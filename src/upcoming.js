import { confirmDialog } from './dialogs.js?v=55';
import { start, listen, col, ref, addDoc, updateDoc, deleteDoc, getDocs, showToast } from './common.js?v=55';
import { initProductModal, buildProduct } from './productForm.js?v=55';
import { ensureSupplier, recordPurchase, supplierSummary } from './supplierUtils.js?v=55';
import { addStockPatch } from './orderUtils.js?v=55';
import {
  CATEGORY_LABELS, esc, fmt, todayString, formatDateDMY, parseDMY, daysFromToday, isCable, byFeet, isLengthItem, perBundle, metres,
  productName, stockText, bundleText, digitsOnly, pillHtml, ICONS, sellNameOf
} from './utils.js?v=55';

const el = (id) => document.getElementById(id);
let uid = null;
let items = [];      // [[id, data]]
let suppliers = [], purchases = [], supplierPays = [];
let tab = "all";
const modal = initProductModal();

const cat = (u) => u.category || "pump";
const qtyText = (u) => {
  if (!isCable(u)) return stockText(u);
  const b = digitsOnly(u.bundle || "");
  return stockText(u) + (b ? ` · ${b} bundle${b === "1" ? "" : "s"}` : "");
};
function whenText(u) {
  if (u.status === "arrived") return "Received";
  if (!u.expectedDate) return "No date set";
  const d = daysFromToday(u.expectedDate);
  return d === 0 ? "Today" : d === 1 ? "Tomorrow" : d > 1 ? `In ${d} days` : `${Math.abs(d)} day${d === -1 ? "" : "s"} late`;
}

start((user) => {
  uid = user.uid;
  listen(uid, "upcoming", (rows) => { items = rows; render(); });
  listen(uid, "suppliers", (rows) => { suppliers = rows; modal.setSuppliers(rows); });
  listen(uid, "purchases", (rows) => { purchases = rows; });
  listen(uid, "supplierPayments", (rows) => { supplierPays = rows; });
});
const balanceOf = (id) => { const r = suppliers.find((x) => x[0] === id); return r ? supplierSummary(id, r[1], purchases, supplierPays).balance : 0; };
const unitsOf = (data) => (byFeet(data) ? metres(data) : Number(data.quantity || 0));
const billItem = (data, productId) => ({ productId: productId || null, name: sellNameOf(data), category: data.category, qty: unitsOf(data), unit: byFeet(data) ? "ft" : "pcs", cost: Number(data.cost || 0), total: Math.round(unitsOf(data) * Number(data.cost || 0)) });

