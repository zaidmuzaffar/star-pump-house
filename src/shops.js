import './dialogs.js?v=55';
import { start, listen, col, addDoc, showToast } from './common.js?v=55';
import { CATEGORY_LABELS, CATEGORY_ORDER, esc, fmt, formatDateDMY, todayString, highlightMatch, digitsOnly, attachAutoCapitalize, attachNumberFormatting, toNumber, withButtonLock, initials } from './utils.js?v=55';
import { shopSummary } from './shopUtils.js?v=55';

const el = (id) => document.getElementById(id);
let uid = null;
let shops = [], bills = [], pays = [];
let filter = "all", query = "";

start((user) => {
  uid = user.uid;
  listen(uid, "shops", (rows) => { shops = rows; render(); });
  listen(uid, "shopBills", (rows) => { bills = rows; render(); });
  listen(uid, "shopPayments", (rows) => { pays = rows; render(); });
});

function render() {
  const all = shops.map(([id, s]) => {
    const sum = shopSummary(id, s, bills, pays);
    const cats = new Set();
    sum.bills.forEach(([, b]) => (b.items || []).forEach((i) => i.category && cats.add(i.category)));
    return { id, s, sum, cats: CATEGORY_ORDER.filter((c) => cats.has(c)) };
  });
  const due = all.filter((r) => r.sum.remaining > 0);
  el("k-count").textContent = fmt(all.length);
  el("k-count-n").textContent = `${bills.length} stock bill${bills.length === 1 ? "" : "s"} in total`;
  el("k-given").textContent = fmt(all.reduce((a, r) => a + r.sum.given + r.sum.opening, 0));
  el("k-recv").textContent = fmt(all.reduce((a, r) => a + r.sum.received, 0));
  el("k-due").textContent = fmt(due.reduce((a, r) => a + r.sum.remaining, 0));
  el("k-due-n").textContent = `to receive from ${due.length} shop${due.length === 1 ? "" : "s"}`;

  el("s-filters").innerHTML = [["all", "All", all.length], ["due", "Remaining", due.length], ["clear", "Paid up", all.length - due.length]]
    .map(([k, label, n]) => `<button type="button" class="tab" data-f="${k}" aria-pressed="${filter === k}">${label}<span class="cnt">${n}</span></button>`).join("");

  const q = query.trim().toLowerCase(), qd = digitsOnly(query);
  const list = all
    .filter((r) => filter === "all" || (filter === "due" ? r.sum.remaining > 0 : r.sum.remaining <= 0))
    .filter((r) => !q || r.s.name.toLowerCase().includes(q) || (r.s.owner || "").toLowerCase().includes(q) || (qd && digitsOnly(r.s.phone || "").includes(qd)))
    .sort((a, b) => b.sum.remaining - a.sum.remaining || (b.sum.last || "").localeCompare(a.sum.last || ""));

  const cols = "minmax(260px,1.6fr) minmax(170px,1.1fr) 70px 140px 130px 160px 110px 32px";
  el("s-table").innerHTML = `<div style="min-width:1140px"><div class="head" style="grid-template-columns:${cols}"><span>Shop</span><span>Stock given</span><span class="num">Bills</span><span class="num">Given (Rs)</span><span class="num">Received (Rs)</span><span class="num">Remaining Amount</span><span>Last bill</span><span></span></div>` +
    list.map((r) => `<div class="row clickable sup-row" data-href="shop.html?id=${encodeURIComponent(r.id)}" style="grid-template-columns:${cols};min-height:76px">
      <span class="sup-cell"><span class="av">${esc(initials(r.s.name))}</span><span class="cinfo"><a class="cname sup-link" href="shop.html?id=${encodeURIComponent(r.id)}">${highlightMatch(r.s.name, query.trim())}</a><span class="cmeta">${esc([r.s.owner, r.s.phone, r.s.address].filter(Boolean).join(" · ") || "No phone saved")}</span><a class="mini-btn" href="supplier-bill.html?type=shop&id=${encodeURIComponent(r.id)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"></path><path d="M9 8h6"></path><path d="M9 12h6"></path></svg>Total Bill</a></span></span>
      <span class="chips">${r.cats.length ? r.cats.map((c) => `<span class="pill cat-${c}">${CATEGORY_LABELS[c]}</span>`).join("") : '<span class="t-dim">—</span>'}</span>
      <span class="num">${fmt(r.sum.bills.length)}</span>
      <span class="num">${fmt(r.sum.given + r.sum.opening)}</span>
      <span class="num t-green">${fmt(r.sum.received)}</span>
      <span class="num ${r.sum.remaining > 0 ? "t-amber" : "t-dim"}">${r.sum.remaining > 0 ? fmt(r.sum.remaining) : r.sum.remaining < 0 ? "Advance " + fmt(-r.sum.remaining) : "—"}</span>
      <span class="num muted">${r.sum.last ? formatDateDMY(r.sum.last) : "—"}</span>
      <span class="go" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"></path></svg></span>
    </div>`).join("") +
    (list.length ? "" : `<div class="empty"><strong>${all.length ? "No shop matches" : "No shops yet"}</strong>${all.length ? "Try another search or filter." : 'Press "Add Shop" to add a shop you give stock to.'}</div>`) + "</div>";
}

el("s-filters").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (b) { filter = b.dataset.f; render(); } });
el("s-search").addEventListener("input", (e) => { query = e.target.value; render(); });
el("s-table").addEventListener("click", (e) => {
  if (e.target.closest("a")) return;
  const row = e.target.closest("[data-href]");
  if (row) location.href = row.dataset.href;
});

// ---------- Add shop ----------
const modal = el("shop-modal");
["shop-name", "shop-owner", "shop-address"].forEach((i) => attachAutoCapitalize(el(i)));
attachNumberFormatting(el("shop-phone"), false);
attachNumberFormatting(el("shop-opening"), true);
const closeModal = () => modal.classList.remove("active");
el("add-shop-btn").addEventListener("click", () => {
  ["shop-name", "shop-owner", "shop-phone", "shop-address", "shop-opening", "shop-note"].forEach((i) => { el(i).value = ""; });
  modal.classList.add("active");
  setTimeout(() => el("shop-name").focus(), 50);
});
el("shop-close").addEventListener("click", closeModal);
el("shop-cancel").addEventListener("click", closeModal);
el("shop-save").addEventListener("click", (e) => withButtonLock(e.currentTarget, async () => {
  const name = el("shop-name").value.trim();
  if (!name) { alert("Please enter the shop name."); return; }
  if (shops.some(([, s]) => s.name.trim().toLowerCase() === name.toLowerCase())) { alert("A shop with this name already exists."); return; }
  try {
    const d = await addDoc(col(uid, "shops"), {
      name, owner: el("shop-owner").value.trim(), phone: el("shop-phone").value, address: el("shop-address").value.trim(),
      note: el("shop-note").value.trim(), openingBalance: toNumber(el("shop-opening").value), createdAt: todayString(), timestamp: Date.now()
    });
    closeModal();
    showToast(el("toast"), `<span>${esc(name)} added.</span><a href="shop.html?id=${encodeURIComponent(d.id)}">Open shop</a>`);
  } catch (error) { alert("Error adding shop: " + error.message); }
}));
