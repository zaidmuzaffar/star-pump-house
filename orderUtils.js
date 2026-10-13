// Ordering stock: Purchase form -> Upcoming Products (ordered, on the way) -> Stock (arrived).
// Items not ordered yet wait in Pending Products (collection "pendingProducts"; no bill, nothing paid).
import { col, addDoc } from './common.js?v=55';
import { byFeet, isCable, metres, perBundle, sellNameOf } from './utils.js?v=55';

// Patch that adds qty (pieces, or feet for cable / length items) to a stock product.
export function addStockPatch(p, qty) {
  if (byFeet(p)) {
    const len = metres(p) + qty;
    const patch = { length: len + "ft" };
    const per = isCable(p) ? perBundle(p) : 0;
    if (per > 0) { patch.bundle = String(Math.ceil(len / per - 1e-9)); patch.perBundle = per; }
    return patch;
  }
  return { quantity: Number(p.quantity || 0) + qty };
}

// An Upcoming Products entry for a product of the Stock List that was ordered on a purchase bill.
export function upcomingDoc(p, productId, { qty, cost, sup, purchaseId = "", itemIndex = null, expectedDate = "" }) {
  const d = {
    category: p.category, name: p.name || "", price: Number(p.price || 0), cost: Number(cost || 0),
    status: "pending", productId, source: "purchase", orderedDate: "",
    supplierId: sup ? sup.id : "", supplierName: sup ? sup.name : ""
  };
  if (p.brand) d.brand = p.brand;
  if (p.size) d.size = p.size;
  if (p.unit) d.unit = p.unit;
  if (byFeet(p)) {
    d.length = qty + "ft";
    const per = isCable(p) ? perBundle(p) : 0;
    if (per > 0) { d.perBundle = per; d.bundle = String(Math.ceil(qty / per - 1e-9)); }
  } else d.quantity = qty;
  if (purchaseId) d.purchaseId = purchaseId;
  if (itemIndex !== null) d.purchaseItem = itemIndex;
  if (expectedDate) d.expectedDate = expectedDate;
  return d;
}

export async function addUpcoming(uid, doc) { return addDoc(col(uid, "upcoming"), doc); }

// A line that was not ordered yet.
export function pendingDoc(item, sup, date) {
  return {
    date, timestamp: Date.now(), productId: item.productId, name: item.name, category: item.category,
    qty: item.qty, unit: item.unit, cost: item.cost, total: item.total,
    supplierId: sup.id, supplierName: sup.name, supplierPhone: sup.phone || ""
  };
}

export const unitWord = (u) => (u === "ft" ? "ft" : "pcs");
export const nameOf = (p) => sellNameOf(p);
