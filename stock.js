import { confirmDialog } from './dialogs.js?v=55';
import { start, listen, col, ref, addDoc, updateDoc, deleteDoc } from './common.js?v=55';
import { initProductModal, buildProduct } from './productForm.js?v=55';
import { ensureSupplier, recordPurchase, supplierSummary } from './supplierUtils.js?v=55';
import {
  CATEGORY_LABELS, CATEGORY_ORDER, HAS_QUANTITY, LOW_QTY, LOW_CABLE_FT, ICONS,
  esc, fmt, formatDateDMY, todayString, highlightMatch, attachNumberFormatting, attachAutoCapitalize,
  formatWithCommas, digitsOnly, toNumber, withButtonLock, isCable, isLowStock, metres, lengthText, byFeet, isLengthItem, perBundle, perBundleText, productName,
  productLabel, stockText, bundleText, stockValue, pillHtml, sellNameOf, phoneKey, nameKey, highlightWords
} from './utils.js?v=55';

const el = (id) => document.getElementById(id);
let uid = null;
let products = [];            // [[id, data]]
let suppliers = [], purchases = [], supplierPays = [];   // for the "Bought from" box
let tab = "all", query = "", lowOnly = new URLSearchParams(location.search).has("low");
// Selling to a customer picked on the Customers page: name and number are filled in, then we go back there.
const qp = new URLSearchParams(location.search);
const preset = qp.has("cname") || qp.has("cphone") ? { name: qp.get("cname") || "", phone: qp.get("cphone") || "", key: qp.get("c") || "" } : null;
let known = [];               // past customers for the name / number suggestions: [{ name, phone }]
let sellItems = [];           // [{ id, p, price, quantity }]
let addAnotherMode = false;
const productModal = initProductModal();

// ---------- Rendering ----------

const TABS = [["all", "All"], ["pump", "Pumps"], ["wire", "Wire"], ["safety_cable", "Safety Cable"], ["other", "Other"]];

const LAYOUTS = {
  all:   { cols: "140px minmax(220px,2fr) minmax(150px,1.2fr) 150px 140px 200px", min: 1040 },
  pump:  { cols: "minmax(240px,2fr) minmax(150px,1fr) 140px 120px 160px 200px", min: 1000 },
  cable: { cols: "minmax(160px,1.2fr) minmax(140px,1fr) 150px 220px 150px minmax(200px,1fr)", min: 1130 },
  other: { cols: "minmax(160px,2fr) 110px 100px 110px 120px 140px 190px", min: 1070 }
};

function actions(id) {
  return `<span class="row-actions">
    <button type="button" class="sellbtn" data-act="sell" data-id="${id}">Sell</button>
    <button type="button" class="iconbtn" data-act="edit" data-id="${id}" aria-label="Edit product">${ICONS.edit}</button>
    <button type="button" class="iconbtn del" data-act="del" data-id="${id}" aria-label="Delete product">${ICONS.del}</button>
  </span>`;
}

function lowBadge(p) { return isLowStock(p) ? '<span class="low">Low</span>' : ""; }

function detailText(p) {
  if (p.category === "pump") return p.brand || "—";
  if (isCable(p)) { const b = bundleText(p); return b === "—" ? "Loose length" : "Bundle: " + b + (perBundleText(p) ? " · " + perBundleText(p) : ""); }
  return "Size: " + (p.size || "—");
}

function haystack(p) {
  return [productName(p), p.brand || "", p.size || "", CATEGORY_LABELS[p.category]].join(" ").toLowerCase();
}

