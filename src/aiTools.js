// Ask AI: the "tools" the AI may use to read the shop's records.
// The AI never reads the database itself: it asks for one of these functions (with a name, a date range ...),
// the function works out the answer from the records already loaded on the page, and only that small result
// goes back to the AI. Everything here only READS records (nothing is changed).
import {
  CATEGORY_LABELS, todayString, digitsOnly, phoneKey, nameKey, groupBills, withReturns, remainingOf, paidAtSale,
  itemText, saleUnits, saleUnitName, productLabel, stockText, isLowStock, stockNumber, byFeet, isCable, sellNameOf, daysAgoIso
} from './utils.js?v=55';
import { supplierSummary } from './supplierUtils.js?v=55';
import { shopSummary } from './shopUtils.js?v=55';
import { kindLabel } from './expenseUtils.js?v=55';

// All records, filled by ai.js: each is an array of [id, data].
export const D = {
  products: [], sales: [], payments: [], returns: [], suppliers: [], purchases: [], supplierPayments: [],
  shops: [], shopBills: [], shopPayments: [], upcoming: [], pendingProducts: [], closings: [], expenses: []
};
export const COLLECTIONS = Object.keys(D);

// ---------- small helpers ----------
const num = (v) => Number(v || 0);
const words = (q) => nameKey(q).split(" ").filter(Boolean);
// every word of the question appears in the text ("zaid" finds "Zaid Muzaffar", "jd 0.75" finds "Jd 0.75")
export const matches = (text, q) => { const t = nameKey(text); const w = words(q); return w.length > 0 && w.every((x) => t.includes(x)); };
const inRange = (date, from, to) => (!from || (date || "") >= from) && (!to || (date || "") <= to);
const range = (a) => ({ from: a.from || "", to: a.to || (a.from ? todayString() : "") });
const cap = (list, limit, def = 25) => list.slice(0, Math.max(1, Math.min(Number(limit) || def, 100)));
const catName = (c) => CATEGORY_LABELS[c] || (c ? String(c) : "Other");

// Sale bills after returns (one bill = one customer checkout; several items).
function bills() {
  return groupBills(withReturns(D.sales, D.returns)).map((b) => {
    const cashAtSale = b.docs.reduce((a, s) => a + paidAtSale(s), 0);
    return Object.assign(b, { cashAtSale: Math.min(cashAtSale, b.amount) });
  });
}
const billOut = (b) => ({
  date: b.date, time: b.time || "", customer: b.customerName || "Walk-in", phone: b.customerContact || "",
  items: b.docs.map((s) => `${s.productName || itemText(s)} × ${saleUnits(s)} ${saleUnitName(s)} = Rs ${num(s.origAmount ?? s.amount)}`),
  total: b.amount, received: b.amount - b.remaining, remaining_udhaar: b.remaining,
  ...(b.returnCount ? { returned_value: b.returnedValue } : {})
});

// Customers, the same way the Customers page groups them: by phone number, or by name when a sale has no number.
export function customers() {
  const map = new Map(), byName = new Map();
  const all = bills();
  const add = (key, b) => {
    let c = map.get(key);
    if (!c) { c = { key, name: "", phone: "", bills: [], total: 0, udhaar: 0, first: b.date || "", last: "", lastTs: -1 }; map.set(key, c); }
    c.bills.push(b); c.total += b.amount; c.udhaar += b.remaining;
    if (b.date && b.date < c.first) c.first = b.date;
    if (b.timestamp >= c.lastTs) { c.lastTs = b.timestamp; c.last = b.date || c.last; }
    const p = phoneKey(b.customerContact);
    if (p && b.timestamp >= (c.nameTs ?? -1) && b.customerName) { c.nameTs = b.timestamp; c.name = b.customerName.trim(); }
    if (!c.name) c.name = (b.customerName || "").trim();
    if (p) c.phone = p;
  };
  all.forEach((b) => {
    const p = phoneKey(b.customerContact); if (!p) return;
    add("c" + p, b);
    const n = nameKey(b.customerName);
    if (n) { const s = byName.get(n) || new Set(); s.add("c" + p); byName.set(n, s); }
  });
  all.forEach((b) => {
    if (phoneKey(b.customerContact)) return;
    const n = nameKey(b.customerName); if (!n) return;
    const owners = byName.get(n);
    add(owners && owners.size === 1 ? [...owners][0] : "n" + n, b);
  });
  return [...map.values()];
}
export function findCustomers(q) {
  const list = customers();
  const d = digitsOnly(q || "");
  if (d.length >= 4) return list.filter((c) => digitsOnly(c.phone).includes(d));
  const exact = list.filter((c) => nameKey(c.name) === nameKey(q));
  return exact.length ? exact : list.filter((c) => matches(c.name, q));
}
const custBrief = (c) => ({ name: c.name || "No name", phone: c.phone, total_bought: c.total, udhaar_remaining: c.udhaar, last_visit: c.last });

