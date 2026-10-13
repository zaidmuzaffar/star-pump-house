// Pending Products: items saved from a purchase form with "Add these items to Upcoming Products" NOT ticked.
// Not ordered yet: no bill, nothing paid. Tick items and press "Add to Upcoming" when you order them:
// a bill is made for each supplier and the items go to Upcoming Products (Stock when they arrive).
import { confirmDialog } from './dialogs.js?v=55';
import { start, listen, ref, deleteDoc, showToast } from './common.js?v=55';
import {
  esc, fmt, formatDateDMY, todayString, parseDMY, attachDateMask, attachNumberFormatting, toNumber, withButtonLock,
  pillHtml, stockText, isLowStock, ICONS
} from './utils.js?v=55';
import { recordPurchase, supplierSummary } from './supplierUtils.js?v=55';
import { upcomingDoc, addUpcoming } from './orderUtils.js?v=55';

const el = (id) => document.getElementById(id);
let uid = null;
let pending = [], products = [], suppliers = [], purchases = [], supplierPays = [];
const sel = new Set();

start((user) => {
  uid = user.uid;
  listen(uid, "pendingProducts", (rows) => { pending = rows; [...sel].forEach((id) => { if (!rows.some(([x]) => x === id)) sel.delete(id); }); render(); });
  listen(uid, "products", (rows) => { products = rows; render(); });
  listen(uid, "suppliers", (rows) => { suppliers = rows; });
  listen(uid, "purchases", (rows) => { purchases = rows; });
  listen(uid, "supplierPayments", (rows) => { supplierPays = rows; });
});

const productOf = (id) => { const r = products.find(([x]) => x === id); return r ? r[1] : null; };
const unit = (u) => (u === "ft" ? "ft" : "pcs");

function render() {
  const list = pending.slice().sort((a, b) => (a[1].supplierName || "").localeCompare(b[1].supplierName || "") || (b[1].timestamp || 0) - (a[1].timestamp || 0));
  el("k-items").textContent = fmt(list.length);
  el("k-value").textContent = fmt(list.reduce((a, [, p]) => a + Number(p.total || 0), 0));
  const sups = new Set(list.map(([, p]) => p.supplierId || p.supplierName));
  el("k-sups").textContent = fmt(sups.size);
  el("k-sups-n").textContent = sups.size ? [...new Set(list.map(([, p]) => p.supplierName))].slice(0, 3).join(", ") : "—";

  const cols = "44px 96px minmax(220px,1.8fr) minmax(150px,1fr) 110px 110px 120px 48px";
  el("pp-table").innerHTML = `<div class="head" style="grid-template-columns:${cols}"><span></span><span>Added</span><span>Product</span><span>Supplier</span><span class="num">Qty</span><span class="num">Cost (Rs)</span><span class="num">Total (Rs)</span><span></span></div>` +
    (list.length ? list.map(([id, it]) => {
      const p = productOf(it.productId);
      return `<label class="row pp-row${sel.has(id) ? " picked" : ""}" style="grid-template-columns:${cols}">
        <span><input type="checkbox" class="ck" data-sel="${id}" ${sel.has(id) ? "checked" : ""} aria-label="Select ${esc(it.name)}"></span>
        <span class="num muted">${formatDateDMY(it.date)}</span>
        <span class="stk"><span class="w500">${pillHtml(it.category)} ${esc(it.name)}</span>${p ? `<span class="stock-now${isLowStock(p) ? " is-low" : ""}">In stock: ${esc(stockText(p))}${isLowStock(p) ? " · running low" : ""}</span>` : ""}</span>
        <span>${it.supplierId ? `<a class="link" href="supplier.html?id=${encodeURIComponent(it.supplierId)}">${esc(it.supplierName)}</a>` : esc(it.supplierName || "—")}</span>
        <span class="num">${fmt(it.qty)} ${unit(it.unit)}</span>
        <span class="num">${fmt(it.cost)}${it.unit === "ft" ? " / ft" : ""}</span>
        <span class="num strong">${fmt(it.total)}</span>
        <span><button type="button" class="iconbtn del" data-del="${id}" aria-label="Remove ${esc(it.name)}">${ICONS.del}</button></span>
      </label>`;
    }).join("")
      : '<div class="empty"><strong>Nothing pending</strong>When you save a purchase with "Add these items to Upcoming Products" not ticked, the items wait here.</div>');

  el("pp-all").checked = list.length > 0 && list.every(([id]) => sel.has(id));
  el("pp-count").textContent = sel.size ? `${sel.size} selected` : "";
  el("pp-order").disabled = el("pp-remove").disabled = sel.size === 0;
}