function render() {
  const q = query.trim().toLowerCase();
  const sorted = products.slice().sort((a, b) =>
    CATEGORY_ORDER.indexOf(a[1].category) - CATEGORY_ORDER.indexOf(b[1].category) || productName(a[1]).localeCompare(productName(b[1])));
  const rows = sorted.filter(([, p]) => (tab === "all" || p.category === tab) && (!q || haystack(p).includes(q)) && (!lowOnly || isLowStock(p)));

  // KPIs
  const all = products.map((r) => r[1]);
  el("k-products").textContent = fmt(all.length);
  el("k-value").textContent = fmt(all.reduce((a, p) => a + stockValue(p), 0));
  el("k-metres").textContent = fmt(all.reduce((a, p) => a + (isCable(p) ? metres(p) : 0), 0)) + " ft";
  el("k-low").textContent = fmt(all.filter(isLowStock).length);
  el("stock-sub").textContent = "All categories in one place · Last updated " + formatDateDMY(todayString());

  // Tabs
  el("tabs").innerHTML = TABS.map(([key, label]) => {
    const count = key === "all" ? all.length : all.filter((p) => p.category === key).length;
    return `<button type="button" class="tab" data-tab="${key}" aria-pressed="${tab === key}">${label}<span class="cnt">${count}</span></button>`;
  }).join("");
  el("low-toggle").setAttribute("aria-pressed", String(lowOnly));

  // Table
  const area = el("table-area");
  if (!rows.length) {
    area.innerHTML = '<div class="empty"><strong>No products found</strong>Try another search, or switch category.</div>';
  } else if (tab === "all") {
    const L = LAYOUTS.all;
    area.innerHTML = `<div style="min-width:${L.min}px"><div class="head" style="grid-template-columns:${L.cols}"><span>Category</span><span>Product</span><span>Details</span><span class="num">In stock</span><span class="num">Price (Rs)</span><span style="text-align:right">Actions</span></div>` +
      rows.map(([id, p]) => `<div class="row" style="grid-template-columns:${L.cols}">
        <span>${pillHtml(p.category, true)}</span>
        <span class="w500">${highlightMatch(productName(p), query.trim())}</span>
        <span class="muted">${esc(detailText(p))}</span>
        <span class="num cell-flex">${esc(stockText(p))}${lowBadge(p)}</span>
        <span class="num">${fmt(p.price)}</span>
        ${actions(id)}
      </div>`).join("") + "</div>";
  } else if (tab === "pump") {
    const L = LAYOUTS.pump;
    area.innerHTML = `<div style="min-width:${L.min}px"><div class="head" style="grid-template-columns:${L.cols}"><span>Name</span><span>Detail</span><span class="num">Price (Rs)</span><span class="num">Quantity</span><span class="num">Stock value (Rs)</span><span style="text-align:right">Actions</span></div>` +
      rows.map(([id, p]) => `<div class="row" style="grid-template-columns:${L.cols}">
        <span class="w500">${highlightMatch(productName(p), query.trim())}</span>
        <span class="muted">${esc(p.brand || "—")}</span>
        <span class="num">${fmt(p.price)}</span>
        <span class="num cell-flex">${fmt(p.quantity)}${lowBadge(p)}</span>
        <span class="num strong">${fmt(stockValue(p))}</span>
        ${actions(id)}
      </div>`).join("") + "</div>";
  } else if (tab === "other") {
    const L = LAYOUTS.other;
    area.innerHTML = `<div style="min-width:${L.min}px"><div class="head" style="grid-template-columns:${L.cols}"><span>Name</span><span>Size</span><span class="num">Length</span><span class="num">Price (Rs)</span><span class="num">Quantity</span><span class="num">Stock value (Rs)</span><span style="text-align:right">Actions</span></div>` +
      rows.map(([id, p]) => `<div class="row" style="grid-template-columns:${L.cols}">
        <span class="w500">${highlightMatch(productName(p), query.trim())}</span>
        <span class="muted">${esc(p.size || "—")}</span>
        <span class="num${isLengthItem(p) ? " cell-flex" : ""}">${esc(lengthText(p))}${isLengthItem(p) ? lowBadge(p) : ""}</span>
        <span class="num">${fmt(p.price)}${isLengthItem(p) ? ' <span class="muted" style="font-size:12px">/ ft</span>' : ""}</span>
        <span class="num${isLengthItem(p) ? "" : " cell-flex"}">${isLengthItem(p) ? "—" : fmt(p.quantity) + lowBadge(p)}</span>
        <span class="num strong">${isLengthItem(p) ? "—" : fmt(stockValue(p))}</span>
        ${actions(id)}
      </div>`).join("") + "</div>";
  } else {
    const L = LAYOUTS.cable;
    area.innerHTML = `<div style="min-width:${L.min}px"><div class="head" style="grid-template-columns:${L.cols}"><span>Name</span><span>Size</span><span class="num">Length</span><span class="num">Bundle</span><span class="num">Price (Rs)</span><span style="text-align:right">Actions</span></div>` +
      rows.map(([id, p]) => `<div class="row" style="grid-template-columns:${L.cols}">
        <span class="w500">${p.name ? highlightMatch(p.name, query.trim()) : '<span class="t-dim">—</span>'}</span>
        <span class="w500">${highlightMatch(p.size || "", query.trim())}</span>
        <span class="num cell-flex">${esc(stockText(p))}${lowBadge(p)}</span>
        <span class="num">${esc(bundleText(p))}${perBundleText(p) && bundleText(p) !== "—" ? ` <span class="muted" style="font-size:12px">· ${esc(perBundleText(p))}</span>` : ""}</span>
        <span class="num">${fmt(p.price)} <span class="muted" style="font-size:12px">/ ft</span></span>
        ${actions(id)}
      </div>`).join("") + "</div>";
  }

  el("foot-left").textContent = `Showing ${rows.length} of ${all.length} products`;
  el("foot-right").textContent = `Low stock: ${LOW_QTY} pcs or fewer · cable ${LOW_CABLE_FT} ft or less`;
}

