import './dialogs.js?v=55';
import { start, listen } from './common.js?v=55';
import { CATEGORY_LABELS, esc, fmt, formatDateDMY, todayString, daysAgoIso, saleCategory, saleUnits, saleUnitName } from './utils.js?v=55';

const el = (id) => document.getElementById(id);
let sales = [], returns = [], closings = [], products = [], expenses = [];
let months = 12, tRange = "month", tBy = "sales", mSel = null, dSel = null;

start((user) => {
  listen(user.uid, "sales", (rows) => { sales = rows.map((r) => r[1]); render(); });
  listen(user.uid, "returns", (rows) => { returns = rows.map((r) => r[1]).filter((r) => r.source !== "shop"); render(); });
  listen(user.uid, "closings", (rows) => { closings = rows.map((r) => r[1]); render(); });
  listen(user.uid, "products", (rows) => { products = rows; render(); });
  listen(user.uid, "expenses", (rows) => { expenses = rows.map((r) => r[1]); render(); });
});

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CAT_COLOR = { pump: "#0E6A8C", wire: "#C2771F", safety_cable: "#2F8F5B", other: "#5D6B78" };
const C = { sales: "#0E6A8C", profit: "#2F8F5B", exp: "#C2771F", net: "#14202B", neg: "#A3322A" };
const money = (n) => (n < 0 ? "−" : "") + fmt(Math.abs(Math.round(n)));
const short = (n) => { const a = Math.abs(n), s = n < 0 ? "−" : ""; return a >= 1e6 ? s + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M" : a >= 1e3 ? s + Math.round(a / 1e3) + "k" : s + Math.round(a); };
const ym = (d) => (d || "").slice(0, 7);

// Last n months as "YYYY-MM", oldest first
function monthKeys(n) {
  const now = new Date(todayString() + "T00:00:00"), out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); }
  return out;
}
const monthLabel = (k, full) => (full ? MONTH_FULL : MON)[Number(k.slice(5, 7)) - 1] + " " + (full ? k.slice(0, 4) : k.slice(2, 4));

// Sales, gross profit, expenses for one bucket function
function totals(keyOf) {
  const m = new Map();
  const g = (k) => { let o = m.get(k); if (!o) { o = { sales: 0, cost: 0, profit: 0, exp: 0, bills: new Set() }; m.set(k, o); } return o; };
  sales.forEach((s) => {
    const k = keyOf(s.date); if (k == null || !(Number(s.amount) > 0)) return;
    const o = g(k); o.sales += Number(s.amount); o.bills.add(s.timestamp || s.date + s.customerName);
    if (Number(s.cost) > 0) o.profit += Number(s.amount) - Number(s.cost);
  });
  returns.forEach((r) => {
    const k = keyOf(r.date); if (k == null) return;
    const o = g(k); if (r.type !== "exchange") o.sales -= Number(r.value || 0);
    if (Number(r.cost) > 0 && r.type !== "exchange") o.profit -= Number(r.value || 0) - (r.stockUpdated ? Number(r.cost) : 0);
  });
  expenses.forEach((x) => { const k = keyOf(x.date); if (k != null) g(k).exp += Number(x.amount || 0); });
  closings.forEach((c) => { const k = keyOf(c.date); if (k != null) g(k).exp += Number(c.expenses || 0); });
  return m;
}

