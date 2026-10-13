import { confirmDialog } from './dialogs.js?v=55';
import { start, listen } from './common.js?v=55';
import { setBillRemaining } from './custPay.js?v=55';
import { groupBills, esc, fmt, formatDateDMY, toNumber, digitsOnly, itemText, ICONS } from './utils.js?v=55';

const el = (id) => document.getElementById(id);
let uid = null;
let sales = [];            // credit sales only: [[id, data]]
let tab = "all", sel = new Set(), editing = null, draft = "", editOriginal = "";

start((user) => {
  uid = user.uid;
  listen(uid, "sales", (rows) => {
    sales = rows.filter(([, s]) => s.paymentType === "credit");
    const ids = new Set(sales.map((r) => r[0]));
    sel = new Set([...sel].filter((id) => ids.has(id)));
    render();
  });
});

const isOpen = (b) => b.remaining > 0;
let bills = [];

function render() {
  bills = groupBills(sales);
  const open = bills.filter(isOpen);
  const done = bills.filter((b) => !isOpen(b));
  const shown = tab === "pending" ? open : tab === "received" ? done : bills;

  el("k-pending").textContent = fmt(open.reduce((a, b) => a + b.remaining, 0));
  el("k-open").textContent = fmt(open.length);
  el("k-done").textContent = fmt(done.length);
  const oldest = open.slice().sort((a, b) => (a.date || "") < (b.date || "") ? -1 : 1)[0];
  el("k-oldest").textContent = oldest ? formatDateDMY(oldest.date) : "—";
  el("k-oldest-who").textContent = oldest ? (oldest.customerName || "Walk-in customer") : "All paid";

  el("tabs").innerHTML = [["all", "All", bills.length], ["pending", "Pending", open.length], ["received", "Received", done.length]]
    .map(([k, label, n]) => `<button type="button" class="tab" data-tab="${k}" aria-pressed="${tab === k}">${label}<span class="cnt">${n}</span></button>`).join("");

  const bar = el("bulk-bar");
  bar.hidden = sel.size === 0;
  el("bulk-count-text").textContent = `${sel.size} selected`;

  const cols = "40px 92px minmax(130px,1fr) 116px minmax(150px,1.3fr) 124px 124px 100px 124px";
  const allChecked = shown.length > 0 && shown.every((b) => sel.has(b.key));
  let html = `<div class="head" style="grid-template-columns:${cols}"><label class="ckw"><input type="checkbox" class="ck" data-all ${allChecked ? "checked" : ""} aria-label="Select all"></label><span>Date</span><span>Customer</span><span>Contact</span><span>Item</span><span class="num">Total (Rs)</span><span class="num">Remaining (Rs)</span><span style="text-align:center">Status</span><span style="text-align:center">Action</span></div>`;
  html += shown.map((b) => {
    const id = b.key, o = isOpen(b), checked = sel.has(id), rem = b.remaining;
    const rowCls = o ? (checked ? "due-row hl" : "due-row") : "paid-row";
    const name = b.customerName || "—";
    const remCell = editing === id
      ? `<span class="rem-edit"><input type="text" inputmode="numeric" id="rem-draft" value="${esc(draft)}" aria-label="New remaining amount"><button type="button" data-act="save" data-id="${id}">Save</button></span>`
      : `<button type="button" class="rem-btn ${o ? "" : "done"}" data-act="edit" data-id="${id}" aria-label="Edit remaining for ${esc(name)}">${fmt(rem)}${ICONS.pencil}</button>`;
    const items = b.docs.map((d) => `<span class="ln">${esc(itemText(d))}</span>`).join("");
    return `<div class="row bill ${rowCls}" style="align-items:center;grid-template-columns:${cols};min-height:60px;padding-top:6px;padding-bottom:6px">
      <label class="ckw"><input type="checkbox" class="ck" data-sel="${id}" ${checked ? "checked" : ""} aria-label="Select ${esc(name)}"></label>
      <span class="num muted" style="text-align:left">${formatDateDMY(b.date)}</span>
      <span class="w500">${esc(name)}</span>
      <span class="num muted" style="text-align:left;font-size:13px">${esc(b.customerContact || "—")}</span>
      <span class="stk">${items}</span>
      <span class="num">${fmt(b.amount)}</span>
      <span style="display:flex;justify-content:flex-start">${remCell}</span>
      <span style="display:flex;justify-content:center"><span class="pill ${o ? "b-pend" : "b-done"}">${o ? "Pending" : "Received"}</span></span>
      <span style="display:flex;justify-content:center">${o ? `<button type="button" class="btn-paid" data-act="paid" data-id="${id}">Mark paid</button>` : ""}</span>
    </div>`;
  }).join("");
  if (!shown.length) html += '<div class="empty"><strong>Nothing here</strong>No credit sales in this list.</div>';
  el("pending-table").innerHTML = html;
  const input = el("rem-draft");
  if (input && document.activeElement !== input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
}

const find = (key) => bills.find((b) => b.key === key);

async function setRemaining(key, value, opts) {
  const bill = find(key);
  if (bill) await setBillRemaining(uid, bill, value, opts);
}

el("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (b) { tab = b.dataset.tab; render(); }
});

