import { confirmDialog } from './dialogs.js?v=55';
import { start, listen, col, ref, addDoc, updateDoc, deleteDoc, showToast } from './common.js?v=55';
import {
  CATEGORY_LABELS, CATEGORY_ORDER, ICONS, esc, fmt, formatDateDMY, todayString, parseDMY, attachDateMask, attachNumberFormatting,
  attachAutoCapitalize, formatWithCommas, toNumber, withButtonLock, initials, pillHtml, byFeet, isCable, metres, perBundle, sellNameOf, productName
} from './utils.js?v=55';
import { shopSummary } from './shopUtils.js?v=55';
import { buildStatement, dayOf } from './partyUtils.js?v=55';
import { highlightWords as hw } from './utils.js?v=55';

const el = (id) => document.getElementById(id);
const sid = new URLSearchParams(location.search).get("id") || "";
let uid = null;
let shops = [], bills = [], pays = [], products = [];
const loaded = { s: false, b: false, p: false };
let tab = "ledger";
let q = "";
// Search: every word must appear somewhere in the line.
const hit = (...parts) => { if (!q) return true; const t = parts.join(" ").toLowerCase().replace(/,/g, ""); return q.replace(/,/g, "").split(/\s+/).every((w) => t.includes(w)); };
const noHits = '<div class="empty"><strong>Nothing found</strong>Try another word, date (DD-MM-YY) or amount.</div>';

start((user) => {
  uid = user.uid;
  listen(uid, "shops", (r) => { shops = r; loaded.s = true; render(); });
  listen(uid, "shopBills", (r) => { bills = r; loaded.b = true; render(); });
  listen(uid, "shopPayments", (r) => { pays = r; loaded.p = true; render(); });
  listen(uid, "products", (r) => { products = r; if (el("give-modal").classList.contains("active")) renderLines(); });
});

const current = () => { const r = shops.find((x) => x[0] === sid); return r ? r[1] : null; };
const summary = () => shopSummary(sid, current(), bills, pays);
const productById = (id) => { const r = products.find((x) => x[0] === id); return r ? r[1] : null; };
const available = (p) => (byFeet(p) ? metres(p) : Number(p.quantity || 0));

