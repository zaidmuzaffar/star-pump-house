// Ask AI: entries the AI can PREPARE. Nothing is saved by the AI.
// A "propose_..." tool checks the details against the records and makes a draft; aiCards.js shows the draft as the
// same form the normal page uses (Sell Product, Receive payment, Purchase, Give stock ...). Only the manager's
// button on that form saves, with the same rules and record format as the normal pages.
import { col, ref, addDoc, updateDoc, deleteDoc } from './common.js?v=55';
import { KINDS, kindOf, kindLabel } from './expenseUtils.js?v=55';
import { buildProduct } from './productForm.js?v=55';
import {
  CATEGORY_LABELS, todayString, phoneKey, nameKey, byFeet, isCable, metres, perBundle, productName, stockText,
  productLabel, groupBills, sellNameOf, saleUnits, saleUnitName, remainingOf, paidAtSale, daysAgoIso, formatDateDMY, itemText
} from './utils.js?v=55';
import { receiveFromCustomer, changeSalePayment } from './custPay.js?v=55';
import { supplierSummary, recordPurchase, paySupplier, ensureSupplier, supKey } from './supplierUtils.js?v=55';
import { shopSummary } from './shopUtils.js?v=55';
import { upcomingDoc, addUpcoming, pendingDoc } from './orderUtils.js?v=55';
import { D, matches, findCustomers, productRows, customers } from './aiTools.js?v=55';

export const num = (v) => Math.max(0, Math.round(Number(String(v ?? "").replace(/[^\d.]/g, "")) || 0));
const has = (v) => v != null && v !== "";
const drafts = new Map();
let seq = 0;
export const getDraft = (id) => drafts.get(id);
export const dropDraft = (id) => drafts.delete(id);
export const allDrafts = () => [...drafts.values()];
export function restoreDraft(d) { drafts.set(d.id, d); const n = Number(String(d.id).slice(1)); if (n > seq) seq = n; }
export const productById = (id) => { const r = D.products.find(([x]) => x === id); return r ? r[1] : null; };
export const sellName = (p) => (isCable(p) ? `${CATEGORY_LABELS[p.category]} — ${productName(p)}` : p.name);
export const available = (p) => (byFeet(p) ? metres(p) : Number(p.quantity || 0));

function pickProduct(words, pid) {
  if (pid && D.products.some(([id]) => id === pid)) return { row: D.products.find(([id]) => id === pid) };
  const q = String(words || "").trim();
  if (!q) return { problem: "Which product? The product name is missing." };
  let rows = productRows(q);
  const exact = rows.filter(([, p]) => nameKey(productLabel(p)) === nameKey(q) || nameKey(p.name || "") === nameKey(q) || nameKey(sellNameOf(p)) === nameKey(q));
  if (exact.length === 1) rows = exact;
  if (!rows.length) return { problem: `No product in the Stock List matches "${q}". Ask the manager for the exact product name.` };
  if (rows.length > 1) return { problem: `More than one product matches "${q}". Ask which one.`, candidates: rows.slice(0, 10).map(([, p]) => `${productLabel(p)} (in stock ${stockText(p)}, price Rs ${p.price || 0})`), pids: rows.slice(0, 10).map(([id]) => id) };
  return { row: rows[0] };
}
function pickParty(list, name, label, pid) {
  if (pid) { const r = list.find(([id]) => id === pid); if (r) return { id: r[0], s: r[1] }; }
  const q = String(name || "").trim();
  if (!q) return { problem: `Which ${label}? The name is missing.` };
  const exact = list.filter(([, s]) => supKey(s.name) === supKey(q));
  const hit = exact.length ? exact : list.filter(([, s]) => matches(`${s.name} ${s.owner || ""} ${s.phone || ""}`, q));
  if (hit.length > 1) return { problem: `More than one ${label} matches "${q}". Ask which one.`, candidates: hit.map(([, s]) => s.name), ids: hit.map(([id]) => id) };
  if (!hit.length) return { none: true, name: q.replace(/\b\w/g, (c) => c.toUpperCase()) };
  return { id: hit[0][0], s: hit[0][1] };
}
const need = (message, candidates, options) => (options && options.length
  ? { status: "need_choice", message: message + " The choices are shown to the manager as buttons; ask in one short line which one (they can press a button).", candidates, _options: options }
  : { status: "need_info", message, ...(candidates ? { candidates } : {}) });
// buttons for "which product?": the same request again with that exact product
const productChoice = (a, i, r) => r.pids ? r.pids.map((pid, k) => ({ label: r.candidates[k], args: Object.assign({}, a, { items: a.items.map((x, j) => (j === i ? Object.assign({}, x, { _pid: pid }) : x)) }) })) : null;
const custLabel = (c) => `${c.name || "No name"}${c.phone ? " · " + c.phone : " · no number"}${c.udhaar > 0 ? " · udhaar Rs " + c.udhaar.toLocaleString("en-US") : ""}`;
function custByKeyOrQuery(a, q) {
  if (a._key) { const c = customers().find((x) => x.key === a._key); if (c) return [c]; }
  return findCustomers(q);
}
const shown = (d, summary) => {
  drafts.set(d.id, d);
  return { status: "form_shown_waiting_for_manager", draft_id: d.id, summary,
    note: "NOT saved yet. The same form as on the normal page is now shown with these details; the manager can change anything (add products, prices, payment) and saves it with the form's own buttons. Tell them in one or two lines to check the form and save. Never say it is saved." };
};
const partyChoice = (a, sp) => sp.ids ? sp.ids.map((id, k) => ({ label: sp.candidates[k], args: Object.assign({}, a, { _id: id }) })) : null;
const returnableOf = (x) => Math.max(0, saleUnits(x) - Number(x.returnedQty || 0));
const newId = () => "d" + (++seq);

