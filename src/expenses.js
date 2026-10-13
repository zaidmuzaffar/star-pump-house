// Expenses page: add / change / delete shop expenses, with totals by kind for the chosen period.
import { confirmDialog } from './dialogs.js?v=55';
import { start, listen, col, ref, addDoc, updateDoc, deleteDoc, showToast } from './common.js?v=55';
import { esc, fmt, formatDateDMY, parseDMY, todayString, toNumber, attachNumberFormatting, attachDateMask, attachAutoCapitalize, withButtonLock, highlightWords, inPeriodRange, PERIOD_LABEL, periodRangeText, ICONS } from './utils.js?v=55';
import { KINDS, kindLabel, kindColor, isCash } from './expenseUtils.js?v=55';

const el = (id) => document.getElementById(id);
let uid = null, rows = [], period = "month", query = "", kind = "", editId = null;

attachNumberFormatting(el("x-amount"), true);
attachDateMask(el("x-date"));
attachAutoCapitalize(el("x-note"));
el("x-date").value = formatDateDMY(todayString());

start((user) => {
  uid = user.uid;
  listen(uid, "expenses", (r) => { rows = r; render(); });
});

function kinds() {
  el("x-kinds").innerHTML = KINDS.map(([k, l, c]) => `<button type="button" class="x-kind" data-k="${k}" aria-pressed="${kind === k}" style="--kc:${c}">${l}</button>`).join("");
}
el("x-kinds").addEventListener("click", (e) => { const b = e.target.closest("[data-k]"); if (b) { kind = b.dataset.k; kinds(); } });
kinds();