function render() {
  if (!loaded.s || !loaded.b || !loaded.p) return;
  const s = current();
  el("sh-missing").hidden = !!s;
  el("sh-page").hidden = !s;
  if (!s) return;
  const sum = summary();
  document.title = s.name + " - Star Pump House";
  el("sh-av").textContent = initials(s.name);
  el("sh-name").textContent = s.name;
  el("sh-meta").textContent = [s.owner, s.phone, s.address, "Since " + formatDateDMY(s.createdAt || todayString())].filter(Boolean).join(" · ");
  el("sh-note").textContent = s.note || "";
  el("sh-bill-btn").href = "supplier-bill.html?type=shop&id=" + encodeURIComponent(sid);
  const rem = sum.remaining;
  el("sh-stats").innerHTML = `
    <div><span class="l">Total stock given (Rs)</span><span class="v">${fmt(sum.given + sum.opening)}</span></div>
    <div><span class="l">${sum.returned ? "Received + returned (Rs)" : "Total received (Rs)"}</span><span class="v t-green">${fmt(sum.received + sum.returned)}</span>${sum.returned ? `<span class="l" style="margin-top:2px">Rs ${fmt(sum.returned)} of it is items returned</span>` : ""}</div>
    <div class="${rem > 0 ? "owe" : ""}"><span class="l">${rem < 0 ? "Advance from them (Rs)" : "Remaining Amount (Rs)"}</span><span class="v ${rem > 0 ? "t-amber" : "t-green"}">${fmt(Math.abs(rem))}</span></div>
    <div><span class="l">Stock bills</span><span class="v">${fmt(sum.bills.length)}</span></div>
    <div><span class="l">Last payment</span><span class="v" style="font-size:16px">${sum.lastPay ? formatDateDMY(sum.lastPay) : "—"}</span></div>`;
  document.querySelectorAll("#sh-tabs [data-tab]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === tab)));
  if (tab === "ledger") renderLedger(s, sum);
  else if (tab === "bills") renderBills(sum);
  else renderProducts(sum);
}

// "Bill / Before": a bill shows its amount (and what was remaining before it, underneath);
// a payment shows what was remaining before it. Paid takes it off, and the last column is the new remaining.
function beforeCell(r) {
  if (r.kind === "pay") return `<span class="stk"><span class="w500">${hw(fmt(r.prev), q)}</span><span class="before-l">Remaining before</span></span>`;
  if (r.kind === "open") return hw(fmt(r.bill), q);
  return `<span class="stk"><span>${hw(fmt(r.bill), q)}</span>${r.prev ? `<span class="before-l">Before: ${fmt(r.prev)}</span>` : ""}</span>`;
}

function renderLedger(s, sum) {
  const rows = buildStatement({ opening: sum.opening, openingDate: s.createdAt || "", bills: sum.bills, pays: sum.pays, linkField: "billId" });
  const shown = rows.filter((r) => hit(r.date && formatDateDMY(r.date), r.day, r.detail, r.billNo, r.method, r.bill, r.paid, r.remaining, r.kind === "pay" ? "received" : r.kind === "open" ? "old balance" : "stock bill")).reverse();
  const cols = "44px 120px minmax(240px,2fr) 150px 130px 120px 150px 48px";
  el("sh-body").innerHTML = `<div class="scroll-x"><div style="min-width:1030px">
    <div class="head" style="grid-template-columns:${cols}"><span>#</span><span>Date</span><span>Entry</span><span class="num">Bill / Before (Rs)</span><span class="num">Received (Rs)</span><span>Received by</span><span class="num">Remaining</span><span></span></div>` +
    shown.map((r) => `<div class="row khata-row ${r.kind === "pay" ? "ledger-pay" : ""}" style="grid-template-columns:${cols}">
      <span class="num muted">${r.n}</span>
      <span class="stk"><span class="num w500">${r.date ? hw(formatDateDMY(r.date), q) : "—"}</span><span class="muted" style="font-size:12px">${hw(r.day, q)}</span></span>
      <span class="stk"><span class="ln"><span class="pill ${r.kind === "pay" ? (r.method === "Return" ? "b-exch" : "b-paid") : r.kind === "open" ? "cat-other" : "b-pend"}">${r.kind === "pay" ? (r.method === "Return" ? "Returned" : "Received") : r.kind === "open" ? "Old balance" : "Stock bill"}</span>${r.billNo ? `<span class="muted" style="font-size:12px">No. ${hw(r.billNo, q)}</span>` : ""}</span><span class="ln" style="font-size:13px">${hw(r.detail, q)}</span></span>
      <span class="num">${beforeCell(r)}</span>
      <span class="num t-green strong">${r.paid ? hw(fmt(r.paid), q) : '<span class="t-dim">—</span>'}</span>
      <span style="font-size:13px">${r.paid ? hw(r.method === "Return" ? "Items returned" : (r.method || "Cash"), q) : '<span class="t-dim">—</span>'}</span>
      <span class="num strong ${r.remaining > 0 ? "t-amber" : "t-green"}">${fmt(r.remaining)}</span>
      <span>${r.kind === "pay" ? `<button type="button" class="iconbtn del" data-delpay="${r.id}" aria-label="Delete payment">${ICONS.del}</button>` : ""}</span>
    </div>`).join("") +
    (rows.length && !shown.length ? noHits : "") + (rows.length ? "" : '<div class="empty"><strong>Nothing yet</strong>Press "Give stock" when you give items to this shop.</div>') + "</div></div>";
}

function renderBills(sum) {
  const list = sum.bills.slice().sort((a, b) => (b[1].date || "").localeCompare(a[1].date || "") || (b[1].timestamp || 0) - (a[1].timestamp || 0)).filter(([, b]) => hit(formatDateDMY(b.date), dayOf(b.date), b.billNo, b.total, b.paid, ...(b.items || []).map((i) => i.name + " " + (i.category || ""))));
  const recvOf = (id) => sum.pays.filter(([, p]) => p.billId === id).reduce((a, [, p]) => a + Number(p.amount || 0), 0);
  el("sh-body").innerHTML = list.length ? '<div class="bills">' + list.map(([id, b]) => {
    const got = recvOf(id);
    return `<div class="bill-card">
      <div class="bill-top">
        <span class="stk"><span class="w500" style="font-weight:600">${hw(formatDateDMY(b.date), q)} · ${hw(dayOf(b.date), q)}${b.billNo ? ` · Bill no. ${hw(b.billNo, q)}` : ""}</span><span class="muted" style="font-size:12px">Stock given</span></span>
        <span style="display:flex;align-items:center;gap:6px"><span class="pill b-exch">Rs ${fmt(b.total)}</span><button type="button" class="iconbtn del" data-delbill="${id}" aria-label="Delete bill">${ICONS.del}</button></span>
      </div>
      <div class="bill-items">${(b.items || []).map((i) => `<div class="bill-item"><span>${pillHtml(i.category)}</span><span class="w500">${hw(i.name, q)}</span><span class="num muted">${fmt(i.qty)} ${i.unit === "ft" ? "ft" : "pcs"} × Rs ${fmt(i.price)}</span><span class="num strong">Rs ${hw(fmt(i.total), q)}</span></div>`).join("")}</div>
      <div class="bill-foot"><span>Total <b class="num">Rs ${fmt(b.total)}</b></span><span>Received with bill <b class="num t-green">Rs ${fmt(got)}</b></span></div>
    </div>`;
  }).join("") + "</div>"
    : sum.bills.length ? noHits : '<div class="empty"><strong>No stock given yet</strong>Press "Give stock".</div>';
}

function renderProducts(sum) {
  const map = new Map();
  sum.bills.forEach(([, b]) => (b.items || []).forEach((i) => {
    const k = i.productId || i.name;
    let a = map.get(k);
    if (!a) { a = { name: i.name, cat: i.category, unit: i.unit, times: 0, qty: 0, total: 0, lastPrice: 0, last: "" }; map.set(k, a); }
    a.times++; a.qty += Number(i.qty || 0); a.total += Number(i.total || 0);
    if ((b.date || "") >= a.last) { a.last = b.date || ""; a.lastPrice = i.price; }
  }));
  const rows = [...map.values()].filter((r) => hit(r.name, r.cat, formatDateDMY(r.last), dayOf(r.last))).sort((a, b) => (b.last || "").localeCompare(a.last || ""));
  const cols = "minmax(220px,1.8fr) 130px 110px 130px 140px 130px 110px";
  el("sh-body").innerHTML = `<div class="scroll-x"><div style="min-width:980px"><div class="head" style="grid-template-columns:${cols}"><span>Product</span><span>Category</span><span class="num">Times given</span><span class="num">Total qty</span><span class="num">Total (Rs)</span><span class="num">Last price</span><span>Last given</span></div>` +
    rows.map((r) => `<div class="row" style="grid-template-columns:${cols}"><span class="w500">${hw(r.name, q)}</span><span>${pillHtml(r.cat)}</span><span class="num">${fmt(r.times)}</span><span class="num">${fmt(r.qty)} ${r.unit === "ft" ? "ft" : "pcs"}</span><span class="num strong">${fmt(r.total)}</span><span class="num">${fmt(r.lastPrice)}</span><span class="stk"><span class="num muted">${hw(formatDateDMY(r.last), q)}</span><span class="muted" style="font-size:12px">${hw(dayOf(r.last), q)}</span></span></div>`).join("") +
    (rows.length ? "" : map.size ? noHits : '<div class="empty"><strong>No products yet</strong></div>') + "</div></div>";
}

el("sh-q").addEventListener("input", (e) => { q = e.target.value.trim().toLowerCase(); render(); });
el("sh-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; render(); } });

el("sh-body").addEventListener("click", async (e) => {
  const dp = e.target.closest("[data-delpay]");
  if (dp) {
    const r = pays.find((x) => x[0] === dp.dataset.delpay);
    if (!r || !(await confirmDialog({ title: "Delete this payment?", message: `Rs ${fmt(r[1].amount)} received on ${formatDateDMY(r[1].date)} will be removed and added back to the remaining amount.`, confirmLabel: "Delete", danger: true }))) return;
    try { await deleteDoc(ref(uid, "shopPayments", r[0])); } catch (error) { alert("Error deleting payment: " + error.message); }
    return;
  }
  const db = e.target.closest("[data-delbill]");
  if (db) {
    const r = bills.find((x) => x[0] === db.dataset.delbill);
    if (!r || !(await confirmDialog({ title: "Delete this stock bill?", message: "The items will be put back in your Stock List and the money received with this bill will be removed too.", confirmLabel: "Delete bill", danger: true }))) return;
    try {
      for (const i of r[1].items || []) {
        const p = productById(i.productId);
        if (!p) continue;
        await updateDoc(ref(uid, "products", i.productId), stockPatch(p, Math.max(0, Number(i.qty || 0) - Number(i.returnedQty || 0))));
      }
      for (const [pid, p] of pays.filter(([, p]) => p.billId === r[0])) await deleteDoc(ref(uid, "shopPayments", pid));
      await deleteDoc(ref(uid, "shopBills", r[0]));
    } catch (error) { alert("Error deleting bill: " + error.message); }
  }
});

// Change stock by +delta (put back) or −delta (given out).
function stockPatch(p, delta) {
  if (byFeet(p)) {
    const len = Math.max(0, metres(p) + delta);
    const patch = { length: len + "ft" };
    const per = isCable(p) ? perBundle(p) : 0;
    if (per > 0) { patch.bundle = String(Math.max(0, Math.ceil(len / per - 1e-9))); patch.perBundle = per; }
    return patch;
  }
  return { quantity: Math.max(0, Number(p.quantity || 0) + delta) };
}

// ---------- Give stock ----------
let lines = [];
attachDateMask(el("g-date"));
attachNumberFormatting(el("g-recv"), true);
const lineTotal = (l) => toNumber(l.qty) * toNumber(l.price);
const GCOLS = "minmax(280px,2fr) 150px 170px 140px 48px";

function options(selected) {
  const sorted = products.slice().sort((a, b) => CATEGORY_ORDER.indexOf(a[1].category) - CATEGORY_ORDER.indexOf(b[1].category) || productName(a[1]).localeCompare(productName(b[1])));
  return '<option value="">Choose a product…</option>' + CATEGORY_ORDER.map((cat) => {
    const opts = sorted.filter(([, p]) => p.category === cat);
    if (!opts.length) return "";
    return `<optgroup label="${CATEGORY_LABELS[cat]}">` + opts.map(([id, p]) => `<option value="${id}"${id === selected ? " selected" : ""}${available(p) <= 0 ? " disabled" : ""}>${esc(sellNameOf(p))} · ${fmt(available(p))} ${byFeet(p) ? "ft" : "pcs"} left</option>`).join("") + "</optgroup>";
  }).join("");
}
function gTotals() {
  const bill = lines.reduce((a, l) => a + lineTotal(l), 0), recv = Math.min(toNumber(el("g-recv").value), bill);
  el("g-total").textContent = fmt(bill); el("g-due").textContent = fmt(bill - recv);
}
function renderLines() {
  el("g-lines").innerHTML = `<div class="head" style="grid-template-columns:${GCOLS};height:40px"><span>Product</span><span class="num">Qty</span><span class="num">Price (Rs)</span><span class="num">Line total</span><span></span></div>` +
    lines.map((l, i) => {
      const p = productById(l.productId), unit = p && byFeet(p) ? "ft" : "pcs";
      return `<div class="row" style="grid-template-columns:${GCOLS}" data-i="${i}">
        <select class="inp sm" data-k="productId" aria-label="Product">${options(l.productId)}</select>
        <span class="ibox" style="height:44px"><input type="text" inputmode="numeric" class="mono" data-k="qty" value="${esc(l.qty)}" placeholder="0" aria-label="Quantity"><span class="aff">${unit}</span></span>
        <span class="ibox" style="height:44px"><span class="aff">Rs</span><input type="text" inputmode="numeric" class="mono" data-k="price" value="${esc(l.price)}" placeholder="0" aria-label="Price"><span class="aff">${unit === "ft" ? "/ ft" : ""}</span></span>
        <span class="num strong" data-total>${fmt(lineTotal(l))}</span>
        <span>${lines.length > 1 ? `<button type="button" class="iconbtn del" data-rm="${i}" aria-label="Remove item">${ICONS.del}</button>` : ""}</span>
      </div>`;
    }).join("");
  gTotals();
}
el("g-lines").addEventListener("change", (e) => {
  if (e.target.dataset.k !== "productId") return;
  const i = Number(e.target.closest("[data-i]").dataset.i), p = productById(e.target.value);
  lines[i].productId = e.target.value;
  if (p && !toNumber(lines[i].price)) lines[i].price = formatWithCommas(p.price);
  renderLines();
});
el("g-lines").addEventListener("input", (e) => {
  const k = e.target.dataset.k;
  if (k !== "qty" && k !== "price") return;
  const row = e.target.closest("[data-i]"), i = Number(row.dataset.i);
  e.target.value = k === "price" ? formatWithCommas(e.target.value) : String(toNumber(e.target.value) || "");
  lines[i][k] = e.target.value;
  row.querySelector("[data-total]").textContent = fmt(lineTotal(lines[i]));
  gTotals();
});
el("g-lines").addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (b) { lines.splice(Number(b.dataset.rm), 1); renderLines(); } });
el("g-add").addEventListener("click", () => { lines.push({ productId: "", qty: "", price: "" }); renderLines(); });
el("g-recv").addEventListener("input", gTotals);