export function productRows(q, category) {
  return D.products.filter(([, p]) => (!category || p.category === category) && (!q || matches(`${productLabel(p)} ${p.name || ""} ${p.size || ""} ${p.brand || ""} ${catName(p.category)}`, q)));
}
const productOut = ([, p]) => ({
  name: productLabel(p), category: catName(p.category), in_stock: stockText(p), low_stock: isLowStock(p),
  sale_price: num(p.price), cost_price: num(p.cost), unit: byFeet(p) ? "per ft" : "per piece",
  ...(isCable(p) && p.bundle ? { bundles: p.bundle } : {}), ...(p.supplierName ? { supplier: p.supplierName } : {})
});

// ---------- the tools ----------
export const TOOLS = {
  shop_overview(a) {
    const { from, to } = range(a);
    const bs = bills().filter((b) => inRange(b.date, from, to));
    const pays = D.payments.map((r) => r[1]).filter((p) => inRange(p.date, from, to));
    const saleDay = new Map(bs.map((b) => [b.key, b.date]));
    const loan = pays.filter((p) => !(p.billKey && saleDay.get(p.billKey) === p.date)).reduce((x, p) => x + num(p.amount), 0);
    const withCost = bs.flatMap((b) => b.docs).filter((s) => num(s.cost) > 0);
    const low = D.products.filter(([, p]) => isLowStock(p));
    return {
      period: from ? `${from} to ${to}` : "all time",
      sales_bills: bs.length, total_sales: bs.reduce((x, b) => x + b.amount, 0),
      cash_received_at_sale: bs.reduce((x, b) => x + Math.min(b.cashAtSale, b.amount), 0),
      udhaar_from_these_sales_still_open: bs.reduce((x, b) => x + b.remaining, 0),
      old_udhaar_received_in_period: loan,
      items_sold: bs.reduce((x, b) => x + b.docs.reduce((y, s) => y + (s.lengthFt ? 1 : num(s.quantity) || 1), 0), 0),
      profit_on_sales_with_cost_price: withCost.reduce((x, s) => x + num(s.amount) - num(s.cost), 0),
      all_open_udhaar_now: bills().reduce((x, b) => x + b.remaining, 0),
      products_in_stock_list: D.products.length, low_stock_products: low.length,
      low_stock_names: low.slice(0, 15).map(([, p]) => `${productLabel(p)} (${stockText(p)})`),
      upcoming_orders_on_the_way: D.upcoming.filter(([, u]) => u.status !== "arrived").length
    };
  },

  find_sales(a) {
    const { from, to } = range(a);
    let list = bills().filter((b) => inRange(b.date, from, to));
    if (a.customer) {
      const cs = findCustomers(a.customer); const keys = new Set(cs.flatMap((c) => c.bills.map((b) => b.key)));
      list = list.filter((b) => keys.has(b.key));
    }
    if (a.product) list = list.filter((b) => b.docs.some((s) => matches(`${itemText(s)} ${s.productName || ""}`, a.product)));
    if (a.only_udhaar) list = list.filter((b) => b.remaining > 0);
    return {
      matching_bills: list.length, total: list.reduce((x, b) => x + b.amount, 0),
      received: list.reduce((x, b) => x + b.amount - b.remaining, 0), udhaar_remaining: list.reduce((x, b) => x + b.remaining, 0),
      bills_newest_first: cap(list, a.limit).map(billOut),
      ...(list.length > (Number(a.limit) || 25) ? { note: "Only the newest bills are listed; totals cover all of them." } : {})
    };
  },

  customer_account(a) {
    const cs = findCustomers(a.customer || "");
    if (!cs.length) return { found: 0, message: "No customer with this name or number." };
    if (cs.length > 1) return { found: cs.length, message: "More than one customer matches. Ask which one.", candidates: cs.slice(0, 10).map(custBrief) };
    const c = cs[0];
    const keys = new Set(c.bills.map((b) => b.key)), ids = new Set(c.bills.flatMap((b) => b.ids));
    const pays = D.payments.map((r) => r[1]).filter((p) => keys.has(p.billKey) || (p.saleIds || []).some((x) => ids.has(x)));
    const rets = D.returns.map((r) => r[1]).filter((r) => r.saleId && ids.has(r.saleId) && r.source !== "shop");
    return {
      ...custBrief(c), paid: c.total - c.udhaar, customer_since: c.first, bills: c.bills.length,
      open_udhaar_bills: c.bills.filter((b) => b.remaining > 0).map(billOut),
      recent_bills: c.bills.slice().sort((x, y) => y.timestamp - x.timestamp).slice(0, 10).map(billOut),
      udhaar_payments_received: pays.sort((x, y) => (y.date || "").localeCompare(x.date || "")).slice(0, 15).map((p) => ({ date: p.date, amount: num(p.amount), note: p.note || "" })),
      returns: rets.map((r) => ({ date: r.date, product: r.productName, qty: r.qty, value: num(r.value), type: r.type || "", refund: num(r.refund) }))
    };
  },

  udhaar_list(a) {
    const list = customers().filter((c) => c.udhaar > 0).sort((x, y) => y.udhaar - x.udhaar);
    const walkIn = bills().filter((b) => b.remaining > 0 && !phoneKey(b.customerContact) && !nameKey(b.customerName));
    return {
      customers_with_udhaar: list.length, total_udhaar: list.reduce((x, c) => x + c.udhaar, 0) + walkIn.reduce((x, b) => x + b.remaining, 0),
      customers: cap(list, a.limit, 30).map((c) => ({ name: c.name || "No name", phone: c.phone, udhaar: c.udhaar, oldest_open_bill: c.bills.filter((b) => b.remaining > 0).map((b) => b.date).sort()[0] || "" })),
      ...(walkIn.length ? { walk_in_bills_without_name: walkIn.length } : {})
    };
  },

  stock_lookup(a) {
    let rows = productRows(a.product, a.category);
    if (a.only_low) rows = rows.filter(([, p]) => isLowStock(p));
    rows.sort((x, y) => productLabel(x[1]).localeCompare(productLabel(y[1])));
    return { products_found: rows.length, products: cap(rows, a.limit, 40).map(productOut),
      stock_value_at_sale_price_pieces_only: rows.reduce((x, [, p]) => x + (byFeet(p) ? 0 : num(p.price) * num(p.quantity)), 0) };
  },

  best_sellers(a) {
    const { from, to } = range(a);
    const m = new Map();
    bills().filter((b) => inRange(b.date, from, to)).forEach((b) => b.docs.forEach((s) => {
      const cat = s.category || "other";
      if (a.category && cat !== a.category) return;
      const k = s.productName || itemText(s);
      const r = m.get(k) || { product: k, category: catName(cat), qty: 0, unit: saleUnitName(s), amount: 0, times_sold: 0 };
      r.qty += saleUnits(s) - (s.lengthFt ? 0 : num(s.returnedQty2)); r.amount += num(s.amount); r.times_sold++;
      m.set(k, r);
    }));
    const by = a.sort_by === "amount" ? "amount" : "qty";
    const list = [...m.values()].sort((x, y) => y[by] - x[by] || y.amount - x.amount);
    return { period: from ? `${from} to ${to}` : "all time", sorted_by: by === "qty" ? "quantity sold" : "money (Rs)", products: cap(list, a.limit, 10) };
  },

  sales_by_period(a) {
    const { from, to } = range(a);
    const g = a.group_by === "month" ? (d) => (d || "").slice(0, 7) : (d) => d || "";
    const m = new Map();
    bills().filter((b) => inRange(b.date, from, to)).forEach((b) => {
      const k = g(b.date); const r = m.get(k) || { [a.group_by === "month" ? "month" : "date"]: k, bills: 0, total: 0, received_at_sale: 0, udhaar_open: 0 };
      r.bills++; r.total += b.amount; r.received_at_sale += Math.min(b.cashAtSale, b.amount); r.udhaar_open += b.remaining; m.set(k, r);
    });
    const list = [...m.values()].sort((x, y) => String(Object.values(y)[0]).localeCompare(String(Object.values(x)[0])));
    return { period: from ? `${from} to ${to}` : "all time", rows_newest_first: cap(list, a.limit, 62), grand_total: list.reduce((x, r) => x + r.total, 0) };
  },

  profit_report(a) {
    const { from, to } = range(a);
    const docs = bills().filter((b) => inRange(b.date, from, to)).flatMap((b) => b.docs);
    const withCost = docs.filter((s) => num(s.cost) > 0);
    const m = new Map();
    withCost.forEach((s) => { const k = s.productName || itemText(s); const r = m.get(k) || { product: k, sales: 0, cost: 0, profit: 0 }; r.sales += num(s.amount); r.cost += num(s.cost); r.profit = r.sales - r.cost; m.set(k, r); });
    const S = withCost.reduce((x, s) => x + num(s.amount), 0), C = withCost.reduce((x, s) => x + num(s.cost), 0);
    const exp = D.expenses.map((r) => r[1]).filter((x) => inRange(x.date, from, to)).reduce((t, x) => t + num(x.amount), 0)
      + D.closings.map((r) => r[1]).filter((c) => inRange(c.date, from, to)).reduce((t, c) => t + num(c.expenses), 0);
    return { period: from ? `${from} to ${to}` : "all time", sales: S, cost: C, gross_profit: S - C, margin_percent: S ? Math.round((S - C) / S * 1000) / 10 : 0,
      expenses: exp, net_profit_after_expenses: S - C - exp,
      sales_without_cost_price_not_counted: docs.length - withCost.length, top_products: [...m.values()].sort((x, y) => y.profit - x.profit).slice(0, Number(a.limit) || 10) };
  },

  supplier_account(a) {
    const list = D.suppliers.map(([id, s]) => ({ id, s, sum: supplierSummary(id, s, D.purchases, D.supplierPayments) }));
    if (!a.supplier) {
      return { suppliers: list.length, total_remaining_to_pay: list.reduce((x, r) => x + r.sum.balance, 0),
        list: list.sort((x, y) => y.sum.balance - x.sum.balance).map((r) => ({ name: r.s.name, phone: r.s.phone || "", total_bills: r.sum.bought, paid: r.sum.paid, remaining_to_pay: r.sum.balance, last_bill: r.sum.last })) };
    }
    const hit = list.filter((r) => matches(`${r.s.name} ${r.s.phone || ""}`, a.supplier));
    if (!hit.length) return { found: 0, message: "No supplier with this name." };
    if (hit.length > 1) return { found: hit.length, message: "More than one supplier matches. Ask which one.", candidates: hit.map((r) => r.s.name) };
    const { s, sum } = hit[0];
    return { name: s.name, phone: s.phone || "", opening_balance: sum.opening, total_bills: sum.bought, paid: sum.paid, remaining_to_pay: sum.balance,
      bills_newest_first: sum.bills.slice().sort((x, y) => (y[1].date || "").localeCompare(x[1].date || "")).slice(0, 15).map(([, p]) => ({ date: p.date, bill_no: p.billNo || "", total: num(p.total), items: (p.items || []).map((i) => `${i.name} × ${i.qty}${i.unit === "ft" ? " ft" : ""} @ Rs ${num(i.cost)}`) })),
      payments_newest_first: sum.pays.slice().sort((x, y) => (y[1].date || "").localeCompare(x[1].date || "")).slice(0, 15).map(([, p]) => ({ date: p.date, amount: num(p.amount), method: p.method || "", note: p.note || "" })) };
  },

  shop_account(a) {
    const list = D.shops.map(([id, s]) => ({ s, sum: shopSummary(id, s, D.shopBills, D.shopPayments) }));
    if (!a.shop) {
      return { shops: list.length, total_remaining_to_collect: list.reduce((x, r) => x + r.sum.remaining, 0),
        list: list.sort((x, y) => y.sum.remaining - x.sum.remaining).map((r) => ({ name: r.s.name, owner: r.s.owner || "", phone: r.s.phone || "", stock_given: r.sum.given, received: r.sum.received, returned: r.sum.returned, remaining: r.sum.remaining, last_bill: r.sum.last })) };
    }
    const hit = list.filter((r) => matches(`${r.s.name} ${r.s.owner || ""} ${r.s.phone || ""}`, a.shop));
    if (!hit.length) return { found: 0, message: "No shop with this name." };
    if (hit.length > 1) return { found: hit.length, message: "More than one shop matches. Ask which one.", candidates: hit.map((r) => r.s.name) };
    const { s, sum } = hit[0];
    return { name: s.name, owner: s.owner || "", phone: s.phone || "", opening_balance: sum.opening, stock_given: sum.given, received: sum.received, returned_items_value: sum.returned, remaining: sum.remaining,
      bills_newest_first: sum.bills.slice().sort((x, y) => (y[1].date || "").localeCompare(x[1].date || "")).slice(0, 15).map(([, b]) => ({ date: b.date, total: num(b.total), items: (b.items || []).map((i) => `${i.name} × ${i.qty}${i.unit === "ft" ? " ft" : ""} @ Rs ${num(i.price)}`) })),
      payments_newest_first: sum.pays.slice().sort((x, y) => (y[1].date || "").localeCompare(x[1].date || "")).slice(0, 15).map(([, p]) => ({ date: p.date, amount: num(p.amount), method: p.method || "", note: p.note || "" })) };
  },

  purchases_list(a) {
    const { from, to } = range(a);
    let list = D.purchases.map((r) => r[1]).filter((p) => inRange(p.date, from, to));
    if (a.supplier) list = list.filter((p) => matches(p.supplier || "", a.supplier));
    if (a.product) list = list.filter((p) => (p.items || []).some((i) => matches(i.name || "", a.product)));
    list.sort((x, y) => (y.date || "").localeCompare(x.date || "") || num(y.timestamp) - num(x.timestamp));
    return { bills: list.length, total: list.reduce((x, p) => x + num(p.total), 0), paid_with_bill: list.reduce((x, p) => x + num(p.paid), 0),
      list_newest_first: cap(list, a.limit).map((p) => ({ date: p.date, supplier: p.supplier || "", bill_no: p.billNo || "", total: num(p.total), paid_with_bill: num(p.paid), items: (p.items || []).map((i) => `${i.name} × ${i.qty}${i.unit === "ft" ? " ft" : ""} @ Rs ${num(i.cost)}`) })) };
  },

  returns_list(a) {
    const { from, to } = range(a);
    let list = D.returns.map((r) => r[1]).filter((r) => inRange(r.date, from, to));
    if (a.customer) list = list.filter((r) => matches(r.customerName || "", a.customer));
    if (a.product) list = list.filter((r) => matches(r.productName || "", a.product));
    list.sort((x, y) => (y.date || "").localeCompare(x.date || ""));
    return { returns: list.length, total_value: list.reduce((x, r) => x + num(r.value), 0),
      list_newest_first: cap(list, a.limit).map((r) => ({ date: r.date, from: r.source === "shop" ? "shop (wholesale)" : "customer", name: r.customerName || "Walk-in", product: r.productName, qty: r.qty, value: num(r.value), type: r.type || "", cash_refund: num(r.refund), back_in_stock: !!r.stockUpdated })) };
  },

  orders_status() {
    const up = D.upcoming.map((r) => r[1]).filter((u) => u.status !== "arrived");
    return {
      upcoming_on_the_way: up.map((u) => ({ product: isCable(u) ? productLabel(u) : (u.name || ""), qty: byFeet(u) ? stockText(u) : num(u.quantity) + " pcs", supplier: u.supplierName || "", ordered: u.orderedDate || "", expected: u.expectedDate || "", cost: num(u.cost) })),
      pending_not_ordered_yet: D.pendingProducts.map((r) => r[1]).map((p) => ({ product: p.name, qty: p.qty, supplier: p.supplierName || "", cost: num(p.cost), total: num(p.total), added: p.date }))
    };
  },


  // ---------- forecasting (simple, explainable maths on past sales) ----------
  // Speed of selling = a mix of the last 30 days (60%) and the last 90 days (40%), per day.
  forecast_stock(a) {
    const ahead = Math.min(Math.max(Number(a.days_ahead) || 30, 7), 180);
    const d30 = daysAgoIso(29), d90 = daysAgoIso(89);
    const sold30 = new Map(), sold90 = new Map();
    bills().forEach((b) => b.docs.forEach((s) => {
      if ((b.date || "") < d90) return;
      const k = s.productName || "", u = saleUnits(s) - (s.lengthFt ? 0 : num(s.returnedQty2));
      sold90.set(k, (sold90.get(k) || 0) + u);
      if ((b.date || "") >= d30) sold30.set(k, (sold30.get(k) || 0) + u);
    }));
    D.shopBills.forEach(([, sb]) => { if ((sb.date || "") < d90) return; (sb.items || []).forEach((i) => {
      sold90.set(i.name, (sold90.get(i.name) || 0) + num(i.qty)); if ((sb.date || "") >= d30) sold30.set(i.name, (sold30.get(i.name) || 0) + num(i.qty)); }); });
    const coming = new Map();
    D.upcoming.forEach(([, u]) => { if (u.status === "arrived") return; const q = byFeet(u) ? parseFloat(String(u.length || 0)) || 0 : num(u.quantity); coming.set(u.productId, (coming.get(u.productId) || 0) + q); });
    let rows = D.products.filter(([, p]) => (!a.category || p.category === a.category) && (!a.product || matches(`${productLabel(p)} ${p.name || ""}`, a.product))).map(([id, p]) => {
      const k = sellNameOf(p), rate = 0.6 * (sold30.get(k) || 0) / 30 + 0.4 * (sold90.get(k) || 0) / 90;
      const stock = stockNumber(p), onWay = coming.get(id) || 0, unit = byFeet(p) ? "ft" : "pcs";
      const daysLeft = rate > 0 ? Math.floor(stock / rate) : null;
      const needed = Math.ceil(rate * ahead * 1.2);   // 20% extra as safety
      return { product: productLabel(p), unit, in_stock: stock, on_the_way: onWay, sold_last_30_days: sold30.get(k) || 0, sold_last_90_days: sold90.get(k) || 0,
        expected_to_sell_next_period: Math.round(rate * ahead), days_of_stock_left: daysLeft, suggested_order: Math.max(0, needed - stock - onWay) };
    });
    rows = rows.filter((r) => r.sold_last_90_days > 0 || a.product).sort((x, y) => (x.days_of_stock_left ?? 1e9) - (y.days_of_stock_left ?? 1e9));
    return { period_days: ahead, method: "Average selling speed (last 30 days weighted 60%, last 90 days 40%), customer sales and wholesale shop bills. Suggested order = expected need for the period + 20% safety - stock - already on the way.",
      products: cap(rows, a.limit, 15), products_with_no_sales_in_90_days: D.products.length - rows.length };
  },

  forecast_sales(a) {
    const months = new Map();
    bills().forEach((b) => { const m = (b.date || "").slice(0, 7); if (m) months.set(m, (months.get(m) || 0) + b.amount); });
    const now = todayString().slice(0, 7);
    const keys = [];
    const t0 = new Date(); for (let i = 6; i >= 1; i--) { const dt = new Date(t0.getFullYear(), t0.getMonth() - i, 1); keys.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`); }
    const hist = keys.map((k) => ({ month: k, sales: months.get(k) || 0 }));
    const used = hist.filter((h) => h.sales > 0);
    if (used.length < 2) return { message: "Not enough past months with sales to forecast (need at least 2 full months).", past_months: hist, this_month_so_far: months.get(now) || 0 };
    const n = used.length, xs = used.map((_, i) => i), ys = used.map((h) => h.sales);
    const mx = xs.reduce((p, c) => p + c, 0) / n, my = ys.reduce((p, c) => p + c, 0) / n;
    const slope = xs.reduce((p, x, i) => p + (x - mx) * (ys[i] - my), 0) / (xs.reduce((p, x) => p + (x - mx) ** 2, 0) || 1);
    const recent = ys.slice(-3), avg3 = recent.reduce((p, c) => p + c, 0) / recent.length;
    // the straight line continued 1 month (this month) and 2 months (next month), mixed half-half with the 3-month average
    const est = (k) => Math.max(0, Math.round((0.5 * (my + slope * (n - 1 + k - mx)) + 0.5 * avg3) / 100) * 100);
    const day = Number(todayString().slice(8, 10)), dim = new Date(Number(now.slice(0, 4)), Number(now.slice(5, 7)), 0).getDate();
    const sofar = months.get(now) || 0;
    return { past_full_months: hist, this_month_so_far: sofar, this_month_on_current_pace: Math.round(sofar / day * dim),
      forecast_this_month: est(1), forecast_next_month: est(2), trend: slope > 0 ? "going up" : slope < 0 ? "going down" : "flat", change_per_month: Math.round(slope),
      method: "Half from the trend line of the last months, half from the average of the last 3 months. A rough guide, not a promise." };
  },

  cash_day(a) {
    const day = a.date || todayString();
    const bs = bills().filter((b) => b.date === day);
    const pays = D.payments.map((r) => r[1]).filter((p) => p.date === day);
    const saleKeys = new Set(bs.map((b) => b.key));
    const closing = (D.closings.find(([id, c]) => id === day || c.date === day) || [])[1];
    const refunds = D.returns.map((r) => r[1]).filter((r) => r.date === day && num(r.refund) > 0).reduce((x, r) => x + num(r.refund), 0);
    return { date: day, sales_bills: bs.length, sales_total: bs.reduce((x, b) => x + b.amount, 0),
      cash_from_sales: bs.reduce((x, b) => x + Math.min(b.cashAtSale, b.amount), 0) + pays.filter((p) => saleKeys.has(p.billKey)).reduce((x, p) => x + num(p.amount), 0),
      old_udhaar_received: pays.filter((p) => !saleKeys.has(p.billKey)).reduce((x, p) => x + num(p.amount), 0),
      cash_refunds_paid: refunds,
      cash_closing_saved: closing ? { opening_cash: num(closing.opening), expenses: num(closing.expenses), expected_in_drawer: num(closing.expected), counted: num(closing.counted), difference: num(closing.diff) } : "not saved for this day" };
  },

  expenses_report(a) {
    const { from, to } = range(a);
    const rows = D.expenses.map((r) => r[1]).filter((x) => inRange(x.date, from, to) && (!a.kind || x.kind === a.kind || matches(kindLabel(x.kind) + " " + (x.note || ""), a.kind)))
      .sort((x, y) => (y.date || "").localeCompare(x.date || ""));
    const by = {};
    rows.forEach((x) => { const k = kindLabel(x.kind); by[k] = (by[k] || 0) + num(x.amount); });
    const small = D.closings.map((r) => r[1]).filter((c) => inRange(c.date, from, to)).reduce((t, c) => t + num(c.expenses), 0);
    return { period: from ? `${from} to ${to}` : "all time", total: rows.reduce((t, x) => t + num(x.amount), 0), count: rows.length, by_kind: by,
      paid_in_cash: rows.filter((x) => !x.method || x.method === "Cash").reduce((t, x) => t + num(x.amount), 0),
      other_small_expenses_in_cash_closing: small,
      list: rows.slice(0, Math.min(Number(a.limit) || 15, 40)).map((x) => ({ date: x.date, kind: kindLabel(x.kind), amount: num(x.amount), paid_by: x.method || "Cash", note: x.note || "" })) };
  }
};

// ---------- descriptions for the AI ----------
// Built with the Firebase AI "Schema" helper passed in by ai.js.
export function declarations(Schema) {
  const S = (d) => Schema.string({ description: d });
  const I = (d) => Schema.integer({ description: d });
  const B = (d) => Schema.boolean({ description: d });
  const FROM = S("Start date YYYY-MM-DD (inclusive). Leave out for all time.");
  const TO = S("End date YYYY-MM-DD (inclusive). Leave out for up to today.");
  const LIMIT = I("How many rows to list at most.");
  const CAT = S('Product category: "pump", "wire", "safety_cable" or "other".');
  const obj = (properties, required = []) => Schema.object({ properties, optionalProperties: Object.keys(properties).filter((k) => !required.includes(k)) });
  return [
    { name: "shop_overview", description: "Overall shop numbers for a period: total sales, cash received, udhaar (credit) still open, old udhaar received, items sold, profit, low stock, orders on the way. Use for general questions like 'aaj kitni sale hui', 'is mahine ka hisaab'.", parameters: obj({ from: FROM, to: TO }) },
    { name: "find_sales", description: "List customer sale bills (newest first) with items, total, received and remaining udhaar. Filter by customer name/phone, product, dates, or only bills with udhaar.", parameters: obj({ customer: S("Customer name or phone (part is fine)."), product: S("Product name words, e.g. 'submersible' or 'wire 7/29'."), from: FROM, to: TO, only_udhaar: B("Only bills with udhaar still remaining."), limit: LIMIT }) },
    { name: "customer_account", description: "Full account of one customer: total bought, paid, udhaar remaining, open udhaar bills, recent bills, udhaar payments, returns.", parameters: obj({ customer: S("Customer name or phone number.") }, ["customer"]) },
    { name: "udhaar_list", description: "All customers who still owe money (udhaar / credit / baqi / pending payment), biggest first, with the total.", parameters: obj({ limit: LIMIT }) },
    { name: "stock_lookup", description: "Products in the Stock List with quantity in stock, sale price, cost price and low-stock flag. Search by product words or category, or only low stock.", parameters: obj({ product: S("Product name words."), category: CAT, only_low: B("Only products running low."), limit: LIMIT }) },
    { name: "best_sellers", description: "Which products sold the most in a period, by quantity or by money.", parameters: obj({ from: FROM, to: TO, category: CAT, sort_by: S('"qty" (default) or "amount".'), limit: LIMIT }) },
    { name: "sales_by_period", description: "Sales totals per day or per month, e.g. to find the best day or compare months.", parameters: obj({ from: FROM, to: TO, group_by: S('"day" (default) or "month".'), limit: LIMIT }) },
    { name: "profit_report", description: "Profit (sales minus cost price) for a period, with the most profitable products.", parameters: obj({ from: FROM, to: TO, limit: LIMIT }) },
    { name: "supplier_account", description: "Suppliers (companies the shop buys from): bills, paid and remaining to pay. Leave supplier empty to list all suppliers.", parameters: obj({ supplier: S("Supplier name.") }) },
    { name: "shop_account", description: "Wholesale shops the shop gives stock to on account: stock given, received, returned and remaining to collect. Leave shop empty to list all.", parameters: obj({ shop: S("Shop or owner name.") }) },
    { name: "purchases_list", description: "Purchase bills from suppliers (what was bought, when, at what cost).", parameters: obj({ supplier: S("Supplier name."), product: S("Product name words."), from: FROM, to: TO, limit: LIMIT }) },
    { name: "returns_list", description: "Items returned by customers or wholesale shops.", parameters: obj({ customer: S("Customer or shop name."), product: S("Product name words."), from: FROM, to: TO, limit: LIMIT }) },
    { name: "orders_status", description: "Upcoming Products (ordered, on the way) and Pending Products (not ordered yet)." },
    { name: "forecast_stock", description: "Stock forecast: how fast each product sells, how many days the stock will last, and how much to order for the coming period. Use for 'kaun sa maal khatam hoga', 'kya mangwana chahiye', 'agle mahine kitna bikega' per product.", parameters: obj({ days_ahead: I("Days to plan for (default 30)."), product: S("Product words, to check one product."), category: CAT, limit: LIMIT }) },
    { name: "forecast_sales", description: "Sales forecast: total sales expected next month from past months' trend, and this month's pace." },
    { name: "expenses_report", description: "Shop running expenses (Expenses page): rent, electricity, salary, tea, transport, repairs. Total, by kind and the list. Net profit = gross profit − these.", parameters: obj({ from: FROM, to: TO, kind: S("Kind or words, e.g. rent, salary, chai."), limit: LIMIT }) },
    { name: "cash_day", description: "Cash for one day: cash from sales, old udhaar received, refunds and the saved Cash Closing.", parameters: obj({ date: S("Day YYYY-MM-DD. Leave out for today.") }) }
  ];
}

// Friendly names for the "Looked at" line under an answer.
export const TOOL_LABEL = {
  shop_overview: "Overview", find_sales: "Sales", customer_account: "Customer account", udhaar_list: "Udhaar list",
  stock_lookup: "Stock List", best_sellers: "Best sellers", sales_by_period: "Sales by day", profit_report: "Profit",
  supplier_account: "Suppliers", shop_account: "Shops", purchases_list: "Purchases", returns_list: "Returns",
  orders_status: "Upcoming / Pending", cash_day: "Cash", forecast_stock: "Stock forecast", forecast_sales: "Sales forecast", expenses_report: "Expenses"
};
