import './dialogs.js?v=55';
import { start, listen } from './common.js?v=55';
import { CATEGORY_LABELS, CATEGORY_ORDER, esc, fmt, formatDateDMY, todayString, daysAgoIso, saleCategory, saleUnits, saleUnitName, pillHtml, inPeriodRange, PERIOD_LABEL, periodRangeText } from './utils.js?v=55';

const el = (id) => document.getElementById(id);
let sales = [], returns = [], closings = [], products = [], expenseRows = [];
let period = "month";   // today | daily | week | month | all

start((user) => {
  listen(user.uid, "sales", (rows) => { sales = rows.map((r) => r[1]); render(); });
  listen(user.uid, "returns", (rows) => { returns = rows.map((r) => r[1]); render(); });
  listen(user.uid, "closings", (rows) => { closings = rows.map((r) => r[1]); render(); });
  listen(user.uid, "products", (rows) => { products = rows; render(); });
  listen(user.uid, "expenses", (rows) => { expenseRows = rows.map((r) => r[1]); render(); });
});

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const BAR = { pump: "#0E6A8C", wire: "#C2771F", safety_cable: "#2F8F5B", other: "#5D6B78" };
const LOW_MARGIN = 15; // % — below this the margin is shown in amber

// Today = today · Daily = last 7 days · Weekly = last 30 days · Monthly = last 12 months · Overall = everything
function inRange(date) { return inPeriodRange(period, date); }
function rangeText() { return PERIOD_LABEL[period] + (period === "all" ? "" : " · " + periodRangeText(period)); }

const pct = (profit, salesAmt) => (salesAmt > 0 ? Math.round(profit / salesAmt * 1000) / 10 : 0);