el("sh-give-btn").addEventListener("click", () => {
  lines = [{ productId: "", qty: "", price: "" }];
  el("g-date").value = formatDateDMY(todayString()); el("g-billno").value = ""; el("g-recv").value = "0";
  el("give-title").textContent = "Give stock to " + current().name;
  renderLines();
  el("give-modal").classList.add("active");
});
if (new URLSearchParams(location.search).get("give")) { const t = setInterval(() => { if (current()) { clearInterval(t); el("sh-give-btn").click(); } }, 200); setTimeout(() => clearInterval(t), 8000); }
el("give-close").addEventListener("click", () => el("give-modal").classList.remove("active"));

el("g-save").addEventListener("click", (e) => withButtonLock(e.currentTarget, async () => {
  const s = current();
  const date = parseDMY(el("g-date").value);
  if (!date) { alert("Please enter the date as DD-MM-YY."); return; }
  if (!el("g-recv").value.trim()) { alert("Please enter how much you received now (write 0 if nothing)."); return; }
  const used = lines.filter((l) => l.productId || toNumber(l.qty));
  if (!used.length) { alert("Please add at least one item."); return; }
  const need = new Map();
  for (const l of used) {
    const p = productById(l.productId);
    if (!p) { alert("Please choose a product for every item."); return; }
    if (toNumber(l.qty) <= 0) { alert(`Please enter the quantity for ${sellNameOf(p)}.`); return; }
    if (toNumber(l.price) <= 0) { alert(`Please enter the price for ${sellNameOf(p)}.`); return; }
    need.set(l.productId, (need.get(l.productId) || 0) + toNumber(l.qty));
  }
  for (const [id, q] of need) { const p = productById(id); if (q > available(p)) { alert(`Only ${fmt(available(p))} ${byFeet(p) ? "ft" : "pcs"} of ${sellNameOf(p)} left in stock.`); return; } }
  const items = used.map((l) => {
    const p = productById(l.productId), qty = toNumber(l.qty), price = toNumber(l.price);
    return { productId: l.productId, name: sellNameOf(p), category: p.category, qty, unit: byFeet(p) ? "ft" : "pcs", price, cost: Math.round(Number(p.cost || 0) * qty), total: qty * price };
  });
  const total = items.reduce((a, i) => a + i.total, 0);
  const recv = Math.min(toNumber(el("g-recv").value), total);
  try {
    for (const [id, q] of need) await updateDoc(ref(uid, "products", id), stockPatch(productById(id), -q));
    const ts = Date.now();
    const d = await addDoc(col(uid, "shopBills"), { date, timestamp: ts, shopId: sid, shop: s.name, billNo: el("g-billno").value.trim(), items, total, received: recv });
    if (recv > 0) await addDoc(col(uid, "shopPayments"), { date, timestamp: ts + 1, shopId: sid, shop: s.name, amount: recv, method: "Cash", note: "Received with bill", billId: d.id });
    el("give-modal").classList.remove("active");
    tab = "ledger"; render();
    showToast(el("toast"), `<span>Stock bill of Rs ${fmt(total)} saved for ${esc(s.name)}. Items taken out of Stock.</span>`);
  } catch (error) { alert("Error saving: " + error.message); }
}));