export const ACTIONS = {
  propose_sale(a) {
    const items = [];
    const list = Array.isArray(a.items) ? a.items : [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const r = pickProduct(it.product, it._pid);
      if (r.problem) return need(r.problem, r.candidates, productChoice(a, i, r));
      const [id, p] = r.row;
      if (items.some((x) => x.id === id)) continue;
      const feet = byFeet(p), q = num(it.qty) || 1;
      if (q > available(p)) return need(`Only ${stockText(p)} of ${sellName(p)} in stock, but ${q}${feet ? " ft" : ""} asked.`);
      const listed = Number(p.price || 0);
      items.push({ id, price: Math.min(num(it.price) || listed, listed), maxPrice: listed, quantity: feet ? 1 : q, feet: feet ? q : 0 });
    }
    if (!items.length) return need("Which product(s) and how many?");
    let name = String(a.customer_name || "").trim(), phone = phoneKey(a.customer_phone || "");
    let known = "";
    if ((name || phone) && a._new) known = "new";
    else if (name || phone) {
      const cs = custByKeyOrQuery(a, phone || name);
      if (cs.length === 1) { name = cs[0].name || name; phone = cs[0].phone || phone; known = "existing"; }
      else if (cs.length > 1 && !phone) return need(`More than one customer is called "${name}".`, cs.slice(0, 8).map(custLabel), cs.slice(0, 8).map((c) => ({ label: custLabel(c), args: Object.assign({}, a, { _key: c.key, customer_name: c.name, customer_phone: c.phone }) })).concat([{ label: `New customer "${name}"`, args: Object.assign({}, a, { _new: true }) }]));
      else known = "new";
    }
    const loan = a.payment === "loan" || (has(a.paid) && num(a.paid) === 0);
    const d = { id: newId(), type: "sale", name, phone, known, items, loan, paidHint: has(a.paid) ? num(a.paid) : null, udhaarHint: has(a.udhaar) ? num(a.udhaar) : null };
    const total = items.reduce((x, i) => x + i.price * (i.feet && byFeet(productById(i.id)) ? i.feet : i.quantity), 0);
    return shown(d, { form: "Sell Product", customer: name || "Walk-in", customer_status: known || "walk-in", items: items.map((i) => { const p = productById(i.id); return `${sellName(p)} × ${byFeet(p) ? i.feet + " ft" : i.quantity} @ Rs ${i.price}`; }), total, payment: loan ? "Loan (all udhaar)" : d.udhaarHint != null ? `udhaar Rs ${d.udhaarHint}` : d.paidHint != null ? `paid Rs ${d.paidHint}` : "not said (manager chooses Cash or Loan)" });
  },

  propose_receive_udhaar(a) {
    let cs = custByKeyOrQuery(a, String(a.customer || ""));
    if (cs.length > 1 && cs.filter((c) => c.udhaar > 0).length === 1) cs = cs.filter((c) => c.udhaar > 0);
    if (!cs.length) return need("No customer with this name or number.");
    if (cs.length > 1) return need("More than one customer matches.", cs.slice(0, 8).map(custLabel), cs.slice(0, 8).map((c) => ({ label: custLabel(c), args: Object.assign({}, a, { _key: c.key }) })));
    const c = cs[0];
    if (c.udhaar <= 0) return { status: "nothing_to_do", message: `${c.name} has no udhaar left.` };
    const amount = has(a.amount) ? Math.min(num(a.amount), c.udhaar) : null;
    const d = { id: newId(), type: "udhaar", name: c.name, phone: c.phone, keys: c.bills.map((b) => b.key), amount };
    return shown(d, { form: "Receive payment", customer: c.name, udhaar_now: c.udhaar, received: amount ?? c.udhaar, udhaar_after: c.udhaar - (amount ?? c.udhaar) });
  },

  propose_purchase(a) {
    const sp = pickParty(D.suppliers, a.supplier, "supplier", a._id);
    if (sp.problem) return need(sp.problem, sp.candidates, partyChoice(a, sp));
    const lines = [];
    const list = Array.isArray(a.items) ? a.items : [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const r = pickProduct(it.product, it._pid);
      if (r.problem) return need(r.problem + " (A brand-new product is added on the Purchases page.)", r.candidates, productChoice(a, i, r));
      const [id, p] = r.row;
      lines.push({ productId: id, qty: num(it.qty), cost: num(it.cost) || Number(p.cost || 0) });
    }
    if (!lines.length) return need("Which products, how many and at what cost?");
    const d = { id: newId(), type: "purchase", supId: sp.id || "", supName: sp.none ? sp.name : sp.s.name, supPhone: sp.none ? "" : sp.s.phone || "", isNew: !!sp.none, lines, paid: num(a.paid), billNo: String(a.bill_no || ""), ordered: a.not_ordered_yet ? false : true, date: todayString() };
    return shown(d, { form: "New Purchase", supplier: d.supName, new_supplier: d.isNew, items: lines.map((l) => `${sellNameOf(productById(l.productId))} × ${l.qty} @ Rs ${l.cost}`), paid_now: d.paid, goes_to: d.ordered ? "Upcoming Products" : "Pending Products" });
  },

  propose_supplier_payment(a) {
    const sp = pickParty(D.suppliers, a.supplier, "supplier", a._id);
    if (sp.problem) return need(sp.problem, sp.candidates, partyChoice(a, sp));
    if (sp.none) return need(`No supplier called "${a.supplier}".`);
    const sum = supplierSummary(sp.id, sp.s, D.purchases, D.supplierPayments);
    const d = { id: newId(), type: "suppay", supId: sp.id, supName: sp.s.name, amount: num(a.amount), method: methodOf(a.method), note: String(a.note || ""), date: todayString() };
    return shown(d, { form: "Pay supplier", supplier: sp.s.name, remaining_now: sum.balance, paying: d.amount || "not said", method: d.method });
  },

  propose_shop_bill(a) {
    const sp = pickParty(D.shops, a.shop, "shop", a._id);
    if (sp.problem) return need(sp.problem, sp.candidates, partyChoice(a, sp));
    if (sp.none) return need(`No wholesale shop called "${a.shop}". New shops are added on the Shops page.`);
    const lines = [];
    const list = Array.isArray(a.items) ? a.items : [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const r = pickProduct(it.product, it._pid);
      if (r.problem) return need(r.problem, r.candidates, productChoice(a, i, r));
      const [id, p] = r.row, q = num(it.qty);
      if (q > available(p)) return need(`Only ${stockText(p)} of ${sellName(p)} in stock.`);
      lines.push({ productId: id, qty: q, price: num(it.price) || Number(p.price || 0) });
    }
    if (!lines.length) return need("Which products, how many and at what price?");
    const d = { id: newId(), type: "shopbill", shopId: sp.id, shopName: sp.s.name, lines, recv: has(a.received) ? num(a.received) : null, billNo: String(a.bill_no || ""), date: todayString() };
    return shown(d, { form: "Give stock", shop: sp.s.name, items: lines.map((l) => `${sellNameOf(productById(l.productId))} × ${l.qty} @ Rs ${l.price}`), received_now: d.recv ?? "not said" });
  },

  // ---------- a customer RETURN (same as the Returns page, customer side) ----------
  propose_return(a) {
    let cs = custByKeyOrQuery(a, String(a.customer || ""));
    const since = daysAgoIso(180);
    const keySet = (c) => new Set(c.bills.flatMap((b) => b.ids));
    if (a.customer && !cs.length) return need("No customer with this name or number.");
    if (cs.length > 1) {
      const withItem = cs.filter((c) => D.sales.some(([id, x]) => keySet(c).has(id) && (!a.product || matches(x.productName || "", a.product))));
      if (withItem.length === 1) cs = withItem;
      else return need("More than one customer matches.", cs.slice(0, 8).map(custLabel), cs.slice(0, 8).map((c) => ({ label: custLabel(c), args: Object.assign({}, a, { _key: c.key }) })));
    }
    const ids = cs.length ? keySet(cs[0]) : null;
    const list = D.sales.filter(([id, x]) => (!ids || ids.has(id)) && (x.date || "") >= since && returnableOf(x) > 0 && (!a.product || matches(x.productName || "", a.product)) && (a._sale ? id === a._sale : true))
      .sort((x, y) => (y[1].timestamp || 0) - (x[1].timestamp || 0));
    if (!list.length) return need("No sale from the last 6 months matches (that can still be returned). Ask which sale it was.");
    if (list.length > 1 && !a._sale) {
      const opts = list.slice(0, 8).map(([id, x]) => ({ label: `${formatDateDMY(x.date)} · ${x.customerName || "Walk-in"} · ${itemText(x)} · Rs ${Number(x.amount).toLocaleString("en-US")}`, args: Object.assign({}, a, { _sale: id }) }));
      return need("More than one sale matches.", opts.map((o) => o.label), opts);
    }
    const [sid, x] = list[0];
    const rtype = ["refund", "udhaar", "exchange"].includes(a.type) ? a.type : remainingOf(x) > 0 ? "udhaar" : "refund";
    const d = { id: newId(), type: "return", saleId: sid, qty: Math.min(num(a.qty) || 1, returnableOf(x)), rtype, back: a.damaged ? false : true, reason: String(a.reason || "") };
    return shown(d, { form: "Return", customer: x.customerName || "Walk-in", sale: `${formatDateDMY(x.date)} ${itemText(x)}`, qty: d.qty, type: rtype, back_in_stock: d.back });
  },

  // ---------- fix how an old sale was paid (Cash by mistake -> Loan, or back) ----------
  propose_change_payment(a) {
    let cs = custByKeyOrQuery(a, String(a.customer || ""));
    if (!cs.length) return need("No customer with this name or number.");
    if (cs.length > 1) return need("More than one customer matches.", cs.slice(0, 8).map(custLabel), cs.slice(0, 8).map((c) => ({ label: custLabel(c), args: Object.assign({}, a, { _key: c.key }) })));
    const keys = new Set(cs[0].bills.map((b) => b.key));
    let bills = groupBills(D.sales).filter((b) => keys.has(b.key) && (!a.date || b.date === a.date) && (!a.product || b.docs.some((x) => matches(x.productName || "", a.product))) && (!a._bill || b.key === a._bill));
    if (!bills.length) return need("No sale of this customer matches. Ask which sale (date or item).");
    if (bills.length > 1 && !a._bill) {
      const opts = bills.slice(0, 8).map((b) => ({ label: `${formatDateDMY(b.date)} · ${b.docs.map((x) => itemText(x)).join(", ")} · Rs ${b.amount.toLocaleString("en-US")}${b.remaining > 0 ? " · udhaar Rs " + b.remaining.toLocaleString("en-US") : " · paid"}`, args: Object.assign({}, a, { _bill: b.key }) }));
      return need("This customer has more than one sale.", opts.map((o) => o.label), opts);
    }
    const b = bills[0];
    const mode = ["loan", "cash", "part"].includes(a.payment) ? a.payment : "loan";
    const d = { id: newId(), type: "payfix", billKey: b.key, mode, paid: has(a.paid_at_sale) ? num(a.paid_at_sale) : null };
    return shown(d, { form: "Change payment", customer: b.customerName, sale: `${formatDateDMY(b.date)} · Rs ${b.amount}`, change_to: mode });
  },

  propose_shop_payment(a) {
    const sp = pickParty(D.shops, a.shop, "shop", a._id);
    if (sp.problem) return need(sp.problem, sp.candidates, partyChoice(a, sp));
    if (sp.none) return need(`No wholesale shop called "${a.shop}".`);
    const sum = shopSummary(sp.id, sp.s, D.shopBills, D.shopPayments);
    const d = { id: newId(), type: "shoppay", shopId: sp.id, shopName: sp.s.name, amount: num(a.amount), method: methodOf(a.method), note: String(a.note || ""), date: todayString() };
    return shown(d, { form: "Receive from shop", shop: sp.s.name, remaining_now: sum.remaining, receiving: d.amount || "not said" });
  },

  // ---------- Expenses (Expenses page) ----------
  propose_expense(a) {
    const kind = KINDS.some((k) => k[0] === a.kind) ? a.kind : kindOf(`${a.kind || ""} ${a.note || ""}`);
    const d = { id: newId(), type: "expense", editId: "", kind, amount: num(a.amount), method: methodOf(a.method), note: String(a.note || ""), date: isoOk(a.date) || todayString() };
    return shown(d, { form: "Add expense", kind: kindLabel(kind), amount: d.amount || "not said", paid_by: d.method, date: d.date });
  },
  propose_edit_expense(a) {
    const rows = findExpenses(a);
    if (!rows.length) return need("No expense matches. Ask the date, kind or amount.");
    if (rows.length > 1 && !a._id) return need("More than one expense matches.", rows.slice(0, 8).map(expLabel), rows.slice(0, 8).map((r) => ({ label: expLabel(r), args: Object.assign({}, a, { _id: r[0] }) })));
    const [eid, x] = rows[0];
    const nk = has(a.new_kind) ? (KINDS.some((k) => k[0] === a.new_kind) ? a.new_kind : kindOf(a.new_kind)) : x.kind;
    const d = { id: newId(), type: "expense", editId: eid, kind: nk, amount: has(a.new_amount) ? num(a.new_amount) : num(x.amount), method: has(a.new_method) ? methodOf(a.new_method) : (x.method || "Cash"),
      note: has(a.new_note) ? String(a.new_note) : (x.note || ""), date: isoOk(a.new_date) || x.date };
    return shown(d, { form: "Edit expense", was: expLabel(rows[0]), now: `${kindLabel(d.kind)} Rs ${d.amount} on ${d.date}` });
  },

  // ---------- Products (Stock List: Add Product / Edit) ----------
  propose_new_product(a) {
    const cat = ["pump", "wire", "safety_cable", "other"].includes(a.category) ? a.category : guessCat(`${a.name || ""} ${a.size || ""}`);
    const v = { name: titleCase(a.name), brand: String(a.detail || ""), size: String(a.size || ""), length: a.length_ft ? String(num(a.length_ft)) : "", bundle: a.bundles ? String(num(a.bundles)) : "",
      quantity: a.quantity ? String(num(a.quantity)) : "", price: a.price ? String(num(a.price)) : "", cost: a.cost ? String(num(a.cost)) : "" };
    const same = productRows(`${a.name || ""} ${a.size || ""}`.trim()).filter(([, p]) => p.category === cat && nameKey(productLabel(p)) === nameKey(`${v.name} ${v.size}`.trim()));
    const d = { id: newId(), type: "product", editId: "", category: cat, values: v };
    return shown(d, { form: "Add Product", category: CATEGORY_LABELS[cat], name: v.name || v.size, ...(same.length ? { warning: "A product with this name is already in the Stock List. To add stock to it, use New Purchase instead." } : {}) });
  },
  propose_edit_product(a) {
    const r = pickProduct(a.product, a._pid);
    if (r.problem) return need(r.problem, r.candidates, r.pids ? r.pids.map((pid, k) => ({ label: r.candidates[k], args: Object.assign({}, a, { _pid: pid }) })) : null);
    const [pid, p] = r.row;
    const v = isCable(p)
      ? { name: p.name || "", size: p.size || "", length: String(metres(p) || ""), bundle: String(p.bundle || "").replace(/\D/g, ""), price: String(p.price || "") }
      : { name: p.name || "", brand: p.brand || "", size: p.size || "", length: p.category === "other" && byFeet(p) ? String(metres(p) || "") : "", quantity: p.category === "other" && byFeet(p) ? "" : String(p.quantity ?? 0), price: String(p.price || "") };
    v.cost = p.cost ? String(p.cost) : "";
    if (has(a.new_name)) v.name = titleCase(a.new_name);
    if (has(a.new_detail)) v.brand = String(a.new_detail);
    if (has(a.new_price)) v.price = String(num(a.new_price));
    if (has(a.new_cost)) v.cost = String(num(a.new_cost));
    if (has(a.new_quantity)) { if (byFeet(p)) v.length = String(num(a.new_quantity)); else v.quantity = String(num(a.new_quantity)); }
    const d = { id: newId(), type: "product", editId: pid, category: p.category, values: v };
    return shown(d, { form: "Edit product", product: productLabel(p), price_now: p.price, new_price: Number(v.price), cost: Number(v.cost || 0) });
  },

  // ---------- New supplier / wholesale shop ----------
  propose_new_party(a) {
    const kind = a.kind === "shop" ? "shop" : "supplier";
    const list = kind === "shop" ? D.shops : D.suppliers;
    const name = titleCase(a.name);
    if (!name) return need(`What is the ${kind}'s name?`);
    if (list.some(([, s]) => supKey(s.name) === supKey(name))) return need(`A ${kind} called "${name}" is already there. Nothing new needed.`);
    const d = { id: newId(), type: "party", kind, name, phone: String(a.phone || "").replace(/[^\d+]/g, ""), owner: titleCase(a.owner), address: String(a.address || ""), opening: num(a.opening_balance) };
    return shown(d, { form: kind === "shop" ? "Add shop" : "Add supplier", name, phone: d.phone || "not given", opening_balance: d.opening });
  },

  // ---------- Wholesale shop returned stock (Returns page → Shop) ----------
  propose_shop_return(a) {
    const sp = pickParty(D.shops, a.shop, "shop", a._id);
    if (sp.problem) return need(sp.problem, sp.candidates, partyChoice(a, sp));
    if (sp.none) return need(`No wholesale shop called "${a.shop}".`);
    const items = [];
    D.shopBills.filter(([, b]) => b.shopId === sp.id).sort((x, y) => (y[1].timestamp || 0) - (x[1].timestamp || 0)).forEach(([bid, b]) => (b.items || []).forEach((i, idx) => {
      if (shopLeft(i) > 0 && (!a.product || matches(i.name || "", a.product))) items.push({ bid, idx, b, i });
    }));
    const pick = a._bill ? items.filter((x) => x.bid === a._bill && x.idx === Number(a._idx)) : items;
    if (!pick.length) return need("No item given to this shop matches (that can still come back). Ask which item.");
    if (pick.length > 1) {
      const opts = pick.slice(0, 8).map((x) => ({ label: `${formatDateDMY(x.b.date)} · ${x.i.name} · ${shopLeft(x.i)} ${x.i.unit === "ft" ? "ft" : "pcs"} left · Rs ${Number(x.i.price || 0).toLocaleString("en-US")}`, args: Object.assign({}, a, { _id: sp.id, _bill: x.bid, _idx: x.idx }) }));
      return need("More than one item matches.", opts.map((o) => o.label), opts);
    }
    const x = pick[0];
    const d = { id: newId(), type: "shopret", shopId: sp.id, billId: x.bid, idx: x.idx, qty: Math.min(num(a.qty) || 1, shopLeft(x.i)), back: a.damaged ? false : true, exch: !!a.exchange, reason: String(a.reason || "") };
    return shown(d, { form: "Shop return", shop: sp.s.name, item: x.i.name, qty: d.qty, back_in_stock: d.back });
  },

  // ---------- Fix the customer name / number on a sale (Sales Summary → Edit customer) ----------
  propose_edit_sale_customer(a) {
    let cs = custByKeyOrQuery(a, String(a.customer || ""));
    if (!cs.length) return need("No customer with this name or number.");
    if (cs.length > 1) return need("More than one customer matches.", cs.slice(0, 8).map(custLabel), cs.slice(0, 8).map((c) => ({ label: custLabel(c), args: Object.assign({}, a, { _key: c.key }) })));
    const keys = new Set(cs[0].bills.map((b) => b.key));
    const all = a.all_sales ? groupBills(D.sales).filter((b) => keys.has(b.key)) : null;
    let bills = all || groupBills(D.sales).filter((b) => keys.has(b.key) && (!a.date || b.date === a.date) && (!a.product || b.docs.some((x) => matches(x.productName || "", a.product))) && (!a._bill || b.key === a._bill));
    if (!bills.length) return need("No sale of this customer matches.");
    if (!all && bills.length > 1 && !a._bill) {
      const opts = bills.slice(0, 7).map((b) => ({ label: `${formatDateDMY(b.date)} · ${b.docs.map((x) => itemText(x)).join(", ")} · Rs ${b.amount.toLocaleString("en-US")}`, args: Object.assign({}, a, { _bill: b.key }) }));
      opts.push({ label: `All ${bills.length} sales of this customer`, args: Object.assign({}, a, { all_sales: true }) });
      return need("This customer has more than one sale. Which one, or all?", opts.map((o) => o.label), opts);
    }
    const b0 = bills[0];
    const d = { id: newId(), type: "custfix", billKeys: bills.map((b) => b.key), name: has(a.new_name) ? titleCase(a.new_name) : b0.customerName || "", phone: has(a.new_phone) ? String(a.new_phone).replace(/\D/g, "") : b0.customerContact || "", oldName: b0.customerName || "", oldPhone: b0.customerContact || "" };
    return shown(d, { form: "Edit customer", sales: bills.length, from: `${d.oldName} ${d.oldPhone}`.trim(), to: `${d.name} ${d.phone}`.trim() });
  },

  // ---------- Delete a record (each one exactly like its page's delete button) ----------
  propose_delete(a) {
    const kind = DEL[a.record] ? a.record : null;
    if (!kind) return need('Which kind of record? expense, product, supplier_payment, shop_payment, purchase_bill, shop_bill or pending_product. Customer sales are not deleted: use a Return, Change payment or Edit customer instead.');
    const rows = DEL[kind].find(a);
    if (!rows.length) return need("Nothing matches. Ask the date, name or amount.");
    if (rows.length > 1 && !a._id) return need("More than one record matches.", rows.slice(0, 8).map((r) => DEL[kind].label(r)), rows.slice(0, 8).map((r) => ({ label: DEL[kind].label(r), args: Object.assign({}, a, { _id: r[0] }) })));
    const r = rows[0];
    const d = { id: newId(), type: "delete", kind, rid: r[0], label: DEL[kind].label(r), effect: DEL[kind].effect };
    return shown(d, { form: "Delete " + DEL[kind].title, record: d.label, what_happens: d.effect, note2: "The manager must press Delete on the form and confirm." });
  },
};

