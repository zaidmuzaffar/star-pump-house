import './dialogs.js?v=55';
import { start, listen, showToast, ref, updateDoc } from './common.js?v=55';
import { confirmDialog } from './dialogs.js?v=55';
import {
  esc, fmt, formatDateDMY, todayString, highlightMatch, groupBills, itemText, saleQtyText,
  remainingOf, phoneKey, nameKey, initials, digitsOnly, toNumber, formatWithCommas, withButtonLock, withReturns, saleUnitName, mergeSameDay
} from './utils.js?v=55';
import { receiveFromCustomer } from './custPay.js?v=55';

const el = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let uid = null;
let sales = [];      // [[id, data]]
let payments = [];   // [data]
let paymentDocs = []; // [[id, data]]
let returns = [];    // [[id, data]]
let query = "", filter = "all", picked = params.get("c"), tab = "buys";
let all = [];
let keepPick = null;   // after editing a customer: open them again once the new details arrive

start((user) => {
  uid = user.uid;
  listen(uid, "sales", (rows) => { sales = rows; render(); });
  listen(uid, "payments", (rows) => { paymentDocs = rows; payments = rows.map((r) => r[1]); render(); });
  listen(uid, "returns", (rows) => { returns = rows; render(); });
});

// One entry per customer. Sales with the same phone number are one customer (spaces, dashes and +92 ignored).
// A sale with only a name joins the customer who has that same name and a phone number.
function buildCustomers() {
  const map = new Map(), byName = new Map();
  const add = (key, b) => {
    let c = map.get(key);
    if (!c) { c = { key, name: "", contact: "", bills: [], total: 0, due: 0, first: b.date || "", last: "", lastTs: -1 }; map.set(key, c); }
    c.bills.push(b);
    c.total += b.amount;
    c.due += b.remaining;
    if (b.date && b.date < c.first) c.first = b.date;
    if (b.timestamp >= c.lastTs) { c.lastTs = b.timestamp; c.last = b.date || c.last; }
    // Name and number come from the newest sale that had a phone number (name-only sales just fill gaps).
    const p = phoneKey(b.customerContact);
    if (p && b.timestamp >= (c.nameTs ?? -1) && b.customerName) { c.nameTs = b.timestamp; c.name = b.customerName.trim(); }
    if (!c.name) c.name = (b.customerName || "").trim();
    if (p) c.contact = p;
  };
  // amounts are after returns (refund / cut udhaar), so Total bought goes down when something comes back
  const bills = groupBills(withReturns(sales, returns));
  bills.forEach((b) => {
    const p = phoneKey(b.customerContact);
    if (!p) return;
    add("c" + p, b);
    const n = nameKey(b.customerName);
    if (n) { const s = byName.get(n) || new Set(); s.add("c" + p); byName.set(n, s); }
  });
  bills.forEach((b) => {
    if (phoneKey(b.customerContact)) return;
    const n = nameKey(b.customerName);
    if (!n) return; // walk-in sale without name or phone
    const owners = byName.get(n);
    add(owners && owners.size === 1 ? [...owners][0] : "n" + n, b);
  });
  return [...map.values()].map((c) => Object.assign(c, { paid: c.total - c.due, visits: mergeSameDay(c.bills).length,  // same customer + same day = one visit
       returns: c.bills.reduce((a, b) => a + b.returnCount, 0), returnedValue: c.bills.reduce((a, b) => a + b.returnedValue, 0) }));
}

function paymentRows(c) {
  const rows = [];
  c.bills.forEach((b) => {
    const logged = payments.filter((p) => p.billKey === b.key);
    const loggedSum = logged.reduce((a, p) => a + Number(p.amount || 0), 0);
    const allNew = b.docs.every((d) => typeof d.paidAtSale === "number");
    const atSale = allNew ? b.docs.reduce((a, d) => a + d.paidAtSale, 0) : Math.max(0, b.received - loggedSum);
    if (atSale > 0) rows.push({ date: b.date, ts: b.timestamp, note: "Cash at sale", amount: atSale });
    logged.forEach((p) => rows.push({ date: p.date, ts: p.timestamp || 0, note: p.note || "Udhaar payment", amount: Number(p.amount || 0) }));
  });
  const ids = new Set(c.bills.flatMap((b) => b.ids));
  returns.forEach(([, r]) => { if (r.saleId && ids.has(r.saleId) && Number(r.refund) > 0) rows.push({ date: r.date, ts: r.timestamp || 0, note: `Cash refund (returned ${r.productName})`, amount: Number(r.refund), refund: true }); });
  return rows.sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.ts - a.ts);
}

