import './dialogs.js?v=55';
import { auth, start, listen } from './common.js?v=55';
import { fmt, formatDateDMY, todayString, isoFromDate, remainingOf, esc, isCable, isLowStock, productName, stockText, metres, stockNumber, stockValue, CATEGORY_LABELS, itemText, groupBills, daysFromToday, withReturns } from './utils.js?v=55';

const el = (id) => document.getElementById(id);
let sales = [], products = [], upcoming = [];
let salesRaw = [], returnsAll = [];
let chartType = "bar";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

start((user) => {
  const now = new Date();
  el("d-eyebrow").textContent = WEEKDAYS[now.getDay()] + " · " + formatDateDMY(todayString());
  el("welcome-text").textContent = "Welcome back, " + (user.displayName || user.email);
  // Sales after customer returns (refund / cut udhaar take the value off), same as Sales Summary.
  listen(user.uid, "sales", (rows) => { salesRaw = rows; sales = withReturns(salesRaw, returnsAll).map((r) => r[1]); render(); });
  listen(user.uid, "returns", (rows) => { returnsAll = rows; sales = withReturns(salesRaw, returnsAll).map((r) => r[1]); render(); });
  listen(user.uid, "products", (rows) => { products = rows; render(); });
  listen(user.uid, "upcoming", (rows) => { upcoming = rows.map((r) => r[1]); render(); });
});

document.querySelectorAll("#chart-seg button").forEach((btn) => {
  btn.addEventListener("click", () => {
    chartType = btn.dataset.type;
    document.querySelectorAll("#chart-seg button").forEach((b) => b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
    renderChart();
  });
});

function render() {
  renderLowAlert();
  renderKpis();
  renderChart();
  renderLowStock();
  renderRecent();
  renderBiggestPending();
}

function renderKpis() {
  const today = todayString();
  const month = today.slice(0, 7);
  const todays = sales.filter((s) => s.date === today);
  const monthly = sales.filter((s) => s.date && s.date.startsWith(month));
  const sum = (arr) => arr.reduce((a, s) => a + s.amount, 0);
  const owedToday = todays.reduce((a, s) => a + remainingOf(s), 0);

  el("k-today").textContent = fmt(sum(todays));
  el("k-today-note").textContent = `${todays.length} sale${todays.length === 1 ? "" : "s"} · ${owedToday ? "Rs " + fmt(owedToday) + " unpaid" : "all cash received"}`;
  el("k-month").textContent = fmt(sum(monthly));
  el("k-month-note").textContent = `${monthly.length} sale${monthly.length === 1 ? "" : "s"} in ${MONTHS[new Date().getMonth()]}`;

  const open = sales.filter((s) => remainingOf(s) > 0);
  el("k-pending").textContent = fmt(open.reduce((a, s) => a + remainingOf(s), 0));
  el("k-pending-note").textContent = `${open.length} entr${open.length === 1 ? "y" : "ies"} · view all →`;

  el("k-stock").textContent = fmt(products.reduce((a, [, p]) => a + stockValue(p), 0));
}

// ---------- Sales chart: daily / weekly / monthly / overall ----------

const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
let period = "daily";

const dm = (iso) => iso.slice(8, 10) + "-" + iso.slice(5, 7);
const sumBetween = (from, to) => sales.reduce((a, s) => (s.date >= from && s.date <= to ? a + s.amount : a), 0);

// Returns { title, sub, avgLabel, prevLabel, rows: [[label, sub, value]] } — last row is the current period.
function chartData() {
  const now = new Date();
  if (period === "daily") {
    const rows = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const iso = isoFromDate(d), v = sumBetween(iso, iso);
      rows.push(i === 0 ? ["Today", dm(iso), v] : [dm(iso), WD3[d.getDay()], v]);
    }
    return { title: "Daily sales", sub: "This week: last 7 days · total per day in Rs", avgLabel: "Average per day", prevLabel: "vs yesterday", rows };
  }
  if (period === "weekly") {
    const rows = [];
    for (let w = 3; w >= 0; w--) {
      const end = new Date(now); end.setDate(end.getDate() - w * 7);
      const start = new Date(end); start.setDate(start.getDate() - 6);
      const a = isoFromDate(start), b = isoFromDate(end), v = sumBetween(a, b);
      rows.push(w === 0 ? ["This week", "from " + dm(a), v] : [dm(a), "to " + dm(b), v]);
    }
    return { title: "Weekly sales", sub: "Last 4 weeks · total per week in Rs", avgLabel: "Average per week", prevLabel: "vs last week", rows };
  }
  if (period === "monthly") {
    const rows = [];
    for (let m = 11; m >= 0; m--) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      const v = sales.reduce((a, s) => ((s.date || "").slice(0, 7) === key ? a + s.amount : a), 0);
      rows.push([MON3[d.getMonth()], m === 0 ? "so far" : String(d.getFullYear()).slice(2), v]);
    }
    return { title: "Monthly sales", sub: "Last 12 months · total per month in Rs", avgLabel: "Average per month", prevLabel: "vs last month", rows };
  }
  const thisYear = now.getFullYear();
  const first = sales.reduce((m, s) => Math.min(m, Number((s.date || "9999").slice(0, 4))), thisYear);
  const rows = [];
  for (let y = first; y <= thisYear; y++) {
    const v = sales.reduce((a, s) => ((s.date || "").slice(0, 4) === String(y) ? a + s.amount : a), 0);
    rows.push([String(y), y === thisYear ? "so far" : "full year", v]);
  }
  return { title: "Overall sales", sub: "Every year since the shop started · Rs", avgLabel: "Average per year", prevLabel: "vs last year", rows };
}