// ---------- helpers for the newer forms ----------
const isoOk = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
const titleCase = (v) => String(v || "").trim().replace(/\s+/g, " ").replace(/(^|\s)\S/g, (c) => c.toUpperCase()).replace(/\b(hp|pvc|ppr|gi)\b/gi, (w) => w.toUpperCase());
const guessCat = (t) => (/safety|cable/i.test(t) ? "safety_cable" : /wire|\d+\/\d+/i.test(t) ? "wire" : /pump|motor|hp\b/i.test(t) ? "pump" : "other");
const shopLeft = (i) => Math.max(0, Number(i.qty || 0) - Number(i.returnedQty || 0));
export const expLabel = ([, x]) => `${formatDateDMY(x.date)} · ${kindLabel(x.kind)}${x.note ? " (" + x.note + ")" : ""} · Rs ${Number(x.amount || 0).toLocaleString("en-US")}`;
function findExpenses(a) {
  if (a._id) { const r = D.expenses.find(([id]) => id === a._id); if (r) return [r]; }
  return D.expenses.filter(([, x]) => (!isoOk(a.date) || x.date === a.date) && (!has(a.amount) || num(x.amount) === num(a.amount))
    && (!a.which || matches(`${kindLabel(x.kind)} ${x.kind} ${x.note || ""}`, a.which) || x.kind === kindOf(a.which)))
    .sort((x, y) => (y[1].date || "").localeCompare(x[1].date || "") || (y[1].timestamp || 0) - (x[1].timestamp || 0));
}
const byWords = (rows, a, text) => rows.filter(([, x]) => (!isoOk(a.date) || x.date === a.date) && (!has(a.amount) || [x.amount, x.total].some((v) => num(v) === num(a.amount))) && (!a.which || matches(text(x), a.which)))
  .sort((x, y) => (y[1].date || "").localeCompare(x[1].date || "") || (y[1].timestamp || 0) - (x[1].timestamp || 0));