function render() {
  all = buildCustomers();
  const month = todayString().slice(0, 7);

  // KPIs
  el("k-count").textContent = fmt(all.length);
  const owing = all.filter((c) => c.due > 0);
  el("k-udhaar").textContent = fmt(owing.reduce((a, c) => a + c.due, 0));
  el("k-owing").textContent = `${owing.length} customer${owing.length === 1 ? "" : "s"} owe money`;
  const top = all.slice().sort((a, b) => b.total - a.total)[0];
  el("k-top").textContent = top ? top.name || top.contact : "—";
  el("k-top-amt").textContent = top ? "Rs " + fmt(top.total) + " bought" : "No sales yet";
  el("k-new").textContent = fmt(all.filter((c) => (c.first || "").startsWith(month)).length);

  // Filters
  el("c-filters").innerHTML = [["all", "All customers", all.length], ["due", "Has udhaar", owing.length]]
    .map(([k, label, n]) => `<button type="button" class="tab" data-f="${k}" aria-pressed="${filter === k}">${label}<span class="cnt">${n}</span></button>`).join("");

  // List
  const q = query.trim().toLowerCase(), qd = digitsOnly(query);
  const list = all
    .filter((c) => (filter === "all" || c.due > 0) && (!q || c.name.toLowerCase().includes(q) || (qd && digitsOnly(c.contact).includes(qd))))
    .sort((a, b) => b.lastTs - a.lastTs);
  if (keepPick && all.some((c) => c.key === keepPick)) { picked = keepPick; keepPick = null; }
  if (!picked || !all.some((c) => c.key === picked)) picked = list[0] ? list[0].key : null;

  el("c-list").innerHTML = list.length ? list.map((c) => `
    <button type="button" class="citem${c.due > 0 ? " owes" : ""}" data-key="${esc(c.key)}" aria-pressed="${c.key === picked}">
      <span class="av">${esc(initials(c.name || c.contact))}</span>
      <span class="cinfo"><span class="cname">${highlightMatch(c.name || "No name", query.trim())}</span><span class="cmeta">${c.contact ? esc(c.contact) + " · " : ""}Last visit ${formatDateDMY(c.last)} · ${c.visits} visit${c.visits === 1 ? "" : "s"}${c.returns ? ` · <span class="t-red">${c.returns} return${c.returns === 1 ? "" : "s"}</span>` : ""}</span></span>
      <span class="due-badge${c.due > 0 ? "" : " clear"}">Rs ${fmt(c.due)}</span>
    </button>`).join("")
    : '<div class="empty"><strong>No customer found</strong>Customers appear here after you sell with a name or phone number.</div>';

  renderDetail(all.find((c) => c.key === picked));
}