el("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  tab = b.dataset.tab;
  render();
});
el("low-toggle").addEventListener("click", () => { lowOnly = !lowOnly; render(); });
el("stock-search").addEventListener("input", (e) => { query = e.target.value; render(); });

el("table-area").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === "sell") sellProduct(id);
  if (btn.dataset.act === "edit") editProduct(id);
  if (btn.dataset.act === "del") deleteProduct(id);
});

const byId = (id) => { const row = products.find((r) => r[0] === id); return row ? row[1] : null; };

start((user) => {
  uid = user.uid;
  listen(uid, "products", (rows) => { products = rows; render(); });
  listen(uid, "sales", (rows) => { buildKnown(rows); });
  me = user;
  if (user.role === "salesman") { showSalesmanBar(user); return; }   // a salesman only sells: no suppliers / purchases
  listen(uid, "suppliers", (rows) => { suppliers = rows; productModal.setSuppliers(rows); });
  listen(uid, "purchases", (rows) => { purchases = rows; });
  listen(uid, "supplierPayments", (rows) => { supplierPays = rows; });
  if (new URLSearchParams(location.search).get("add")) openAdd();
});
let me = null;
function showSalesmanBar(user) {
  const bar = document.createElement("div");
  bar.className = "staff-bar";
  bar.innerHTML = `<b>Salesman login</b><span>${esc(user.staffName || user.email)} · you can sell items. Profit, accounts and settings are only for the owner.</span>`;
  const ph = document.querySelector(".main .ph");
  if (ph) ph.insertAdjacentElement("afterend", bar);
}

// ---------- Add / Edit / Delete ----------

const balanceOf = (id) => { const r = suppliers.find((x) => x[0] === id); return r ? supplierSummary(id, r[1], purchases, supplierPays).balance : 0; };

function openAdd() {
  if (me && me.role === "salesman") return;
  productModal.open({
    title: "Add Product", sub: "Fields change with the category you pick.", saveLabel: "Save Product", category: "pump",
    withSupplier: true, suppliers, getBalance: balanceOf,
    onSave: async (category, v, buy) => {
      const built = buildProduct(category, v);
      if (built.error) { alert(built.error); return false; }
      const data = built.data;
      const fromSupplier = buy && !buy.none;
      const feet = byFeet(data);
      const units = feet ? metres(data) : Number(data.quantity || 0);
      if (fromSupplier && !(data.cost > 0)) { alert("Please enter the Cost price — it is saved in the supplier's record."); return false; }
      if (fromSupplier && units <= 0) { alert("Please enter the quantity you bought."); return false; }
      try {
        let sup = null;
        if (fromSupplier) {
          sup = await ensureSupplier(uid, buy, suppliers);
          data.supplierId = sup.id; data.supplierName = sup.name;
        }
        const d = await addDoc(col(uid, "products"), data);
        if (sup) {
          const item = { productId: d.id, name: sellNameOf(data), category, qty: units, unit: feet ? "ft" : "pcs", cost: data.cost, total: Math.round(units * data.cost) };
          await recordPurchase(uid, { sup, date: buy.date, items: [item], paid: buy.paid, balanceBefore: buy.id ? balanceOf(buy.id) : 0, source: "add-product" });
        }
        return true;
      }
      catch (error) { alert("Error adding product: " + error.message); return false; }
    }
  });
}
el("open-add-modal-btn").addEventListener("click", openAdd);

