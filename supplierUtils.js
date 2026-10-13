// Suppliers: shared data helpers + the "Bought from" supplier picker.
// Collections (under users/{uid}/):
//   suppliers        { name, phone, address, note, openingBalance, createdAt, timestamp }
//   purchases        { date, timestamp, supplierId, supplier, billNo, items[], total, paid, source }
//   supplierPayments { date, timestamp, supplierId, supplier, amount, note, method, purchaseId?, balanceBefore, balanceAfter }
import { col, ref, addDoc, updateDoc } from './common.js?v=55';
import { esc, fmt, todayString, formatDateDMY, parseDMY, attachDateMask, attachNumberFormatting, attachAutoCapitalize, formatWithCommas, toNumber } from './utils.js?v=55';

export const supKey = (name) => String(name || "").trim().toLowerCase();

// Does a purchase / payment record belong to this supplier? (older records only have the name)
export function belongs(rec, id, sup) {
  if (rec.supplierId) return rec.supplierId === id;
  return !!sup && supKey(rec.supplier) === supKey(sup.name);
}

export function itemsText(p) {
  return (p.items || []).map((i) => `${i.name} × ${fmt(i.qty)}${i.unit === "ft" ? " ft" : ""}`).join(", ");
}

// Totals for one supplier.
export function supplierSummary(id, sup, purchases, payments) {
  const bills = purchases.filter(([, p]) => belongs(p, id, sup));
  const pays = payments.filter(([, p]) => belongs(p, id, sup));
  const opening = Number(sup.openingBalance || 0);
  const bought = bills.reduce((a, [, p]) => a + Number(p.total || 0), 0);
  const paid = pays.reduce((a, [, p]) => a + Number(p.amount || 0), 0);
  const last = bills.reduce((m, [, p]) => ((p.date || "") > m ? p.date : m), "");
  const lastPay = pays.reduce((m, [, p]) => ((p.date || "") > m ? p.date : m), "");
  return { bills, pays, opening, bought, paid, balance: opening + bought - paid, last, lastPay };
}

// Running ledger: every bill (+) and payment (−) in date order with the balance before and after.
export function buildLedger(sup, summary) {
  const ev = [];
  if (summary.opening) ev.push({ date: sup.createdAt || "", ts: 0, kind: "open", detail: "Old Remaining Cost (before using this website)", bill: summary.opening, pay: 0 });
  summary.bills.forEach(([id, p]) => ev.push({ date: p.date || "", ts: p.timestamp || 0, kind: "bill", id, detail: itemsText(p), billNo: p.billNo || "", bill: Number(p.total || 0), pay: 0 }));
  summary.pays.forEach(([id, p]) => ev.push({ date: p.date || "", ts: p.timestamp || 0, kind: "pay", id, detail: p.note || "Payment", method: p.method || "", bill: 0, pay: Number(p.amount || 0) }));
  ev.sort((a, b) => (a.kind === "open" ? -1 : b.kind === "open" ? 1 : 0) || a.date.localeCompare(b.date) || a.ts - b.ts);
  let bal = 0;
  ev.forEach((e) => { e.before = bal; bal += e.bill - e.pay; e.after = bal; });
  return ev;
}

// Creates the supplier when "Add new supplier" was picked (or reuses one with the same name).
export async function ensureSupplier(uid, pick, suppliers) {
  if (pick.id) return { id: pick.id, name: pick.name, phone: pick.phone || "" };
  const name = pick.newName.trim();
  const same = suppliers.find(([, s]) => supKey(s.name) === supKey(name));
  if (same) return { id: same[0], name: same[1].name, phone: same[1].phone || "" };
  const d = await addDoc(col(uid, "suppliers"), { name, phone: pick.newPhone || "", address: "", note: "", openingBalance: 0, createdAt: todayString(), timestamp: Date.now() });
  return { id: d.id, name, phone: pick.newPhone || "" };
}