// ---------- SVG bar chart ----------
// groups: [{ key, label, sub?, values:[{v,color}], line? }]
function barChart(host, groups, { height = 260, line = false, selected = null } = {}) {
  const W = Math.max(320, host.clientWidth || 800), H = height, L = 52, R = 22, T = 14, B = 34;
  const all = groups.flatMap((g) => [...g.values.map((x) => x.v), line ? g.line : 0]);
  let max = Math.max(1, ...all), min = Math.min(0, ...all);
  const step = niceStep((max - min) / 4);
  max = Math.ceil(max / step) * step; min = Math.floor(min / step) * step;
  const y = (v) => T + (max - v) / (max - min) * (H - T - B);
  const gw = (W - L - R) / groups.length, inner = Math.min(gw * 0.78, 18 * groups[0]?.values.length + 10 || 30), bw = inner / (groups[0]?.values.length || 1);
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" font-family="IBM Plex Sans, system-ui, sans-serif">`;
  for (let v = min; v <= max + 1e-6; v += step) s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? "#9AA4AD" : "#E3E6E8"}"/><text x="${L - 8}" y="${y(v) + 4}" font-size="11" fill="#5A6672" text-anchor="end">${short(v)}</text>`;
  const every = Math.max(1, Math.ceil(groups.length / Math.floor((W - L - R) / 44)));
  groups.forEach((g, i) => {
    const x0 = L + i * gw, cx = x0 + gw / 2;
    if (g.key === selected) s += `<rect x="${x0 + 1}" y="${T}" width="${gw - 2}" height="${H - T - B}" fill="#EAF3F8" rx="4"/>`;
    g.values.forEach((b, j) => {
      const top = y(Math.max(0, b.v)), h = Math.max(b.v ? 1 : 0, Math.abs(y(b.v) - y(0)));
      s += `<rect x="${cx - inner / 2 + j * bw + 1}" y="${top}" width="${Math.max(1, bw - 2)}" height="${h}" rx="2" fill="${b.v < 0 ? C.neg : b.color}"/>`;
    });
    if ((groups.length - 1 - i) % every === 0) s += `<text x="${cx}" y="${H - B + 16}" font-size="11" fill="#4A5662" text-anchor="middle">${esc(g.label)}</text>`;
    s += `<rect class="hit" data-k="${g.key}" x="${x0}" y="${T}" width="${gw}" height="${H - T}" fill="transparent" style="cursor:pointer"><title>${esc(g.tip || g.label)}</title></rect>`;
  });
  if (line) {
    const pts = groups.map((g, i) => `${L + i * gw + gw / 2},${y(g.line)}`);
    s += `<polyline points="${pts.join(" ")}" fill="none" stroke="${C.net}" stroke-width="2" stroke-linejoin="round" pointer-events="none"/>`;
    groups.forEach((g, i) => { s += `<circle cx="${L + i * gw + gw / 2}" cy="${y(g.line)}" r="3.5" fill="${g.line < 0 ? C.neg : C.net}" stroke="#fff" stroke-width="1.5" pointer-events="none"/>`; });
  }
  host.innerHTML = s + "</svg>";
}
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw)))), f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

function pick(host, rows) { host.innerHTML = rows.map(([k, v, c]) => `<span><i style="background:${c || "transparent"}"></i>${k} <b class="num">${v}</b></span>`).join(""); }