function renderDetail(c) {
  const box = el("c-detail");
  if (!c) { box.innerHTML = '<div class="empty"><strong>Pick a customer</strong>Their purchases and payments will show here.</div>'; return; }
  // one line per day: several bills on the same day are one entry, each bill still listed on its own (Bill 1, Bill 2 …)
  const bills = mergeSameDay(c.bills);
  const perBill = (b, fItem, fHead) => b.parts.length > 1 ? b.parts.flatMap((p, i) => [...p.docs.map(fItem), fHead(p, i)]) : b.docs.map(fItem);
  const pays = paymentRows(c);

  let body;
  if (tab === "buys") {
    const cols = "80px minmax(120px,1.6fr) 60px 88px 104px 88px";
    const lines = (arr) => `<span class="stk">${arr.map((x) => `<span class="ln">${x}</span>`).join("")}</span>`;
    body = `<div class="scroll-x"><div class="ctable"><div class="head" style="grid-template-columns:${cols};padding:0 24px"><span>Date</span><span>Items</span><span class="num">Qty</span><span class="num">Total (Rs)</span><span class="num">Returned</span><span class="num">Remaining</span></div>` +
      bills.map((b) => { const r = b.remaining, ret = b.returnCount > 0; return `<div class="row bill${ret ? " ret-row" : r > 0 ? " due-row" : ""}" style="grid-template-columns:${cols};padding:10px 24px;min-height:52px">
        <span class="num muted stk"><span class="ln">${formatDateDMY(b.date)}</span><span class="ln" style="font-size:12px">${esc(b.time || "")}</span></span>
        ${lines(perBill(b, (d) => `<span class="w500">${esc(d.productName || itemText(d))}</span>`, (p, i) => `<span class="bill-tag">Bill ${i + 1} · ${esc(p.time || "")} · Rs ${fmt(p.origAmount)}</span>`))}
        <span class="num">${lines(perBill(b, (d) => esc(saleQtyText(d)), () => '<span class="bill-tag-gap"></span>'))}</span>
        <span class="num strong stk"><span class="ln">${fmt(b.origAmount)}</span>${b.parts.length > 1 ? `<span class="ln bills-note">${b.parts.length} bills</span>` : b.docs.length > 1 ? `<span class="ln muted" style="font-size:12px;font-weight:400">${b.docs.length} items</span>` : ""}</span>
        <span class="num ${ret ? "t-red strong" : "t-dim"}">${ret ? `<span class="stk"><span>${b.returnedValue ? "Rs " + fmt(b.returnedValue) : "Exchanged"}</span><span style="font-size:12px;font-weight:500">${fmt(b.returnedQty)} back</span></span>` : "0"}</span>
        <span class="num ${r > 0 ? "t-amber strong" : "t-green"}">${fmt(r)}</span></div>`; }).join("") + "</div></div>";
  } else {
    const cols = "100px minmax(160px,1fr) 140px";
    body = `<div class="head" style="grid-template-columns:${cols};padding:0 24px"><span>Date</span><span>Note</span><span class="num">Amount (Rs)</span></div>` +
      (pays.length ? pays.map((p) => `<div class="row${p.refund ? " ret-row" : ""}" style="grid-template-columns:${cols};padding:8px 24px;min-height:52px"><span class="num muted">${formatDateDMY(p.date)}</span><span>${esc(p.note)}</span><span class="num ${p.refund ? "t-red" : "t-green"} strong">${p.refund ? "Refund " : ""}${fmt(p.amount)}</span></div>`).join("")
        : '<div class="empty"><strong>No payments yet</strong></div>');
  }

  const saleHref = "stock.html?" + new URLSearchParams({ cname: c.name || "", cphone: c.contact || "", c: c.key }).toString();
  box.innerHTML = `
    <div class="chead">
      <span class="av lg">${esc(initials(c.name || c.contact))}</span>
      <div class="who"><h2>${esc(c.name || "No name")}</h2><span class="sub">${c.contact ? esc(c.contact) + " · " : ""}Customer since ${formatDateDMY(c.first)}</span></div>
      <div class="ph-actions"><button type="button" class="btn sec edit-c" id="c-edit-btn" aria-label="Edit name and number"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"></path><path d="M13.5 6.5l4 4"></path></svg>Edit</button>${c.due > 0 ? '<button type="button" class="btn sec" id="c-recv-btn">Receive payment</button>' : ""}<a href="${esc(saleHref)}" class="btn pri" id="c-sale-btn">New Sale</a></div>
    </div>
    <div class="stats">
      <div><span class="l">Total bought (Rs)</span><span class="v">${fmt(c.total)}</span>${c.returnedValue ? `<span class="l t-red">Rs ${fmt(c.returnedValue)} returned</span>` : ""}</div>
      <div><span class="l">Paid (Rs)</span><span class="v t-green">${fmt(c.paid)}</span></div>
      <div class="${c.due > 0 ? "owe" : ""}"><span class="l">Udhaar (Rs)</span><span class="v ${c.due > 0 ? "t-amber" : "t-green"}">${fmt(c.due)}</span></div>
      <div><span class="l">Visits</span><span class="v">${fmt(c.visits)}</span></div>
      <div class="${c.returns ? "ret" : ""}"><span class="l">Returns</span><span class="v ${c.returns ? "t-red" : ""}">${fmt(c.returns)}</span></div>
    </div>
    <div class="subtabs" role="group" aria-label="History type">
      <button type="button" data-tab="buys" aria-pressed="${tab === "buys"}">Purchases</button>
      <button type="button" data-tab="pays" aria-pressed="${tab === "pays"}">Payments</button>
    </div>
    <div style="padding-bottom:8px">${body}</div>`;
}

