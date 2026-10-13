// Morning report on the Dashboard: how the last working day went, what is running low,
// and which udhaar has been waiting a long time. Hide it for today, or send it to WhatsApp.
import { auth, listen, whoAmI } from './common.js?v=55';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js';
import { fmt, esc, formatDateDMY, todayString, daysAgoIso, remainingOf, paidAtSale, isLowStock, productName, stockText, stockNumber, withReturns, phoneKey, nameKey } from './utils.js?v=55';

const el = (id) => document.getElementById(id);
const HIDE_KEY = "sph-morning-hidden";
const OLD_DAYS = 30;
const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
let salesRaw = [], returns = [], payments = [], expenses = [], products = [], closings = [], loaded = new Set();
let shopName = "", lastBackup = null;

const hiddenToday = () => { try { return localStorage.getItem(HIDE_KEY) === todayString(); } catch (e) { return false; } };

onAuthStateChanged(auth, async (u) => {
  if (!u) return;
  const user = await whoAmI(u);
  if (user.role !== "owner") return;
  const on = (name, f) => listen(user.uid, name, (rows) => { f(rows); loaded.add(name); render(); });
  on("sales", (r) => { salesRaw = r; });
  on("returns", (r) => { returns = r; });
  on("payments", (r) => { payments = r.map((x) => x[1]); });
  on("expenses", (r) => { expenses = r.map((x) => x[1]); });
  on("products", (r) => { products = r; });
  on("closings", (r) => { closings = r.map((x) => x[1]); });
  on("settings", (r) => { const s = r.find(([id]) => id === "shop"); shopName = (s && s[1].shopName) || ""; lastBackup = (s && s[1].lastBackup) || null; });
});

let report = null;
function build() {
  const today = todayString();
  const sales = withReturns(salesRaw, returns).map((r) => r[1]);
  // the last day before today that had any sale (yesterday, or Saturday after a closed Sunday)
  const before = sales.map((s) => s.date).filter((d) => d && d < today).sort();
  const day = before.length ? before[before.length - 1] : daysAgoIso(1);
  const ds = sales.filter((s) => s.date === day);
  const bills = new Set(ds.map((s) => s.timestamp || s.customerName + s.time)).size;
  const total = ds.reduce((a, s) => a + Number(s.amount || 0), 0);
  const counted = ds.filter((s) => Number(s.cost) > 0);
  const profit = counted.reduce((a, s) => a + Number(s.amount) - Number(s.cost), 0);
  const cash = ds.reduce((a, s) => a + Math.max(0, paidAtSale(s) - Number(s.refunded || 0)), 0);
  const udhaarGiven = ds.reduce((a, s) => a + Math.max(0, Number(s.origAmount ?? s.amount) - paidAtSale(s)), 0);
  const loanIn = payments.filter((p) => p.date === day).reduce((a, p) => a + Number(p.amount || 0), 0);
  const spent = expenses.filter((x) => x.date === day).reduce((a, x) => a + Number(x.amount || 0), 0)
    + closings.filter((c) => c.date === day).reduce((a, c) => a + Number(c.expenses || 0), 0);
  const items = new Map();
  ds.forEach((s) => items.set(s.productName, (items.get(s.productName) || 0) + Number(s.amount || 0)));
  const topItem = [...items.entries()].sort((a, b) => b[1] - a[1])[0];

  const low = products.filter(([, p]) => isLowStock(p)).sort((a, b) => stockNumber(a[1]) - stockNumber(b[1])).map(([, p]) => p);

  // udhaar older than OLD_DAYS, one line per customer (oldest unpaid bill decides the days)
  const cut = daysAgoIso(OLD_DAYS), who = new Map();
  sales.filter((s) => remainingOf(s) > 0 && s.date && s.date <= cut).forEach((s) => {
    const k = phoneKey(s.customerContact) || nameKey(s.customerName) || "walk-in";
    const o = who.get(k) || { name: s.customerName || "Walk-in customer", phone: s.customerContact || "", amount: 0, since: s.date };
    o.amount += remainingOf(s); if (s.date < o.since) o.since = s.date; who.set(k, o);
  });
  const old = [...who.values()].sort((a, b) => b.amount - a.amount);
  const days = (d) => Math.round((new Date(today + "T00:00:00") - new Date(d + "T00:00:00")) / 86400000);
  old.forEach((o) => { o.days = days(o.since); });
  return { day, isYesterday: day === daysAgoIso(1), bills, total, profit, missingCost: ds.length - counted.length, cash, udhaarGiven, loanIn, spent, topItem, low, old, oldTotal: old.reduce((a, o) => a + o.amount, 0) };
}