// ---------- render ----------
function render() {
  document.querySelectorAll("#m-range [data-n]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.n) === months)));
  document.querySelectorAll("#t-range [data-r]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.r === tRange)));
  document.querySelectorAll("#t-by [data-b]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.b === tBy)));

  // month by month
  const keys12 = monthKeys(12), set12 = new Set(keys12);
  const byM = totals((d) => (set12.has(ym(d)) ? ym(d) : null));
  const mrow = (k) => { const o = byM.get(k) || { sales: 0, profit: 0, exp: 0, bills: new Set() }; return { k, sales: o.sales, profit: o.profit, exp: o.exp, net: o.profit - o.exp, bills: o.bills.size }; };
  const all12 = keys12.map(mrow), shownM = all12.slice(-months);
  if (!mSel || !shownM.some((r) => r.k === mSel)) mSel = shownM[shownM.length - 1].k;
  barChart(el("m-chart"), shownM.map((r) => ({ key: r.k, label: monthLabel(r.k), tip: `${monthLabel(r.k, true)}\nSales Rs ${money(r.sales)}\nGross profit Rs ${money(r.profit)}\nExpenses Rs ${money(r.exp)}\nNet profit Rs ${money(r.net)}`,
    values: [{ v: r.sales, color: C.sales }, { v: r.profit, color: C.profit }, { v: r.exp, color: C.exp }], line: r.net })), { line: true, selected: mSel });
  const ms = all12.find((r) => r.k === mSel);
  pick(el("m-pick"), [[`<b>${monthLabel(mSel, true)}</b>`, ""], ["Sales", "Rs " + money(ms.sales), C.sales], ["Gross profit", "Rs " + money(ms.profit), C.profit], ["Expenses", "Rs " + money(ms.exp), C.exp], ["Net profit", "Rs " + money(ms.net), ms.net < 0 ? C.neg : C.net]]);
  const cols = "minmax(130px,1fr) 80px 130px 130px 120px 130px 80px";
  el("m-table").innerHTML = `<div class="head" style="grid-template-columns:${cols}"><span>Month</span><span class="num">Bills</span><span class="num">Sales (Rs)</span><span class="num">Gross profit</span><span class="num">Expenses</span><span class="num">Net profit</span><span class="num">Margin</span></div>` +
    [...shownM].reverse().map((r) => `<div class="row clickable${r.k === mSel ? " sel" : ""}" data-m="${r.k}" style="grid-template-columns:${cols};min-height:46px"><span class="w500">${monthLabel(r.k, true)}</span><span class="num">${r.bills}</span><span class="num strong">${money(r.sales)}</span><span class="num t-green">${money(r.profit)}</span><span class="num t-amber">${money(r.exp)}</span><span class="num strong" style="color:${r.net < 0 ? C.neg : "#1D5034"}">${money(r.net)}</span><span class="num muted">${r.sales > 0 ? Math.round(r.profit / r.sales * 100) + "%" : "—"}</span></div>`).join("");

  // KPIs
  const cur = all12[11], prev = all12[10];
  el("k-ms").textContent = money(cur.sales);
  const ch = prev.sales > 0 ? Math.round((cur.sales - prev.sales) / prev.sales * 100) : null;
  el("k-ms-s").textContent = ch == null ? `${cur.bills} bills so far` : `${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch)}% vs ${monthLabel(prev.k, true).split(" ")[0]} (Rs ${money(prev.sales)})`;
  el("k-mp").textContent = money(cur.net);
  el("k-mp-s").textContent = `Gross Rs ${money(cur.profit)} − expenses Rs ${money(cur.exp)}`;
  const best = all12.reduce((a, r) => (r.sales > a.sales ? r : a), all12[0]);
  el("k-best").textContent = best.sales > 0 ? monthLabel(best.k, true) : "—";
  el("k-best-s").textContent = best.sales > 0 ? `Rs ${money(best.sales)} sales · Rs ${money(best.net)} net` : "No sales yet";

  // last 30 days
  const days = []; for (let i = 29; i >= 0; i--) days.push(daysAgoIso(i));
  const dset = new Set(days), byD = totals((d) => (dset.has(d) ? d : null));
  if (!dSel || !dset.has(dSel)) dSel = days[29];
  const drow = (d) => { const o = byD.get(d) || { sales: 0, profit: 0, exp: 0, bills: new Set() }; return { d, sales: o.sales, profit: o.profit, bills: o.bills.size }; };
  const dr = days.map(drow), dsum = dr.reduce((a, r) => a + r.sales, 0), active = dr.filter((r) => r.sales > 0).length;
  el("d-sub").textContent = `Sales per day · Rs ${money(dsum)} in 30 days · average Rs ${money(active ? dsum / active : 0)} on a day with sales`;
  barChart(el("d-chart"), dr.map((r) => { const dt = new Date(r.d + "T00:00:00"); return { key: r.d, label: String(dt.getDate()), tip: `${formatDateDMY(r.d)} · ${WD[dt.getDay()]}\nSales Rs ${money(r.sales)} · ${r.bills} bills\nProfit Rs ${money(r.profit)}`, values: [{ v: r.sales, color: C.sales }, { v: r.profit, color: C.profit }] }; }), { height: 220, selected: dSel });
  const ds = drow(dSel);
  pick(el("d-pick"), [[`<b>${formatDateDMY(dSel)} · ${WD[new Date(dSel + "T00:00:00").getDay()]}</b>`, ""], ["Sales", "Rs " + money(ds.sales), C.sales], ["Profit", "Rs " + money(ds.profit), C.profit], ["Bills", String(ds.bills)]]);

  // weekday (last 12 weeks)
  const wk = Array.from({ length: 7 }, () => ({ s: 0, n: 0 }));
  for (let i = 0; i < 84; i++) { const d = daysAgoIso(i); wk[new Date(d + "T00:00:00").getDay()].n++; }
  const from84 = daysAgoIso(83);
  sales.forEach((s) => { if (s.date >= from84 && s.date <= todayString() && Number(s.amount) > 0) wk[new Date(s.date + "T00:00:00").getDay()].s += Number(s.amount); });
  const avg = wk.map((w, i) => ({ i, v: w.n ? w.s / w.n : 0 })), wmax = Math.max(1, ...avg.map((a) => a.v));
  const order = [1, 2, 3, 4, 5, 6, 0];
  el("w-bars").innerHTML = order.map((i) => `<div class="cbar"><div class="cbar-top"><span style="font-weight:600">${WD[i]}</span><span class="num"><b>Rs ${money(avg[i].v)}</b></span></div><div class="track"><span style="width:${Math.max(2, Math.round(avg[i].v / wmax * 100))}%;background:${avg[i].v === wmax ? C.profit : "#7FA9BA"}"></span></div></div>`).join("");
  const topWd = avg.reduce((a, b) => (b.v > a.v ? b : a), avg[0]);
  el("k-wd").textContent = topWd.v > 0 ? WD[topWd.i] : "—";
  el("k-wd-s").textContent = topWd.v > 0 ? `About Rs ${money(topWd.v)} a ${WD[topWd.i]}` : "Not enough sales yet";

  // top items + category
  const from = tRange === "month" ? todayString().slice(0, 7) + "-01" : tRange === "3m" ? monthKeys(3)[0] + "-01" : tRange === "year" ? monthKeys(12)[0] + "-01" : "";
  const inR = (d) => d && d >= from && d <= todayString();
  const byName = {}; products.forEach(([, p]) => { byName[p.name || p.size] = p.category; });
  const items = new Map(), cats = new Map();
  const it = (n, cat) => { let o = items.get(n); if (!o) { o = { name: n, cat, sales: 0, profit: 0, qty: 0, unit: "pcs" }; items.set(n, o); } return o; };
  sales.forEach((s) => {
    if (!inR(s.date) || !(Number(s.amount) > 0)) return;
    const cat = saleCategory(s, byName), o = it(s.productName || "—", cat);
    o.sales += Number(s.amount); o.qty += saleUnits(s); o.unit = saleUnitName(s);
    if (Number(s.cost) > 0) o.profit += Number(s.amount) - Number(s.cost);
    cats.set(cat, (cats.get(cat) || 0) + Number(s.amount));
  });
  returns.forEach((r) => {
    if (!inR(r.date) || r.type === "exchange") return;
    const o = it(r.productName || "—", r.category); o.sales -= Number(r.value || 0); o.qty -= Number(r.qty || 0);
    if (Number(r.cost) > 0) o.profit -= Number(r.value || 0) - (r.stockUpdated ? Number(r.cost) : 0);
    if (r.category) cats.set(r.category, (cats.get(r.category) || 0) - Number(r.value || 0));
  });
  const top = [...items.values()].filter((o) => o.sales > 0).sort((a, b) => b[tBy] - a[tBy]).slice(0, 10);
  const tmax = Math.max(1, ...top.map((o) => o[tBy]));
  const rangeName = { month: "This month", "3m": "Last 3 months", year: "Last 12 months", all: "All time" }[tRange];
  el("t-sub").textContent = `${rangeName} · top ${top.length} by ${tBy === "qty" ? "quantity sold" : tBy}`;
  el("t-bars").innerHTML = top.length ? top.map((o, i) => {
    const v = o[tBy], main = tBy === "qty" ? `${fmt(o.qty)} ${o.unit}` : "Rs " + money(v);
    const side = tBy === "sales" ? `Rs ${money(o.profit)} profit · ${fmt(o.qty)} ${o.unit}` : tBy === "profit" ? `on Rs ${money(o.sales)} sales` : `Rs ${money(o.sales)}`;
    return `<div class="cbar"><div class="cbar-top tb"><span class="tb-n"><span class="muted num">${i + 1}.</span> ${esc(o.name)}</span><span class="num tb-v"><b>${main}</b> <span class="muted">· ${side}</span></span></div><div class="track"><span style="width:${Math.max(2, Math.round(Math.max(0, v) / tmax * 100))}%;background:${CAT_COLOR[o.cat] || CAT_COLOR.other}"></span></div></div>`;
  }).join("") : '<div class="empty" style="padding:24px 0"><strong>No sales in this range</strong>Pick a longer range above.</div>';
  const csum = [...cats.values()].reduce((a, b) => a + b, 0);
  const crows = [...cats.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  el("c-sub").textContent = `${rangeName} · Rs ${money(csum)} sales`;
  el("c-bars").innerHTML = crows.length ? crows.map(([c, v]) => `<div class="cbar"><div class="cbar-top"><span style="font-weight:600">${esc(CATEGORY_LABELS[c] || c)}</span><span class="num"><b>Rs ${money(v)}</b> <span class="muted">· ${Math.round(v / csum * 100)}%</span></span></div><div class="track"><span style="width:${Math.max(2, Math.round(v / crows[0][1] * 100))}%;background:${CAT_COLOR[c] || CAT_COLOR.other}"></span></div></div>`).join("")
    : '<div class="empty" style="padding:24px 0"><strong>No sales</strong></div>';
}

el("m-range").addEventListener("click", (e) => { const b = e.target.closest("[data-n]"); if (b) { months = Number(b.dataset.n); render(); } });
el("t-range").addEventListener("click", (e) => { const b = e.target.closest("[data-r]"); if (b) { tRange = b.dataset.r; render(); } });
el("t-by").addEventListener("click", (e) => { const b = e.target.closest("[data-b]"); if (b) { tBy = b.dataset.b; render(); } });
el("m-chart").addEventListener("click", (e) => { const h = e.target.closest(".hit"); if (h) { mSel = h.dataset.k; render(); } });
el("m-table").addEventListener("click", (e) => { const r = e.target.closest("[data-m]"); if (r) { mSel = r.dataset.m; render(); } });
el("d-chart").addEventListener("click", (e) => { const h = e.target.closest(".hit"); if (h) { dSel = h.dataset.k; render(); } });
let rt = null;
window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 150); });
