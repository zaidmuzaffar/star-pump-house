import './dialogs.js?v=55';
import { start, listen, col, ref, addDoc, updateDoc, showToast } from './common.js?v=55';
import { CATEGORY_LABELS, CATEGORY_ORDER, esc, fmt, formatDateDMY, todayString, highlightMatch, digitsOnly, attachAutoCapitalize, attachNumberFormatting, toNumber, withButtonLock, initials } from './utils.js?v=55';
import { supKey, belongs, supplierSummary } from './supplierUtils.js?v=55';

const el = (id) => document.getElementById(id);
let uid = null;
let suppliers = [], purchases = [], payments = [];
const loaded = { suppliers: false, purchases: false, payments: false };
let filter = "all", query = "", migrated = false;

start((user) => {
  uid = user.uid;
  listen(uid, "suppliers", (rows) => { suppliers = rows; loaded.suppliers = true; ready(); });
  listen(uid, "purchases", (rows) => { purchases = rows; loaded.purchases = true; ready(); });
  listen(uid, "supplierPayments", (rows) => { payments = rows; loaded.payments = true; ready(); });
});

function ready() {
  if (!loaded.suppliers || !loaded.purchases || !loaded.payments) return;
  migrate();
  render();
}

// Older purchase bills only stored the supplier's name: create those suppliers once and link the records.
async function migrate() {
  if (migrated) return;
  migrated = true;
  const known = new Map(suppliers.map(([id, s]) => [supKey(s.name), id]));
  const orphans = [...purchases, ...payments].filter(([, r]) => !r.supplierId && supKey(r.supplier));
  if (!orphans.length) return;
  try {
    for (const [, r] of orphans) {
      const k = supKey(r.supplier);
      if (known.has(k)) continue;
      const d = await addDoc(col(uid, "suppliers"), { name: r.supplier.trim(), phone: r.supplierPhone || "", address: "", note: "", openingBalance: 0, createdAt: r.date || todayString(), timestamp: Date.now() });
      known.set(k, d.id);
    }
    for (const [id, r] of purchases.filter(([, r]) => !r.supplierId && known.has(supKey(r.supplier)))) await updateDoc(ref(uid, "purchases", id), { supplierId: known.get(supKey(r.supplier)) });
    for (const [id, r] of payments.filter(([, r]) => !r.supplierId && known.has(supKey(r.supplier)))) await updateDoc(ref(uid, "supplierPayments", id), { supplierId: known.get(supKey(r.supplier)) });
  } catch (e) { /* not critical: records still match by name */ }
}

function rowsData() {
  return suppliers.map(([id, s]) => {
    const sum = supplierSummary(id, s, purchases, payments);
    const cats = new Set(), names = new Set();
    sum.bills.forEach(([, p]) => (p.items || []).forEach((i) => { if (i.category) cats.add(i.category); names.add(i.name); }));
    return { id, s, sum, cats: CATEGORY_ORDER.filter((c) => cats.has(c)), names: [...names] };
  });
}