const shortNum = (n) => {
  const t = (x) => String(Math.round(x * 10) / 10);
  if (n >= 1000000) return t(n / 1000000) + "M";
  if (n >= 1000) return t(n / 1000) + "k";
  return String(n);
};

function renderChart() {
  const ds = chartData();
  const raw = ds.rows, N = raw.length, H = 208;
  const top = Math.max(...raw.map((r) => r[2]));
  const rough = Math.max(top, 1) * 1.12 / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough);
  const MAX = step * 4;

  el("chart-title").textContent = ds.title;
  el("chart-sub").textContent = ds.sub;
  document.querySelectorAll("#period-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.period === period)));

  // Summary strip
  const total = raw.reduce((a, r) => a + r[2], 0);
  const best = raw[raw.findIndex((r) => r[2] === top)];
  const last = raw[N - 1][2], prev = N > 1 ? raw[N - 2][2] : 0;
  const pct = prev > 0 ? Math.round((last - prev) / prev * 100) : null;
  const cell = (label, value, style) => `<div><span class="cs-l">${esc(label)}</span><span class="num cs-v" ${style ? `style="${style}"` : ""}>${value}</span></div>`;
  el("chart-sum").innerHTML =
    cell("Total (Rs)", fmt(total)) +
    cell(ds.avgLabel, fmt(Math.round(total / N))) +
    cell(top > 0 ? "Highest · " + best[0] : "Highest", fmt(top), "color:#0B5572") +
    cell(raw[N - 1][0] + " " + ds.prevLabel, pct === null ? "—" : (pct >= 0 ? "+" : "") + pct + "%", pct === null ? "" : "color:" + (pct >= 0 ? "#22583A" : "#A3322A"));

  el("y-axis").innerHTML = [4, 3, 2, 1].map((i) => `<span>${shortNum(i * step)}</span>`).join("") + "<span>0</span>";

  const lines = [6, 58, 110, 162].map((t) => `<div class="gl" style="top:${t}px"></div>`).join("") + '<div class="gl base" style="top:214px"></div>';
  let plot;
  if (chartType === "bar") {
    plot = `<div class="bars" style="grid-template-columns:repeat(${N},minmax(0,1fr))">` + raw.map(([label, sub, v], i) => {
      const cur = i === N - 1;
      return `<div class="bar-col"><span class="num bar-val">${shortNum(v)}</span><div class="bar${cur ? " today" : ""}" title="${esc(label + " " + sub)}: Rs ${fmt(v)}" style="height:${Math.max(2, Math.round(v / MAX * H))}px"></div></div>`;
    }).join("") + "</div>";
  } else {
    const pts = raw.map((r, i) => `${(i + 0.5) * 100},${(H - r[2] / MAX * H).toFixed(1)}`);
    plot = `<svg viewBox="0 0 ${N * 100} 208" preserveAspectRatio="none" width="100%" height="208" style="position:absolute;left:0;top:6px;overflow:visible" aria-hidden="true">
      <polygon points="50,208 ${pts.join(" ")} ${N * 100 - 50},208" fill="#0E6A8C" fill-opacity="0.08" stroke="none"></polygon>
      <polyline points="${pts.join(" ")}" fill="none" stroke="#0E6A8C" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline>
    </svg>` + `<div class="bars" style="grid-template-columns:repeat(${N},minmax(0,1fr));pointer-events:none">` + raw.map(([label, sub, v]) =>
      `<div class="bar-col" title="${esc(label + " " + sub)}: Rs ${fmt(v)}"></div>`).join("") + "</div>";
  }
  el("plot-area").innerHTML = lines + plot;

  el("x-axis").style.gridTemplateColumns = `repeat(${N},minmax(0,1fr))`;
  el("x-axis").innerHTML = raw.map(([label, sub], i) =>
    `<div class="x-col${i === N - 1 ? " today" : ""}"><span>${esc(label)}</span><span class="sub">${esc(sub)}</span></div>`).join("");
}