function render() {
  const box = el("morning");
  if (!box || loaded.size < 7) return;
  el("morning-open").hidden = !hiddenToday();
  box.hidden = hiddenToday();
  document.body.classList.toggle("mr-on", !box.hidden);
  if (box.hidden) return;
  const r = report = build();
  const h = new Date().getHours();
  el("mr-greet").textContent = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  el("mr-day").textContent = `${r.isYesterday ? "Yesterday" : "Last sale day"} · ${WD[new Date(r.day + "T00:00:00").getDay()]} ${formatDateDMY(r.day)}`;
  const tile = (label, v, sub, cls = "") => `<div class="mr-t ${cls}"><span class="mr-l">${label}</span><span class="mr-v num">${v}</span>${sub ? `<span class="mr-s">${sub}</span>` : ""}</div>`;
  el("mr-tiles").innerHTML = r.bills ? [
    tile("Sales", "Rs " + fmt(r.total), `${r.bills} bill${r.bills === 1 ? "" : "s"}${r.topItem ? " · most: " + esc(r.topItem[0]) : ""}`),
    tile("Profit", "Rs " + fmt(r.profit), r.missingCost ? `${r.missingCost} sale(s) without cost` : r.total ? Math.round(r.profit / r.total * 100) + "% margin" : "", "g"),
    tile("Cash taken", "Rs " + fmt(r.cash), r.loanIn ? `+ Rs ${fmt(r.loanIn)} udhaar received` : "At the time of sale"),
    tile("Udhaar given", "Rs " + fmt(r.udhaarGiven), r.spent ? `Expenses Rs ${fmt(r.spent)}` : "New loans that day", r.udhaarGiven ? "a" : ""),
  ].join("") : `<div class="mr-none">No sales on that day.${r.loanIn ? ` Rs ${fmt(r.loanIn)} udhaar was received.` : ""}</div>`;
  el("mr-low").innerHTML = r.low.length
    ? `<b>${r.low.length} item${r.low.length === 1 ? "" : "s"} running low</b> ` + r.low.slice(0, 4).map((p) => `<span class="chip">${esc(productName(p))} <span class="num">${stockNumber(p) === 0 ? "out" : esc(stockText(p))}</span></span>`).join("") + (r.low.length > 4 ? `<span class="chip">+${r.low.length - 4} more</span>` : "") + ` <a class="link" href="stock.html?low=1">View</a>`
    : "<b>Stock is fine</b> <span class=\"muted\">· nothing running low</span>";
  el("mr-old").innerHTML = r.old.length
    ? `<b>Rs ${fmt(r.oldTotal)} udhaar older than ${OLD_DAYS} days</b> <span class="muted">· ${r.old.length} customer${r.old.length === 1 ? "" : "s"}</span> ` + r.old.slice(0, 3).map((o) => `<span class="chip">${esc(o.name)} <span class="num">Rs ${fmt(o.amount)} · ${o.days}d</span></span>`).join("") + ` <a class="link" href="pending.html">Collect</a>`
    : `<b>No old udhaar</b> <span class="muted">· nobody owes for more than ${OLD_DAYS} days</span>`;
  // weekly backup reminder
  const bd = lastBackup ? Math.floor((Date.now() - new Date(lastBackup + "T00:00:00").getTime()) / 86400000) : null;
  el("mr-backup").hidden = bd != null && bd < 7;
  el("mr-backup").innerHTML = `<b>${bd == null ? "No backup made yet" : `Last backup was ${bd} days ago`}</b> <span class="muted">· take one every week, it takes 5 seconds</span> <a class="link" href="settings.html#backup">Download backup</a>`;
}

function reportText(r) {
  const L = [`*${shopName || "Star Pump House"} — morning report*`, `${r.isYesterday ? "Yesterday" : "Last sale day"}: ${WD[new Date(r.day + "T00:00:00").getDay()]} ${formatDateDMY(r.day)}`, ""];
  if (r.bills) {
    L.push(`Sales: Rs ${fmt(r.total)} (${r.bills} bill${r.bills === 1 ? "" : "s"})`, `Profit: Rs ${fmt(r.profit)}`, `Cash taken: Rs ${fmt(r.cash)}`, `Udhaar given: Rs ${fmt(r.udhaarGiven)}`);
    if (r.loanIn) L.push(`Udhaar received: Rs ${fmt(r.loanIn)}`);
    if (r.spent) L.push(`Expenses: Rs ${fmt(r.spent)}`);
    if (r.topItem) L.push(`Most sold: ${r.topItem[0]}`);
  } else L.push("No sales that day.");
  L.push("");
  L.push(r.low.length ? `Low stock (${r.low.length}): ` + r.low.slice(0, 6).map((p) => `${productName(p)} (${stockNumber(p) === 0 ? "out" : stockText(p)})`).join(", ") : "Stock: nothing running low");
  L.push(r.old.length ? `Old udhaar (>${OLD_DAYS} days): Rs ${fmt(r.oldTotal)} — ` + r.old.slice(0, 5).map((o) => `${o.name} Rs ${fmt(o.amount)} (${o.days}d)`).join(", ") : "Old udhaar: none");
  return L.join("\n");
}

el("mr-hide").addEventListener("click", () => { try { localStorage.setItem(HIDE_KEY, todayString()); } catch (e) {} render(); });
el("morning-open").addEventListener("click", () => { try { localStorage.removeItem(HIDE_KEY); } catch (e) {} render(); });
el("mr-wa").addEventListener("click", () => { if (report) window.open("https://wa.me/?text=" + encodeURIComponent(reportText(report)), "_blank", "noopener"); });