const pick1 = (rows, a) => (a._id ? rows.filter(([id]) => id === a._id) : null);
const shopNameOf = (x) => x.shop || ((D.shops.find(([id]) => id === x.shopId) || [, {}])[1].name) || "shop";
const rs = (v) => "Rs " + Number(v || 0).toLocaleString("en-US");
export const DEL = {
  expense: { title: "expense", find: (a) => findExpenses(a), label: expLabel, effect: "Removed from Expenses; Profit Report and Cash Closing change with it." },
  product: { title: "product", find: (a) => { const r = pick1(D.products, a); if (r && r.length) return r; return a.which ? productRows(a.which) : []; },
    label: ([, p]) => `${productLabel(p)} · in stock ${stockText(p)} · ${rs(p.price)}`, effect: "Removed from the Stock List. Old sales stay as they are. Cannot be undone." },
  supplier_payment: { title: "supplier payment", find: (a) => pick1(D.supplierPayments, a) || byWords(D.supplierPayments, a, (x) => `${x.supplier || ""} ${x.note || ""}`),
    label: ([, x]) => `${formatDateDMY(x.date)} · paid to ${x.supplier || "supplier"} · ${rs(x.amount)}${x.method ? " · " + x.method : ""}`, effect: "The payment is removed and added back to what you still owe the supplier." },
  shop_payment: { title: "shop payment", find: (a) => pick1(D.shopPayments, a) || byWords(D.shopPayments, a, (x) => `${shopNameOf(x)} ${x.note || ""} ${x.method || ""}`),
    label: ([, x]) => `${formatDateDMY(x.date)} · from ${shopNameOf(x)} · ${rs(x.amount)}${x.method ? " · " + x.method : ""}`, effect: "The money received is removed and added back to what the shop owes." },
  purchase_bill: { title: "purchase bill", find: (a) => pick1(D.purchases, a) || byWords(D.purchases, a, (x) => `${x.supplier || ""} ${x.billNo || ""} ${(x.items || []).map((i) => i.name).join(" ")}`),
    label: ([, x]) => `${formatDateDMY(x.date)} · ${x.supplier || "supplier"}${x.billNo ? " #" + x.billNo : ""} · ${(x.items || []).map((i) => i.name).slice(0, 3).join(", ")} · ${rs(x.total)}`, effect: "The bill is removed from the supplier's record. Stock quantities and payments already made are NOT changed." },
  shop_bill: { title: "stock bill (shop)", find: (a) => pick1(D.shopBills, a) || byWords(D.shopBills, a, (x) => `${shopNameOf(x)} ${x.billNo || ""} ${(x.items || []).map((i) => i.name).join(" ")}`),
    label: ([, x]) => `${formatDateDMY(x.date)} · ${shopNameOf(x)} · ${(x.items || []).map((i) => i.name).slice(0, 3).join(", ")} · ${rs(x.total)}`, effect: "The items go back into your Stock List and money received with this bill is removed too." },
  pending_product: { title: "pending product", find: (a) => pick1(D.pendingProducts, a) || byWords(D.pendingProducts, a, (x) => `${x.name || ""} ${x.supplierName || ""}`),
    label: ([, x]) => `${x.name || "item"}${x.qty ? " × " + x.qty + " " + (x.unit === "ft" ? "ft" : "pcs") : ""}${x.supplierName ? " · " + x.supplierName : ""}`, effect: "Removed from Pending Products." }
};

