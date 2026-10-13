// Total Bill for a supplier (?id=...) or a shop (?type=shop&id=...).
// Each line: Remaining before  + Bill  − Paid  = Remaining after. New bills and payments appear automatically.
import './dialogs.js?v=55';
import { start, listen, showToast } from './common.js?v=55';
import { esc, fmt, formatDateDMY, todayString } from './utils.js?v=55';
import { supKey } from './supplierUtils.js?v=55';
import { buildStatement, statementTotals, saveStatementPdf, dayOf } from './partyUtils.js?v=55';

const el = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const pid = params.get("id") || "";
const SHOP = params.get("type") === "shop";
const CFG = SHOP
  ? { parties: "shops", bills: "shopBills", pays: "shopPayments", link: "billId", idField: "shopId", page: "shop.html", back: "Back to shop",
      labels: { title: "Total Bill", total: "Total Stock Given", paidTotal: "Total Received", remaining: "Remaining Amount", bill: "Bill", pay: "Received", payWord: "Received" },
      howto: "Each line: Remaining before, plus new stock given, minus money received, gives the Remaining Amount.", remNote: "Still to receive" }
  : { parties: "suppliers", bills: "purchases", pays: "supplierPayments", link: "purchaseId", idField: "supplierId", page: "supplier.html", back: "Back to supplier",
      labels: { title: "Total Bill", total: "Total Purchases", paidTotal: "Total Paid", remaining: "Remaining Cost", bill: "Bill", pay: "Paid" },
      howto: "Each line: Remaining Cost before, plus new bill, minus payment, gives the Remaining Cost after.", remNote: "Still to pay" };

let parties = [], bills = [], pays = [];
const loaded = { a: false, b: false, c: false };
let rows = [], party = null;

if (SHOP) {
  document.querySelectorAll(".side .nv.on").forEach((a) => { a.classList.remove("on"); a.removeAttribute("aria-current"); });
  const link = document.querySelector('.side a[href="shops.html"]');
  if (link) { link.classList.add("on"); link.setAttribute("aria-current", "page"); }
}
el("tb-back").href = pid ? `${CFG.page}?id=${encodeURIComponent(pid)}` : (SHOP ? "shops.html" : "suppliers.html");
el("tb-back-t").textContent = CFG.back;
el("tb-total-l").textContent = CFG.labels.total + " (Rs)";
el("tb-paid-l").textContent = CFG.labels.paidTotal + " (Rs)";
el("tb-rem-l").textContent = CFG.labels.remaining + " (Rs)";
el("tb-rem-n").textContent = CFG.remNote;
el("tb-howto").textContent = CFG.howto;

start((user) => {
  listen(user.uid, CFG.parties, (r) => { parties = r; loaded.a = true; render(); });
  listen(user.uid, CFG.bills, (r) => { bills = r; loaded.b = true; render(); });
  listen(user.uid, CFG.pays, (r) => { pays = r; loaded.c = true; render(); });
});

// Older supplier records only stored the name.
const mine = (rec) => (rec[CFG.idField] ? rec[CFG.idField] === pid : !SHOP && party && supKey(rec.supplier) === supKey(party.name));

function render() {
  if (!loaded.a || !loaded.b || !loaded.c) return;
  const r = parties.find((x) => x[0] === pid);
  el("tb-missing").hidden = !!r;
  el("tb-page").hidden = !r;
  if (!r) return;
  party = r[1];
  rows = buildStatement({ opening: Number(party.openingBalance || 0), openingDate: party.createdAt || "", bills: bills.filter(([, b]) => mine(b)), pays: pays.filter(([, p]) => mine(p)), linkField: CFG.link });
  const t = statementTotals(rows);
  const nb = rows.filter((x) => x.kind === "bill").length, np = rows.filter((x) => x.paid > 0).length;
  document.title = "Total Bill - " + party.name;
  el("tb-eyebrow").textContent = (SHOP ? "Shop" : "Supplier") + " · Total Bill";
  el("tb-name").textContent = party.name;
  el("tb-meta").textContent = [party.phone, party.address].filter(Boolean).join(" · ") || (SHOP ? "Shop" : "Supplier");
  const today = todayString();
  el("tb-asof").textContent = `${dayOf(today)}, ${formatDateDMY(today)}`;
  el("tb-total").textContent = fmt(t.bill);
  el("tb-total-n").textContent = `${nb} bill${nb === 1 ? "" : "s"}`;
  el("tb-paid").textContent = fmt(t.paid);
  const retd = rows.filter((x) => x.kind === "pay" && x.method === "Return").reduce((a, x) => a + x.paid, 0);
  el("tb-paid-n").textContent = `${np} payment${np === 1 ? "" : "s"}` + (retd ? ` · includes Rs ${fmt(retd)} items returned` : "");
  el("tb-rem").textContent = fmt(t.remaining);

  const cols = "40px 92px 96px minmax(220px,1.8fr) 130px 120px 120px 150px";
  el("tb-table").innerHTML = `<div class="head" style="grid-template-columns:${cols}"><span>#</span><span>Date</span><span>Day</span><span>Detail</span><span class="num">Remaining before</span><span class="num">${CFG.labels.bill}</span><span class="num">${CFG.labels.pay}</span><span class="num">${CFG.labels.remaining}</span></div>` +
    (rows.length ? rows.slice().reverse().map((e) => {
      const kind = e.kind === "pay" ? (SHOP ? (e.method === "Return" ? "Returned" : "Received") : "Payment") : e.kind === "open" ? "Old balance" : "Bill";
      return `<div class="row eq-row ${e.kind === "pay" ? "ledger-pay" : ""}" style="grid-template-columns:${cols}">
        <span class="num muted">${e.n}</span>
        <span class="num w500">${e.date ? formatDateDMY(e.date) : "—"}</span>
        <span class="muted">${e.day}</span>
        <span class="stk"><span class="ln"><span class="pill ${e.kind === "pay" ? "b-paid" : e.kind === "open" ? "cat-other" : "b-pend"}">${kind}</span>${e.billNo ? `<span class="muted" style="font-size:12px">No. ${esc(e.billNo)}</span>` : ""}${e.paid ? `<span class="muted" style="font-size:12px">${esc(e.method || "Cash")}</span>` : ""}</span><span class="ln" style="font-size:13px">${esc(e.detail)}</span></span>
        <span class="num muted">${fmt(e.prev)}</span>
        <span class="num">${e.bill ? fmt(e.bill) : '<span class="t-dim">—</span>'}</span>
        <span class="num t-green strong">${e.paid ? fmt(e.paid) : '<span class="t-dim">—</span>'}</span>
        <span class="num strong eq ${e.remaining > 0 ? "t-amber" : "t-green"}">${fmt(e.remaining)}</span>
      </div>`;
    }).join("")
    : '<div class="empty"><strong>No bills or payments yet</strong></div>');
}

el("tb-pdf").addEventListener("click", () => {
  if (!party) return;
  try {
    saveStatementPdf({ name: party.name, phone: party.phone || "", labels: CFG.labels, rows });
    showToast(el("toast"), `<span>PDF saved: ${esc(party.name)} - Total Bill - ${formatDateDMY(todayString())}.pdf (check your Downloads).</span>`);
  } catch (e) { alert("Could not make the PDF: " + e.message); }
});