// ---------- Receive payment ----------
attachNumberFormatting(el("recv-amount"), true);
attachDateMask(el("recv-date"));
attachAutoCapitalize(el("recv-note"));
function preview() {
  const rem = summary().remaining, amt = toNumber(el("recv-amount").value);
  el("recv-preview").innerHTML = `<div><span>Remaining now</span><b class="num">Rs ${fmt(rem)}</b></div><div><span>Received</span><b class="num t-green">Rs ${fmt(amt)}</b></div><div class="after"><span>Remaining after</span><b class="num ${rem - amt > 0 ? "t-amber" : "t-green"}">Rs ${fmt(rem - amt)}</b></div>`;
}
el("sh-recv-btn").addEventListener("click", () => {
  const rem = summary().remaining;
  el("recv-title").textContent = "Receive from " + current().name;
  el("recv-sub").textContent = rem > 0 ? `Remaining: Rs ${fmt(rem)}.` : "Nothing is remaining right now.";
  el("recv-amount").value = ""; el("recv-date").value = formatDateDMY(todayString()); el("recv-method").value = "Cash"; el("recv-note").value = "";
  preview();
  el("recv-modal").classList.add("active");
  setTimeout(() => el("recv-amount").focus(), 50);
});
el("recv-amount").addEventListener("input", preview);
const closeRecv = () => el("recv-modal").classList.remove("active");
el("recv-close").addEventListener("click", closeRecv);
el("recv-cancel").addEventListener("click", closeRecv);
el("recv-save").addEventListener("click", (e) => withButtonLock(e.currentTarget, async () => {
  const amount = toNumber(el("recv-amount").value), date = parseDMY(el("recv-date").value);
  if (amount <= 0) { alert("Please enter the amount you received."); return; }
  if (!date) { alert("Please enter the date as DD-MM-YY."); return; }
  const s = current(), rem = summary().remaining;
  try {
    await addDoc(col(uid, "shopPayments"), { date, timestamp: Date.now(), shopId: sid, shop: s.name, amount, method: el("recv-method").value, note: el("recv-note").value.trim() || "Payment received" });
    closeRecv();
    tab = "ledger"; render();
    showToast(el("toast"), `<span>Rs ${fmt(amount)} received. Remaining for ${esc(s.name)} is now Rs ${fmt(rem - amount)}.</span><a href="supplier-bill.html?type=shop&id=${encodeURIComponent(sid)}">Total Bill</a>`);
  } catch (error) { alert("Error saving payment: " + error.message); }
}));