export const METHODS = ["Cash", "Bank transfer", "Cheque", "JazzCash / Easypaisa"];
function methodOf(m) { const k = nameKey(m || "cash"); return METHODS.find((x) => nameKey(x).split(/[ /]+/).some((w) => w && k.includes(w))) || "Cash"; }

export const ACTION_LABEL = { propose_sale: "Sell Product", propose_receive_udhaar: "Receive udhaar", propose_purchase: "New Purchase", propose_supplier_payment: "Pay supplier", propose_shop_bill: "Give stock to shop", propose_shop_payment: "Receive from shop", propose_return: "Return", propose_change_payment: "Change payment", propose_expense: "Add expense", propose_edit_expense: "Edit expense", propose_new_product: "Add Product", propose_edit_product: "Edit product", propose_new_party: "Add supplier / shop", propose_shop_return: "Shop return", propose_edit_sale_customer: "Edit customer", propose_delete: "Delete record" };

export function actionDeclarations(Schema) {
  const S = (d) => Schema.string({ description: d });
  const N = (d) => Schema.number({ description: d });
  const B = (d) => Schema.boolean({ description: d });
  const obj = (properties, required = []) => Schema.object({ properties, optionalProperties: Object.keys(properties).filter((k) => !required.includes(k)) });
  const arr = (item, d) => Schema.array({ items: item, description: d });
  const line = (extra) => obj(Object.assign({ product: S("Product name words from the Stock List."), qty: N("Pieces, or feet for wire/cable.") }, extra), ["product"]);
  return [
    { name: "propose_sale", description: "Open the SELL PRODUCT form for a customer sale (becha / sale ki / diya), filled in. The manager can add products and chooses Cash or Loan there. E.g. '2 pump Ahmed ko udhaar pe'.",
      parameters: obj({ customer_name: S("Customer name, if given."), customer_phone: S("Customer phone, if given."),
        items: arr(line({ price: N("Sale price per piece / per foot, only if the manager said one.") }), "Products sold."),
        payment: S('"loan" if it was sold on loan / udhaar with nothing paid; "cash" if paid; leave out if not said.'),
        paid: N("Cash received now (Rs), if said."), udhaar: N("Amount left as udhaar (Rs), if said instead of paid.") }, ["items"]) },
    { name: "propose_receive_udhaar", description: "Open the RECEIVE PAYMENT form: a customer paid back udhaar (paise diye / udhaar clear).",
      parameters: obj({ customer: S("Customer name or phone."), amount: N("Amount received (Rs). Leave out if the whole udhaar was paid.") }, ["customer"]) },
    { name: "propose_purchase", description: "Open the NEW PURCHASE form: stock bought or ordered from a supplier (maal mangwaya / khareeda).",
      parameters: obj({ supplier: S("Supplier name."), items: arr(line({ cost: N("Cost price per piece / per foot, if said.") }), "Products."),
        paid: N("Cash paid to the supplier with this bill (Rs)."), bill_no: S("Bill number, if said."), not_ordered_yet: B("True if the items are only planned (not ordered yet): they go to Pending Products.") }, ["supplier", "items"]) },
    { name: "propose_supplier_payment", description: "Open the PAY SUPPLIER form (supplier ko paise diye).",
      parameters: obj({ supplier: S("Supplier name."), amount: N("Amount paid (Rs)."), method: S("Cash, Bank transfer, Cheque or JazzCash / Easypaisa."), note: S("Note, if any.") }, ["supplier"]) },
    { name: "propose_shop_bill", description: "Open the GIVE STOCK form for a WHOLESALE SHOP (stock given to another shop on account; not a customer sale).",
      parameters: obj({ shop: S("Wholesale shop name."), items: arr(line({ price: N("Price per piece / per foot for the shop, if said.") }), "Products given."),
        received: N("Cash received from the shop now (Rs), if said."), bill_no: S("Bill number, if said.") }, ["shop", "items"]) },
    { name: "propose_return", description: "Open the RETURN form: a customer brought back an item (wapis kiya / return). Choose cash refund, cut from udhaar or exchange; damaged items do not go back to stock.",
      parameters: obj({ customer: S("Customer name or phone."), product: S("Product words."), qty: N("How many pieces (or feet) came back."),
        type: S('"refund" (cash given back), "udhaar" (cut from what they owe) or "exchange" (another item given). Leave out if not said.'),
        damaged: B("True if the item is damaged / faulty and should NOT go back into stock."), reason: S("Reason, if said.") }, []) },
    { name: "propose_change_payment", description: "Open the CHANGE PAYMENT form for an OLD sale that was saved wrongly as Cash or Loan (e.g. 'Ahmed wali sale cash me chali gayi, woh udhaar thi').",
      parameters: obj({ customer: S("Customer name or phone."), date: S("Sale date YYYY-MM-DD, if said."), product: S("Product words, if said."),
        payment: S('What it should be: "loan" (all udhaar), "cash" (fully paid) or "part".'), paid_at_sale: N("For part: cash really taken at the sale (Rs).") }, ["customer"]) },
    { name: "propose_shop_payment", description: "Open the RECEIVE FROM SHOP form: a wholesale shop paid money.",
      parameters: obj({ shop: S("Wholesale shop name."), amount: N("Amount received (Rs)."), method: S("Cash, Bank transfer, Cheque or JazzCash / Easypaisa."), note: S("Note, if any.") }, ["shop"]) },
    { name: "propose_expense", description: "Open the ADD EXPENSE form (Expenses page): shop running costs like rent (kiraya), electricity bill (bijli), salary, tea/food (chai), transport/fuel, repairs.",
      parameters: obj({ kind: S('"rent", "electricity", "salary", "food", "transport", "repair" or "other" (or the words used).'), amount: N("Amount (Rs)."), method: S("Cash, Bank transfer, Cheque or JazzCash / Easypaisa. Default Cash."), note: S("Short note, e.g. 'October rent', 'Ali salary'."), date: S("Date YYYY-MM-DD if not today.") }, []) },
    { name: "propose_edit_expense", description: "Open an existing expense to CHANGE it (amount, kind, note, date). Find it by words, date or amount.",
      parameters: obj({ which: S("Kind or note words of the expense."), date: S("Its date YYYY-MM-DD."), amount: N("Its current amount."), new_amount: N("New amount."), new_kind: S("New kind."), new_note: S("New note."), new_date: S("New date YYYY-MM-DD."), new_method: S("New payment method.") }, []) },
    { name: "propose_new_product", description: "Open the ADD PRODUCT form (Stock List) for a product that is NOT in the Stock List yet. Wire / safety cable are by size + length in feet; pumps by name + quantity; other items by name + size + quantity (or length).",
      parameters: obj({ category: S('"pump", "wire", "safety_cable" or "other".'), name: S("Product name (for wire/cable the brand, optional)."), detail: S("Pump detail, e.g. '1 HP, 2 inch outlet'."), size: S("Size, e.g. 7/29 or 1.5 inch."),
        length_ft: N("Total feet for wire / cable (or a length item)."), bundles: N("Number of bundles (wire / cable), if said."), quantity: N("Pieces in stock."), price: N("Sale price (per piece, or per foot for wire/cable)."), cost: N("Cost price, if said.") }, []) },
    { name: "propose_edit_product", description: "Open the EDIT form of a product in the Stock List: change its price, cost, name, detail or the stock count (pieces, or feet for wire/cable).",
      parameters: obj({ product: S("Product name words."), new_price: N("New sale price."), new_cost: N("New cost price."), new_name: S("New name."), new_detail: S("New pump detail."), new_quantity: N("Correct stock count (pieces, or feet).") }, ["product"]) },
    { name: "propose_new_party", description: "Open the form to ADD a new SUPPLIER (company you buy from) or a new WHOLESALE SHOP (shop you give stock to on account).",
      parameters: obj({ kind: S('"supplier" or "shop".'), name: S("Name."), phone: S("Phone, if said."), owner: S("Shop owner name (shops only)."), address: S("Address / city, if said."), opening_balance: N("Old balance already owed when starting (Rs), if said.") }, ["kind", "name"]) },
    { name: "propose_shop_return", description: "Open the RETURN form for a WHOLESALE SHOP that gave back stock it had taken on account (the value is taken off the shop's bill).",
      parameters: obj({ shop: S("Wholesale shop name."), product: S("Product words."), qty: N("How many pieces (or feet) came back."), damaged: B("True if damaged: it does NOT go back into stock."), exchange: B("True if they take another item instead."), reason: S("Reason, if said.") }, ["shop"]) },
    { name: "propose_edit_sale_customer", description: "Open the EDIT CUSTOMER form for sales: fix a wrong customer name or phone number on one sale or on all of that customer's sales.",
      parameters: obj({ customer: S("Customer name or phone as it is saved now."), date: S("Sale date YYYY-MM-DD, if said."), product: S("Product words, if said."), new_name: S("Correct name."), new_phone: S("Correct phone number."), all_sales: B("True to change all sales of this customer.") }, ["customer"]) },
    { name: "propose_delete", description: "Open a DELETE form for one record entered by mistake. The manager must press Delete and confirm. Kinds: expense, product (from Stock List), supplier_payment, shop_payment, purchase_bill, shop_bill, pending_product. Customer sales are never deleted (use propose_return, propose_change_payment or propose_edit_sale_customer).",
      parameters: obj({ record: S('"expense", "product", "supplier_payment", "shop_payment", "purchase_bill", "shop_bill" or "pending_product".'), which: S("Words to find it: name, supplier / shop, note, product."), date: S("Its date YYYY-MM-DD, if said."), amount: N("Its amount (Rs), if said.") }, ["record"]) }
  ];
}