// Saves one purchase bill (+ the money paid with it) in the supplier's record.
export async function recordPurchase(uid, { sup, date, items, paid, billNo = "", balanceBefore = 0, source = "purchase", addedToStock = true, extra = {} }) {
  const total = items.reduce((a, i) => a + i.total, 0);
  const pay = Math.min(Math.max(0, paid), total);
  const ts = Date.now();
  const d = await addDoc(col(uid, "purchases"), {
    date, timestamp: ts, supplierId: sup.id, supplier: sup.name, supplierPhone: sup.phone || "",
    billNo, items, total, paid: pay, addedToStock, source, ...extra
  });
  if (pay > 0) {
    await addDoc(col(uid, "supplierPayments"), {
      date, timestamp: ts + 1, supplierId: sup.id, supplier: sup.name, amount: pay, purchaseId: d.id,
      note: "Paid with bill", method: "Cash", balanceBefore: balanceBefore + total, balanceAfter: balanceBefore + total - pay
    });
  }
  return { id: d.id, total, paid: pay };
}

// A payment to a supplier. Settles the oldest unpaid bills first.
export async function paySupplier(uid, { id, sup, amount, date, note, method, bills, balance }) {
  let left = amount;
  const open = bills.filter(([, p]) => Number(p.total || 0) > Number(p.paid || 0))
    .sort((a, b) => (a[1].date || "").localeCompare(b[1].date || "") || (a[1].timestamp || 0) - (b[1].timestamp || 0));
  for (const [pid, p] of open) {
    if (left <= 0) break;
    const part = Math.min(left, Number(p.total || 0) - Number(p.paid || 0));
    await updateDoc(ref(uid, "purchases", pid), { paid: Number(p.paid || 0) + part });
    left -= part;
  }
  await addDoc(col(uid, "supplierPayments"), {
    date, timestamp: Date.now(), supplierId: id, supplier: sup.name, amount, note: note || "Payment", method: method || "Cash",
    balanceBefore: balance, balanceAfter: balance - amount
  });
}

// ---------- "Bought from" picker (used in Add Product and New Purchase) ----------

export function pickerHtml(p, { allowNone = false, showMoney = true } = {}) {
  return `
  <div class="buy-box" id="${p}-box">
    <div class="buy-head"><span class="buy-title">Bought from</span><span class="hint">Saved in the supplier's record with today's purchase</span></div>
    <div class="grid2">
      <label class="fgroup full"><span class="lbl">Supplier <span class="req">*</span></span>
        <select class="inp" id="${p}-sup"></select>
      </label>
      <div class="newsup full" id="${p}-new" hidden>
        <span class="newsup-t">New supplier</span>
        <div class="grid2">
          <label class="fgroup"><span class="lbl">Supplier name <span class="req">*</span></span><input class="inp" type="text" id="${p}-nname" placeholder="e.g. Al-Noor Pumps Co." autocomplete="off"></label>
          <label class="fgroup"><span class="lbl">Phone</span><input class="inp" type="text" inputmode="numeric" id="${p}-nphone" placeholder="Digits only"></label>
        </div>
      </div>
      ${showMoney ? `
      <label class="fgroup buy-money" id="${p}-datew"><span class="lbl">Purchase date <span class="req">*</span></span><input class="inp mono" type="text" inputmode="numeric" id="${p}-date" placeholder="DD-MM-YY"></label>
      <label class="fgroup buy-money" id="${p}-paidw"><span class="lbl">Paid now <span class="req">*</span></span><span class="ibox"><span class="aff">Rs</span><input type="text" inputmode="numeric" class="mono" id="${p}-paid" placeholder="0"></span></label>
      <div class="buy-sum full buy-money" id="${p}-sum"></div>` : ""}
    </div>
  </div>`;
}