// ---------- Edit shop ----------
["e-name", "e-owner", "e-address"].forEach((i) => attachAutoCapitalize(el(i)));
attachNumberFormatting(el("e-phone"), false);
attachNumberFormatting(el("e-opening"), true);
const closeEdit = () => el("edit-modal").classList.remove("active");
el("sh-edit-btn").addEventListener("click", () => {
  const s = current();
  el("e-name").value = s.name || ""; el("e-owner").value = s.owner || ""; el("e-phone").value = s.phone || ""; el("e-address").value = s.address || "";
  el("e-opening").value = s.openingBalance ? formatWithCommas(s.openingBalance) : ""; el("e-note").value = s.note || "";
  el("edit-modal").classList.add("active");
});
el("edit-close").addEventListener("click", closeEdit);
el("edit-cancel").addEventListener("click", closeEdit);
el("edit-save").addEventListener("click", (e) => withButtonLock(e.currentTarget, async () => {
  const name = el("e-name").value.trim();
  if (!name) { alert("Please enter the shop name."); return; }
  try {
    await updateDoc(ref(uid, "shops", sid), { name, owner: el("e-owner").value.trim(), phone: el("e-phone").value, address: el("e-address").value.trim(), openingBalance: toNumber(el("e-opening").value), note: el("e-note").value.trim() });
    closeEdit();
  } catch (error) { alert("Error saving shop: " + error.message); }
}));
