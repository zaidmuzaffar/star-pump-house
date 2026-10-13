// Shops (wholesale): other shops you give stock to on account.
// Collections (under users/{uid}/):
//   shops        { name, owner, phone, address, note, openingBalance, createdAt, timestamp }
//   shopBills    { date, timestamp, shopId, shop, billNo, items[{productId,name,category,qty,unit,price,cost,total}], total, received }
//   shopPayments { date, timestamp, shopId, shop, amount, method, note, billId? }  (method "Return" = items given back)
// These are NOT sales: they never appear in Sales Summary, Dashboard sales or Pending Payments.

export function shopSummary(id, shop, bills, pays) {
  const b = bills.filter(([, x]) => x.shopId === id);
  const p = pays.filter(([, x]) => x.shopId === id);
  const opening = Number(shop.openingBalance || 0);
  const given = b.reduce((a, [, x]) => a + Number(x.total || 0), 0);
  // Items returned by the shop are credited with method "Return" (from the Returns page); not cash.
  const received = p.filter(([, x]) => x.method !== "Return").reduce((a, [, x]) => a + Number(x.amount || 0), 0);
  const returned = p.filter(([, x]) => x.method === "Return").reduce((a, [, x]) => a + Number(x.amount || 0), 0);
  const last = b.reduce((m, [, x]) => ((x.date || "") > m ? x.date : m), "");
  const lastPay = p.filter(([, x]) => x.method !== "Return").reduce((m, [, x]) => ((x.date || "") > m ? x.date : m), "");
  return { bills: b, pays: p, opening, given, received, returned, remaining: opening + given - received - returned, last, lastPay };
}