const table = el("pending-table");
table.addEventListener("change", (e) => {
  if (e.target.dataset.all !== undefined) {
    const list = tab === "pending" ? bills.filter(isOpen) : tab === "received" ? bills.filter((b) => !isOpen(b)) : bills;
    if (e.target.checked) list.forEach((b) => sel.add(b.key)); else list.forEach((b) => sel.delete(b.key));
    render();
  } else if (e.target.dataset.sel) {
    const id = e.target.dataset.sel;
    if (e.target.checked) sel.add(id); else sel.delete(id);
    render();
  }
});

table.addEventListener("input", (e) => {
  if (e.target.id === "rem-draft") { draft = digitsOnly(e.target.value); e.target.value = draft; }
});

table.addEventListener("keydown", (e) => {
  if (e.target.id !== "rem-draft") return;
  if (e.key === "Enter") { e.preventDefault(); saveDraft(); }
  if (e.key === "Escape") { editing = null; render(); }
});

async function saveDraft() {
  const id = editing;
  if (!id) return;
  try { await setRemaining(id, toNumber(draft)); editing = null; render(); }
  catch (error) { alert("Error updating amount: " + error.message); }
}

table.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const id = b.dataset.id, row = find(id);
  if (!row) return;
  if (b.dataset.act === "edit") { editing = id; draft = editOriginal = String(row.remaining); render(); }
  if (b.dataset.act === "save") saveDraft();
  if (b.dataset.act === "paid") {
    if (!(await confirmDialog({ title: "Mark as paid?", message: `Rs. ${fmt(row.remaining)} will be marked as received${row.customerName ? " from " + row.customerName : ""}.`, confirmLabel: "Mark paid" }))) return;
    try { await setRemaining(id, 0); } catch (error) { alert("Error marking as paid: " + error.message); }
  }
});

el("bulk-received-btn").addEventListener("click", async () => {
  const ids = [...sel];
  if (!ids.length) return;
  try { await Promise.all(ids.map((id) => setRemaining(id, 0))); sel.clear(); render(); }
  catch (error) { alert("Error marking as received: " + error.message); }
});
el("bulk-delete-btn").addEventListener("click", async () => {
  const keys = [...sel];
  if (!keys.length) return;
  if (!(await confirmDialog({ title: `Remove ${keys.length} record${keys.length === 1 ? "" : "s"} from pending?`, message: "They will leave Pending Payments and be marked as received in Sales Summary.", confirmLabel: "Remove" }))) return;
  try { await Promise.all(keys.map((k) => setRemaining(k, 0, { log: false }))); sel.clear(); render(); }
  catch (error) { alert("Error updating records: " + error.message); }
});
el("bulk-clear-btn").addEventListener("click", () => { sel.clear(); render(); });

// While a remaining amount is being edited: clicking outside cancels the edit if nothing changed;
// if the value was changed, clicks outside are blocked until it is saved (or Esc is pressed).
document.addEventListener("click", (e) => {
  if (editing === null || e.target.closest(".rem-edit")) return;
  if (draft === editOriginal) { editing = null; render(); return; }
  e.stopPropagation();
  e.preventDefault();
  const box = document.querySelector(".rem-edit");
  const input = el("rem-draft");
  if (box) { box.classList.remove("nudge"); void box.offsetWidth; box.classList.add("nudge"); }
  if (input) input.focus();
}, true);
