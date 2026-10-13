import { start, listen, ref, updateDoc } from './common.js?v=55';
import { infoDialog, confirmDialog } from './dialogs.js?v=55';
import { changeSalePayment } from './custPay.js?v=55';
import { getShop, cachedShop, receiptFrom, saveReceiptPdf, whatsappReceipt, whatsappReceiptPdf } from './receipt.js?v=55';
let shownByKey = new Map();
const soldBy = (b) => [...new Set(b.docs.map((x) => x.soldBy).filter(Boolean))].join(", ");
import {
  esc, fmt, toNumber, todayString, isoFromDate, formatDateDMY, highlightMatch, attachNumberFormatting,
  attachAutoCapitalize, withButtonLock, remainingOf, receivedOf, saleCategory, saleQtyText, pillHtml, itemText, groupBills, withReturns, phoneKey, paidAtSale, daysAgoIso, inPeriodRange, PERIOD_LABEL, PERIOD_WORDS, periodRangeText, mergeSameDay
} from './utils.js?v=55';

const el = (id) => document.getElementById(id);
let uid = null;
let sales = [];      // [[id, data]]
let products = [];
let payments = [];
let returns = [];    // customer returns: cash refund / cut udhaar take the value off the sale   // udhaar received later (Pending Payments / Customers)
let period = "today", query = "", openId = null, editingId = null, selKey = null;

attachNumberFormatting(el("cust-contact"), false);
attachAutoCapitalize(el("cust-name"));

start((user) => {
  uid = user.uid;
  getShop(uid);
  listen(uid, "sales", (rows) => { sales = rows; render(); });
  listen(uid, "products", (rows) => { products = rows; render(); });
  listen(uid, "payments", (rows) => { payments = rows.map((r) => r[1]); render(); });
  listen(uid, "returns", (rows) => { returns = rows; render(); });
});


const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// Which group a sale date belongs to:
//   Today / Daily -> one group per day · Weekly -> last 30 days in blocks of 7 days (newest = this week) · Monthly / Overall -> per month
function groupOf(date) {
  const d = date || "";
  if (period === "week") {
    const ago = Math.floor((new Date(todayString() + "T00:00:00") - new Date(d + "T00:00:00")) / 86400000);
    const w = Math.max(0, Math.floor(ago / 7));
    const end = daysAgoIso(w * 7), start = daysAgoIso(Math.min(w * 7 + 6, 29));
    return { key: "w" + String(99 - w).padStart(2, "0"), label: w === 0 ? "This week" : w === 1 ? "Last week" : `${w} weeks ago`, sub: `${formatDateDMY(start)} to ${formatDateDMY(end)}` };
  }
  if (period === "month" || period === "all") return { key: d.slice(0, 7), label: `${MONTH_FULL[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`, sub: "" };
  const wd = new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });
  return { key: d, label: formatDateDMY(d), sub: wd };
}

function inPeriod(s) { return inPeriodRange(period, s.date); }

