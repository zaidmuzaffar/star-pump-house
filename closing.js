import { confirmDialog } from './dialogs.js?v=55';
import { start, listen, ref, setDoc, showToast } from './common.js?v=55';
import { esc, fmt, formatDateDMY, todayString, toNumber, formatWithCommas, withButtonLock, paidAtSale } from './utils.js?v=55';

const el = (id) => document.getElementById(id);
let uid = null;
let sales = [], payments = [], returns = [], supplierPays = [], shopPays = [], closings = [], expenses = [];
let loadedToday = false, openingTouched = false;
const today = todayString();

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
el("c-eyebrow").textContent = "Galla · " + WEEKDAYS[new Date().getDay()] + " " + formatDateDMY(today);

// ---------- Note counter ----------
const DENOMS = [[5000, "Rs 5,000"], [1000, "Rs 1,000"], [500, "Rs 500"], [100, "Rs 100"], [50, "Rs 50"], [20, "Rs 20"], [10, "Rs 10"], [1, "Coins (Rs)"]];
el("c-notes").innerHTML = DENOMS.map(([v, label]) => `
  <label class="row cash-row" style="min-height:52px;cursor:text">
    <span><span class="note-chip n${v}">${label}</span></span>
    <span><input class="qin" type="text" inputmode="numeric" data-d="${v}" value="" placeholder="0" aria-label="Number of ${label}"></span>
    <span class="num strong" data-amt="${v}" style="text-align:right">0</span>
  </label>`).join("");

const moneyInputs = ["c-opening", "c-expenses", "c-owner"];
moneyInputs.forEach((id) => el(id).addEventListener("input", (e) => {
  e.target.value = formatWithCommas(e.target.value);
  if (id === "c-opening") openingTouched = true;
  compute();
}));
el("c-notes").addEventListener("input", (e) => {
  if (!e.target.dataset.d) return;
  e.target.value = e.target.dataset.d === "1" ? formatWithCommas(e.target.value) : String(toNumber(e.target.value) || "");
  compute();
});

start((user) => {
  uid = user.uid;
  listen(uid, "sales", (rows) => { sales = rows.map((r) => r[1]); compute(); });
  listen(uid, "payments", (rows) => { payments = rows.map((r) => r[1]); compute(); });
  listen(uid, "returns", (rows) => { returns = rows.map((r) => r[1]); compute(); });
  listen(uid, "supplierPayments", (rows) => { supplierPays = rows.map((r) => r[1]); compute(); });
  listen(uid, "shopPayments", (rows) => { shopPays = rows.map((r) => r[1]); compute(); });
  listen(uid, "expenses", (rows) => { expenses = rows.map((r) => r[1]); compute(); });
  listen(uid, "closings", (rows) => { closings = rows.map((r) => Object.assign({ id: r[0] }, r[1])); loadClosing(); compute(); renderHistory(); });
});

const sumToday = (arr, field) => arr.filter((x) => x.date === today).reduce((a, x) => a + Number(x[field] || 0), 0);

function loadClosing() {
  const mine = closings.find((c) => c.date === today);
  if (mine && !loadedToday) {
    loadedToday = true;
    el("c-opening").value = fmt(mine.opening);
    el("c-expenses").value = fmt(mine.expenses);
    el("c-owner").value = fmt(mine.ownerOut);
    el("c-note").value = mine.note || "";
    const counts = mine.counts || {};
    document.querySelectorAll("#c-notes [data-d]").forEach((i) => { const n = counts[i.dataset.d]; i.value = n ? (i.dataset.d === "1" ? fmt(n) : String(n)) : ""; });
    openingTouched = true;
  }
  if (!mine && !openingTouched) {
    const prev = closings.filter((c) => c.date < today).sort((a, b) => b.date.localeCompare(a.date))[0];
    el("c-opening").value = prev ? fmt(prev.counted) : "0";
    el("c-open-note").textContent = prev ? `(closing of ${formatDateDMY(prev.date)})` : "(type the cash you started with)";
  }
  const closed = !!mine;
  el("c-status").textContent = closed ? `Closed · ${formatDateDMY(today)}${mine.time ? " at " + mine.time : ""}` : "Open · not closed yet";
  el("c-status").classList.toggle("closed", closed);
  el("c-close").textContent = closed ? "Update today's closing" : "Close today's galla";
}

// Udhaar from a sale made TODAY and paid back today is counted with today's cash sales, not as a loan received.
function sameDayLoan(todays) {
  const keys = new Set(todays.map((s) => "t" + s.timestamp));
  return payments.filter((p) => p.date === today && keys.has(p.billKey)).reduce((a, p) => a + Number(p.amount || 0), 0);
}