function editProduct(id) {
  if (me && me.role === "salesman") return;
  const p = byId(id);
  if (!p) return;
  const values = isCable(p)
    ? { name: p.name || "", size: p.size || "", length: String(metres(p) || ""), bundle: digitsOnly(p.bundle || ""), price: formatWithCommas(p.price) }
    : { name: p.name || "", brand: p.brand || "", size: p.size || "", length: String(metres(p) || ""), quantity: isLengthItem(p) ? "" : String(p.quantity ?? 0), price: formatWithCommas(p.price) };
  values.cost = p.cost ? formatWithCommas(p.cost) : "";
  productModal.open({
    title: "Edit " + CATEGORY_LABELS[p.category], sub: "Update the details and save.", saveLabel: "Save Changes",
    category: p.category, edit: true, values,
    onSave: async (category, v) => {
      const built = buildProduct(category, v, { allowZeroQty: true });
      if (built.error) { alert(built.error); return false; }
      try { await updateDoc(ref(uid, "products", id), built.data); return true; }
      catch (error) { alert("Error updating product: " + error.message); return false; }
    }
  });
}

async function deleteProduct(id) {
  if (me && me.role === "salesman") return;
  const p = byId(id);
  const label = p ? productName(p) || "this item" : "this item";
  if (!(await confirmDialog({ title: "Delete product?", message: `"${label}" will be removed from the Stock List. This cannot be undone.`, confirmLabel: "Delete", danger: true }))) return;
  try { await deleteDoc(ref(uid, "products", id)); } catch (error) { alert("Error deleting product: " + error.message); }
}

// ---------- Sell (multi-item) ----------
// Wire / Safety Cable: price is per foot and the seller picks how many feet to sell.
// Pumps / Other: price per piece and a quantity. An Other item that has a length can also sell some feet.

const sellModal = el("sell-modal"), pickerModal = el("picker-modal"), paymentModal = el("payment-modal"), categoryModal = el("category-modal");
const custName = el("sell-customer-name"), custContact = el("sell-customer-contact");
const received = el("payment-received"), payTotal = el("payment-total");

attachNumberFormatting(custContact, false);
attachNumberFormatting(received, true);
attachAutoCapitalize(custName);

const sellName = (p) => (isCable(p) ? `${CATEGORY_LABELS[p.category]} — ${productName(p)}` : p.name);
const hasFeetBox = (p) => byFeet(p) || (p.category === "other" && metres(p) > 0);
const lineTotal = (item) => (byFeet(item.p) ? item.price * item.feet : item.price * item.quantity);
const sellTotal = () => sellItems.reduce((sum, item) => sum + lineTotal(item), 0);
const newItem = (id, p) => ({ id, p, price: p.price, maxPrice: p.price, quantity: 1, feet: byFeet(p) ? 1 : 0 });

function sellProduct(id) {
  const p = byId(id);
  if (!p) return;
  custName.value = preset ? preset.name : "";
  custContact.value = preset ? phoneKey(preset.phone) || preset.phone : "";
  // Sale started from a customer: name and number are locked to that customer.
  custName.readOnly = custContact.readOnly = !!preset;
  el("sell-locked").hidden = !preset;
  markFilled();
  sellItems = [newItem(id, p)];
  renderSellItems();
  sellModal.classList.add("active");
}