function render() {
  const byName = {};
  products.forEach(([, p]) => { byName[p.name || p.size] = p.category; });
  const q = query.trim().toLowerCase();
  const list = withReturns(sales, returns).filter(([, s]) => inPeriod(s))
    .sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));

  const total = list.reduce((a, [, s]) => a + s.amount, 0);
  const pend = list.reduce((a, [, s]) => a + remainingOf(s), 0);
  const bills = groupBills(list);
  // Received = cash taken at the time of the sale (after refunds). Udhaar paid back later is NOT sales money:
  // it shows only in "Loan received" (and in Cash Closing on the day it came in).
  // Udhaar paid on the SAME day as the sale counts as that sale's cash (it is not a "loan received").
  bills.forEach((b) => {
    const sameDay = payments.filter((p) => p.billKey === b.key && p.date === b.date).reduce((a, p) => a + Number(p.amount || 0), 0);
    const atSale = b.docs.reduce((a, d) => a + Math.max(0, paidAtSale(d) - Number(d.refunded || 0)), 0);
    b.cashAtSale = Math.min(Math.max(0, b.amount - b.remaining), atSale + sameDay);
    b.sameDayPaid = sameDay;
    b.paidLater = Math.max(0, b.amount - b.remaining - b.cashAtSale);
  });
  const unpaid = bills.filter((b) => b.remaining > 0).length;
  const rec = bills.reduce((a, b) => a + b.cashAtSale, 0);
  const items = list.reduce((a, [, s]) => a + Math.max(0, (Number(s.quantity) || 1) - (s.lengthFt ? 0 : Number(s.returnedQty2 || 0))), 0);
  const retVal = list.reduce((a, [, s]) => a + Number(s.returnedValue || 0), 0);
  const retCount = list.reduce((a, [, s]) => a + Number(s.returnCount || 0), 0);

  el("sales-eyebrow").textContent = PERIOD_LABEL[period] + " · " + (period === "all" ? "up to " + formatDateDMY(todayString()) : periodRangeText(period));
  el("k-total").textContent = fmt(total);
  el("k-total-note").textContent = `${bills.length} sale${bills.length === 1 ? "" : "s"}` + (retVal ? ` · Rs ${fmt(retVal)} returned (taken off)` : retCount ? ` · ${retCount} exchange${retCount === 1 ? "" : "s"}` : "");
  el("k-received").textContent = fmt(rec);
  el("k-received-note").textContent = "Cash taken at the time of sale";
  renderLoans();
  el("k-pending").textContent = fmt(pend);
  el("k-pending-note").textContent = `${unpaid} unpaid · open Pending Payments`;
  el("k-items").textContent = fmt(items);

  document.querySelectorAll("#period-seg [data-period]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.period === period)));

  // Grouped totals: by day (Today / Weekly), by week (Monthly), by month (Overall)
  const groups = {};
  bills.forEach((b) => {
    const g = groupOf(b.date);
    const d = groups[g.key] || (groups[g.key] = Object.assign({ count: 0, items: 0, rec: 0, pend: 0, total: 0 }, g));
    d.count++; d.items += b.docs.reduce((a, s) => a + Math.max(0, (Number(s.quantity) || 1) - (s.lengthFt ? 0 : Number(s.returnedQty2 || 0))), 0); d.rec += b.cashAtSale; d.pend += b.remaining; d.total += b.amount;
  });
  const gcols = "minmax(200px,1.4fr) 100px 100px minmax(140px,1fr) minmax(140px,1fr) minmax(140px,1fr)";
  const gkeys = Object.keys(groups).sort().reverse();
  const first = { today: "Date", daily: "Date", week: "Week", month: "Month", all: "Month" }[period];
  el("grp-title").textContent = { today: "Today", daily: "Day by day", week: "Week by week", month: "Month by month", all: "Month by month" }[period];
  el("grp-sub").textContent = "Totals for the selected period · click a row to jump to its sales above";
  el("byday-table").innerHTML = `<div class="head" style="grid-template-columns:${gcols}"><span>${first}</span><span class="num">Sales</span><span class="num">Items</span><span class="num">Received (Rs)</span><span class="num">Pending (Rs)</span><span class="num">Total (Rs)</span></div>` +
    (gkeys.length ? gkeys.map((k) => { const d = groups[k]; return `<div class="row clickable${selKey === k ? " sel" : ""}" data-gkey="${k}" data-glabel="${esc(d.label)}" data-gsub="${esc(d.sub || "")}" style="grid-template-columns:${gcols};min-height:48px">
      <span class="w500">${esc(d.label)}${d.sub ? ` <span class="muted" style="font-weight:400;font-size:12px">${esc(d.sub)}</span>` : ""}</span><span class="num">${d.count}</span><span class="num">${fmt(d.items)}</span>
      <span class="num t-green">${fmt(d.rec)}</span><span class="num ${d.pend > 0 ? "t-amber" : "t-dim"}">${fmt(d.pend)}</span><span class="num strong">${fmt(d.total)}</span></div>`; }).join("")
      + `<div class="row" style="grid-template-columns:${gcols};min-height:48px;background:#F8F9F7"><span class="strong">Total</span><span class="num strong">${bills.length}</span><span class="num strong">${fmt(items)}</span><span class="num strong t-green">${fmt(rec)}</span><span class="num strong ${pend > 0 ? "t-amber" : "t-dim"}">${fmt(pend)}</span><span class="num strong">${fmt(total)}</span></div>`
      : '<div class="empty"><strong>No sales in this period</strong>Sell a product from the Stock List.</div>');

  // Sales table: one row per customer bill (several items on one line)
  const cols = "88px minmax(124px,1.1fr) 112px minmax(150px,1.5fr) 96px 64px 106px 100px 100px";
  const qs = query.trim();
  // Same customer, same day -> one entry; each bill is still shown on its own inside it (Bill 1, Bill 2 …).
  const shown = mergeSameDay(bills).filter((b) => !q || [b.customerName, b.customerContact, ...b.docs.map((s) => s.productName || "")].join(" ").toLowerCase().includes(q));
  shownByKey = new Map(shown.map((b) => [b.key, b]));
  const many = (b) => b.parts.length > 1;
  // item-side columns: with several bills, each bill gets a small "Bill n · time · Rs" line, then its items
  const perBill = (b, fItem, fHead) => many(b) ? b.parts.flatMap((p, i) => [...p.docs.map(fItem), fHead(p, i)]) : b.docs.map(fItem);
  const lines = (arr) => `<span class="stk">${arr.map((x) => `<span class="ln">${x}</span>`).join("")}</span>`;
  el("sales-table").innerHTML = `<div class="head" style="grid-template-columns:${cols}"><span>Date</span><span>Customer</span><span>Contact</span><span>Item</span><span>Category</span><span class="num">Qty</span><span class="num">Total (Rs)</span><span class="num">Received</span><span class="num">Remaining</span></div>` +
    (shown.length ? dayBox(shown, (b) => {
      const one = (x) => `<span class="stk"><span class="ln">${x}</span></span>`;
      const inSel = selKey && groupOf(b.date).key === selKey;
      return `<div class="row bill clickable${b.returnCount ? " ret-row" : b.remaining > 0 ? " due-row" : ""}${selKey && !inSel ? " dim" : ""}" data-id="${b.key}" style="grid-template-columns:${cols}">
        <span class="num muted stk"><span class="ln">${formatDateDMY(b.date)}</span></span>
        <span class="stk"><span class="ln"><span class="w500">${b.customerName ? highlightMatch(b.customerName, qs) : '<span class="t-dim">—</span>'}</span></span>${soldBy(b) ? `<span class="sold-by">by ${esc(soldBy(b))}</span>` : ""}</span>
        <span class="num muted stk" style="font-size:13px"><span class="ln">${b.customerContact ? highlightMatch(phoneKey(b.customerContact) || b.customerContact, qs) : "—"}</span></span>
        ${lines(perBill(b, (s) => highlightMatch(s.productName, qs), (p, i) => `<span class="bill-tag">Bill ${i + 1} · ${esc(p.time || "")} · Rs ${fmt(p.amount)}${p.remaining > 0 ? ` · <span class="t-amber">Rs ${fmt(p.remaining)} due</span>` : ""}</span>`))}
        ${lines(perBill(b, (s) => pillHtml(saleCategory(s, byName)), () => '<span class="bill-tag-gap"></span>'))}
        <span class="num stk">${perBill(b, (s) => esc(saleQtyText(s)), () => '<span class="bill-tag-gap"></span>').map((x) => `<span class="ln">${x}</span>`).join("")}</span>
        <span class="num strong stk"><span class="ln">${fmt(b.amount)}</span>${many(b) ? `<span class="ln bills-note">${b.parts.length} bills</span>` : ""}${b.returnCount ? `<span class="ret-note">${b.returnedValue ? "Rs " + fmt(b.returnedValue) + " returned" : "Exchanged"}</span>` : ""}</span>
        <span class="num t-green stk"><span class="ln">${fmt(b.cashAtSale)}</span>${b.paidLater ? `<span class="later-note">Rs ${fmt(b.paidLater)} paid later</span>` : ""}</span>
        <span class="num ${b.remaining > 0 ? "t-amber" : "t-dim"} stk"><span class="ln">${fmt(b.remaining)}</span></span>
      </div>` + (openId === b.key ? `<div class="row-panel" style="justify-content:flex-start"><button type="button" class="btn sec" data-act="edit" data-id="${b.key}">Edit customer</button><button type="button" class="btn sec" data-act="payfix" data-id="${b.key}">Change payment (Cash / Loan)</button><button type="button" class="btn sec" data-act="receipt" data-id="${b.key}">Receipt (PDF)</button><button type="button" class="btn sec" data-act="wa" data-id="${b.key}">Send on WhatsApp</button></div>` : "");
    }) : '<div class="empty"><strong>No sales match</strong>No sales match your search in this period.</div>');
}