// ================= Save (called only by the form's own buttons) =================
const timeNow = () => new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
const lineTotal = (it, p) => (byFeet(p) ? it.price * it.feet : it.price * it.quantity);
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

// The same checks as the Sell Product form; returns an error text or "".
export function checkSale(d) {
  if (!d.items.length) return "Add at least one product to sell.";
  for (const it of d.items) {
    const p = productById(it.id); if (!p) return "A product is no longer in the Stock List.";
    const name = sellName(p);
    if (it.price <= 0) return `Please enter a price for ${name}.`;
    if (it.price > it.maxPrice) return `The price of ${name} cannot be more than Rs ${it.maxPrice.toLocaleString("en-US")}.`;
    if (byFeet(p)) {
      if (it.feet <= 0) return `Please enter how many feet of ${name} to sell.`;
      if (it.feet > metres(p)) return `Only ${metres(p).toLocaleString("en-US")} ft left for ${name}.`;
    } else {
      if (it.quantity <= 0) return `Please enter a quantity for ${name}.`;
      if (it.quantity > Number(p.quantity || 0)) return `Only ${p.quantity} left for ${name}.`;
      if (it.feet > metres(p)) return `Only ${metres(p).toLocaleString("en-US")} ft left for ${name}.`;
    }
  }
  return "";
}
export const saleTotal = (d) => d.items.reduce((x, it) => x + lineTotal(it, productById(it.id) || {}), 0);

// Exactly what the Stock List's Sell Product does (finalizeSale).
export async function saveSale(uid, d, totalReceived) {
  const totalAmount = saleTotal(d);
  const totalRemaining = Math.max(0, totalAmount - totalReceived);
  const ratio = totalAmount > 0 ? totalRemaining / totalAmount : 0;
  const timestamp = Date.now(), date = todayString(), time = timeNow();
  const customerName = d.name.trim(), customerContact = phoneKey(d.phone) || d.phone;
  for (const item of d.items) {
    const p = productById(item.id), cable = byFeet(p);
    const qty = cable ? 1 : item.quantity;
    const amount = lineTotal(item, p);
    const remaining = Math.round(amount * ratio);
    const patch = {};
    if (!cable) patch.quantity = p.quantity - qty;
    if (item.feet > 0) {
      const left = metres(p) - item.feet;
      patch.length = left + "ft";
      const per = isCable(p) ? perBundle(p) : 0;
      if (per > 0) { patch.bundle = String(Math.max(0, Math.ceil(left / per - 1e-9))); patch.perBundle = per; }
    }
    if (Object.keys(patch).length) await updateDoc(ref(uid, "products", item.id), patch);
    const record = { productName: sellName(p), category: p.category, quantity: qty, amount, received: amount - remaining, remainingCost: remaining,
      paymentType: remaining > 0 ? "credit" : "cash", date, time, timestamp, customerName, customerContact };
    if (item.feet > 0) { record.lengthFt = item.feet; if (cable) record.pricePerFt = item.price; }
    record.paidAtSale = amount - remaining;
    const unitCost = Number(p.cost || 0);
    if (unitCost > 0) record.cost = Math.round(unitCost * (cable ? item.feet : qty));
    if (remaining > 0) record.status = "pending";
    await addDoc(col(uid, "sales"), record);
  }
  return { total: totalAmount, udhaar: totalRemaining };
}

export async function saveUdhaar(uid, d, amount) {
  const keys = new Set(d.keys);
  const open = groupBills(D.sales).filter((b) => keys.has(b.key));
  return receiveFromCustomer(uid, open, amount);
}
export const customerOpenBills = (d) => { const keys = new Set(d.keys); return groupBills(D.sales).filter((b) => keys.has(b.key) && b.remaining > 0); };