function feetField(item, index, required) {
  const left = metres(item.p);
  return `<label class="fgroup"><span class="lbl">Length to sell${required ? ' <span class="req">*</span>' : " (optional)"}</span><span class="ibox"><input type="text" inputmode="numeric" class="mono sell-item-feet" data-index="${index}" value="${item.feet ? item.feet : ""}" placeholder="0"><span class="aff">ft</span></span><span class="hint-line">${fmt(left)} ft in stock</span></label>`;
}

function renderSellItems() {
  el("sell-items").innerHTML = sellItems.map((item, index) => {
    const p = item.p, cable = byFeet(p);
    const priceLabel = cable ? "Price per foot" : "Price";
    const qtyField = cable ? "" : `<label class="fgroup"><span class="lbl">Quantity <span class="req">*</span></span><span class="ibox"><input type="text" inputmode="numeric" class="mono sell-item-qty" data-index="${index}" value="${item.quantity}"><span class="aff">pcs</span><button type="button" class="step" data-qty="-1" data-index="${index}" aria-label="Decrease">−</button><button type="button" class="step" data-qty="1" data-index="${index}" aria-label="Increase">+</button></span><span class="hint-line">${fmt(p.quantity)} pcs in stock</span></label>`;
    return `<div class="sell-card">
      <div class="sell-card-head"><span>${esc(sellName(p))}</span>${index > 0 ? `<button type="button" class="rm" data-remove="${index}" aria-label="Remove item">×</button>` : ""}</div>
      <div class="grid2">
        <label class="fgroup"><span class="lbl">${priceLabel} <span class="req">*</span></span><span class="ibox"><span class="aff">Rs</span><input type="text" inputmode="numeric" class="mono sell-item-price" data-index="${index}" value="${Number(item.price).toLocaleString("en-US")}">${cable ? '<span class="aff">/ ft</span>' : ""}</span><span class="hint-line price-hint">Listed Rs ${fmt(item.maxPrice)}${cable ? " / ft" : ""} · can only be lowered</span></label>
        ${cable ? feetField(item, index, true) : qtyField}
        ${!cable && hasFeetBox(p) ? feetField(item, index, false) : ""}
      </div>
      <div class="line-total"><span>${cable ? `Rs ${fmt(item.price)} × ${fmt(item.feet)} ft` : `Rs ${fmt(item.price)} × ${fmt(item.quantity)}`}</span><strong data-line="${index}">Rs ${fmt(lineTotal(item))}</strong></div>
    </div>`;
  }).join("");
  updateSellTotal();
}

function updateSellTotal() { el("sell-total-display").textContent = "Rs. " + fmt(sellTotal()); }

function refreshLine(index) {
  const item = sellItems[index];
  const card = el("sell-items").querySelectorAll(".sell-card")[index];
  if (!card) return;
  card.querySelector(".line-total span").textContent = byFeet(item.p) ? `Rs ${fmt(item.price)} × ${fmt(item.feet)} ft` : `Rs ${fmt(item.price)} × ${fmt(item.quantity)}`;
  card.querySelector("[data-line]").textContent = "Rs " + fmt(lineTotal(item));
  updateSellTotal();
}

el("sell-items").addEventListener("input", (e) => {
  const index = parseInt(e.target.dataset.index, 10);
  if (isNaN(index) || !sellItems[index]) return;
  if (e.target.classList.contains("sell-item-price")) {
    let v = toNumber(e.target.value);
    const over = v > sellItems[index].maxPrice;
    if (over) v = sellItems[index].maxPrice;
    e.target.value = formatWithCommas(String(v));
    sellItems[index].price = v;
    const hint = e.target.closest("label").querySelector(".price-hint");
    if (hint) hint.classList.toggle("warn", over);
  } else if (e.target.classList.contains("sell-item-qty")) {
    e.target.value = digitsOnly(e.target.value);
    sellItems[index].quantity = toNumber(e.target.value);
  } else if (e.target.classList.contains("sell-item-feet")) {
    e.target.value = digitsOnly(e.target.value);
    sellItems[index].feet = toNumber(e.target.value);
  } else return;
  refreshLine(index);
});