// The picked day / week / month: its sales sit together inside one framed box with a summary strip on top.
// Rows keep their own colours (red = returned, orange = still pending); other rows fade a little.
function dayBox(list, rowHtml) {
  if (!selKey) return list.map(rowHtml).join("");
  const inSel = (b) => groupOf(b.date).key === selKey;
  const picked = list.filter(inSel);
  if (!picked.length) return list.map(rowHtml).join("");
  const g = groupOf(picked[0].date);
  const sum = (f) => picked.reduce((a, b) => a + f(b), 0);
  const tot = sum((b) => b.amount), rec = sum((b) => b.cashAtSale), pend = sum((b) => b.remaining), ret = sum((b) => b.returnedValue || 0);
  const head = `<div class="day-box-head">
      <span class="dbh-title">${esc(g.label)}${g.sub ? ` <small>${esc(g.sub)}</small>` : ""}</span>
      <button type="button" class="dbh-x" data-act="clear-day">Show all ✕</button>
      <span class="dbh-stat">${picked.length} sale${picked.length === 1 ? "" : "s"}</span>
      <span class="dbh-stat">Total <b>Rs ${fmt(tot)}</b></span>
      <span class="dbh-stat">Received <b>Rs ${fmt(rec)}</b></span>
      ${pend ? `<span class="dbh-stat pend">Pending <b>Rs ${fmt(pend)}</b></span>` : ""}
      ${ret ? `<span class="dbh-stat ret">Returned <b>Rs ${fmt(ret)}</b></span>` : ""}
    </div>`;
  let html = "", open = false;
  list.forEach((b) => {
    const s = inSel(b);
    if (s && !open) { html += `<div class="day-box" id="day-box">${head}`; open = true; }
    if (!s && open) { html += "</div>"; open = false; }
    html += rowHtml(b);
  });
  return html + (open ? "</div>" : "");
}