el("c-search").addEventListener("input", (e) => { query = e.target.value; render(); });
el("c-filters").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (b) { filter = b.dataset.f; picked = null; render(); } });
el("c-list").addEventListener("click", (e) => { const b = e.target.closest("[data-key]"); if (b) { picked = b.dataset.key; render(); } });
el("c-detail").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (b) { tab = b.dataset.tab; render(); return; }
  if (e.target.closest("#c-recv-btn")) openReceive();
  if (e.target.closest("#c-edit-btn")) openEdit();
});

// ---------- Receive payment (stays on this page) ----------
const modal = el("crecv-modal"), amt = el("crecv-amount"), remIn = el("crecv-remaining");
let rc = null, mode = "paid";

function openReceive() {
  rc = all.find((c) => c.key === picked);
  if (!rc || rc.due <= 0) return;
  mode = "paid";
  el("crecv-sub").textContent = [rc.name, rc.contact].filter(Boolean).join(" · ");
  const open = rc.bills.filter((b) => b.remaining > 0).sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.timestamp - b.timestamp);
  el("crecv-bills").innerHTML = open.map((b) => `<div class="crb"><span class="num muted">${formatDateDMY(b.date)}</span><span class="crb-items">${b.docs.map((d) => esc(itemText(d))).join(", ")}</span><span class="num t-amber strong">Rs ${fmt(b.remaining)}</span></div>`).join("");
  amt.value = ""; remIn.value = formatWithCommas(rc.due);
  showMode();
  modal.classList.add("active");
}