function values() {
  const todays = sales.filter((s) => s.date === today);
  const v = {
    opening: toNumber(el("c-opening").value),
    cashSales: todays.reduce((a, s) => a + paidAtSale(s), 0) + sameDayLoan(todays),
    salesCount: todays.length,
    udhaarIn: sumToday(payments, "amount") - sameDayLoan(todays),
    shopIn: sumToday(shopPays.filter((p) => !p.method || p.method === "Cash"), "amount"),
    refunds: sumToday(returns, "refund"),
    supplierPaid: sumToday(supplierPays, "amount"),
    expenses: toNumber(el("c-expenses").value),
    bookExpenses: expenses.filter((x) => x.date === today && (!x.method || x.method === "Cash")).reduce((a, x) => a + Number(x.amount || 0), 0),
    ownerOut: toNumber(el("c-owner").value),
    counts: {}, counted: 0
  };
  v.expected = v.opening + v.cashSales + v.udhaarIn + v.shopIn - v.refunds - v.supplierPaid - v.bookExpenses - v.expenses - v.ownerOut;
  document.querySelectorAll("#c-notes [data-d]").forEach((i) => {
    const d = Number(i.dataset.d), n = toNumber(i.value);
    if (n) v.counts[d] = n;
    v.counted += d * n;
    el("c-notes").querySelector(`[data-amt="${d}"]`).textContent = fmt(d * n);
  });
  v.diff = v.counted - v.expected;
  return v;
}

function compute() {
  const v = values();
  el("c-sales").textContent = fmt(v.cashSales);
  el("c-sales-n").textContent = `(${v.salesCount} sale record${v.salesCount === 1 ? "" : "s"})`;
  el("c-udhaar").textContent = fmt(v.udhaarIn);
  el("c-shops").textContent = fmt(v.shopIn);
  el("c-refunds").textContent = fmt(v.refunds);
  el("c-suppliers").textContent = fmt(v.supplierPaid);
  el("c-book").textContent = fmt(v.bookExpenses);
  el("c-expected").textContent = "Rs " + fmt(v.expected);
  el("c-counted").textContent = "Rs " + fmt(v.counted);
  const kind = v.diff === 0 ? "ok" : v.diff < 0 ? "short" : "over";
  const box = el("c-result");
  box.className = "result " + kind;
  el("c-result-t").textContent = kind === "ok" ? "Cash matches" : kind === "short" ? "Cash is short" : "Extra cash in galla";
  el("c-result-s").textContent = `Expected Rs ${fmt(v.expected)} · Counted Rs ${fmt(v.counted)}`;
  el("c-diff").textContent = v.diff === 0 ? "Rs 0" : (v.diff > 0 ? "+ Rs " : "− Rs ") + fmt(Math.abs(v.diff));
}

el("c-close").addEventListener("click", (e) => withButtonLock(e.currentTarget, async () => {
  const v = values();
  if (v.counted === 0 && !(await confirmDialog({ title: "No cash counted", message: "You have not typed any notes. Close the galla with Rs 0 counted?", confirmLabel: "Close anyway" }))) return;
  try {
    await setDoc(ref(uid, "closings", today), {
      date: today, time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }), timestamp: Date.now(),
      opening: v.opening, cashSales: v.cashSales, udhaarIn: v.udhaarIn, shopIn: v.shopIn, refunds: v.refunds, supplierPaid: v.supplierPaid,
      expenses: v.expenses, bookExpenses: v.bookExpenses, ownerOut: v.ownerOut, expected: v.expected, counted: v.counted, diff: v.diff,
      counts: v.counts, note: el("c-note").value.trim()
    });
    loadedToday = true;
    showToast(el("toast"), `<span>Galla closed for ${formatDateDMY(today)}. ${v.diff === 0 ? "Cash matched." : v.diff < 0 ? "Short by Rs " + fmt(-v.diff) + "." : "Extra Rs " + fmt(v.diff) + "."}</span>`);
  } catch (error) { alert("Error saving closing: " + error.message); }
}));

function renderHistory() {
  const cols = "110px 1fr 1fr 1fr 1fr 120px minmax(160px,1.4fr)";
  const rows = closings.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  el("c-history").innerHTML = `<div class="head" style="grid-template-columns:${cols}"><span>Date</span><span class="num">Expected (Rs)</span><span class="num">Counted (Rs)</span><span class="num">Difference</span><span class="num">Expenses</span><span>Result</span><span>Note</span></div>` +
    rows.map((c) => {
      const d = Number(c.diff || 0), k = d === 0 ? "ok" : d < 0 ? "short" : "over";
      return `<div class="row" style="grid-template-columns:${cols};min-height:52px">
        <span class="num w500">${formatDateDMY(c.date)}</span>
        <span class="num">${fmt(c.expected)}</span>
        <span class="num">${fmt(c.counted)}</span>
        <span class="num strong" style="color:${k === "ok" ? "#1D5034" : k === "short" ? "#8E2A23" : "#7A4205"}">${d === 0 ? "0" : (d > 0 ? "+" : "−") + fmt(Math.abs(d))}</span>
        <span class="num muted">${fmt(Number(c.expenses || 0) + Number(c.bookExpenses || 0))}</span>
        <span><span class="pill ${k === "ok" ? "b-paid" : k === "short" ? "b-short" : "b-over"}">${k === "ok" ? "Matched" : k === "short" ? "Short" : "Over"}</span></span>
        <span class="muted" style="font-size:13px">${esc(c.note || "")}</span>
      </div>`;
    }).join("") +
    (rows.length ? "" : '<div class="empty"><strong>No closings yet</strong>Close the galla at the end of each day.</div>');
}

compute();