// ---------- Loan received: old udhaar paid back in this period ----------
function renderLoans() {
  const PERIOD = PERIOD_WORDS[period];
  // pay-back on the same day as the sale is part of that sale (Cash received), not a loan received
  const saleDate = new Map(groupBills(sales).map((b) => [b.key, b.date]));
  const list = payments.filter((p) => inPeriod(p) && !(p.billKey && saleDate.get(p.billKey) === p.date)).sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.timestamp || 0) - (a.timestamp || 0));
  const total = list.reduce((a, p) => a + Number(p.amount || 0), 0);
  el("k-loan").textContent = fmt(total);
  el("k-loan-note").textContent = list.length ? `${list.length} payment${list.length === 1 ? "" : "s"} ${PERIOD} · not in sales` : `Nothing received ${PERIOD}`;
  el("loan-sub").textContent = `Old udhaar customers paid back ${PERIOD}. This is not a sale: it is not added to Total sales; Cash Closing counts it as cash in on the day it came.`;
  const byId = new Map(sales.map(([id, s]) => [id, s]));
  const cols = "96px minmax(150px,1.2fr) 118px minmax(200px,1.6fr) 130px 120px";
  el("loan-table").innerHTML = `<div class="head" style="grid-template-columns:${cols}"><span>Received on</span><span>Customer</span><span>Contact</span><span>For the sale of</span><span>Note</span><span class="num">Amount (Rs)</span></div>` +
    (list.length ? list.map((p) => {
      const docs = (p.saleIds || []).map((id) => byId.get(id)).filter(Boolean);
      const forSale = docs.length ? `${formatDateDMY(docs[0].date)} · ${docs.map((d) => esc(itemText(d))).join(", ")}` : '<span class="t-dim">—</span>';
      const day = p.date ? new Date(p.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" }) : "";
      return `<div class="row loan-row" style="grid-template-columns:${cols}">
        <span class="stk"><span class="num w500">${formatDateDMY(p.date)}</span><span class="muted" style="font-size:12px">${day}</span></span>
        <span class="w500">${esc(p.customerName || "—")}</span>
        <span class="num muted" style="font-size:13px">${esc(phoneKey(p.customerContact) || p.customerContact || "—")}</span>
        <span style="font-size:13px">${forSale}</span>
        <span class="muted" style="font-size:13px">${esc(p.note || "Udhaar payment")}</span>
        <span class="num strong t-teal">${fmt(p.amount)}</span>
      </div>`; }).join("") +
      `<div class="row" style="grid-template-columns:${cols};background:#F8F9F7"><span class="strong">Total</span><span></span><span></span><span></span><span></span><span class="num strong t-teal">${fmt(total)}</span></div>`
      : `<div class="empty"><strong>No loan received ${PERIOD}</strong>When a customer pays old udhaar (Customers or Pending Payments), it shows here.</div>`);
}