function render() {
  const all = rowsData();
  const owe = all.filter((r) => r.sum.balance > 0);
  el("k-count").textContent = fmt(all.length);
  el("k-count-n").textContent = `${all.reduce((a, r) => a + r.sum.bills.length, 0)} purchase bills in total`;
  el("k-bought").textContent = fmt(all.reduce((a, r) => a + r.sum.bought + r.sum.opening, 0));
  el("k-paid").textContent = fmt(all.reduce((a, r) => a + r.sum.paid, 0));
  el("k-due").textContent = fmt(owe.reduce((a, r) => a + r.sum.balance, 0));
  el("k-due-n").textContent = `to ${owe.length} supplier${owe.length === 1 ? "" : "s"}`;

  el("s-filters").innerHTML = [["all", "All", all.length], ["owe", "Remaining", owe.length], ["clear", "Paid up", all.length - owe.length]]
    .map(([k, label, n]) => `<button type="button" class="tab" data-f="${k}" aria-pressed="${filter === k}">${label}<span class="cnt">${n}</span></button>`).join("");

  const q = query.trim().toLowerCase(), qd = digitsOnly(query);
  const list = all
    .filter((r) => filter === "all" || (filter === "owe" ? r.sum.balance > 0 : r.sum.balance <= 0))
    .filter((r) => !q || r.s.name.toLowerCase().includes(q) || (qd && digitsOnly(r.s.phone || "").includes(qd)) || r.names.some((n) => n.toLowerCase().includes(q)))
    .sort((a, b) => b.sum.balance - a.sum.balance || (b.sum.last || "").localeCompare(a.sum.last || ""));

  const cols = "minmax(260px,1.6fr) minmax(170px,1.1fr) 70px 140px 130px 150px 110px 32px";
  el("s-table").innerHTML = `<div style="min-width:1130px"><div class="head" style="grid-template-columns:${cols}"><span>Supplier</span><span>Buys from them</span><span class="num">Bills</span><span class="num">Bought (Rs)</span><span class="num">Paid (Rs)</span><span class="num">Remaining Cost (Rs)</span><span>Last bill</span><span></span></div>` +
    list.map((r) => `<div class="row clickable sup-row" data-href="supplier.html?id=${encodeURIComponent(r.id)}" style="grid-template-columns:${cols};min-height:76px">
      <span class="sup-cell"><span class="av">${esc(initials(r.s.name))}</span><span class="cinfo"><a class="cname sup-link" href="supplier.html?id=${encodeURIComponent(r.id)}">${highlightMatch(r.s.name, query.trim())}</a><span class="cmeta">${esc([r.s.phone, r.s.address].filter(Boolean).join(" · ") || "No phone saved")}</span><a class="mini-btn" href="supplier-bill.html?id=${encodeURIComponent(r.id)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"></path><path d="M9 8h6"></path><path d="M9 12h6"></path></svg>Total Bill</a></span></span>
      <span class="chips">${r.cats.length ? r.cats.map((c) => `<span class="pill cat-${c}">${CATEGORY_LABELS[c]}</span>`).join("") : '<span class="t-dim">—</span>'}</span>
      <span class="num">${fmt(r.sum.bills.length)}</span>
      <span class="num">${fmt(r.sum.bought + r.sum.opening)}</span>
      <span class="num t-green">${fmt(r.sum.paid)}</span>
      <span class="num ${r.sum.balance > 0 ? "t-amber" : "t-dim"}">${r.sum.balance > 0 ? fmt(r.sum.balance) : r.sum.balance < 0 ? "Advance " + fmt(-r.sum.balance) : "—"}</span>
      <span class="num muted">${r.sum.last ? formatDateDMY(r.sum.last) : "—"}</span>
      <span class="go" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"></path></svg></span>
    </div>`).join("") +
    (list.length ? "" : `<div class="empty"><strong>${all.length ? "No supplier matches" : "No suppliers yet"}</strong>${all.length ? "Try another search or filter." : 'Press "Add Supplier", or pick "Add new supplier" when you add a product.'}</div>`) + "</div>";
}

el("s-filters").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (b) { filter = b.dataset.f; render(); } });
el("s-search").addEventListener("input", (e) => { query = e.target.value; render(); });
// Click anywhere on a row opens the supplier (the Total Bill button opens the bill page).
el("s-table").addEventListener("click", (e) => {
  if (e.target.closest("a")) return;
  const row = e.target.closest("[data-href]");
  if (row) location.href = row.dataset.href;
});

// ---------- Add supplier ----------
const modal = el("sup-modal");
attachAutoCapitalize(el("sup-name"));
attachAutoCapitalize(el("sup-address"));
attachNumberFormatting(el("sup-phone"), false);
attachNumberFormatting(el("sup-opening"), true);
function closeModal() { modal.classList.remove("active"); }
el("add-sup-btn").addEventListener("click", () => {
  ["sup-name", "sup-phone", "sup-address", "sup-opening", "sup-note"].forEach((i) => { el(i).value = ""; });
  modal.classList.add("active");
  setTimeout(() => el("sup-name").focus(), 50);
});
el("sup-close").addEventListener("click", closeModal);
el("sup-cancel").addEventListener("click", closeModal);
el("sup-save").addEventListener("click", (e) => withButtonLock(e.currentTarget, async () => {
  const name = el("sup-name").value.trim();
  if (!name) { alert("Please enter the supplier name."); return; }
  if (suppliers.some(([, s]) => supKey(s.name) === supKey(name))) { alert("A supplier with this name already exists."); return; }
  try {
    const d = await addDoc(col(uid, "suppliers"), {
      name, phone: el("sup-phone").value, address: el("sup-address").value.trim(), note: el("sup-note").value.trim(),
      openingBalance: toNumber(el("sup-opening").value), createdAt: todayString(), timestamp: Date.now()
    });
    closeModal();
    showToast(el("toast"), `<span>${esc(name)} added.</span><a href="supplier.html?id=${encodeURIComponent(d.id)}">Open supplier</a>`);
  } catch (error) { alert("Error adding supplier: " + error.message); }
}));