document.querySelectorAll("#period-seg button").forEach((btn) => {
  btn.addEventListener("click", () => { period = btn.dataset.period; renderChart(); });
});


// ---------- Low-stock alert (top of the page) ----------
// Hidden for the rest of the day when the × is pressed; comes back tomorrow if items are still low.

const ALERT_KEY = "sph-lowalert-hidden";
function alertHiddenToday() { try { return localStorage.getItem(ALERT_KEY) === todayString(); } catch (e) { return false; } }

function renderLowAlert() {
  const box = el("low-alert");
  const low = products.filter(([, p]) => isLowStock(p)).sort((a, b) => stockNumber(a[1]) - stockNumber(b[1]));
  box.hidden = !low.length || alertHiddenToday();
  if (box.hidden) return;
  el("low-alert-title").textContent = low.length === 1
    ? "1 item is running low. Reorder before it finishes."
    : `${low.length} items are running low. Reorder before they finish.`;
  const shown = low.slice(0, 6);
  el("low-alert-chips").innerHTML = shown.map(([, p]) => {
    const n = stockNumber(p);
    return `<span class="chip">${esc(productName(p))} <span class="num">${n === 0 ? "out of stock" : esc(stockText(p)) + " left"}</span></span>`;
  }).join("") + (low.length > shown.length ? `<span class="chip">+${low.length - shown.length} more</span>` : "");
}

el("low-alert-hide").addEventListener("click", () => {
  try { localStorage.setItem(ALERT_KEY, todayString()); } catch (e) {}
  el("low-alert").hidden = true;
});

// ---------- Low stock ----------

function renderLowStock() {
  const low = products.filter(([, p]) => isLowStock(p))
    .sort((a, b) => stockNumber(a[1]) - stockNumber(b[1]))
    .slice(0, 5);
  el("low-list").innerHTML = low.length
    ? low.map(([, p]) => `<div class="li"><span class="stack"><span class="w500">${esc(productName(p))}</span><span class="small">${CATEGORY_LABELS[p.category]}</span></span><span class="num t-amber">${esc(stockText(p))}</span></div>`).join("")
    : '<div class="empty"><strong>Nothing is running low</strong>All items are above the low-stock level.</div>';

  const pend = upcoming.filter((u) => u.status !== "arrived");
  const banner = el("upcoming-banner");
  banner.hidden = pend.length === 0;
  if (pend.length) {
    const dated = pend.filter((u) => u.expectedDate).sort((a, b) => (a.expectedDate < b.expectedDate ? -1 : 1));
    el("upcoming-banner-text").textContent = `${pend.length} upcoming product${pend.length === 1 ? "" : "s"}` + (dated[0] ? `, next on ${formatDateDMY(dated[0].expectedDate)}` : "");
  }
}

// ---------- Recent sales ----------

function renderRecent() {
  const cols = "100px minmax(150px,1.2fr) minmax(180px,1.5fr) 120px 110px";
  const recent = groupBills(sales.map((s, i) => [i, s])).slice(0, 5);
  let html = `<div class="head" style="grid-template-columns:${cols};height:40px"><span>Date</span><span>Customer</span><span>Item</span><span class="num">Total (Rs)</span><span style="text-align:right">Status</span></div>`;
  if (!recent.length) html += '<div class="empty"><strong>No sales yet</strong>Sell a product from the Stock List.</div>';
  html += recent.map((b) => {
    const paid = b.remaining === 0;
    return `<div class="row" style="grid-template-columns:${cols};min-height:52px;padding-top:8px;padding-bottom:8px">
      <span class="num l muted">${formatDateDMY(b.date)}</span>
      <span class="w500">${esc(b.customerName || "—")}</span>
      <span>${esc(b.docs.map(itemText).join(", "))}</span>
      <span class="num">${fmt(b.amount)}</span>
      <span style="text-align:right"><span class="pill ${paid ? "b-paid" : "b-pend"}">${paid ? "Paid" : "Pending"}</span></span>
    </div>`;
  }).join("");
  el("recent-table").innerHTML = html;
}

// ---------- Biggest pending ----------

function renderBiggestPending() {
  const top = sales.filter((s) => remainingOf(s) > 0)
    .sort((a, b) => remainingOf(b) - remainingOf(a)).slice(0, 4);
  el("pending-list").innerHTML = top.length
    ? top.map((s) => `<div class="li"><span class="stack"><span class="w500">${esc(s.customerName || "—")}</span><span class="small">Since ${formatDateDMY(s.date)}</span></span><span class="num strong">${fmt(remainingOf(s))}</span></div>`).join("")
    : '<div class="empty"><strong>Nothing pending</strong>No one owes you money right now.</div>';
}