el("period-seg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-period]");
  if (!b) return;
  period = b.dataset.period; openId = null; selKey = null; render();
});
el("byday-table").addEventListener("click", (e) => {
  const row = e.target.closest("[data-gkey]");
  if (!row) return;
  selKey = selKey === row.dataset.gkey ? null : row.dataset.gkey;
  render();
  if (selKey) {
    const target = el("day-box");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
    else {
      // searching a name and this day has none of their sales: say it plainly, in the site's own popup
      const nb = (t) => t.replace(/-/g, "\u2011");   // dates never break across two lines
      const lab = nb(row.dataset.glabel || ""), sub = nb(row.dataset.gsub || "");
      const when = period === "week" ? `during ${lab.toLowerCase()}${sub ? ` (${sub})` : ""}`
        : (period === "month" || period === "all") ? `in ${lab}` : `on ${sub ? sub + ", " : ""}${lab}`;
      const who = query.trim();
      const unit = period === "week" ? "week" : (period === "month" || period === "all") ? "month" : "day";
      selKey = null; render();
      infoDialog({
        title: (who ? "Nothing bought " : "No sales ") + (unit === "day" ? "on this day" : "this " + unit),
        message: who ? `"${who}" did not buy anything ${when}. Clear the search to see all the sales of this ${unit}.` : `There are no sales to show ${when}.`
      });
    }
  }
});
el("sales-search").addEventListener("input", (e) => { query = e.target.value; render(); });

el("sales-table").addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]");
  if (act) {
    const id = act.dataset.id;
    if (act.dataset.act === "edit") openEdit(id);
    if (act.dataset.act === "payfix") openPayFix(id);
    if (act.dataset.act === "receipt" || act.dataset.act === "wa") {
      const b = shownByKey.get(id); if (!b) return;
      const r = receiptFrom(b);
      if (act.dataset.act === "wa") openWa(r); else saveReceiptPdf(cachedShop(), r);
    }
    if (act.dataset.act === "clear-day") { selKey = null; render(); }
    return;
  }
  const row = e.target.closest(".row[data-id]");
  if (row) { openId = openId === row.dataset.id ? null : row.dataset.id; if (openId) getShop(uid); render(); }
});

// key can be one bill ("t123") or a same-day entry ("t123,t456"): editing changes every bill in it
const billIds = (key) => { const ks = key.split(","); return groupBills(sales).filter((b) => ks.includes(b.key)).flatMap((b) => b.ids); };

function openEdit(key) {
  const bill = groupBills(sales).find((b) => key.split(",").includes(b.key));
  if (!bill) return;
  editingId = key;
  el("cust-name").value = bill.customerName || "";
  el("cust-contact").value = bill.customerContact || "";
  el("cust-modal").classList.add("active");
}
el("cust-cancel").addEventListener("click", () => { el("cust-modal").classList.remove("active"); editingId = null; });
el("cust-save").addEventListener("click", (e) => withButtonLock(e.currentTarget, async () => {
  if (!editingId) return;
  try {
    const patch = { customerName: el("cust-name").value.trim(), customerContact: el("cust-contact").value };
    await Promise.all(billIds(editingId).map((id) => updateDoc(ref(uid, "sales", id), patch)));
    el("cust-modal").classList.remove("active"); editingId = null;
  } catch (error) { alert("Error updating customer: " + error.message); }
}));