function render() {
  const view = items.map(([id, u]) => [id, Object.assign({}, u, { category: cat(u) })]);
  const byDate = (a, b) => (a[1].expectedDate || "9999") < (b[1].expectedDate || "9999") ? -1 : 1;
  const pend = view.filter(([, u]) => u.status !== "arrived").sort(byDate);
  const done = view.filter(([, u]) => u.status === "arrived");
  const list = tab === "pending" ? pend : tab === "arrived" ? done : pend.concat(done);

  el("k-pending").textContent = fmt(pend.length);
  const next = pend.find(([, u]) => u.expectedDate);
  el("k-next").textContent = next ? formatDateDMY(next[1].expectedDate) : "—";
  el("k-next-what").textContent = next ? `${productName(next[1])} · ${qtyText(next[1])}` : "Nothing expected";
  el("k-arrived").textContent = fmt(done.length);

  el("tabs").innerHTML = [["all", "All", view.length], ["pending", "Pending", pend.length], ["arrived", "Arrived", done.length]]
    .map(([k, label, n]) => `<button type="button" class="tab" data-tab="${k}" aria-pressed="${tab === k}">${label}<span class="cnt">${n}</span></button>`).join("");

  const cols = "120px minmax(260px,2.2fr) 130px 170px 110px 160px";
  const I = {
    truck: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h11v10H3z"></path><path d="M14 10h4l3 3v3h-7"></path><circle cx="7" cy="18" r="2"></circle><circle cx="17" cy="18" r="2"></circle></svg>',
    tag: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12l-8 8-9-9V3h8z"></path><circle cx="7.5" cy="7.5" r="1.5"></circle></svg>',
    cal: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4"></path></svg>',
    // goods coming in: an open box with an arrow going down into it
    receive: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 10.5l8.5 4 8.5-4"></path><path d="M3.5 10.5v7.2l8.5 4 8.5-4v-7.2"></path><path d="M12 14.5v7.2"></path><path d="M12 2.5v7"></path><path d="M9 6.8l3 3 3-3"></path></svg>',
    // already in stock: a closed box with a tick
    stock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8.5 4v9.5L12 20.5 3.5 16.5V7z"></path><path d="M3.5 7L12 11l8.5-4"></path><path d="M12 11v9.5"></path><circle cx="18" cy="18" r="4.2" fill="#fff"></circle><path d="M16.2 18.1l1.3 1.3 2.4-2.6"></path></svg>'
  };
  let html = `<div class="head" style="grid-template-columns:${cols}"><span>Expected</span><span>Product</span><span>Category</span><span class="num">Quantity</span><span>Status</span><span style="text-align:right">Action</span></div>`;
  html += list.map(([id, u]) => {
    const arrived = u.status === "arrived";
    const name = isCable(u) ? CATEGORY_LABELS[u.category] + " " + productName(u) : productName(u);
    const late = !arrived && u.expectedDate && daysFromToday(u.expectedDate) < 0;
    // line 1: supplier + cost · line 2: ordered date
    const line1 = [
      u.supplierName ? `<span class="up-chip">${I.truck}${u.supplierId ? `<a href="supplier.html?id=${encodeURIComponent(u.supplierId)}">${esc(u.supplierName)}</a>` : esc(u.supplierName)}</span>` : "",
      Number(u.cost) ? `<span class="up-chip">${I.tag}Cost Rs ${fmt(u.cost)}${byFeet(u) ? " / ft" : ""}</span>` : ""
    ].join("");
    const line2 = u.orderedDate ? `<span class="up-chip">${I.cal}Ordered ${formatDateDMY(u.orderedDate)}</span>` : "";
    const chips = (line1 ? `<span class="up-chips">${line1}</span>` : "") + (line2 ? `<span class="up-chips">${line2}</span>` : "");
    return `<div class="row up-row${arrived ? " arrived" : ""}" style="grid-template-columns:${cols}">
      <span class="stk"><span class="num w500">${u.expectedDate ? formatDateDMY(u.expectedDate) : "—"}</span><span class="up-when${late ? " late" : ""}">${whenText(u)}</span></span>
      <span class="stk" style="gap:6px"><span class="up-name">${esc(name)}${!isCable(u) && u.brand ? `<span class="up-brand">${esc(u.brand)}</span>` : ""}</span>${chips}</span>
      <span>${pillHtml(u.category)}</span>
      <span class="num up-qty">${esc(qtyText(u))}</span>
      <span><span class="pill ${arrived ? "b-done" : "b-pend"}">${arrived ? "Arrived" : "Pending"}</span></span>
      <span class="row-actions">
        ${arrived
          ? '<span class="arr-done">In stock</span>'
          : `<button type="button" class="arr-btn" data-act="arrive" data-id="${id}" title="Add to Stock">Arrived</button>`}
        <button type="button" class="iconbtn" data-act="edit" data-id="${id}" title="Edit" aria-label="Edit">${ICONS.edit}</button>
        <button type="button" class="iconbtn del" data-act="del" data-id="${id}" title="Delete" aria-label="Delete">${ICONS.del}</button>
      </span>
    </div>`;
  }).join("");
  if (!list.length) html += '<div class="empty"><strong>Nothing here</strong>Add an upcoming product to track it.</div>';
  el("upcoming-table").innerHTML = html;
}