function showMode() {
  document.querySelectorAll("#crecv-mode [data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  el("crecv-edit").hidden = mode !== "edit";
  el("crecv-save").textContent = mode === "paid" ? "Mark paid" : "Save payment";
  preview();
  if (mode === "edit") amt.focus();
}

function receivedNow() { return mode === "paid" ? rc.due : Math.min(toNumber(amt.value), rc.due); }

function preview() {
  if (!rc) return;
  const got = receivedNow(), after = rc.due - got;
  el("crecv-preview").innerHTML = `<div><span>Udhaar now</span><b class="num">Rs ${fmt(rc.due)}</b></div><div><span>Received</span><b class="num t-green">Rs ${fmt(got)}</b></div><div class="after"><span>Remaining after</span><b class="num ${after > 0 ? "t-amber" : "t-green"}">Rs ${fmt(after)}</b></div>`;
}

// "Received now" and "Remaining after" are linked: type either one.
amt.addEventListener("input", () => {
  let v = toNumber(amt.value); if (v > rc.due) v = rc.due;
  amt.value = amt.value ? formatWithCommas(v) : "";
  remIn.value = formatWithCommas(rc.due - v) || "0";
  preview();
});
remIn.addEventListener("input", () => {
  let v = toNumber(remIn.value); if (v > rc.due) v = rc.due;
  remIn.value = remIn.value ? formatWithCommas(v) : "";
  amt.value = formatWithCommas(rc.due - v) || "0";
  preview();
});

el("crecv-mode").addEventListener("click", (e) => { const b = e.target.closest("[data-mode]"); if (b) { mode = b.dataset.mode; showMode(); } });
const closeRecv = () => { modal.classList.remove("active"); rc = null; };
el("crecv-cancel").addEventListener("click", closeRecv);
el("crecv-close").addEventListener("click", closeRecv);

el("crecv-save").addEventListener("click", (e) => withButtonLock(e.currentTarget, async () => {
  if (!rc) return;
  const got = receivedNow();
  if (got <= 0) { alert("Please write how much money was received."); amt.focus(); return; }
  try {
    const name = rc.name || rc.contact;
    const left = rc.due - got;
    const keys = new Set(rc.bills.map((b) => b.key));
    await receiveFromCustomer(uid, groupBills(sales).filter((b) => keys.has(b.key)), got);
    closeRecv();
    showToast(el("toast"), `<span>Rs ${fmt(got)} received from ${esc(name)}. ${left > 0 ? "Remaining Rs " + fmt(left) + "." : "All clear."} Pending Payments and Sales Summary are updated.</span>`);
  } catch (error) { alert("Error saving payment: " + error.message); }
}));

// ---------- Edit customer (name / phone) ----------
// Changes the name and number on every sale of this customer, and on their udhaar payments and returns,
// so Sales Summary, Pending Payments, Returns, Cash Closing and this page all show the new details.
let ec = null;
function openEdit() {
  ec = all.find((c) => c.key === picked);
  if (!ec) return;
  el("cedit-sub").textContent = [ec.name, ec.contact].filter(Boolean).join(" · ");
  el("cedit-name").value = ec.name || "";
  el("cedit-phone").value = ec.contact || "";
  const n = ec.bills.reduce((a, b) => a + b.ids.length, 0);
  el("cedit-note").innerHTML = `The new name and number will be saved on all <b>${n} sale${n === 1 ? "" : "s"}</b> of this customer, and changed in Sales Summary, Pending Payments, Returns and Cash Closing too.`;
  el("cedit-modal").classList.add("active");
}
const closeEdit = () => { el("cedit-modal").classList.remove("active"); ec = null; };
el("cedit-cancel").addEventListener("click", closeEdit);
el("cedit-close").addEventListener("click", closeEdit);
el("cedit-save").addEventListener("click", (e) => withButtonLock(e.currentTarget, async () => {
  if (!ec) return;
  const name = el("cedit-name").value.trim().replace(/\s+/g, " ");
  const phoneRaw = el("cedit-phone").value.trim();
  if (!name) { alert("Please write the customer's name."); el("cedit-name").focus(); return; }
  const pk = phoneKey(phoneRaw);
  if (phoneRaw && !pk) { alert("Please check the phone number."); el("cedit-phone").focus(); return; }
  const phone = pk || "";
  if (name === (ec.name || "") && phone === (ec.contact || "")) { closeEdit(); return; }
  // the new number already belongs to another customer -> they become one customer
  const other = phone ? all.find((c) => c.key !== ec.key && c.contact === phone) : null;
  if (other && !(await confirmDialog({ title: "This number is already saved", message: `${phone} belongs to ${other.name || "another customer"}. If you save, both will be shown as one customer named ${name}.`, confirmLabel: "Save anyway" }))) return;
  try {
    const ids = new Set(ec.bills.flatMap((b) => b.ids));
    const keys = new Set(ec.bills.map((b) => b.key));
    if (other) other.bills.forEach((b) => { b.ids.forEach((id) => ids.add(id)); keys.add(b.key); });
    const patch = { customerName: name, customerContact: phone };
    const jobs = [...ids].map((id) => updateDoc(ref(uid, "sales", id), patch));
    paymentDocs.forEach(([id, p]) => { if (keys.has(p.billKey) || (p.saleIds || []).some((x) => ids.has(x))) jobs.push(updateDoc(ref(uid, "payments", id), patch)); });
    returns.forEach(([id, r]) => { if (r.source !== "shop" && r.saleId && ids.has(r.saleId)) jobs.push(updateDoc(ref(uid, "returns", id), patch)); });
    await Promise.all(jobs);
    picked = keepPick = phone ? "c" + phone : "n" + nameKey(name);
    closeEdit();
    showToast(el("toast"), `<span>Customer updated to ${esc(name)}${phone ? " · " + esc(phone) : ""}. Sales Summary, Pending Payments and Returns show the new details.</span>`);
    render();
  } catch (error) { alert("Error: " + error.message); }
}));

if (params.get("sold")) showToast(el("toast"), "<span>Sale saved and added to this customer.</span>");
