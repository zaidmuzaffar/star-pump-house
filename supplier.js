import { confirmDialog } from './dialogs.js?v=55';
import { start, listen, ref, updateDoc, deleteDoc, showToast } from './common.js?v=55';
import {
  CATEGORY_LABELS, esc, fmt, formatDateDMY, todayString, parseDMY, attachDateMask, attachNumberFormatting, attachAutoCapitalize,
  formatWithCommas, toNumber, withButtonLock, initials, pillHtml, ICONS
} from './utils.js?v=55';
import { supKey, supplierSummary, buildLedger, paySupplier, itemsText } from './supplierUtils.js?v=55';
import { initProductModal } from './productForm.js?v=55';
import { initPurchaseForm } from './purchaseForm.js?v=55';
import { buildStatement, dayOf } from './partyUtils.js?v=55';
import { highlightWords as hw } from './utils.js?v=55';

const el = (id) => document.getElementById(id);
const sid = new URLSearchParams(location.search).get("id") || "";
let uid = null;
let suppliers = [], purchases = [], payments = [], products = [];
const loaded = { s: false, p: false, y: false };
let tab = "ledger";
let q = "";
// Search: every word must appear somewhere in the line.
const hit = (...parts) => { if (!q) return true; const t = parts.join(" ").toLowerCase().replace(/,/g, ""); return q.replace(/,/g, "").split(/\s+/).every((w) => t.includes(w)); };
const noHits = '<div class="empty"><strong>Nothing found</strong>Try another word, date (DD-MM-YY) or amount.</div>';

start((user) => {
  uid = user.uid;
  listen(uid, "suppliers", (rows) => { suppliers = rows; loaded.s = true; render(); });
  listen(uid, "purchases", (rows) => { purchases = rows; loaded.p = true; render(); });
  listen(uid, "supplierPayments", (rows) => { payments = rows; loaded.y = true; render(); });
  listen(uid, "products", (rows) => { products = rows; if (el("buy-modal").classList.contains("active")) buyForm.refreshProducts(); });
});

// ---------- New purchase from this supplier (stays on this page) ----------
const buyForm = initPurchaseForm(el("sp-pf-root"), {
  prefix: "spf", fixedSupplierId: sid, getUid: () => uid,
  getSuppliers: () => suppliers, getProducts: () => products, getPurchases: () => purchases, getPayments: () => payments,
  productModal: initProductModal(),
  onSaved: (sup, mode) => {
    el("buy-modal").classList.remove("active");
    tab = "bills"; render();
    showToast(el("toast"), mode === "pending"
      ? `<span>Not ordered yet: saved in Pending Products (no bill, nothing paid).</span><a href="pending-products.html">Open Pending Products</a>`
      : `<span>Purchase saved in ${esc(sup.name)}'s record. The items are in Upcoming Products until they arrive.</span><a href="upcoming.html">Open Upcoming</a>`, 9000);
  }
});
el("sp-buy-btn").addEventListener("click", () => {
  el("buy-title").textContent = "New purchase from " + (current() ? current().name : "");
  buyForm.reset();
  el("buy-modal").classList.add("active");
});
el("buy-close").addEventListener("click", () => el("buy-modal").classList.remove("active"));

const current = () => { const r = suppliers.find((x) => x[0] === sid); return r ? r[1] : null; };
const summary = () => supplierSummary(sid, current(), purchases, payments);