// Wires up the picker. getBill() returns the bill total for the summary line.
export function initPicker(p, { allowNone = false, getBill = () => 0, getBalance = () => 0 } = {}) {
  const $ = (s) => document.getElementById(`${p}-${s}`);
  let suppliers = [];
  const sel = $("sup");
  attachAutoCapitalize($("nname"));
  attachNumberFormatting($("nphone"), false);
  if ($("date")) attachDateMask($("date"));
  if ($("paid")) attachNumberFormatting($("paid"), true);

  function fill(list) {
    suppliers = list;
    const keep = sel.value;
    const sorted = list.slice().sort((a, b) => a[1].name.localeCompare(b[1].name));
    sel.innerHTML = '<option value="">Choose supplier…</option>' +
      sorted.map(([id, s]) => `<option value="${id}">${esc(s.name)}${s.phone ? " · " + esc(s.phone) : ""}</option>`).join("") +
      '<option value="__new">+ Add new supplier</option>' +
      (allowNone ? '<option value="__none">No supplier (old stock already in shop)</option>' : "");
    if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
  }
  function sync() {
    const v = sel.value;
    $("new").hidden = v !== "__new";
    const money = v !== "__none";
    document.querySelectorAll(`#${p}-box .buy-money`).forEach((e) => { e.hidden = !money; });
    summary();
  }
  function summary() {
    const s = $("sum");
    if (!s) return;
    const bill = getBill(), paid = Math.min(toNumber($("paid").value), bill);
    if (!bill) { s.innerHTML = "Enter the quantity and cost price to see the bill."; return; }
    const v = sel.value, bal = v && v !== "__new" && v !== "__none" ? getBalance(v) : 0;
    s.innerHTML = `Bill <b>Rs ${fmt(bill)}</b> · Paid <b>Rs ${fmt(paid)}</b> · Remaining Cost <b class="${bill - paid > 0 ? "t-amber" : "t-green"}">Rs ${fmt(bill - paid)}</b>` +
      (bill - paid > 0 ? ` <span class="muted">→ added to this supplier's Remaining Cost${bal ? " (now Rs " + fmt(bal) + ", after Rs " + fmt(bal + bill - paid) + ")" : ""}</span>` : "");
  }
  sel.addEventListener("change", () => { sync(); if (sel.value === "__new") $("nname").focus(); });
  if ($("paid")) $("paid").addEventListener("input", summary);

  return {
    setSuppliers: fill,
    summary,
    reset({ paidFull = true } = {}) {
      sel.value = ""; $("nname").value = ""; $("nphone").value = "";
      if ($("date")) $("date").value = formatDateDMY(todayString());
      if ($("paid")) $("paid").value = "0";
      sync();
    },
    select(id) { if ([...sel.options].some((o) => o.value === id)) { sel.value = id; sync(); } },
    // Returns { none } | { id, name, phone } | { newName, newPhone }, plus date & paid — or { error }.
    read() {
      const v = sel.value;
      if (!v) return { error: "Please choose the supplier you bought it from (or add a new supplier)." };
      if (v === "__none") return { none: true };
      const out = {};
      if (v === "__new") {
        const name = $("nname").value.trim();
        if (!name) return { error: "Please enter the new supplier's name." };
        Object.assign(out, { newName: name, newPhone: $("nphone").value });
      } else {
        const s = suppliers.find((x) => x[0] === v);
        Object.assign(out, { id: v, name: s ? s[1].name : "", phone: s ? s[1].phone || "" : "" });
      }
      if ($("date")) {
        out.date = parseDMY($("date").value);
        if (!out.date) return { error: "Please enter the purchase date as DD-MM-YY." };
        if (!$("paid").value.trim()) return { error: "Please enter how much you paid now (write 0 if nothing)." };
        out.paid = toNumber($("paid").value);
      }
      return out;
    },
    formatPaid(v) { $("paid").value = formatWithCommas(String(v)); summary(); }
  };
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function dayName(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return DAYS[new Date(y, m - 1, d).getDay()];
}