function render() {
  document.querySelectorAll("#period-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.p === period)));
  el("range").textContent = "Accounts · " + rangeText();

  const productsByName = {};
  products.forEach(([, p]) => { productsByName[p.name] = p.category; });

  const inPeriod = sales.filter((s) => inRange(s.date) && Number(s.amount) > 0);
  const counted = inPeriod.filter((s) => Number(s.cost) > 0);
  const missing = inPeriod.length - counted.length;

  // Per item
  const items = new Map();
  const item = (name, cat) => {
    let it = items.get(name);
    if (!it) { it = { name, cat, qty: 0, unit: "pcs", sales: 0, cost: 0 }; items.set(name, it); }
    return it;
  };
  counted.forEach((s) => {
    const it = item(s.productName, saleCategory(s, productsByName));
    it.qty += saleUnits(s); it.unit = saleUnitName(s);
    it.sales += Number(s.amount); it.cost += Number(s.cost);
  });
  let returnedValue = 0;
  returns.filter((r) => inRange(r.date) && Number(r.cost) > 0).forEach((r) => {
    const it = item(r.productName, r.category);
    it.qty -= Number(r.qty || 0);
    it.sales -= Number(r.value || 0);
    returnedValue += Number(r.value || 0);
    if (r.stockUpdated) it.cost -= Number(r.cost); // damaged items stay as a loss
  });
  const rows = [...items.values()].map((it) => Object.assign(it, { profit: it.sales - it.cost, margin: pct(it.sales - it.cost, it.sales) }))
    .filter((it) => it.sales !== 0 || it.cost !== 0);

  const S = rows.reduce((a, r) => a + r.sales, 0), C = rows.reduce((a, r) => a + r.cost, 0), P = S - C;
  el("k-sales").textContent = fmt(S);
  el("k-items").textContent = `${counted.length} sale record${counted.length === 1 ? "" : "s"} counted`;
  el("k-cost").textContent = fmt(C);
  el("k-profit").textContent = (P < 0 ? "−" : "") + fmt(Math.abs(P));
  el("k-margin").textContent = pct(P, S) + "%";

  // Expenses page + the "other small expenses" typed in Cash Closing
  const booked = expenseRows.filter((x) => inRange(x.date)).reduce((a, x) => a + Number(x.amount || 0), 0);
  const small = closings.filter((c) => inRange(c.date)).reduce((a, c) => a + Number(c.expenses || 0), 0);
  const expenses = booked + small;
  const net = P - expenses;
  el("k-net").textContent = (net < 0 ? "−" : "") + fmt(Math.abs(net));
  el("k-net").style.color = net < 0 ? "#A3322A" : "#1D5034";
  el("k-net-s").textContent = `Gross profit − Rs ${fmt(expenses)} expenses`;
  el("netline").innerHTML = `<span>Expenses: <b>Rs ${fmt(expenses)}</b> <a class="link" href="expenses.html" style="font-size:13px">see</a></span><span>Net profit: <b style="color:${net >= 0 ? "#1D5034" : "#A3322A"}">${net < 0 ? "−" : ""}Rs ${fmt(Math.abs(net))}</b></span>${returnedValue ? `<span>Returns taken out: <b>Rs ${fmt(returnedValue)}</b></span>` : ""}`;

  const warn = el("missing");
  warn.hidden = missing === 0;
  el("missing-text").textContent = missing
    ? `${missing} sale record${missing === 1 ? " has" : "s have"} no cost price, so ${missing === 1 ? "it is" : "they are"} not counted here. Add a Cost price to your products (Stock List → Edit, or a Purchase bill). New sales will then be counted.`
    : "";

  // Categories
  const cats = CATEGORY_ORDER.map((k) => {
    const m = rows.filter((r) => r.cat === k);
    const sa = m.reduce((a, r) => a + r.sales, 0), co = m.reduce((a, r) => a + r.cost, 0);
    return { k, sales: sa, cost: co, profit: sa - co };
  }).filter((c) => c.sales > 0);
  const maxP = Math.max(1, ...cats.map((c) => c.profit));
  el("cats").innerHTML = cats.length ? cats.map((c) => `
    <div class="cbar">
      <div class="cbar-top"><span style="font-weight:600">${CATEGORY_LABELS[c.k]}</span><span class="num"><b>Rs ${fmt(c.profit)}</b> <span class="muted">· ${pct(c.profit, c.sales)}%</span></span></div>
      <div class="track"><span style="width:${Math.max(3, Math.round(Math.max(0, c.profit) / maxP * 100))}%;background:${BAR[c.k]}"></span></div>
      <span class="muted" style="font-size:12px">Sales Rs ${fmt(c.sales)} · Cost Rs ${fmt(c.cost)}</span>
    </div>`).join("")
    : '<div class="empty" style="padding:24px 0"><strong>Nothing to show</strong>No sales with a cost price in this period.</div>';

  // Quick look
  const live = rows.filter((r) => r.sales > 0);
  const byProfit = live.slice().sort((a, b) => b.profit - a.profit);
  const byMargin = live.slice().sort((a, b) => b.margin - a.margin);
  const look = (cls, title, r, line) => r ? `<div class="look ${cls}"><span class="t">${title}</span><span class="n">${esc(r.name)}</span><span class="d">${line(r)}</span></div>` : "";
  el("looks").innerHTML = live.length
    ? look("g", "Most profit", byProfit[0], (r) => `Rs ${fmt(r.profit)} profit · ${r.margin}% margin`) +
      look("b", "Best margin", byMargin[0], (r) => `${r.margin}% margin · Rs ${fmt(r.profit)}`) +
      (live.length > 1 ? look("a", "Lowest margin · check price", byMargin[byMargin.length - 1], (r) => `${r.margin}% margin · Rs ${fmt(r.profit)}`) : "")
    : '<div class="empty" style="padding:24px 0"><strong>No data yet</strong></div>';

  // Items table
  const cols = "minmax(220px,1.6fr) 130px 100px 130px 130px 130px 180px";
  el("items").innerHTML = `<div class="head" style="grid-template-columns:${cols}"><span>Item</span><span>Category</span><span class="num">Qty</span><span class="num">Sales (Rs)</span><span class="num">Cost (Rs)</span><span class="num">Profit (Rs)</span><span>Margin</span></div>` +
    byProfit.map((r) => {
      const low = r.margin < LOW_MARGIN;
      return `<div class="row" style="grid-template-columns:${cols}">
        <span class="w500">${esc(r.name)}</span>
        <span>${pillHtml(r.cat)}</span>
        <span class="num">${fmt(r.qty)}${r.unit === "ft" ? " ft" : ""}</span>
        <span class="num">${fmt(r.sales)}</span>
        <span class="num muted">${fmt(r.cost)}</span>
        <span class="num strong" style="color:${r.profit >= 0 ? "#1D5034" : "#A3322A"}">${fmt(r.profit)}</span>
        <span style="display:flex;align-items:center;gap:8px"><span class="mini"><span style="width:${Math.max(0, Math.min(100, Math.round(r.margin / 40 * 100)))}%;background:${low ? "#C2771F" : "#2F8F5B"}"></span></span><span class="num strong" style="width:56px;color:${low ? "#7A4205" : "#1D5034"}">${r.margin}%</span></span>
      </div>`;
    }).join("") +
    (byProfit.length ? "" : '<div class="empty"><strong>No profit data</strong>Sales with a cost price will appear here.</div>');
}

document.querySelectorAll("#period-seg button").forEach((b) => b.addEventListener("click", () => { period = b.dataset.p; render(); }));