el("tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; render(); } });

function withExpected(built, v) {
  const iso = parseDMY(v.expected || "");
  if (!iso) return { error: "Please enter the expected date as DD-MM-YY." };
  built.data.expectedDate = iso;
  return built;
}

el("open-upcoming-add-modal-btn").addEventListener("click", () => {
  modal.open({
    title: "Add Upcoming Product", sub: "Track stock that is on its way. The bill is saved with the supplier now; stock is added when it arrives.", saveLabel: "Save Upcoming", category: "pump", withDate: true,
    withSupplier: true, suppliers, getBalance: balanceOf,
    onSave: async (category, v, buy) => {
      const built = withExpected(buildProduct(category, v), v);
      if (built.error) { alert(built.error); return false; }
      const data = Object.assign(built.data, { status: "pending" });
      const fromSupplier = buy && !buy.none;
      if (fromSupplier && !(data.cost > 0)) { alert("Please enter the Cost price — it is saved on the supplier's bill."); return false; }
      if (fromSupplier && unitsOf(data) <= 0) { alert("Please enter the quantity you ordered."); return false; }
      try {
        let sup = null;
        if (fromSupplier) { sup = await ensureSupplier(uid, buy, suppliers); data.supplierId = sup.id; data.supplierName = sup.name; }
        const d = await addDoc(col(uid, "upcoming"), data);
        if (sup) {
          const bill = await recordPurchase(uid, { sup, date: buy.date, items: [billItem(data)], paid: buy.paid, balanceBefore: buy.id ? balanceOf(buy.id) : 0, source: "upcoming", addedToStock: false, extra: { upcomingId: d.id } });
          await updateDoc(ref(uid, "upcoming", d.id), { purchaseId: bill.id });
        }
        return true;
      }
      catch (error) { alert("Error adding upcoming product: " + error.message); return false; }
    }
  });
});

function edit(id) {
  const row = items.find((r) => r[0] === id);
  if (!row) return;
  const u = Object.assign({}, row[1], { category: cat(row[1]) });
  const values = isCable(u)
    ? { name: u.name || "", size: u.size || "", length: String(metres(u) || ""), bundle: digitsOnly(u.bundle || ""), price: Number(u.price || 0).toLocaleString("en-US") }
    : { name: u.name || "", brand: u.brand || "", size: u.size || "", length: String(metres(u) || ""), quantity: isLengthItem(u) ? "" : String(u.quantity ?? 1), price: Number(u.price || 0).toLocaleString("en-US") };
  values.expected = u.expectedDate ? formatDateDMY(u.expectedDate) : "";
  values.cost = u.cost ? Number(u.cost).toLocaleString("en-US") : "";
  modal.open({
    title: "Edit Upcoming Product", sub: "Update the details and save.", saveLabel: "Save Changes",
    category: u.category, edit: true, withDate: true, values,
    onSave: async (category, v) => {
      const built = withExpected(buildProduct(category, v), v);
      if (built.error) { alert(built.error); return false; }
      try {
        await updateDoc(ref(uid, "upcoming", id), built.data);
        // Keep the supplier's bill in step with the new quantity / cost.
        const bill = u.purchaseId && purchases.find((x) => x[0] === u.purchaseId);
        if (bill && !bill[1].addedToStock) {
          const item = billItem(Object.assign({}, u, built.data), u.productId);
          if (u.purchaseItem !== undefined && u.purchaseItem !== null) {
            // one item of a bigger bill: change only that line
            const its = (bill[1].items || []).map((i, k) => (k === u.purchaseItem ? Object.assign({}, i, { qty: item.qty, cost: item.cost, total: item.total }) : i));
            const total = its.reduce((a, i) => a + Number(i.total || 0), 0);
            await updateDoc(ref(uid, "purchases", u.purchaseId), { items: its, total, paid: Math.min(Number(bill[1].paid || 0), total) });
          } else await updateDoc(ref(uid, "purchases", u.purchaseId), { items: [item], total: item.total, paid: Math.min(Number(bill[1].paid || 0), item.total) });
        }
        return true;
      }
      catch (error) { alert("Error updating: " + error.message); return false; }
    }
  });
}

// ---------- Arrived ----------
// Adds the goods to Stock. If this order's cost (or sale) price is different from the Stock List,
// it asks first: update the stock price, or keep the old one. Same price = added straight away.
const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
async function findMatch(u) {
  const snap = await getDocs(col(uid, "products"));
  let byId = null, byName = null;
  snap.forEach((d) => {
    const p = d.data();
    if (u.productId && d.id === u.productId) byId = { id: d.id, p };
    if (byName || p.category !== u.category) return;
    const ok = isCable(u) ? same(p.size, u.size) && same(p.name, u.name)
      : u.category === "pump" ? same(p.name, u.name) && same(p.brand, u.brand)
      : same(p.name, u.name) && same(p.size, u.size);
    if (ok) byName = { id: d.id, p };
  });
  return byId || byName;
}

function askPrice(u, p, label) {
  return new Promise((resolve) => {
    const m = el("arrive-modal");
    const unit = byFeet(p) ? " / ft" : "";
    el("ar-sub").textContent = label;
    el("ar-cost-old").textContent = "Rs " + fmt(p.cost || 0) + unit;
    el("ar-price-old").textContent = "Rs " + fmt(p.price || 0) + unit;
    el("ar-cost").value = fmt(Number(u.cost) || Number(p.cost) || 0);
    el("ar-price").value = fmt(Number(u.price) || Number(p.price) || 0);
    m.classList.add("active");
    const done = (v) => { m.classList.remove("active"); ["ar-keep", "ar-update", "ar-cancel", "ar-close"].forEach((k) => { el(k).onclick = null; }); resolve(v); };
    el("ar-cancel").onclick = el("ar-close").onclick = () => done(null);
    el("ar-keep").onclick = () => done({ update: false });
    el("ar-update").onclick = () => {
      const cost = Number(digitsOnly(el("ar-cost").value)), price = Number(digitsOnly(el("ar-price").value));
      if (!(price > 0)) { alert("Please enter the sale price."); return; }
      done({ update: true, cost, price });
    };
  });
}
["ar-cost", "ar-price"].forEach((k) => el(k).addEventListener("input", (e) => { const v = digitsOnly(e.target.value); e.target.value = v ? Number(v).toLocaleString("en-US") : ""; }));

async function arrive(id) {
  const row = items.find((r) => r[0] === id);
  if (!row || row[1].status === "arrived") return;
  const u = Object.assign({}, row[1], { category: cat(row[1]) });
  const label = `${productName(u)} (${qtyText(u)})`;
  try {
    const match = await findMatch(u);
    let productId, priceNote = "";
    if (match) {
      const p = match.p;
      const costChanged = Number(u.cost) > 0 && Number(u.cost) !== Number(p.cost || 0);
      const priceChanged = Number(u.price) > 0 && Number(u.price) !== Number(p.price || 0);
      let prices = null;
      if (costChanged || priceChanged) {
        const ans = await askPrice(u, p, label);
        if (!ans) return;
        if (ans.update) { prices = { cost: ans.cost, price: ans.price }; priceNote = " Stock price updated."; }
        else priceNote = " Old stock price kept.";
      }
      productId = match.id;
      let patch;
      if (u.productId === match.id) patch = addStockPatch(p, unitsOf(u));
      else {
        patch = {};
        if (isCable(u)) {
          const total = metres(p) + metres(u);
          patch.length = total + "ft";
          const nb = (Number(digitsOnly(p.bundle || "")) || 0) + (Number(digitsOnly(u.bundle || "")) || 0);
          patch.bundle = nb ? String(nb) : "";
          patch.perBundle = nb ? Math.round(total / nb * 100) / 100 : 0;
        } else if (isLengthItem(u)) patch.length = (metres(p) + metres(u)) + "ft";
        else patch.quantity = (Number(p.quantity) || 0) + (Number(u.quantity) || 0);
      }
      if (prices) Object.assign(patch, prices);
      if (u.supplierId) { patch.supplierId = u.supplierId; patch.supplierName = u.supplierName || ""; }
      await updateDoc(ref(uid, "products", match.id), patch);
    } else {
      const rec = { category: u.category, price: u.price, cost: Number(u.cost) || 0 };
      if (u.supplierId) { rec.supplierId = u.supplierId; rec.supplierName = u.supplierName || ""; }
      if (isCable(u)) Object.assign(rec, { name: u.name || "", size: u.size || "", length: u.length || "0ft", bundle: u.bundle || "", perBundle: perBundle(u) });
      else Object.assign(rec, { name: u.name || "", quantity: Number(u.quantity) || 0 }, u.category === "pump" ? { brand: u.brand || "" } : { size: u.size || "", length: u.length || "", unit: u.unit || "pcs" });
      productId = (await addDoc(col(uid, "products"), rec)).id;
    }
    if (u.purchaseId) {
      const bill = purchases.find((x) => x[0] === u.purchaseId);
      if (bill) {
        if (u.purchaseItem !== undefined && u.purchaseItem !== null) {
          // a bill with several items: mark only this item; the bill counts as arrived when all of them did
          const its = (bill[1].items || []).map((i, k) => (k === u.purchaseItem ? Object.assign({}, i, { productId, arrived: true, arrivedDate: todayString() }) : i));
          const all = its.every((i) => i.arrived);
          await updateDoc(ref(uid, "purchases", u.purchaseId), Object.assign({ items: its }, all ? { addedToStock: true, arrivedDate: todayString() } : {}));
        } else await updateDoc(ref(uid, "purchases", u.purchaseId), { addedToStock: true, arrivedDate: todayString(), items: (bill[1].items || []).map((i) => Object.assign({}, i, { productId })) });
      }
    }
    await updateDoc(ref(uid, "upcoming", id), { status: "arrived", arrivedDate: todayString() });
    showToast(el("toast"), `<span>${esc(label)} added to Stock.${priceNote}</span><a href="stock.html">Open Stock List</a>`);
  } catch (error) { alert("Error marking as arrived: " + error.message); }
}

el("upcoming-table").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const id = b.dataset.id;
  if (b.dataset.act === "arrive") arrive(id);
  if (b.dataset.act === "edit") edit(id);
  if (b.dataset.act === "del") {
    const row = items.find((r) => r[0] === id);
    const pid = row && row[1].purchaseId && row[1].status !== "arrived" ? row[1].purchaseId : null;
    const bill = pid && purchases.find((x) => x[0] === pid);
    const idx = row && row[1].purchaseItem;
    const partOfBigBill = bill && idx !== undefined && idx !== null && (bill[1].items || []).length > 1;
    const msg = partOfBigBill ? " This item is also taken off its bill in the supplier's record." : pid ? " Its bill will also be removed from the supplier's record (payments already made stay in the record)." : "";
    if (!(await confirmDialog({ title: "Delete upcoming product?", message: "This entry will be removed." + msg + " This cannot be undone.", confirmLabel: "Delete", danger: true }))) return;
    try {
      await deleteDoc(ref(uid, "upcoming", id));
      if (partOfBigBill) {
        const its = bill[1].items.filter((i, k) => k !== idx);
        const total = its.reduce((a, i) => a + Number(i.total || 0), 0);
        await updateDoc(ref(uid, "purchases", pid), { items: its, total, paid: Math.min(Number(bill[1].paid || 0), total), addedToStock: its.every((i) => i.arrived) });
        // the other items of this bill move up one place
        for (const [oid, o] of items) if (o.purchaseId === pid && o.purchaseItem > idx) await updateDoc(ref(uid, "upcoming", oid), { purchaseItem: o.purchaseItem - 1 });
      } else if (pid) await deleteDoc(ref(uid, "purchases", pid));
    } catch (error) { alert("Error deleting: " + error.message); }
  }
});