function render() {
  if (!loaded.s || !loaded.p || !loaded.y) return;
  const s = current();
  el("sp-missing").hidden = !!s;
  el("sp-page").hidden = !s;
  if (!s) return;
  const sum = summary();
  document.title = s.name + " - Star Pump House";

  el("sp-av").textContent = initials(s.name);
  el("sp-name").textContent = s.name;
  el("sp-meta").textContent = [s.phone, s.address, "Supplier since " + formatDateDMY(s.createdAt || todayString())].filter(Boolean).join(" · ");
  el("sp-note").textContent = s.note || "";
  el("sp-bill-btn").href = "supplier-bill.html?id=" + encodeURIComponent(sid);

  const bal = sum.balance;
  el("sp-stats").innerHTML = `
    <div><span class="l">Total bought (Rs)</span><span class="v">${fmt(sum.bought + sum.opening)}</span></div>
    <div><span class="l">Total paid (Rs)</span><span class="v t-green">${fmt(sum.paid)}</span></div>
    <div class="${bal > 0 ? "owe" : ""}"><span class="l">${bal < 0 ? "Advance with them (Rs)" : "Remaining Cost (Rs)"}</span><span class="v ${bal > 0 ? "t-amber" : "t-green"}">${fmt(Math.abs(bal))}</span></div>
    <div><span class="l">Purchase bills</span><span class="v">${fmt(sum.bills.length)}</span></div>
    <div><span class="l">Last payment</span><span class="v" style="font-size:16px">${sum.lastPay ? formatDateDMY(sum.lastPay) : "—"}</span></div>`;

  document.querySelectorAll("#sp-tabs [data-tab]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === tab)));
  if (tab === "ledger") renderLedger(s, sum);
  else if (tab === "bills") renderBills(sum);
  else renderProducts(sum);
}

// Khata: one line per bill (with what was paid on the spot) and one line per later payment, oldest at the top.
// "Bill / Before": a bill shows its amount (and what was remaining before it, underneath);
// a payment shows what was remaining before it. Paid takes it off, and the last column is the new remaining.
function beforeCell(r) {
  if (r.kind === "pay") return `<span class="stk"><span class="w500">${hw(fmt(r.prev), q)}</span><span class="before-l">Remaining before</span></span>`;
  if (r.kind === "open") return hw(fmt(r.bill), q);
  return `<span class="stk"><span>${hw(fmt(r.bill), q)}</span>${r.prev ? `<span class="before-l">Before: ${fmt(r.prev)}</span>` : ""}</span>`;
}

function renderLedger(s, sum) {
  const rows = buildStatement({ opening: sum.opening, openingDate: s.createdAt || "", bills: sum.bills, pays: sum.pays, linkField: "purchaseId" });
  const shown = rows.filter((r) => hit(r.date && formatDateDMY(r.date), r.day, r.detail, r.billNo, r.method, r.bill, r.paid, r.remaining, r.kind === "pay" ? "payment" : r.kind === "open" ? "old balance" : "bill")).reverse();
  const cols = "44px 120px minmax(240px,2fr) 150px 130px 120px 150px 48px";
  el("sp-body").innerHTML = `<div class="scroll-x"><div style="min-width:1030px">
    <div class="head" style="grid-template-columns:${cols}"><span>#</span><span>Date</span><span>Entry</span><span class="num">Bill / Before (Rs)</span><span class="num">Paid (Rs)</span><span>Paid by</span><span class="num">Remaining Cost</span><span></span></div>` +
    shown.map((r) => `<div class="row khata-row ${r.kind === "pay" ? "ledger-pay" : ""}" style="grid-template-columns:${cols}">
      <span class="num muted">${r.n}</span>
      <span class="stk"><span class="num w500">${r.date ? hw(formatDateDMY(r.date), q) : "—"}</span><span class="muted" style="font-size:12px">${hw(r.day, q)}</span></span>
      <span class="stk"><span class="ln"><span class="pill ${r.kind === "pay" ? "b-paid" : r.kind === "open" ? "cat-other" : "b-pend"}">${r.kind === "pay" ? "Payment" : r.kind === "open" ? "Old balance" : "Bill"}</span>${r.billNo ? `<span class="muted" style="font-size:12px">No. ${hw(r.billNo, q)}</span>` : ""}</span><span class="ln" style="font-size:13px">${hw(r.detail, q)}</span></span>
      <span class="num">${beforeCell(r)}</span>
      <span class="num t-green strong">${r.paid ? hw(fmt(r.paid), q) : '<span class="t-dim">—</span>'}</span>
      <span style="font-size:13px">${r.paid ? hw(r.method || "Cash", q) : '<span class="t-dim">—</span>'}</span>
      <span class="num strong ${r.remaining > 0 ? "t-amber" : "t-green"}">${fmt(r.remaining)}</span>
      <span>${r.kind === "pay" ? `<button type="button" class="iconbtn del" data-delpay="${r.id}" aria-label="Delete payment">${ICONS.del}</button>` : ""}</span>
    </div>`).join("") +
    (rows.length && !shown.length ? noHits : "") + (rows.length ? "" : '<div class="empty"><strong>Nothing yet</strong>Bills and payments for this supplier will show here.</div>') + "</div></div>";
}

function renderBills(sum) {
  const bills = sum.bills.slice().sort((a, b) => (b[1].date || "").localeCompare(a[1].date || "") || (b[1].timestamp || 0) - (a[1].timestamp || 0)).filter(([, b]) => hit(formatDateDMY(b.date), dayOf(b.date), b.billNo, b.total, b.paid, ...(b.items || []).map((i) => i.name + " " + (i.category || ""))));
  el("sp-body").innerHTML = bills.length ? '<div class="bills">' + bills.map(([id, p]) => {
    const due = Math.max(0, Number(p.total || 0) - Number(p.paid || 0));
    return `<div class="bill-card">
      <div class="bill-top">
        <span class="stk"><span class="w500" style="font-weight:600">${hw(formatDateDMY(p.date), q)} · ${hw(dayOf(p.date), q)}${p.billNo ? ` · Bill no. ${hw(p.billNo, q)}` : ""}</span><span class="muted" style="font-size:12px">${p.source === "add-product" ? "Added from Stock List" : p.source === "upcoming" ? "Upcoming order" : "Purchase bill"}${p.source === "upcoming" || p.toUpcoming ? (p.addedToStock ? " · arrived " + formatDateDMY(p.arrivedDate || "") : " · on the way (Upcoming)") : p.addedToStock === false ? " · not added to stock" : ""}</span></span>
        <span class="pill ${due ? "b-pend" : "b-paid"}">${due ? "Due Rs " + fmt(due) : "Paid"}</span>
      </div>
      <div class="bill-items">${(p.items || []).map((i) => `<div class="bill-item"><span>${pillHtml(i.category)}</span><span class="w500">${hw(i.name, q)}</span><span class="num muted">${fmt(i.qty)} ${i.unit === "ft" ? "ft" : "pcs"} × Rs ${fmt(i.cost)}</span><span class="num strong">Rs ${hw(fmt(i.total), q)}</span></div>`).join("")}</div>
      <div class="bill-foot"><span>Total <b class="num">Rs ${fmt(p.total)}</b></span><span>Paid <b class="num t-green">Rs ${fmt(p.paid)}</b></span><span>Remaining <b class="num ${due ? "t-amber" : "t-green"}">Rs ${fmt(due)}</b></span></div>
    </div>`;
  }).join("") + "</div>"
    : sum.bills.length ? noHits : '<div class="empty"><strong>No purchase bills yet</strong>Use "New purchase", or add a product from Stock List and choose this supplier.</div>';
}

function renderProducts(sum) {
  const map = new Map();
  sum.bills.forEach(([, p]) => (p.items || []).forEach((i) => {
    const k = i.productId || i.name;
    let a = map.get(k);
    if (!a) { a = { name: i.name, cat: i.category, unit: i.unit, times: 0, qty: 0, spent: 0, lastCost: 0, last: "" }; map.set(k, a); }
    a.times++; a.qty += Number(i.qty || 0); a.spent += Number(i.total || 0);
    if ((p.date || "") >= a.last) { a.last = p.date || ""; a.lastCost = i.cost; a.name = i.name; }
  }));
  const rows = [...map.values()].filter((r) => hit(r.name, r.cat, formatDateDMY(r.last), dayOf(r.last))).sort((a, b) => (b.last || "").localeCompare(a.last || ""));
  const cols = "minmax(220px,1.8fr) 130px 110px 130px 140px 130px 110px";
  el("sp-body").innerHTML = `<div class="scroll-x"><div style="min-width:980px"><div class="head" style="grid-template-columns:${cols}"><span>Product</span><span>Category</span><span class="num">Times bought</span><span class="num">Total qty</span><span class="num">Total spent (Rs)</span><span class="num">Last cost (Rs)</span><span>Last bought</span></div>` +
    rows.map((r) => `<div class="row" style="grid-template-columns:${cols}">
      <span class="w500">${hw(r.name, q)}</span><span>${pillHtml(r.cat)}</span><span class="num">${fmt(r.times)}</span>
      <span class="num">${fmt(r.qty)} ${r.unit === "ft" ? "ft" : "pcs"}</span><span class="num strong">${fmt(r.spent)}</span>
      <span class="num">${fmt(r.lastCost)}${r.unit === "ft" ? " / ft" : ""}</span><span class="stk"><span class="num muted">${hw(formatDateDMY(r.last), q)}</span><span class="muted" style="font-size:12px">${hw(dayOf(r.last), q)}</span></span>
    </div>`).join("") +
    (rows.length ? "" : map.size ? noHits : '<div class="empty"><strong>No products yet</strong></div>') + "</div></div>";
}

el("sp-q").addEventListener("input", (e) => { q = e.target.value.trim().toLowerCase(); render(); });
el("sp-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; render(); } });

el("sp-body").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-delpay]");
  if (!b) return;
  const r = payments.find((x) => x[0] === b.dataset.delpay);
  if (!r) return;
  if (!(await confirmDialog({ title: "Delete this payment?", message: `Rs ${fmt(r[1].amount)} paid on ${formatDateDMY(r[1].date)} will be removed and added back to the Remaining Cost.`, confirmLabel: "Delete", danger: true }))) return;
  try {
    // Undo it on the bills too (newest bills first).
    let left = Number(r[1].amount || 0);
    const bills = summary().bills.filter(([, p]) => Number(p.paid || 0) > 0)
      .sort((a, c) => (c[1].date || "").localeCompare(a[1].date || "") || (c[1].timestamp || 0) - (a[1].timestamp || 0));
    for (const [pid, p] of bills) {
      if (left <= 0) break;
      if (r[1].purchaseId && pid !== r[1].purchaseId) continue;
      const part = Math.min(left, Number(p.paid || 0));
      await updateDoc(ref(uid, "purchases", pid), { paid: Number(p.paid || 0) - part });
      left -= part;
    }
    await deleteDoc(ref(uid, "supplierPayments", r[0]));
  } catch (error) { alert("Error deleting payment: " + error.message); }
});