el("sell-items").addEventListener("click", (e) => {
  const rm = e.target.closest("[data-remove]");
  if (rm) { sellItems.splice(Number(rm.dataset.remove), 1); renderSellItems(); return; }
  const step = e.target.closest("[data-qty]");
  if (step) {
    const i = Number(step.dataset.index);
    sellItems[i].quantity = Math.max(1, sellItems[i].quantity + Number(step.dataset.qty));
    const box = step.closest(".ibox").querySelector("input");
    box.value = sellItems[i].quantity;
    refreshLine(i);
  }
});

el("sell-add-product-btn").addEventListener("click", () => categoryModal.classList.add("active"));
el("category-cancel-btn").addEventListener("click", () => categoryModal.classList.remove("active"));
categoryModal.querySelectorAll("[data-category]").forEach((btn) => {
  btn.addEventListener("click", () => { categoryModal.classList.remove("active"); openPicker(btn.dataset.category); });
});

function openPicker(category) {
  const list = el("picker-list");
  list.innerHTML = "";
  const added = new Set(sellItems.map((i) => i.id));
  const matches = products.filter(([, p]) => p.category === category);
  if (!matches.length) list.innerHTML = `<p class="muted" style="font-size:14px">No ${CATEGORY_LABELS[category]} items in stock.</p>`;
  matches.forEach(([id, p]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pick-btn";
    btn.textContent = `${sellName(p)} · ${byFeet(p) ? fmt(metres(p)) + " ft" : fmt(p.quantity) + " pcs"} in stock` + (added.has(id) ? " — already added" : "");
    btn.disabled = added.has(id);
    btn.addEventListener("click", () => {
      if (sellItems.some((i) => i.id === id)) return;
      sellItems.push(newItem(id, p));
      pickerModal.classList.remove("active");
      renderSellItems();
    });
    list.appendChild(btn);
  });
  pickerModal.classList.add("active");
}
el("picker-cancel-btn").addEventListener("click", () => pickerModal.classList.remove("active"));

function closeSell() { sellModal.classList.remove("active"); sellItems = []; hideSugg(); }
el("sell-cancel-btn").addEventListener("click", closeSell);
el("sell-close").addEventListener("click", closeSell);

function validateSellItems() {
  if (!sellItems.length) { alert("Add at least one product to sell."); return null; }
  for (const item of sellItems) {
    const p = item.p, name = sellName(p);
    if (item.price <= 0) { alert(`Please enter a price for ${name}.`); return null; }
    if (item.price > item.maxPrice) { alert(`The price of ${name} cannot be more than Rs ${fmt(item.maxPrice)}.`); return null; }
    if (byFeet(p)) {
      if (item.feet <= 0) { alert(`Please enter how many feet of ${name} to sell.`); return null; }
      if (item.feet > metres(p)) { alert(`Only ${fmt(metres(p))} ft left for ${name}.`); return null; }
    } else {
      if (item.quantity <= 0) { alert(`Please enter a quantity for ${name}.`); return null; }
      if (item.quantity > p.quantity) { alert(`Only ${p.quantity} left for ${name}.`); return null; }
      if (item.feet > metres(p)) { alert(`Only ${fmt(metres(p))} ft left for ${name}.`); return null; }
    }
  }
  return sellItems;
}

// Loan: one click — nothing received now, the full amount is owed.
el("sell-loan-btn").addEventListener("click", (e) => withButtonLock(e.currentTarget, async () => {
  const items = validateSellItems();
  if (items) await finalizeSale(items, 0);
}));

// Cash: asks how much was received; the rest becomes a pending payment.
el("sell-cash-btn").addEventListener("click", () => {
  if (!validateSellItems()) return;
  const total = sellTotal();
  sellModal.classList.remove("active");
  payTotal.value = fmt(total);
  received.value = fmt(total);
  paymentModal.classList.add("active");
  received.focus();
});

received.addEventListener("input", () => {
  const max = sellTotal();
  if (toNumber(received.value) > max) received.value = fmt(max);
});

el("payment-cancel-btn").addEventListener("click", () => { paymentModal.classList.remove("active"); sellModal.classList.add("active"); });