export async function savePurchase(uid, d) {
  const sup = d.isNew ? await ensureSupplier(uid, { newName: d.supName, newPhone: "" }, D.suppliers) : { id: d.supId, name: d.supName, phone: d.supPhone };
  const items = d.lines.map((l) => { const p = productById(l.productId); return { productId: l.productId, name: sellNameOf(p), category: p.category, qty: l.qty, unit: byFeet(p) ? "ft" : "pcs", cost: l.cost, total: l.qty * l.cost }; });
  if (!d.ordered) {
    for (const it of items) await addDoc(col(uid, "pendingProducts"), Object.assign(pendingDoc(it, sup, d.date), { billNo: d.billNo }));
    return { sup, total: items.reduce((x, i) => x + i.total, 0), where: "pending" };
  }
  const row = D.suppliers.find(([id]) => id === sup.id);
  const before = row ? supplierSummary(sup.id, row[1], D.purchases, D.supplierPayments).balance : 0;
  const bill = await recordPurchase(uid, { sup, date: d.date, items, paid: d.paid, billNo: d.billNo, balanceBefore: before, addedToStock: false, extra: { toUpcoming: true } });
  for (let i = 0; i < items.length; i++) {
    await addUpcoming(uid, Object.assign(upcomingDoc(productById(items[i].productId), items[i].productId, { qty: items[i].qty, cost: items[i].cost, sup, purchaseId: bill.id, itemIndex: i }), { orderedDate: d.date }));
  }
  return { sup, total: bill.total, where: "upcoming" };
}

export function supplierBalance(d) { const r = D.suppliers.find(([id]) => id === d.supId); return r ? supplierSummary(d.supId, r[1], D.purchases, D.supplierPayments) : null; }
export async function saveSupplierPayment(uid, d) {
  const r = D.suppliers.find(([id]) => id === d.supId); if (!r) throw new Error("Supplier not found.");
  const sum = supplierSummary(d.supId, r[1], D.purchases, D.supplierPayments);
  await paySupplier(uid, { id: d.supId, sup: r[1], amount: d.amount, date: d.date, note: d.note, method: d.method, bills: sum.bills, balance: sum.balance });
}

export function shopBalance(d) { const r = D.shops.find(([id]) => id === d.shopId); return r ? shopSummary(d.shopId, r[1], D.shopBills, D.shopPayments) : null; }
// Exactly what the shop page's "Give stock" does.
export async function saveShopBill(uid, d) {
  const needQ = new Map();
  d.lines.forEach((l) => needQ.set(l.productId, (needQ.get(l.productId) || 0) + l.qty));
  for (const [id, q] of needQ) { const p = productById(id); if (!p) throw new Error("A product is no longer in the Stock List."); if (q > available(p)) throw new Error(`Only ${stockText(p)} of ${sellNameOf(p)} left in stock.`); }
  const items = d.lines.map((l) => { const p = productById(l.productId); return { productId: l.productId, name: sellNameOf(p), category: p.category, qty: l.qty, unit: byFeet(p) ? "ft" : "pcs", price: l.price, cost: Math.round(Number(p.cost || 0) * l.qty), total: l.qty * l.price }; });
  const total = items.reduce((a, i) => a + i.total, 0);
  const recv = Math.min(d.recv || 0, total);
  for (const [id, q] of needQ) await updateDoc(ref(uid, "products", id), stockPatch(productById(id), -q));
  const ts = Date.now();
  const bill = await addDoc(col(uid, "shopBills"), { date: d.date, timestamp: ts, shopId: d.shopId, shop: d.shopName, billNo: d.billNo, items, total, received: recv });
  if (recv > 0) await addDoc(col(uid, "shopPayments"), { date: d.date, timestamp: ts + 1, shopId: d.shopId, shop: d.shopName, amount: recv, method: "Cash", note: "Received with bill", billId: bill.id });
  return { total, recv };
}
export async function saveShopPayment(uid, d) {
  await addDoc(col(uid, "shopPayments"), { date: d.date, timestamp: Date.now(), shopId: d.shopId, shop: d.shopName, amount: d.amount, method: d.method, note: d.note.trim() || "Payment received" });
}

// ---------- Return: exactly what the Returns page saves (customer side) ----------
export const saleRow = (id) => D.sales.find(([x]) => x === id);
export function returnCalc(d) {
  const r = saleRow(d.saleId); if (!r) return null;
  const x = r[1], units = saleUnits(x) || 1, max = returnableOf(x);
  const qty = Math.min(Math.max(0, d.qty), max);
  const value = Math.round(x.amount / units * qty);
  const owed = remainingOf(x);
  let refund = 0, cut = 0;
  if (d.rtype === "refund") refund = value;
  if (d.rtype === "udhaar") { cut = Math.min(value, owed); refund = value - cut; }
  return { x, units, unit: saleUnitName(x), max, qty, value, owed, refund, cut };
}
export async function saveReturn(uid, d) {
  const c = returnCalc(d); if (!c) throw new Error("This sale is no longer there.");
  if (c.qty <= 0) throw new Error("Please enter how much is coming back.");
  const x = c.x;
  const match = (() => {
    const m = D.products.find(([, p]) => (!x.category || p.category === x.category) && (sellNameOf(p) === x.productName || p.name === x.productName));
    return m || null;
  })();
  let stockUpdated = false;
  if (d.back && match) {
    const [pid, p] = match, patch = {};
    if (c.unit === "ft" && byFeet(p)) { const len = metres(p) + c.qty; patch.length = len + "ft"; const per = isCable(p) ? perBundle(p) : 0; if (per > 0) { patch.bundle = String(Math.ceil(len / per - 1e-9)); patch.perBundle = per; } }
    else patch.quantity = Number(p.quantity || 0) + c.qty;
    await updateDoc(ref(uid, "products", pid), patch); stockUpdated = true;
  }
  const salePatch = { returnedQty: Number(x.returnedQty || 0) + c.qty };
  if (c.cut > 0) { const left = c.owed - c.cut; salePatch.remainingCost = left; salePatch.status = left > 0 ? "pending" : "received"; }
  await updateDoc(ref(uid, "sales", d.saleId), salePatch);
  await addDoc(col(uid, "returns"), {
    date: todayString(), timestamp: Date.now(), source: "customer", saleId: d.saleId,
    customerName: x.customerName || "", customerContact: x.customerContact || "",
    productId: match ? match[0] : "", productName: x.productName, category: x.category || "", qty: c.qty, unit: c.unit,
    type: d.rtype, value: c.value, refund: c.refund, udhaarCut: c.cut,
    cost: x.cost ? Math.round(x.cost / c.units * c.qty) : 0,
    backToStock: d.back, stockUpdated, reason: d.reason || "Other"
  });
  return { c, stockUpdated };
}

// ---------- Change payment of an old sale (same as Sales Summary -> Change payment) ----------
export function payfixInfo(d) {
  const b = groupBills(D.sales).find((x) => x.key === d.billKey); if (!b) return null;
  const ids = new Set(b.ids);
  const rows = D.sales.filter(([id]) => ids.has(id));
  const total = rows.reduce((a, [, x]) => a + Number(x.amount || 0), 0);
  const logged = D.payments.map((r) => r[1]).filter((p) => p.billKey === b.key || (p.saleIds || []).some((x) => ids.has(x))).reduce((a, p) => a + Number(p.amount || 0), 0);
  const cuts = D.returns.map((r) => r[1]).filter((r) => r.source !== "shop" && ids.has(r.saleId)).reduce((a, r) => a + Number(r.udhaarCut || 0), 0);
  const max = Math.max(0, total - logged - cuts);
  const nowPaid = Math.min(max, rows.reduce((a, [, x]) => a + paidAtSale(x), 0));
  return { b, rows, total, logged, cuts, max, nowPaid };
}
export async function savePayfix(uid, d, paid) {
  const i = payfixInfo(d); if (!i) throw new Error("This sale is no longer there.");
  return changeSalePayment(uid, i.rows, paid, { logged: i.logged, cuts: i.cuts });
}