function render() {
  document.querySelectorAll("#x-period [data-p]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.p === period)));
  el("x-range").textContent = "Accounts · " + PERIOD_LABEL[period] + (period === "all" ? "" : " · " + periodRangeText(period));
  const inP = rows.filter(([, e]) => inPeriodRange(period, e.date));
  const total = inP.reduce((a, [, e]) => a + Number(e.amount || 0), 0);
  el("k-total").textContent = fmt(total);
  el("k-count").textContent = `${inP.length} expense${inP.length === 1 ? "" : "s"} · ${PERIOD_LABEL[period].toLowerCase()}`;
  el("k-today").textContent = fmt(rows.filter(([, e]) => e.date === todayString()).reduce((a, [, e]) => a + Number(e.amount || 0), 0));
  el("k-cash").textContent = fmt(inP.filter(([, e]) => isCash(e)).reduce((a, [, e]) => a + Number(e.amount || 0), 0));
  const by = KINDS.map(([k]) => ({ k, amt: inP.filter(([, e]) => (e.kind || "other") === k).reduce((a, [, e]) => a + Number(e.amount || 0), 0) })).filter((x) => x.amt > 0).sort((a, b) => b.amt - a.amt);
  el("k-top").textContent = by[0] ? kindLabel(by[0].k) : "—";
  el("k-top-amt").textContent = by[0] ? `Rs ${fmt(by[0].amt)} · ${Math.round(by[0].amt / total * 100)}%` : "Nothing yet";
  el("x-kind-sub").textContent = total ? `Total Rs ${fmt(total)}` : "No expenses in this period";
  const max = Math.max(1, ...by.map((x) => x.amt));
  el("x-bars").innerHTML = by.length ? by.map((x) => `<div class="cbar"><div class="cbar-top"><span style="font-weight:600">${kindLabel(x.k)}</span><span class="num"><b>Rs ${fmt(x.amt)}</b> <span class="muted">· ${Math.round(x.amt / total * 100)}%</span></span></div><div class="track"><span style="width:${Math.max(3, Math.round(x.amt / max * 100))}%;background:${kindColor(x.k)}"></span></div></div>`).join("")
    : '<div class="empty" style="padding:24px 0"><strong>No expenses</strong>Add the first one on the left.</div>';

  const q = query.trim().toLowerCase();
  const list = inP.filter(([, e]) => !q || `${kindLabel(e.kind)} ${e.note || ""} ${e.method || ""} ${formatDateDMY(e.date)}`.toLowerCase().includes(q))
    .sort((a, b) => (b[1].date || "").localeCompare(a[1].date || "") || (b[1].timestamp || 0) - (a[1].timestamp || 0));
  const cols = "100px 170px minmax(160px,1fr) 140px 130px 96px";
  el("x-list").innerHTML = `<div class="head" style="grid-template-columns:${cols}"><span>Date</span><span>Kind</span><span>Note</span><span>Paid by</span><span class="num">Amount (Rs)</span><span></span></div>` +
    (list.length ? list.map(([id, e]) => `<div class="row" style="grid-template-columns:${cols};min-height:52px${editId === id ? ";background:#EAF3F8" : ""}">
      <span class="num muted" style="text-align:left">${formatDateDMY(e.date)}</span>
      <span><span class="x-tag" style="--kc:${kindColor(e.kind)}">${highlightWords(kindLabel(e.kind), query)}</span></span>
      <span>${highlightWords(e.note || "—", query)}</span>
      <span class="muted" style="font-size:13px">${esc(e.method || "Cash")}</span>
      <span class="num strong">${fmt(e.amount)}</span>
      <span style="display:flex;gap:6px;justify-content:flex-end"><button type="button" class="iconbtn" data-edit="${id}" aria-label="Change">${ICONS.edit || "✎"}</button><button type="button" class="iconbtn del" data-del="${id}" aria-label="Delete">${ICONS.del}</button></span>
    </div>`).join("") : `<div class="empty"><strong>${q ? "Nothing matches" : "No expenses here"}</strong>${q ? "Try another word." : "Expenses you add show here."}</div>`);
}

document.querySelectorAll("#x-period [data-p]").forEach((b) => b.addEventListener("click", () => { period = b.dataset.p; render(); }));
el("x-search").addEventListener("input", (e) => { query = e.target.value; render(); });

function resetForm() {
  editId = null; kind = ""; kinds();
  el("x-amount").value = ""; el("x-note").value = ""; el("x-method").value = "Cash"; el("x-date").value = formatDateDMY(todayString());
  el("x-form-title").textContent = "Add expense"; el("x-save").textContent = "Save expense"; el("x-cancel").hidden = true;
  render();
}
el("x-cancel").addEventListener("click", resetForm);

el("x-save").addEventListener("click", (e) => withButtonLock(e.currentTarget, async () => {
  const amount = toNumber(el("x-amount").value), date = parseDMY(el("x-date").value);
  if (!kind) { alert("Please choose what kind of expense it is."); return; }
  if (amount <= 0) { alert("Please enter the amount."); el("x-amount").focus(); return; }
  if (!date) { alert("Please enter the date as DD-MM-YY."); return; }
  const data = { date, kind, amount, method: el("x-method").value, note: el("x-note").value.trim() };
  try {
    if (editId) { await updateDoc(ref(uid, "expenses", editId), data); showToast(el("toast"), "<span>Expense changed.</span>"); }
    else { await addDoc(col(uid, "expenses"), Object.assign({ timestamp: Date.now() }, data)); showToast(el("toast"), `<span>Rs ${fmt(amount)} ${esc(kindLabel(kind).toLowerCase())} saved.${data.method === "Cash" ? " Cash Closing will take it off the galla." : ""}</span>`); }
    resetForm();
  } catch (error) { alert("Error saving expense: " + error.message); }
}));

el("x-list").addEventListener("click", async (e) => {
  const ed = e.target.closest("[data-edit]"), dl = e.target.closest("[data-del]");
  if (ed) {
    const r = rows.find(([id]) => id === ed.dataset.edit); if (!r) return;
    const x = r[1]; editId = r[0]; kind = x.kind || "other"; kinds();
    el("x-amount").value = fmt(x.amount); el("x-date").value = formatDateDMY(x.date); el("x-method").value = x.method || "Cash"; el("x-note").value = x.note || "";
    el("x-form-title").textContent = "Change expense"; el("x-save").textContent = "Save change"; el("x-cancel").hidden = false;
    render(); el("x-amount").focus();
  }
  if (dl) {
    const r = rows.find(([id]) => id === dl.dataset.del); if (!r) return;
    if (!(await confirmDialog({ title: "Delete this expense?", message: `${kindLabel(r[1].kind)} · Rs ${fmt(r[1].amount)} · ${formatDateDMY(r[1].date)}`, confirmLabel: "Delete", danger: true }))) return;
    try { await deleteDoc(ref(uid, "expenses", r[0])); if (editId === r[0]) resetForm(); } catch (error) { alert("Error: " + error.message); }
  }
});
