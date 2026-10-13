import { confirmDialog } from './dialogs.js?v=55';
import { start, listen, ref, deleteDoc, showToast } from './common.js?v=55';
import { ICONS, esc, fmt, formatDateDMY, daysAgoIso, highlightWords, isLowStock, stockNumber } from './utils.js?v=55';
import { initProductModal } from './productForm.js?v=55';
import { supplierSummary, belongs, itemsText } from './supplierUtils.js?v=55';
import { initPurchaseForm } from './purchaseForm.js?v=55';

const el = (id) => document.getElementById(id);
let uid = null;
let purchases = [], products = [], suppliers = [], supplierPays = [];
let query = "";
const params = new URLSearchParams(location.search);

const form = initPurchaseForm(el("pf-root"), {
  prefix: "pf", getUid: () => uid,
  getSuppliers: () => suppliers, getProducts: () => products, getPurchases: () => purchases, getPayments: () => supplierPays,
  productModal: initProductModal(),
  onSaved: (sup, mode) => {
    el("p-form").hidden = true;
    showToast(el("toast"), mode === "pending"
      ? `<span>Not ordered yet: the items are saved in Pending Products (no bill, nothing paid).</span><a href="pending-products.html">Open Pending Products</a>`
      : `<span>Purchase from ${esc(sup.name)} saved. The items are in Upcoming Products and go into Stock when they arrive.</span><a href="upcoming.html">Open Upcoming</a>`, 9000);
  }
});

start((user) => {
  uid = user.uid;
  listen(uid, "purchases", (rows) => { purchases = rows; render(); });
  listen(uid, "supplierPayments", (rows) => { supplierPays = rows; render(); });
  listen(uid, "suppliers", (rows) => { suppliers = rows; form.setSuppliers(rows); render(); });
  listen(uid, "products", (rows) => { products = rows; productsLoaded = true; if (!el("p-form").hidden) form.refreshProducts(); });
  if (params.has("new")) setTimeout(openForm, 300);
});

function supplierIdOf(p) {
  if (p.supplierId) return p.supplierId;
  const r = suppliers.find(([id, s]) => belongs(p, id, s));
  return r ? r[0] : "";
}

function render() {
  const since = daysAgoIso(30);
  const recent = purchases.filter(([, p]) => (p.date || "") >= since);
  el("k-month").textContent = fmt(recent.reduce((a, [, p]) => a + Number(p.total || 0), 0));
  el("k-bills").textContent = `${recent.length} bill${recent.length === 1 ? "" : "s"}`;
  el("k-all").textContent = fmt(purchases.reduce((a, [, p]) => a + Number(p.total || 0), 0));
  el("k-all-n").textContent = `${purchases.length} bill${purchases.length === 1 ? "" : "s"} · ${suppliers.length} supplier${suppliers.length === 1 ? "" : "s"}`;
  el("k-due").textContent = fmt(suppliers.reduce((a, [id, s]) => a + Math.max(0, supplierSummary(id, s, purchases, supplierPays).balance), 0));

  const q = query.trim().toLowerCase();
  const cols = "96px 100px minmax(170px,1.1fr) minmax(240px,1.9fr) 120px 120px 130px 100px 56px";
  const rows = purchases
    .filter(([, p]) => !q || q.replace(/,/g, "").split(/\s+/).every((w) => [p.supplier, itemsText(p), p.billNo, formatDateDMY(p.date), p.total].join(" ").toLowerCase().replace(/,/g, "").includes(w)))
    .sort((a, b) => (b[1].date || "").localeCompare(a[1].date || "") || (b[1].timestamp || 0) - (a[1].timestamp || 0));
  el("p-table").innerHTML = `<div style="min-width:1110px"><div class="head" style="grid-template-columns:${cols}"><span>Date</span><span>Bill no.</span><span>Supplier</span><span>Items</span><span class="num">Total (Rs)</span><span class="num">Paid</span><span class="num">Remaining</span><span>Status</span><span></span></div>` +
    rows.map(([id, p]) => {
      const d = Math.max(0, Number(p.total || 0) - Number(p.paid || 0)), sid = supplierIdOf(p);
      const upcoming = (p.source === "upcoming" || p.toUpcoming) && !p.addedToStock;
      return `<div class="row" style="grid-template-columns:${cols}">
        <span class="num muted">${highlightWords(formatDateDMY(p.date), q)}</span>
        <span class="num" style="font-size:13px">${p.billNo ? highlightWords(p.billNo, q) : "—"}</span>
        <span class="w500">${sid ? `<a href="supplier.html?id=${encodeURIComponent(sid)}" class="link" style="font-size:14px">${highlightWords(p.supplier, q)}</a>` : highlightWords(p.supplier, q)}</span>
        <span>${highlightWords(itemsText(p), q)}${upcoming ? ' <span class="pill b-exch">On the way</span>' : ""}</span>
        <span class="num strong">${highlightWords(fmt(p.total), q)}</span>
        <span class="num t-green">${fmt(p.paid)}</span>
        <span class="num ${d ? "t-amber" : "t-dim"}">${d ? fmt(d) : "—"}</span>
        <span><span class="pill ${d ? "b-pend" : "b-paid"}">${d ? "Due" : "Paid"}</span></span>
        <span class="row-actions"><button type="button" class="iconbtn del" data-del="${id}" aria-label="Delete bill">${ICONS.del}</button></span>
      </div>`;
    }).join("") +
    (rows.length ? "" : `<div class="empty"><strong>${q ? "No bill matches your search" : "No purchases yet"}</strong>${q ? "" : 'Press "New Purchase", or add a product from Stock List and pick its supplier.'}</div>`) + "</div>";
}

el("p-search").addEventListener("input", (e) => { query = e.target.value; render(); });
el("p-table").addEventListener("click", async (e) => {
  const del = e.target.closest("[data-del]");
  if (!del) return;
  if (!(await confirmDialog({ title: "Delete purchase bill?", message: "The bill will be removed from the supplier's record. Stock quantities and payments already made will NOT be changed.", confirmLabel: "Delete", danger: true }))) return;
  try { await deleteDoc(ref(uid, "purchases", del.dataset.del)); } catch (error) { alert("Error deleting bill: " + error.message); }
});

let productsLoaded = false;
function openForm() {
  form.reset({ supplierId: params.get("supplier") || "" });
  // Reorder from the Dashboard: put every low item on the bill
  if (params.has("reorder")) {
    const fill = () => {
      if (!productsLoaded) { setTimeout(fill, 150); return; }
      form.prefill(products.filter(([, p]) => isLowStock(p)).sort((a, b) => stockNumber(a[1]) - stockNumber(b[1])));
    };
    fill();
  }
  el("p-form").hidden = false;
  el("p-form").scrollIntoView({ behavior: "smooth", block: "start" });
}
el("open-form-btn").addEventListener("click", openForm);
el("close-form-btn").addEventListener("click", () => { el("p-form").hidden = true; });
