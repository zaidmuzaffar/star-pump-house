import { confirmDialog } from './dialogs.js?v=55';
import { start, listen, col, ref, addDoc, updateDoc, showToast } from './common.js?v=55';
import {
  esc, fmt, formatDateDMY, todayString, toNumber, digitsOnly, withButtonLock, remainingOf,
  saleUnits, saleUnitName, sellNameOf, byFeet, isCable, metres, perBundle, daysAgoIso, itemText, highlightWords
} from './utils.js?v=55';

const el = (id) => document.getElementById(id);
let uid = null;
let sales = [], products = [], returns = [], shops = [], shopBills = [];
let src = "customer";                       // "customer" or "shop"
let query = "", saleId = null, type = "refund";
let shopId = "", shopQuery = "", pickedItem = null;   // pickedItem: { billId, idx }

start((user) => {
  uid = user.uid;
  listen(uid, "sales", (rows) => { sales = rows; renderSales(); renderForm(); });
  listen(uid, "products", (rows) => { products = rows; renderDamaged(); });
  listen(uid, "returns", (rows) => { returns = rows; renderHistory(); renderDamaged(); });
  listen(uid, "shops", (rows) => { shops = rows; renderShopSelect(); });
  listen(uid, "shopBills", (rows) => { shopBills = rows; renderShopItems(); renderForm(); });
});

const TYPES = {
  customer: [["refund", "Cash refund", "Pay from galla"], ["udhaar", "Cut udhaar", "Reduce what they owe"], ["exchange", "Exchange", "Give another item"]],
  shop: [["cut", "Cut from shop bill", "Reduce what the shop owes"], ["sexchange", "Exchange", "Give the shop another item"]]
};

// ---------- Source: customer or shop ----------
el("r-src").addEventListener("click", (e) => {
  const b = e.target.closest("[data-src]");
  if (!b || b.dataset.src === src) return;
  src = b.dataset.src;
  type = src === "shop" ? "cut" : "refund";
  el("r-qty").value = "1";
  el("r-src").querySelectorAll("[data-src]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.src === src)));
  el("r-cust-sec").hidden = src !== "customer";
  el("r-shop-sec").hidden = src !== "shop";
  renderForm();
});

// ---------- Customer: pick a sale ----------
const saleById = (id) => { const r = sales.find((x) => x[0] === id); return r ? r[1] : null; };
const returnable = (s) => Math.max(0, saleUnits(s) - Number(s.returnedQty || 0));

function renderSales() {
  const q = query.trim().toLowerCase(), qd = digitsOnly(query);
  const list = sales
    .filter(([, s]) => returnable(s) > 0)
    .filter(([, s]) => !q || (s.customerName || "").toLowerCase().includes(q) || (s.productName || "").toLowerCase().includes(q) || (qd && digitsOnly(s.customerContact || "").includes(qd)))
    .sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));
  if (saleId && !list.some(([id]) => id === saleId) && !saleById(saleId)) saleId = null;
  const qs = query.trim();
  el("r-sales-count").textContent = `${list.length} sale${list.length === 1 ? "" : "s"}${q ? " found" : ", newest first"}${list.length > 5 ? " · scroll to see all" : ""}`;
  el("r-sales").innerHTML = list.length ? list.map(([id, s]) => `
    <button type="button" class="pick-sale" data-sale="${id}" aria-pressed="${id === saleId}">
      <span class="dot"></span>
      <span class="info"><span class="t">${highlightWords(itemText(s), qs)}</span><span class="m">${highlightWords(s.customerName || "Walk-in customer", qs)} · ${formatDateDMY(s.date)} · ${fmt(returnable(s))} ${saleUnitName(s)} can be returned</span></span>
      <span class="num" style="font-size:13px">Rs ${fmt(s.amount)}</span>
    </button>`).join("")
    : `<div class="empty" style="padding:24px 12px"><strong>No sale found</strong>${q ? "Try another name or item." : "No sale that can still be returned."}</div>`;
}