// ---------- Expense: same record as the Expenses page ----------
export async function saveExpense(uid, d) {
  const data = { date: d.date, kind: d.kind, amount: d.amount, method: d.method, note: d.note.trim() };
  if (d.editId) await updateDoc(ref(uid, "expenses", d.editId), data);
  else await addDoc(col(uid, "expenses"), Object.assign(data, { timestamp: Date.now() }));
}

// ---------- Product: same checks and record as Stock List → Add Product / Edit ----------
export async function saveProduct(uid, d, values) {
  const built = buildProduct(d.category, values, { allowZeroQty: !!d.editId });
  if (built.error) throw new Error(built.error);
  if (d.editId) { await updateDoc(ref(uid, "products", d.editId), built.data); return built.data; }
  await addDoc(col(uid, "products"), built.data);
  return built.data;
}

// ---------- New supplier / shop: same record as the Suppliers / Shops page ----------
export async function saveParty(uid, d) {
  const list = d.kind === "shop" ? D.shops : D.suppliers;
  if (!d.name.trim()) throw new Error("Please enter the name.");
  if (list.some(([, s]) => supKey(s.name) === supKey(d.name))) throw new Error(`A ${d.kind} with this name already exists.`);
  const base = { name: d.name.trim(), phone: d.phone || "", address: (d.address || "").trim(), note: "", openingBalance: d.opening || 0, createdAt: todayString(), timestamp: Date.now() };
  if (d.kind === "shop") base.owner = (d.owner || "").trim();
  const r = await addDoc(col(uid, d.kind === "shop" ? "shops" : "suppliers"), base);
  return r.id;
}

// ---------- Shop return: exactly what the Returns page saves for a wholesale shop ----------
export function shopReturnCalc(d) {
  const r = D.shopBills.find(([id]) => id === d.billId); if (!r) return null;
  const b = r[1], i = (b.items || [])[d.idx]; if (!i) return null;
  const max = shopLeft(i), qty = Math.min(Math.max(0, d.qty), max);
  const per = Number(i.qty || 0) ? Number(i.total || 0) / Number(i.qty) : Number(i.price || 0);
  const shop = (D.shops.find(([id]) => id === b.shopId) || [, {}])[1];
  return { b, i, shop, unit: i.unit === "ft" ? "ft" : "pcs", max, qty, value: Math.round(per * qty) };
}
export async function saveShopReturn(uid, d) {
  const c = shopReturnCalc(d); if (!c) throw new Error("This shop bill is no longer there.");
  if (c.qty <= 0) throw new Error("Please enter how much is coming back.");
  const { b, i, shop } = c;
  const match = (i.productId && D.products.find(([id]) => id === i.productId)) || D.products.find(([, p]) => (!i.category || p.category === i.category) && (sellNameOf(p) === i.name || p.name === i.name));
  let stockUpdated = false;
  if (d.back && match) {
    const [pid, p] = match, patch = {};
    if (c.unit === "ft" && byFeet(p)) { const len = metres(p) + c.qty; patch.length = len + "ft"; const per = isCable(p) ? perBundle(p) : 0; if (per > 0) { patch.bundle = String(Math.ceil(len / per - 1e-9)); patch.perBundle = per; } }
    else patch.quantity = Number(p.quantity || 0) + c.qty;
    await updateDoc(ref(uid, "products", pid), patch); stockUpdated = true;
  }
  const items = (b.items || []).map((x, k) => (k === d.idx ? Object.assign({}, x, { returnedQty: Number(x.returnedQty || 0) + c.qty }) : x));
  await updateDoc(ref(uid, "shopBills", d.billId), { items });
  await addDoc(col(uid, "shopPayments"), { date: todayString(), timestamp: Date.now(), shopId: b.shopId, shop: shop.name || "", amount: c.value, method: "Return",
    note: `Returned: ${i.name} × ${c.qty}${c.unit === "ft" ? " ft" : ""}${d.exch ? " (exchange)" : ""}`, returnOfBill: d.billId });
  await addDoc(col(uid, "returns"), { date: todayString(), timestamp: Date.now(), source: "shop", shopId: b.shopId, shopName: shop.name || "", billId: d.billId, itemIndex: d.idx,
    customerName: shop.name || "", productId: i.productId || (match ? match[0] : ""), productName: i.name, category: i.category || "",
    qty: c.qty, unit: c.unit, type: d.exch ? "sexchange" : "cut", value: c.value, refund: 0, udhaarCut: c.value, cost: 0,
    backToStock: d.back, stockUpdated, reason: d.reason || "Other" });
  return { c, stockUpdated };
}

// ---------- Edit customer on sales (Sales Summary → Edit customer) ----------
export async function saveCustfix(uid, d) {
  const keys = new Set(d.billKeys);
  const ids = groupBills(D.sales).filter((b) => keys.has(b.key)).flatMap((b) => b.ids);
  if (!ids.length) throw new Error("These sales are no longer there.");
  const patch = { customerName: d.name.trim(), customerContact: d.phone };
  for (const id of ids) await updateDoc(ref(uid, "sales", id), patch);
  return ids.length;
}

// ---------- Delete: the same steps as each page's delete button ----------
export async function doDelete(uid, d) {
  const id = d.rid;
  if (d.kind === "expense") return deleteDoc(ref(uid, "expenses", id));
  if (d.kind === "product") return deleteDoc(ref(uid, "products", id));
  if (d.kind === "purchase_bill") return deleteDoc(ref(uid, "purchases", id));
  if (d.kind === "pending_product") return deleteDoc(ref(uid, "pendingProducts", id));
  if (d.kind === "shop_payment") return deleteDoc(ref(uid, "shopPayments", id));
  if (d.kind === "supplier_payment") {
    const r = D.supplierPayments.find(([x]) => x === id); if (!r) throw new Error("This payment is no longer there.");
    const sup = D.suppliers.find(([sid, s]) => sid === r[1].supplierId || supKey(s.name) === supKey(r[1].supplier || ""));
    if (sup) {
      // undo it on the bills too (newest bills first), like the supplier page
      let left = Number(r[1].amount || 0);
      const bills = supplierSummary(sup[0], sup[1], D.purchases, D.supplierPayments).bills.filter(([, p]) => Number(p.paid || 0) > 0)
        .sort((a, c) => (c[1].date || "").localeCompare(a[1].date || "") || (c[1].timestamp || 0) - (a[1].timestamp || 0));
      for (const [pid, p] of bills) {
        if (left <= 0) break;
        if (r[1].purchaseId && pid !== r[1].purchaseId) continue;
        const part = Math.min(left, Number(p.paid || 0));
        await updateDoc(ref(uid, "purchases", pid), { paid: Number(p.paid || 0) - part });
        left -= part;
      }
    }
    return deleteDoc(ref(uid, "supplierPayments", id));
  }
  if (d.kind === "shop_bill") {
    const r = D.shopBills.find(([x]) => x === id); if (!r) throw new Error("This bill is no longer there.");
    for (const i of r[1].items || []) { const p = productById(i.productId); if (p) await updateDoc(ref(uid, "products", i.productId), stockPatch(p, Math.max(0, Number(i.qty || 0) - Number(i.returnedQty || 0)))); }
    for (const [pid] of D.shopPayments.filter(([, p]) => p.billId === id)) await deleteDoc(ref(uid, "shopPayments", pid));
    return deleteDoc(ref(uid, "shopBills", id));
  }
  throw new Error("This kind of record can't be deleted here.");
}