// ---------- Pay supplier ----------
const payModal = el("pay-modal");
attachNumberFormatting(el("pay-amount"), true);
attachDateMask(el("pay-date"));
attachAutoCapitalize(el("pay-note"));

function preview() {
  const bal = summary().balance, amt = toNumber(el("pay-amount").value);
  el("pay-preview").innerHTML = `<div><span>Remaining Cost now</span><b class="num">Rs ${fmt(bal)}</b></div><div><span>This payment</span><b class="num t-green">Rs ${fmt(amt)}</b></div><div class="after"><span>Remaining Cost after</span><b class="num ${bal - amt > 0 ? "t-amber" : "t-green"}">Rs ${fmt(bal - amt)}</b></div>`;
}
el("sp-pay-btn").addEventListener("click", () => {
  const s = current(), bal = summary().balance;
  el("pay-title").textContent = "Pay " + s.name;
  el("pay-sub").textContent = bal > 0 ? `Remaining Cost: Rs ${fmt(bal)}.` : "Nothing is remaining right now — this will be an advance.";
  el("pay-amount").value = bal > 0 ? fmt(bal) : "";
  el("pay-date").value = formatDateDMY(todayString());
  el("pay-method").value = "Cash";
  el("pay-note").value = "";
  preview();
  payModal.classList.add("active");
  setTimeout(() => { el("pay-amount").focus(); el("pay-amount").select(); }, 50);
});
el("pay-amount").addEventListener("input", preview);
const closePay = () => payModal.classList.remove("active");
el("pay-close").addEventListener("click", closePay);
el("pay-cancel").addEventListener("click", closePay);
el("pay-save").addEventListener("click", (e) => withButtonLock(e.currentTarget, async () => {
  const amount = toNumber(el("pay-amount").value), date = parseDMY(el("pay-date").value);
  if (amount <= 0) { alert("Please enter the amount you paid."); return; }
  if (!date) { alert("Please enter the date as DD-MM-YY."); return; }
  const s = current(), sum = summary();
  try {
    await paySupplier(uid, { id: sid, sup: s, amount, date, note: el("pay-note").value.trim(), method: el("pay-method").value, bills: sum.bills, balance: sum.balance });
    closePay();
    tab = "ledger"; render();
    showToast(el("toast"), `<span>Payment of Rs ${fmt(amount)} saved. Remaining Cost for ${esc(s.name)} is now Rs ${fmt(sum.balance - amount)}.</span><a href="supplier-bill.html?id=${encodeURIComponent(sid)}">Total Bill</a>`);
  } catch (error) { alert("Error saving payment: " + error.message); }
}));