el("r-search").addEventListener("input", (e) => { query = e.target.value; renderSales(); });
el("r-sales").addEventListener("click", (e) => {
  const b = e.target.closest("[data-sale]");
  if (!b) return;
  saleId = b.dataset.sale;
  el("r-qty").value = "1";
  renderSales(); renderForm();
});

// ---------- Shop: pick the shop, then an item it was given ----------
function renderShopSelect() {
  const list = shops.slice().sort((a, b) => (a[1].name || "").localeCompare(b[1].name || ""));
  if (shopId && !list.some(([id]) => id === shopId)) shopId = "";
  el("r-shop").innerHTML = '<option value="">Choose shop…</option>' + list.map(([id, s]) => `<option value="${id}" ${id === shopId ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  renderShopItems();
}
el("r-shop").addEventListener("change", (e) => { shopId = e.target.value; pickedItem = null; el("r-qty").value = "1"; renderShopItems(); renderForm(); });
el("r-shop-search").addEventListener("input", (e) => { shopQuery = e.target.value; renderShopItems(); });

const billById = (id) => { const r = shopBills.find((x) => x[0] === id); return r ? r[1] : null; };
const itemLeft = (i) => Math.max(0, Number(i.qty || 0) - Number(i.returnedQty || 0));

function renderShopItems() {
  const box = el("r-shop-items");
  if (!shopId) { box.innerHTML = '<div class="empty" style="padding:20px 12px"><strong>Choose the shop first</strong>Items you gave to that shop will show here.</div>'; return; }
  const words = shopQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = [];
  shopBills.filter(([, b]) => b.shopId === shopId).forEach(([bid, b]) => (b.items || []).forEach((i, idx) => {
    if (itemLeft(i) <= 0) return;
    const hay = [i.name, b.billNo, formatDateDMY(b.date)].join(" ").toLowerCase();
    if (words.every((w) => hay.includes(w))) list.push({ bid, b, i, idx });
  }));
  list.sort((x, y) => (y.b.date || "").localeCompare(x.b.date || "") || (y.b.timestamp || 0) - (x.b.timestamp || 0));
  if (pickedItem && !list.some((x) => x.bid === pickedItem.billId && x.idx === pickedItem.idx) && !billById(pickedItem.billId)) pickedItem = null;
  const qs = shopQuery.trim();
  box.innerHTML = list.length ? list.slice(0, 12).map(({ bid, b, i, idx }) => `
    <button type="button" class="pick-sale" data-bill="${bid}" data-idx="${idx}" aria-pressed="${pickedItem && pickedItem.billId === bid && pickedItem.idx === idx}">
      <span class="dot"></span>
      <span class="info"><span class="t">${highlightWords(i.name, qs)}</span><span class="m">Given ${highlightWords(formatDateDMY(b.date), qs)}${b.billNo ? " · Bill no. " + highlightWords(b.billNo, qs) : ""} · ${fmt(itemLeft(i))} ${i.unit === "ft" ? "ft" : "pcs"} can be returned</span></span>
      <span class="num" style="font-size:13px">Rs ${fmt(i.price)}${i.unit === "ft" ? "/ft" : ""}</span>
    </button>`).join("")
    : `<div class="empty" style="padding:20px 12px"><strong>No item found</strong>${qs ? "Try another word." : "This shop has nothing that can be returned."}</div>`;
}
el("r-shop-items").addEventListener("click", (e) => {
  const b = e.target.closest("[data-bill]");
  if (!b) return;
  pickedItem = { billId: b.dataset.bill, idx: Number(b.dataset.idx) };
  el("r-qty").value = "1";
  renderShopItems(); renderForm();
});

// ---------- Form ----------
function calc() {
  if (src === "shop") {
    if (!pickedItem) return null;
    const b = billById(pickedItem.billId), i = b && (b.items || [])[pickedItem.idx];
    if (!i) return null;
    const max = itemLeft(i), qty = Math.min(toNumber(el("r-qty").value), max);
    const per = Number(i.qty || 0) ? Number(i.total || 0) / Number(i.qty) : Number(i.price || 0);
    const value = Math.round(per * qty);
    return { shop: true, b, i, unit: i.unit === "ft" ? "ft" : "pcs", max, qty, value, refund: 0, cut: value };
  }
  const s = saleById(saleId);
  if (!s) return null;
  const units = saleUnits(s) || 1;
  const max = returnable(s);
  const qty = Math.min(toNumber(el("r-qty").value), max);
  const value = Math.round(s.amount / units * qty);
  const owed = remainingOf(s);
  let refund = 0, cut = 0;
  if (type === "refund") refund = value;
  if (type === "udhaar") { cut = Math.min(value, owed); refund = value - cut; }
  return { s, units, unit: saleUnitName(s), max, qty, value, owed, refund, cut };
}

function renderForm() {
  const c = calc();
  const unit = c ? c.unit : "pcs";
  el("r-unit").textContent = unit;
  el("r-qty-l").innerHTML = (unit === "ft" ? "2. Feet back" : "2. Quantity back") + ' <span class="req">*</span>';
  el("r-qty-hint").textContent = c ? `Up to ${fmt(c.max)} ${unit}` : (src === "shop" ? "Pick the shop's item first" : "Pick a sale first");

  const types = TYPES[src];
  el("r-types").style.gridTemplateColumns = `repeat(${types.length},minmax(0,1fr))`;
  const udDisabled = src === "customer" && (!c || c.owed <= 0);
  if (udDisabled && type === "udhaar") type = "refund";
  el("r-types").innerHTML = types.map(([k, b, sm]) => `<button type="button" class="typebtn" data-type="${k}" aria-pressed="${type === k}" ${k === "udhaar" && udDisabled ? "disabled" : ""}><b>${b}</b><small>${sm}</small></button>`).join("");

  let hint = "";
  if (src === "customer") {
    if (c && c.owed <= 0) hint = "This customer owes nothing on this sale, so udhaar can't be cut.";
    if (c && type === "udhaar" && c.refund > 0) hint = `Only Rs ${fmt(c.owed)} is owed. The other Rs ${fmt(c.refund)} will be given back in cash.`;
    if (type === "exchange") hint = "The item comes back and no money is returned. Sell the new item from the Stock List as usual.";
  } else {
    if (type === "cut") hint = "The value is taken off this shop's bill (their Remaining Amount goes down).";
    if (type === "sexchange") hint = "The value is taken off the shop's bill, then Give stock opens so you can give the new item on a new bill.";
  }
  el("r-type-hint").textContent = hint;

  const amount = !c ? 0 : src === "shop" ? c.value : type === "exchange" ? 0 : type === "udhaar" ? c.cut : c.refund;
  el("r-amount-l").textContent = src === "shop" ? (type === "cut" ? "Take off the shop's bill" : "Credit to shop, then give new item")
    : type === "refund" ? "Give back in cash" : type === "udhaar" ? "Remove from customer udhaar" : "Exchange, no money back";
  el("r-amount").textContent = "Rs " + fmt(amount) + (c && !c.shop && type === "udhaar" && c.refund > 0 ? ` + Rs ${fmt(c.refund)} cash` : "");
}

el("r-qty").addEventListener("input", (e) => {
  e.target.value = digitsOnly(e.target.value);
  const c = calc();
  if (c && toNumber(e.target.value) > c.max) e.target.value = String(c.max);
  renderForm();
});
el("r-types").addEventListener("click", (e) => {
  const b = e.target.closest("[data-type]");
  if (!b || b.disabled) return;
  type = b.dataset.type;
  renderForm();
});
el("r-stock").addEventListener("change", (e) => { el("r-stock-hint").hidden = e.target.checked; });

// ---------- Stock helpers ----------
function findProduct(r) {
  if (r.productId) { const m = products.find(([id]) => id === r.productId); if (m) return m; }
  return products.find(([, p]) => (!r.category || p.category === r.category) && (sellNameOf(p) === r.productName || p.name === r.productName));
}
async function addToStock(match, qty, unit) {
  const [pid, p] = match, patch = {};
  if (unit === "ft" && byFeet(p)) {
    const len = metres(p) + qty;
    patch.length = len + "ft";
    const per = isCable(p) ? perBundle(p) : 0;
    if (per > 0) { patch.bundle = String(Math.ceil(len / per - 1e-9)); patch.perBundle = per; }
  } else patch.quantity = Number(p.quantity || 0) + qty;
  await updateDoc(ref(uid, "products", pid), patch);
}

// ---------- Save ----------
el("r-save").addEventListener("click", (e) => withButtonLock(e.currentTarget, async () => {
  const c = calc();
  if (!c) { alert(src === "shop" ? "Please pick the shop and the item first." : "Please pick the sale first."); return; }
  if (c.qty <= 0) { alert("Please enter how much is coming back."); return; }
  const back = el("r-stock").checked;
  if (c.shop) return saveShopReturn(c, back);

  const { s } = c;
  const label = `${fmt(c.qty)} ${saleUnitName(s)} of ${s.productName}`;
  const money = type === "exchange" ? "No money is returned." : type === "refund" ? `Rs ${fmt(c.refund)} cash will be given back.` : `Rs ${fmt(c.cut)} will be cut from udhaar${c.refund ? ` and Rs ${fmt(c.refund)} given in cash` : ""}.`;
  const stockNote = back ? "" : " It will NOT go back into Stock (kept aside as damaged).";
  if (!(await confirmDialog({ title: "Save this return?", message: `${label} from ${s.customerName || "walk-in customer"}. ${money}${stockNote}`, confirmLabel: "Save return" }))) return;

  try {
    let stockUpdated = false;
    const match = findProduct({ productName: s.productName, category: s.category });
    if (back && match) { await addToStock(match, c.qty, saleUnitName(s)); stockUpdated = true; }
    const salePatch = { returnedQty: Number(s.returnedQty || 0) + c.qty };
    if (c.cut > 0) {
      const left = c.owed - c.cut;
      salePatch.remainingCost = left;
      salePatch.status = left > 0 ? "pending" : "received";
    }
    await updateDoc(ref(uid, "sales", saleId), salePatch);
    await addDoc(col(uid, "returns"), {
      date: todayString(), timestamp: Date.now(), source: "customer", saleId,
      customerName: s.customerName || "", customerContact: s.customerContact || "",
      productId: match ? match[0] : "", productName: s.productName, category: s.category || "", qty: c.qty, unit: saleUnitName(s),
      type, value: c.value, refund: c.refund, udhaarCut: c.cut,
      cost: s.cost ? Math.round(s.cost / c.units * c.qty) : 0,
      backToStock: back, stockUpdated, reason: el("r-reason").value
    });
    showToast(el("toast"), `<span>Return saved for ${esc(s.customerName || "walk-in customer")}.${back ? (stockUpdated ? ` ${esc(label)} added back to Stock.` : " The product was not found in Stock — it is listed under Damaged / kept aside.") : " Kept aside under Damaged / kept aside (not in Stock)."}</span>${stockUpdated ? '<a href="stock.html">Open Stock List</a>' : ""}`, 9000);
    resetForm();
  } catch (error) { alert("Error saving return: " + error.message); }
}));

async function saveShopReturn(c, back) {
  const shop = (shops.find(([id]) => id === shopId) || [, {}])[1];
  const { b, i } = c, bid = pickedItem.billId;
  const label = `${fmt(c.qty)} ${c.unit} of ${i.name}`;
  const exch = type === "sexchange";
  const msg = `${label} from ${shop.name}. Rs ${fmt(c.value)} will be taken off the shop's bill.${exch ? " Then Give stock opens for the new item." : ""}${back ? "" : " It will NOT go back into Stock (kept aside as damaged)."}`;
  if (!(await confirmDialog({ title: "Save this return?", message: msg, confirmLabel: "Save return" }))) return;
  try {
    let stockUpdated = false;
    const match = findProduct({ productId: i.productId, productName: i.name, category: i.category });
    if (back && match) { await addToStock(match, c.qty, c.unit); stockUpdated = true; }
    const items = (b.items || []).map((x, k) => (k === pickedItem.idx ? Object.assign({}, x, { returnedQty: Number(x.returnedQty || 0) + c.qty }) : x));
    await updateDoc(ref(uid, "shopBills", bid), { items });
    // Credit on the shop's account (shows as "Returned" in the shop's khata). Not cash, so Cash Closing ignores it.
    await addDoc(col(uid, "shopPayments"), {
      date: todayString(), timestamp: Date.now(), shopId, shop: shop.name || "", amount: c.value, method: "Return",
      note: `Returned: ${i.name} × ${fmt(c.qty)}${c.unit === "ft" ? " ft" : ""}${exch ? " (exchange)" : ""}`, returnOfBill: bid
    });
    await addDoc(col(uid, "returns"), {
      date: todayString(), timestamp: Date.now(), source: "shop", shopId, shopName: shop.name || "", billId: bid, itemIndex: pickedItem.idx,
      customerName: shop.name || "", productId: i.productId || (match ? match[0] : ""), productName: i.name, category: i.category || "",
      qty: c.qty, unit: c.unit, type, value: c.value, refund: 0, udhaarCut: c.value, cost: 0,
      backToStock: back, stockUpdated, reason: el("r-reason").value
    });
    if (exch) { location.href = `shop.html?id=${encodeURIComponent(shopId)}&give=1`; return; }
    showToast(el("toast"), `<span>Return saved: Rs ${fmt(c.value)} taken off ${esc(shop.name)}'s bill.${back ? (stockUpdated ? ` ${esc(label)} added back to Stock.` : " The product was not found in Stock — it is listed under Damaged / kept aside.") : " Kept aside under Damaged / kept aside (not in Stock)."}</span><a href="shop.html?id=${encodeURIComponent(shopId)}">Open shop</a>`, 9000);
    resetForm();
  } catch (error) { alert("Error saving return: " + error.message); }
}

function resetForm() {
  saleId = null; pickedItem = null; el("r-qty").value = "1"; type = src === "shop" ? "cut" : "refund";
  el("r-stock").checked = true; el("r-stock-hint").hidden = true;
  renderSales(); renderShopItems(); renderForm();
}

// ---------- History ----------
const TYPE = { refund: ["Cash refund", "b-refund"], udhaar: ["Cut udhaar", "b-udhaar"], exchange: ["Exchange", "b-exch"], cut: ["Cut shop bill", "b-udhaar"], sexchange: ["Exchange", "b-exch"] };
const stockText = (r) => r.stockUpdated ? (r.restockedOn ? "Back in stock (later)" : "Back in stock") : "Damaged / kept aside";

function renderHistory() {
  const month = todayString().slice(0, 7);
  const all = returns.map((r) => r[1]);
  const mine = all.filter((r) => (r.date || "").startsWith(month));
  el("k-count").textContent = fmt(mine.length);
  el("k-refund").textContent = fmt(mine.reduce((a, r) => a + Number(r.refund || 0), 0));
  el("k-udhaar").textContent = fmt(mine.reduce((a, r) => a + Number(r.udhaarCut || 0), 0));
  const dmg = all.filter((r) => !r.stockUpdated);
  el("k-damaged").textContent = fmt(dmg.length);
  el("k-damaged-n").textContent = dmg.length ? `Worth Rs ${fmt(dmg.reduce((a, r) => a + Number(r.value || 0), 0))} · see list below` : "Nothing kept aside";

  const cols = "96px minmax(150px,1.1fr) minmax(170px,1.4fr) 80px 130px 110px 100px 170px";
  const rows = all.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  el("r-history").innerHTML = `<div class="head" style="grid-template-columns:${cols}"><span>Date</span><span>From</span><span>Item</span><span class="num">Qty</span><span>Type</span><span class="num">Value (Rs)</span><span class="num">Cash out</span><span>Stock</span></div>` +
    rows.map((r) => { const t = TYPE[r.type] || TYPE.refund; return `<div class="row${r.stockUpdated ? "" : " ret-row"}" style="grid-template-columns:${cols}" title="${esc(r.reason || "")}">
      <span class="num muted">${formatDateDMY(r.date)}</span>
      <span class="stk"><span class="w500">${esc(r.customerName || "Walk-in")}</span>${r.source === "shop" ? '<span class="muted" style="font-size:12px">Shop</span>' : ""}</span>
      <span>${esc(r.productName)}</span>
      <span class="num">${fmt(r.qty)} ${r.unit === "ft" ? "ft" : ""}</span>
      <span><span class="pill ${t[1]}">${t[0]}</span></span>
      <span class="num">${fmt(r.value)}</span>
      <span class="num ${r.refund ? "" : "t-dim"}" style="${r.refund ? "color:#A3322A;font-weight:600" : ""}">${r.refund ? fmt(r.refund) : "—"}</span>
      <span class="${r.stockUpdated ? "t-green" : "t-red"}" style="font-size:13px;font-weight:${r.stockUpdated ? 500 : 600}">${stockText(r)}</span>
    </div>`; }).join("") +
    (rows.length ? "" : '<div class="empty"><strong>No returns yet</strong>Returns you save will show here.</div>');
}

// ---------- Damaged / kept aside ----------
function renderDamaged() {
  const list = returns.filter(([, r]) => !r.stockUpdated).sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));
  const cols = "96px minmax(170px,1.4fr) minmax(150px,1fr) 90px 110px minmax(140px,1fr) 170px";
  el("r-damaged").innerHTML = list.length ? `<div class="scroll-x"><div style="min-width:860px"><div class="head" style="grid-template-columns:${cols}"><span>Date</span><span>Item</span><span>From</span><span class="num">Qty</span><span class="num">Value (Rs)</span><span>Reason</span><span></span></div>` +
    list.map(([id, r]) => `<div class="row ret-row" style="grid-template-columns:${cols}">
      <span class="num muted">${formatDateDMY(r.date)}</span><span class="w500">${esc(r.productName)}</span>
      <span>${esc(r.customerName || "Walk-in")}${r.source === "shop" ? ' <span class="muted" style="font-size:12px">(shop)</span>' : ""}</span>
      <span class="num">${fmt(r.qty)} ${r.unit === "ft" ? "ft" : "pcs"}</span><span class="num t-red strong">${fmt(r.value)}</span><span class="muted" style="font-size:13px">${esc(r.reason || "—")}</span>
      <span><button type="button" class="btn sec" style="height:38px" data-restock="${id}">Put back in Stock</button></span>
    </div>`).join("") + "</div></div>"
    : '<div class="empty"><strong>Nothing kept aside</strong>When you untick "Item is fine, put it back in Stock", the item waits here.</div>';
}

el("r-damaged").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-restock]");
  if (!b) return;
  const row = returns.find(([id]) => id === b.dataset.restock);
  if (!row) return;
  const [rid, r] = row;
  const match = findProduct(r);
  if (!match) { alert(`"${r.productName}" is not in the Stock List any more. Add the product to Stock first, then try again.`); return; }
  if (!(await confirmDialog({ title: "Put back in Stock?", message: `${fmt(r.qty)} ${r.unit === "ft" ? "ft" : "pcs"} of ${r.productName} will be added to Stock.`, confirmLabel: "Put back" }))) return;
  try {
    await addToStock(match, Number(r.qty || 0), r.unit);
    await updateDoc(ref(uid, "returns", rid), { stockUpdated: true, backToStock: true, restockedOn: todayString() });
    showToast(el("toast"), `<span>${esc(r.productName)} is back in Stock.</span><a href="stock.html">Open Stock List</a>`);
  } catch (error) { alert("Error: " + error.message); }
});

renderForm();
renderShopItems();
