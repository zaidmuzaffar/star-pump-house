// Udhaar (credit) payments from customers. Used by Pending Payments and Customers,
// so a payment saved in one place shows the same everywhere (Sales Summary reads the same sale records).
import { col, ref, updateDoc, addDoc } from './common.js?v=55';
import { todayString } from './utils.js?v=55';

// Sets the remaining amount of a whole bill; the amount is split across its items in proportion to each item's total.
// Money collected is logged in "payments" (Customers, Cash Closing and Sales Summary read it).
export async function setBillRemaining(uid, bill, value, { log = true, note = "" } = {}) {
  const rem = Math.min(Math.max(0, value), bill.amount);
  const collected = bill.remaining - rem;
  let left = rem;
  await Promise.all(bill.ids.map((id, i) => {
    const amount = bill.docs[i].amount;
    const share = i === bill.ids.length - 1 ? left : Math.min(amount, Math.round(rem * amount / bill.amount));
    const r = Math.min(Math.max(0, share), amount);
    left -= r;
    const patch = r <= 0
      ? { remainingCost: 0, received: amount, status: "received" }
      : { remainingCost: r, received: amount - r, status: "pending" };
    return updateDoc(ref(uid, "sales", id), patch);
  }));
  if (log && collected > 0) {
    await addDoc(col(uid, "payments"), {
      date: todayString(), timestamp: Date.now(), amount: collected,
      customerName: bill.customerName || "", customerContact: bill.customerContact || "",
      billKey: bill.key, saleIds: bill.ids, note: note || (rem === 0 ? "Paid in full" : "Part payment")
    });
  }
  return collected;
}

// One amount from a customer, used to clear their open bills oldest first.
export async function receiveFromCustomer(uid, openBills, amount) {
  let left = Math.max(0, amount);
  const bills = openBills.filter((b) => b.remaining > 0).sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.timestamp - b.timestamp);
  for (const b of bills) {
    if (left <= 0) break;
    const take = Math.min(left, b.remaining);
    await setBillRemaining(uid, b, b.remaining - take, { note: take === b.remaining ? "Paid in full (Customers)" : "Part payment (Customers)" });
    left -= take;
  }
  return amount - left;
}

// Fix how a sale was paid AT THE TIME OF SALE (e.g. saved as Cash by mistake but it was on Loan, or the other way).
// rows: the sale records [[id, data]] of the bill(s); paid: cash really taken at the sale.
// Udhaar paid back later and udhaar cut by returns are kept; the rest becomes udhaar (Pending Payments).
// This is a correction, not a payment: nothing is added to "payments", so Cash Closing / Loan received stay right.
export async function changeSalePayment(uid, rows, paid, { logged = 0, cuts = 0 } = {}) {
  const total = rows.reduce((a, [, s]) => a + Number(s.amount || 0), 0);
  const maxPaid = Math.max(0, total - logged - cuts);
  const p = Math.min(Math.max(0, paid), maxPaid);
  const rem = maxPaid - p;
  let leftPaid = p, leftRem = rem;
  await Promise.all(rows.map(([id, s], i) => {
    const amount = Number(s.amount || 0), last = i === rows.length - 1;
    const share = (v) => (total > 0 ? Math.round(v * amount / total) : 0);
    const pi = last ? leftPaid : Math.min(amount, share(p));
    const ri = Math.min(amount, Math.max(0, last ? leftRem : share(rem)));
    leftPaid -= pi; leftRem -= ri;
    return updateDoc(ref(uid, "sales", id), {
      paidAtSale: pi, received: amount - ri, remainingCost: ri,
      paymentType: p < total ? "credit" : "cash", status: ri > 0 ? "pending" : "received"
    });
  }));
  return { total, paid: p, udhaar: rem };
}