el("payment-confirm-btn").addEventListener("click", (e) => withButtonLock(e.currentTarget, async () => {
  const items = validateSellItems();
  paymentModal.classList.remove("active");
  if (!items) return;
  await finalizeSale(items, Math.min(toNumber(received.value), sellTotal()));
}));

async function finalizeSale(items, totalReceived) {
  const totalAmount = sellTotal();
  const totalRemaining = Math.max(0, totalAmount - totalReceived);
  const ratio = totalAmount > 0 ? totalRemaining / totalAmount : 0;
  const timestamp = Date.now();
  const date = todayString();
  const time = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const customerName = custName.value.trim();
  const customerContact = phoneKey(custContact.value) || custContact.value;

  try {
    for (const item of items) {
      const p = item.p, cable = byFeet(p);
      const qty = cable ? 1 : item.quantity;
      const amount = lineTotal(item);
      const remaining = Math.round(amount * ratio);
      const patch = {};
      if (!cable) patch.quantity = p.quantity - qty;
      if (item.feet > 0) {
        const left = metres(p) - item.feet;
        patch.length = left + "ft";
        // Bundles drop automatically as feet are sold (a cut bundle still counts until it is used up).
        const per = isCable(p) ? perBundle(p) : 0;
        if (per > 0) { patch.bundle = String(Math.max(0, Math.ceil(left / per - 1e-9))); patch.perBundle = per; }
      }
      if (Object.keys(patch).length) await updateDoc(ref(uid, "products", item.id), patch);
      const record = {
        productName: sellName(p), category: p.category,
        quantity: qty, amount, received: amount - remaining, remainingCost: remaining,
        paymentType: remaining > 0 ? "credit" : "cash",
        date, time, timestamp, customerName, customerContact
      };
      if (item.feet > 0) { record.lengthFt = item.feet; if (cable) record.pricePerFt = item.price; }
      // For Cash Closing: the cash taken right now. For Profit Report: what these items cost you.
      record.paidAtSale = amount - remaining;
      const unitCost = Number(p.cost || 0);
      if (unitCost > 0) record.cost = Math.round(unitCost * (cable ? item.feet : qty));
      if (remaining > 0) record.status = "pending";
      if (me && me.role === "salesman") record.soldBy = me.staffName || me.email || "Salesman";
      await addDoc(col(uid, "sales"), record);
    }
    closeSell();
    if (preset) {
      const pk = phoneKey(customerContact);
      location.href = "customers.html?" + new URLSearchParams({ c: pk ? "c" + pk : preset.key || "n" + nameKey(customerName), sold: "1" }).toString();
    }
  } catch (error) {
    alert("Error recording sale: " + error.message);
  }
}

// ---------- Old customer suggestions ----------
// While you type a name or number, matching old customers show under the boxes (matching text highlighted).
// Pressing one fills BOTH the name and the number, so the sale joins that customer.
function buildKnown(rows) {
  const map = new Map();
  rows.slice().sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0)).forEach(([, x]) => {
    const n = (x.customerName || "").trim().replace(/\s+/g, " "), p = phoneKey(x.customerContact);
    if (!n && !p) return;
    const key = p ? "c" + p : "n" + nameKey(n);
    const k = map.get(key) || { name: "", phone: p, last: "", visits: 0, due: 0, stamps: new Set() };
    if (n) k.name = n;
    k.last = x.date || k.last;
    if (!k.stamps.has(x.timestamp)) { k.stamps.add(x.timestamp); k.visits++; }
    k.due += x.status === "received" ? 0 : Number(x.remainingCost || 0);
    map.set(key, k);
  });
  // a name-only entry that matches a customer with a number is the same person
  const withPhone = [...map.values()].filter((k) => k.phone);
  map.forEach((k, key) => { if (!k.phone && withPhone.some((w) => nameKey(w.name) === nameKey(k.name))) map.delete(key); });
  known = [...map.values()].reverse();
}

const sugg = el("cust-sugg");
let suggList = [], suggAt = -1;