el("pp-table").addEventListener("change", (e) => {
  const id = e.target.dataset.sel;
  if (!id) return;
  if (e.target.checked) sel.add(id); else sel.delete(id);
  render();
});
el("pp-all").addEventListener("change", (e) => { pending.forEach(([id]) => (e.target.checked ? sel.add(id) : sel.delete(id))); render(); });
el("pp-table").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-del]");
  if (!b) return;
  e.preventDefault();
  if (!(await confirmDialog({ title: "Remove this item?", message: "It will be taken off Pending Products. Nothing else changes.", confirmLabel: "Remove", danger: true }))) return;
  try { await deleteDoc(ref(uid, "pendingProducts", b.dataset.del)); } catch (error) { alert("Error: " + error.message); }
});
el("pp-remove").addEventListener("click", async () => {
  if (!sel.size) return;
  if (!(await confirmDialog({ title: `Remove ${sel.size} item${sel.size === 1 ? "" : "s"}?`, message: "They will be taken off Pending Products. Nothing else changes.", confirmLabel: "Remove", danger: true }))) return;
  try { await Promise.all([...sel].map((id) => deleteDoc(ref(uid, "pendingProducts", id)))); sel.clear(); } catch (error) { alert("Error: " + error.message); }
});

// ---------- Order the selected items -> bill(s) + Upcoming ----------
attachDateMask(el("om-date"));
attachDateMask(el("om-expected"));
attachNumberFormatting(el("om-paid"), true);
const picked = () => pending.filter(([id]) => sel.has(id));
const groups = () => {
  const m = new Map();
  picked().forEach(([id, it]) => { const k = it.supplierId || it.supplierName; const g = m.get(k) || { sup: { id: it.supplierId, name: it.supplierName, phone: it.supplierPhone || "" }, rows: [] }; g.rows.push([id, it]); m.set(k, g); });
  return [...m.values()];
};

el("pp-order").addEventListener("click", () => {
  const gs = groups();
  if (!gs.length) return;
  el("om-list").innerHTML = gs.map((g) => `<div class="om-sup"><div class="om-sup-h"><b>${esc(g.sup.name)}</b><span class="num">Bill Rs ${fmt(g.rows.reduce((a, [, it]) => a + Number(it.total || 0), 0))}</span></div>` +
    g.rows.map(([, it]) => `<div class="om-it"><span>${esc(it.name)}</span><span class="num muted">${fmt(it.qty)} ${unit(it.unit)} × Rs ${fmt(it.cost)}</span></div>`).join("") + "</div>").join("");
  el("om-date").value = formatDateDMY(todayString());
  el("om-expected").value = "";
  el("om-paid").value = "0";
  el("om-paid-wrap").hidden = gs.length !== 1;
  el("om-hint").textContent = gs.length === 1 ? "Paid now: write 0 if nothing was paid yet (you can pay later from the supplier's page)."
    : `${gs.length} suppliers: one bill is made for each. Pay them later from each supplier's page.`;
  el("order-modal").classList.add("active");
});
const closeOrder = () => el("order-modal").classList.remove("active");
el("om-cancel").addEventListener("click", closeOrder);
el("om-close").addEventListener("click", closeOrder);

el("om-save").addEventListener("click", (e) => withButtonLock(e.currentTarget, async () => {
  const date = parseDMY(el("om-date").value);
  if (!date) { alert("Please enter the order date as DD-MM-YY."); return; }
  const expected = el("om-expected").value.trim() ? parseDMY(el("om-expected").value) : "";
  if (el("om-expected").value.trim() && !expected) { alert("Please enter the expected arrival as DD-MM-YY, or leave it empty."); return; }
  const gs = groups();
  const paid = gs.length === 1 ? toNumber(el("om-paid").value) : 0;
  try {
    let n = 0;
    for (const g of gs) {
      const items = g.rows.map(([, it]) => ({ productId: it.productId, name: it.name, category: it.category, qty: Number(it.qty), unit: it.unit, cost: Number(it.cost), total: Number(it.total) }));
      const supRow = suppliers.find(([id]) => id === g.sup.id);
      const before = supRow ? supplierSummary(g.sup.id, supRow[1], purchases, supplierPays).balance : 0;
      const billNo = g.rows.map(([, it]) => it.billNo).find(Boolean) || "";
      const bill = await recordPurchase(uid, { sup: g.sup, date, items, paid, billNo, balanceBefore: before, addedToStock: false, extra: { toUpcoming: true, fromPending: true } });
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const p = productOf(it.productId) || { category: it.category, name: it.name, unit: it.unit };
        await addUpcoming(uid, Object.assign(upcomingDoc(p, it.productId, { qty: it.qty, cost: it.cost, sup: g.sup, purchaseId: bill.id, itemIndex: i, expectedDate: expected }), { orderedDate: date }));
        n++;
      }
      for (const [id] of g.rows) await deleteDoc(ref(uid, "pendingProducts", id));
    }
    sel.clear();
    closeOrder();
    showToast(el("toast"), `<span>${n} item${n === 1 ? "" : "s"} ordered: the bill${gs.length === 1 ? " is" : "s are"} with the supplier and the items are in Upcoming Products.</span><a href="upcoming.html">Open Upcoming</a>`, 9000);
  } catch (error) { alert("Error: " + error.message); }
}));