// ---------- Edit supplier ----------
const supModal = el("sup-modal");
attachAutoCapitalize(el("sup-name"));
attachAutoCapitalize(el("sup-address"));
attachNumberFormatting(el("sup-phone"), false);
attachNumberFormatting(el("sup-opening"), true);
const closeSup = () => supModal.classList.remove("active");
el("sp-edit-btn").addEventListener("click", () => {
  const s = current();
  el("sup-name").value = s.name || ""; el("sup-phone").value = s.phone || ""; el("sup-address").value = s.address || "";
  el("sup-opening").value = s.openingBalance ? formatWithCommas(s.openingBalance) : ""; el("sup-note").value = s.note || "";
  supModal.classList.add("active");
});
el("sup-close").addEventListener("click", closeSup);
el("sup-cancel").addEventListener("click", closeSup);
el("sup-save").addEventListener("click", (e) => withButtonLock(e.currentTarget, async () => {
  const name = el("sup-name").value.trim();
  if (!name) { alert("Please enter the supplier name."); return; }
  if (suppliers.some(([id, s]) => id !== sid && supKey(s.name) === supKey(name))) { alert("Another supplier already has this name."); return; }
  try {
    await updateDoc(ref(uid, "suppliers", sid), { name, phone: el("sup-phone").value, address: el("sup-address").value.trim(), openingBalance: toNumber(el("sup-opening").value), note: el("sup-note").value.trim() });
    closeSup();
  } catch (error) { alert("Error saving supplier: " + error.message); }
}));