function showSugg(from) {
  const qName = from === "name" ? custName.value.trim() : "";
  const qPhone = from === "phone" ? digitsOnly(custContact.value) : "";
  const words = nameKey(qName).split(" ").filter(Boolean);
  if (!words.length && !qPhone) { hideSugg(); return; }
  suggList = known.filter((k) => (words.length ? words.every((w) => nameKey(k.name).includes(w)) : true) && (qPhone ? k.phone.includes(qPhone) : true))
    .map((k, i) => ({ k, i, starts: words.length ? nameKey(k.name).startsWith(words[0]) : k.phone.startsWith(qPhone) }))
    .sort((a, b) => (b.starts - a.starts) || (a.i - b.i)).map((x) => x.k).slice(0, 6);
  if (!suggList.length) { hideSugg(); return; }
  suggAt = -1;
  sugg.innerHTML = '<div class="sugg-h">Old customers — press one to fill name and number</div>' + suggList.map((k, i) => `
    <button type="button" class="sugg-i" role="option" data-i="${i}" aria-selected="false">
      <span class="av">${esc((k.name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase())}</span>
      <span class="cinfo"><span class="cname">${highlightWords(k.name || "No name", qName)}</span><span class="cmeta">${k.phone ? highlightWords(k.phone, qPhone) : "No number"} · ${k.visits} visit${k.visits === 1 ? "" : "s"} · last ${formatDateDMY(k.last)}</span></span>
      ${k.due > 0 ? `<span class="due-badge">Rs ${fmt(k.due)}</span>` : ""}
    </button>`).join("");
  sugg.hidden = false;
  [custName, custContact].forEach((x) => x.setAttribute("aria-expanded", "true"));
}
function hideSugg() { sugg.hidden = true; suggList = []; suggAt = -1; [custName, custContact].forEach((x) => x.setAttribute("aria-expanded", "false")); }
function pickSugg(i) {
  const k = suggList[i];
  if (!k) return;
  custName.value = k.name;
  custContact.value = k.phone;
  markFilled();
  hideSugg();
}
// Filled-in boxes select their text when clicked, so typing again replaces it instead of adding to it.
function markFilled() { [custName, custContact].forEach((x) => { x.dataset.filled = x.value ? "1" : ""; }); }
[custName, custContact].forEach((x) => {
  let justFocused = false;
  x.addEventListener("focus", () => { if (x.dataset.filled === "1" && !x.readOnly) { x.select(); justFocused = true; } });
  x.addEventListener("mouseup", (e) => { if (justFocused) { e.preventDefault(); justFocused = false; } });
  x.addEventListener("input", () => { x.dataset.filled = ""; });
});
function moveSugg(d) {
  if (sugg.hidden || !suggList.length) return false;
  suggAt = (suggAt + d + suggList.length) % suggList.length;
  sugg.querySelectorAll(".sugg-i").forEach((b, i) => b.setAttribute("aria-selected", String(i === suggAt)));
  return true;
}

custName.addEventListener("input", () => { if (!custName.readOnly) showSugg("name"); });
custContact.addEventListener("input", () => { if (!custContact.readOnly) showSugg("phone"); });
[custName, custContact].forEach((inp) => {
  inp.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && moveSugg(1)) e.preventDefault();
    else if (e.key === "ArrowUp" && moveSugg(-1)) e.preventDefault();
    else if (e.key === "Enter" && !sugg.hidden && suggAt >= 0) { e.preventDefault(); pickSugg(suggAt); }
    else if (e.key === "Escape" && !sugg.hidden) { e.stopPropagation(); hideSugg(); }
  });
  inp.addEventListener("blur", () => setTimeout(hideSugg, 150));
});
// mousedown so the choice is taken before the box loses focus
sugg.addEventListener("mousedown", (e) => { const b = e.target.closest("[data-i]"); if (b) { e.preventDefault(); pickSugg(Number(b.dataset.i)); } });

if (preset) {
  const box = el("sell-for");
  box.innerHTML = `<span>New sale for <b>${esc(preset.name || "customer")}</b>${preset.phone ? " · " + esc(preset.phone) : ""}. Press <b>Sell</b> on a product; the name and number are filled in and locked for this customer.</span><a href="customers.html${preset.key ? "?c=" + encodeURIComponent(preset.key) : ""}">Cancel</a>`;
  box.hidden = false;
}