// ---------- Change payment: a sale saved as Cash by mistake that was on Loan (or the other way) ----------
attachNumberFormatting(el("payfix-amt"), true);
let fix = null;   // { key, rows, total, logged, cuts, max, mode, paid }
function openPayFix(key) {
  const ks = key.split(",");
  const parts = groupBills(sales).filter((b) => ks.includes(b.key));
  if (!parts.length) return;
  const ids = new Set(parts.flatMap((b) => b.ids));
  const rows = sales.filter(([id]) => ids.has(id));
  const total = rows.reduce((a, [, s]) => a + Number(s.amount || 0), 0);
  const logged = payments.filter((p) => ks.includes(p.billKey) || (p.saleIds || []).some((x) => ids.has(x))).reduce((a, p) => a + Number(p.amount || 0), 0);
  const cuts = returns.map((r) => r[1]).filter((r) => r.source !== "shop" && ids.has(r.saleId)).reduce((a, r) => a + Number(r.udhaarCut || 0), 0);
  const max = Math.max(0, total - logged - cuts);
  const nowPaid = Math.min(max, rows.reduce((a, [, s]) => a + paidAtSale(s), 0));
  fix = { key, rows, total, logged, cuts, max, paid: nowPaid, mode: nowPaid >= max ? "cash" : nowPaid <= 0 ? "loan" : "part" };
  const b0 = parts[0];
  el("payfix-sub").textContent = [b0.customerName || "Walk-in customer", formatDateDMY(b0.date)].join(" · ");
  el("payfix-items").innerHTML = rows.map(([, s]) => `<div class="crb" style="background:#fff"><span class="num muted">${formatDateDMY(s.date)}</span><span class="crb-items">${esc(itemText(s))}</span><span class="num strong">Rs ${fmt(s.amount)}</span></div>`).join("");
  showFix();
  el("payfix-modal").classList.add("active");
}
function showFix() {
  document.querySelectorAll("#payfix-mode [data-m]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.m === fix.mode)));
  if (fix.mode === "loan") fix.paid = 0;
  if (fix.mode === "cash") fix.paid = fix.max;
  el("payfix-amt-wrap").hidden = fix.mode !== "part";
  el("payfix-amt").value = fmt(fix.paid);
  preview();
}
function preview() {
  const udhaar = fix.max - fix.paid;
  el("payfix-preview").innerHTML = `<div><span>Bill total</span><b class="num">Rs ${fmt(fix.total)}</b></div>`
    + (fix.cuts ? `<div><span>Taken off by returns</span><b class="num">Rs ${fmt(fix.cuts)}</b></div>` : "")
    + (fix.logged ? `<div><span>Udhaar already paid back later</span><b class="num t-green">Rs ${fmt(fix.logged)}</b></div>` : "")
    + `<div><span>Paid at the time of sale</span><b class="num t-green">Rs ${fmt(fix.paid)}</b></div>`
    + `<div class="after"><span>Udhaar (goes to Pending Payments)</span><b class="num ${udhaar > 0 ? "t-amber" : "t-green"}">Rs ${fmt(udhaar)}</b></div>`;
}
el("payfix-mode").addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (!b || !fix) return; fix.mode = b.dataset.m; if (fix.mode === "part" && (fix.paid <= 0 || fix.paid >= fix.max)) fix.paid = 0; showFix(); if (fix.mode === "part") el("payfix-amt").focus(); });
el("payfix-amt").addEventListener("input", () => { if (!fix) return; let v = toNumber(el("payfix-amt").value); if (v > fix.max) { v = fix.max; el("payfix-amt").value = fmt(v); } fix.paid = v; preview(); });
const closeFix = () => { el("payfix-modal").classList.remove("active"); fix = null; };
el("payfix-cancel").addEventListener("click", closeFix);
el("payfix-close").addEventListener("click", closeFix);
el("payfix-save").addEventListener("click", (e) => withButtonLock(e.currentTarget, async () => {
  if (!fix) return;
  const name = fix.rows[0][1].customerName;
  if (fix.paid < fix.max && !name && !(await confirmLoanNoName())) return;
  try {
    const r = await changeSalePayment(uid, fix.rows, fix.paid, { logged: fix.logged, cuts: fix.cuts });
    closeFix();
    infoDialog({ title: "Payment changed", message: r.udhaar > 0 ? `Rs ${fmt(r.udhaar)} is now udhaar${name ? " for " + name : ""}. It shows in Pending Payments and Customers.` : "The sale is now fully paid." });
  } catch (error) { alert("Error: " + error.message); }
}));
function confirmLoanNoName() {
  return confirmDialog({ title: "No customer name", message: "This sale has no customer name, so the udhaar will show without a name. Save anyway? (You can add the name with Edit customer.)", confirmLabel: "Save anyway" });
}

// ---------- Send on WhatsApp: PDF or text ----------
let waReceipt = null;
function openWa(r) {
  waReceipt = r;
  el("wa-sub").textContent = [r.customer || "Walk-in customer", r.phone || "no number", formatDateDMY(r.date)].join(" · ");
  el("wa-note").hidden = true;
  el("wa-modal").classList.add("active");
}
const closeWa = () => { el("wa-modal").classList.remove("active"); waReceipt = null; };
el("wa-close").addEventListener("click", closeWa);
el("wa-modal").addEventListener("click", async (e) => {
  if (e.target === e.currentTarget) return closeWa();
  const b = e.target.closest("[data-wa]"); if (!b || !waReceipt) return;
  const r = waReceipt;
  if (b.dataset.wa === "text") { whatsappReceipt(cachedShop(), r); closeWa(); return; }
  const how = await whatsappReceiptPdf(cachedShop(), r);
  if (how === "downloaded") {
    el("wa-note").hidden = false;
    el("wa-note").textContent = "The PDF is downloaded and the customer's WhatsApp chat is opening. Attach the PDF there (📎) from Downloads.";
    setTimeout(closeWa, 6000);
  } else closeWa();
});
