// Ask AI: the forms the AI fills in. Each one works like the form on its normal page:
//   Sell Product (Stock List): customer + old-customer suggestions, items with price (can only be lowered),
//     quantity −/+ or feet, "Add Another Product", Cancel / Loan / Cash -> Payment Details (Received).
//   Receive payment (Customers): udhaar bills, Mark paid (full) / Edit amount.
//   New Purchase: date, bill no, items, Add item, paid now, "Add these items to Upcoming Products".
//   Pay supplier, Give stock to a wholesale shop, Receive from a shop.
// Only the buttons here save (aiActions.js does the writing, the same way the pages do).
import {
  esc, fmt, toNumber, digitsOnly, formatWithCommas, formatDateDMY, parseDMY, todayString, attachDateMask,
  CATEGORY_LABELS, CATEGORY_ORDER, byFeet, metres, isLowStock, stockText, sellNameOf, phoneKey, nameKey, initials, highlightWords, withButtonLock
} from './utils.js?v=55';
import { D, findCustomers } from './aiTools.js?v=55';
import {
  getDraft, dropDraft, productById, sellName, available, checkSale, saleTotal, saveSale, saveUdhaar, customerOpenBills,
  savePurchase, supplierBalance, saveSupplierPayment, shopBalance, saveShopBill, saveShopPayment, METHODS,
  returnCalc, saveReturn, payfixInfo, savePayfix, saveExpense, saveProduct, saveParty, shopReturnCalc, saveShopReturn, saveCustfix, doDelete
} from './aiActions.js?v=55';
import { KINDS, kindLabel } from './expenseUtils.js?v=55';
import { FIELDS } from './productForm.js?v=55';
import { confirmDialog } from './dialogs.js?v=55';

let ctx = null;   // { uid, bubble, setNote }
export function initCards(c) { ctx = c; }

const money = (n) => "Rs " + fmt(n);
const X = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
const PLUS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"></path></svg>';
const ibox = (cls, i, v, pre = "Rs", post = "") => `<span class="ibox">${pre ? `<span class="aff">${pre}</span>` : ""}<input type="text" inputmode="numeric" class="mono ${cls}" data-i="${i}" value="${v === "" ? "" : fmt(v)}">${post ? `<span class="aff">${post}</span>` : ""}</span>`;
const methodSel = (cls, v) => `<select class="inp ${cls}">${METHODS.map((m) => `<option${m === v ? " selected" : ""}>${m}</option>`).join("")}</select>`;

// ---------- product picker inside the form (name left; LOW badge then stock right) ----------
function pickerHtml(skip = new Set(), mustHave = true) {
  return `<div class="act-pick"><div class="ppk-search"><input type="search" class="act-pick-q" placeholder="Search product…" aria-label="Search product" autocomplete="off"></div><div class="ppk-list act-pick-list">${pickerList("", skip, mustHave)}</div>
    <div class="act-pick-foot"><button type="button" class="btn sec act-pick-close">Close</button></div></div>`;
}
function pickerList(q, skip, mustHave) {
  const words = nameKey(q).split(" ").filter(Boolean);
  let html = "";
  CATEGORY_ORDER.forEach((cat) => {
    const opts = D.products.filter(([id, p]) => p.category === cat && (!words.length || words.every((w) => nameKey(sellNameOf(p) + " " + (p.brand || "")).includes(w))))
      .sort((a, b) => sellNameOf(a[1]).localeCompare(sellNameOf(b[1])));
    if (!opts.length) return;
    html += `<div class="ppk-group">${CATEGORY_LABELS[cat]}</div>` + opts.map(([id, p]) => {
      const off = skip.has(id) || (mustHave && available(p) <= 0);
      return `<div class="ppk-opt${off ? " off" : ""}" data-pid="${id}" role="option" aria-disabled="${off}"><span class="ppk-name">${esc(sellNameOf(p))}${skip.has(id) ? ' <small class="muted">· already added</small>' : ""}</span><span class="ppk-right">${isLowStock(p) ? '<span class="low">Low</span>' : ""}<span class="ppk-qty">${esc(stockText(p))}</span></span></div>`;
    }).join("");
  });
  return html || '<div class="ppk-empty">No product found</div>';
}
function wirePicker(box, skip, mustHave, onPick) {
  const pk = box.querySelector(".act-pick"); if (!pk) return;
  const qIn = pk.querySelector(".act-pick-q");
  qIn.addEventListener("input", () => { pk.querySelector(".act-pick-list").innerHTML = pickerList(qIn.value, skip, mustHave); });
  pk.addEventListener("click", (e) => {
    if (e.target.closest(".act-pick-close")) { pk.remove(); return; }
    const o = e.target.closest(".ppk-opt"); if (!o || o.classList.contains("off")) return;
    onPick(o.dataset.pid);
  });
  qIn.focus({ preventScroll: true });
}

// ---------- shell ----------
function shell(d, title, sub) {
  const box = ctx.bubble("ai act", "");
  box.dataset.draft = d.id;
  box.innerHTML = `<div class="act-head"><div><span class="act-tag">${title}</span><span class="act-sub">${sub}</span></div><button type="button" class="dlg-x act-x" aria-label="Close">${X}</button></div><div class="act-body"></div><div class="act-foot"></div>`;
  box.querySelector(".act-x").addEventListener("click", () => cancel(box, d, title));
  return box;
}
function cancel(box, d, title) {
  dropDraft(d.id);
  ctx.setNote(`the manager closed the ${title} form without saving; nothing was saved`);
  box.removeAttribute("data-draft");
  box.classList.add("done");
  box.innerHTML = `<div class="act-done">${esc(title)} closed. Nothing was saved.</div>`;
  ctx.save && ctx.save();
}
function done(box, d, text, link, linkText) {
  dropDraft(d.id);
  ctx.setNote(`the manager saved it: ${text}`);
  box.removeAttribute("data-draft");
  box.classList.add("done");
  box.innerHTML = `<div class="act-done ok"><b>${/^Deleted/.test(text) ? "Done." : "Saved."}</b> ${esc(text)} <a class="link" href="${esc(link)}">${esc(linkText)}</a></div>`;
  ctx.save && ctx.save();
}
const fail = (err) => alert("Could not save: " + (err && err.message || err));

export function showCard(id) {
  const d = getDraft(id); if (!d) return;
  ({ sale: saleForm, udhaar: udhaarForm, purchase: purchaseForm, suppay: supPayForm, shopbill: shopBillForm, shoppay: shopPayForm, return: returnForm, payfix: payfixForm, expense: expenseForm, product: productForm, party: partyForm, shopret: shopReturnForm, custfix: custfixForm, delete: deleteForm })[d.type](d);
}

// ======================= Sell Product =======================
function saleForm(d) {
  const box = shell(d, "Sell Product", "Add the customer and the items sold.");
  const body = box.querySelector(".act-body"), foot = box.querySelector(".act-foot");
  let step = "items";
  const lt = (it) => { const p = productById(it.id); return byFeet(p) ? it.price * it.feet : it.price * it.quantity; };
  const hint = d.loan ? "Loan: nothing received now (all udhaar)." : d.udhaarHint != null ? `Rs ${fmt(d.udhaarHint)} udhaar (rest paid now).` : d.paidHint != null ? `Rs ${fmt(d.paidHint)} received now.` : "";

  function feetField(it, i, required) {
    const p = productById(it.id);
    return `<label class="fgroup"><span class="lbl">Length to sell${required ? ' <span class="req">*</span>' : " (optional)"}</span>${ibox("s-feet", i, it.feet || "", "", "ft")}<span class="hint-line">${fmt(metres(p))} ft in stock</span></label>`;
  }
  function items() {
    return d.items.map((it, i) => {
      const p = productById(it.id), cable = byFeet(p);
      const qty = cable ? "" : `<label class="fgroup"><span class="lbl">Quantity <span class="req">*</span></span><span class="ibox"><input type="text" inputmode="numeric" class="mono s-qty" data-i="${i}" value="${it.quantity}"><span class="aff">pcs</span><button type="button" class="step" data-step="-1" data-i="${i}" aria-label="Decrease">−</button><button type="button" class="step" data-step="1" data-i="${i}" aria-label="Increase">+</button></span><span class="hint-line">${fmt(p.quantity)} pcs in stock</span></label>`;
      return `<div class="sell-card"><div class="sell-card-head"><span>${esc(sellName(p))}</span>${d.items.length > 1 ? `<button type="button" class="rm" data-rm="${i}" aria-label="Remove item">×</button>` : ""}</div>
        <div class="grid2"><label class="fgroup"><span class="lbl">${cable ? "Price per foot" : "Price"} <span class="req">*</span></span>${ibox("s-price", i, it.price, "Rs", cable ? "/ ft" : "")}<span class="hint-line price-hint" data-ph="${i}">Listed Rs ${fmt(it.maxPrice)}${cable ? " / ft" : ""} · can only be lowered</span></label>
        ${cable ? feetField(it, i, true) : qty}${!cable && p.category === "other" && metres(p) > 0 ? feetField(it, i, false) : ""}</div>
        <div class="line-total"><span data-lx="${i}">${cable ? `Rs ${fmt(it.price)} × ${fmt(it.feet)} ft` : `Rs ${fmt(it.price)} × ${fmt(it.quantity)}`}</span><strong data-lt="${i}">Rs ${fmt(lt(it))}</strong></div></div>`;
    }).join("");
  }
  function render() {
    if (step === "items") {
      body.innerHTML = `<div class="cust-pick"><div class="grid2">
          <label class="fgroup"><span class="lbl">Customer Name</span><input class="inp s-name" type="text" value="${esc(d.name)}" placeholder="e.g. Ahmed Khan" autocomplete="off"></label>
          <label class="fgroup"><span class="lbl">Contact Number</span><input class="inp s-phone" type="text" inputmode="numeric" value="${esc(d.phone)}" placeholder="e.g. 03001234567" autocomplete="off" maxlength="13"></label></div>
          <div class="sugg" hidden></div></div>
        ${d.known === "existing" ? '<span class="hint-line">Old customer: this sale joins their account.</span>' : ""}
        <div class="s-items" style="display:flex;flex-direction:column;gap:12px">${items()}</div>
        <button type="button" class="btn sec s-add" style="justify-content:center">${PLUS}Add Another Product</button>
        <div class="sell-total"><span>Total</span><span class="s-total">Rs. ${fmt(saleTotal(d))}</span></div>
        ${hint ? `<span class="act-hint">You said: ${esc(hint)}</span>` : ""}`;
      foot.innerHTML = `<button type="button" class="btn sec" data-a="cancel">Cancel</button><button type="button" class="btn sec${d.loan ? " act-suggest" : ""}" data-a="loan">Loan</button><button type="button" class="btn pri" data-a="cash">Cash</button>`;
      wireSugg();
    } else {
      const total = saleTotal(d);
      const rec = d.udhaarHint != null ? Math.max(0, total - d.udhaarHint) : d.paidHint != null ? Math.min(d.paidHint, total) : total;
      body.innerHTML = `<div class="act-step">Payment Details · anything not received becomes a pending payment.</div>
        <div class="pay-row"><label class="fgroup"><span class="lbl">Received</span>${ibox("s-recv", 0, rec)}</label>
        <label class="fgroup"><span class="lbl">Total</span><span class="ibox" style="background:#F3F4F1"><span class="aff">Rs</span><input type="text" class="mono" value="${fmt(total)}" disabled></span></label></div>
        <span class="hint-line s-left">${total - rec > 0 ? `Rs ${fmt(total - rec)} will be udhaar.` : "Paid in full."}</span>`;
      foot.innerHTML = `<button type="button" class="btn sec" data-a="back">Cancel</button><button type="button" class="btn pri" data-a="confirm">Confirm</button>`;
      const r = body.querySelector(".s-recv"); r.focus({ preventScroll: true }); r.select();
    }
  }
  function refresh(i) {
    const it = d.items[i], p = productById(it.id);
    const lx = body.querySelector(`[data-lx="${i}"]`), lt2 = body.querySelector(`[data-lt="${i}"]`);
    if (lx) lx.textContent = byFeet(p) ? `Rs ${fmt(it.price)} × ${fmt(it.feet)} ft` : `Rs ${fmt(it.price)} × ${fmt(it.quantity)}`;
    if (lt2) lt2.textContent = "Rs " + fmt(lt(it));
    body.querySelector(".s-total").textContent = "Rs. " + fmt(saleTotal(d));
  }
  body.addEventListener("input", (e) => {
    const t = e.target, i = Number(t.dataset.i);
    if (t.classList.contains("s-name")) { d.name = t.value; d.known = ""; showSugg(); return; }
    if (t.classList.contains("s-phone")) { t.value = digitsOnly(t.value); d.phone = t.value; d.known = ""; showSugg(); return; }
    if (t.classList.contains("s-recv")) {
      const total = saleTotal(d); let v = toNumber(t.value); if (v > total) v = total; t.value = t.value ? formatWithCommas(v) : "";
      body.querySelector(".s-left").textContent = total - v > 0 ? `Rs ${fmt(total - v)} will be udhaar.` : "Paid in full."; return;
    }
    const it = d.items[i]; if (!it) return;
    if (t.classList.contains("s-price")) {
      let v = toNumber(t.value); const over = v > it.maxPrice; if (over) v = it.maxPrice;
      t.value = formatWithCommas(String(v)); it.price = v;
      const ph = body.querySelector(`[data-ph="${i}"]`); if (ph) ph.classList.toggle("warn", over);
    } else if (t.classList.contains("s-qty")) { t.value = digitsOnly(t.value); it.quantity = toNumber(t.value); }
    else if (t.classList.contains("s-feet")) { t.value = digitsOnly(t.value); it.feet = toNumber(t.value); }
    else return;
    refresh(i);
  });
  body.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]");
    if (rm) { d.items.splice(Number(rm.dataset.rm), 1); render(); return; }
    const st = e.target.closest("[data-step]");
    if (st) { const i = Number(st.dataset.i); d.items[i].quantity = Math.max(1, d.items[i].quantity + Number(st.dataset.step)); st.closest(".ibox").querySelector("input").value = d.items[i].quantity; refresh(i); return; }
    if (e.target.closest(".s-add")) {
      if (body.querySelector(".act-pick")) return;
      e.target.closest(".s-add").insertAdjacentHTML("afterend", pickerHtml(new Set(d.items.map((x) => x.id)), true));
      wirePicker(body, new Set(d.items.map((x) => x.id)), true, (pid) => {
        const p = productById(pid); d.items.push({ id: pid, price: Number(p.price || 0), maxPrice: Number(p.price || 0), quantity: 1, feet: byFeet(p) ? 1 : 0 }); render();
      });
    }
  });
  // old customer suggestions (as on the Sell Product form): press one to fill name and number
  function wireSugg() {
    const sg = body.querySelector(".sugg");
    sg.addEventListener("mousedown", (e) => e.preventDefault());
    sg.addEventListener("click", (e) => {
      const b = e.target.closest("[data-k]"); if (!b) return;
      const c = sugList[Number(b.dataset.k)]; d.name = c.name; d.phone = c.phone; d.known = "existing";
      body.querySelector(".s-name").value = c.name; body.querySelector(".s-phone").value = c.phone; sg.hidden = true;
    });
    [".s-name", ".s-phone"].forEach((s) => body.querySelector(s).addEventListener("blur", () => setTimeout(() => { sg.hidden = true; }, 150)));
  }
  let sugList = [];
  function showSugg() {
    const sg = body.querySelector(".sugg"); if (!sg) return;
    const q = (d.phone && d.phone.length >= 3 ? d.phone : d.name).trim();
    sugList = q.length >= 2 ? findCustomers(q).filter((c) => c.phone || c.name).slice(0, 6) : [];
    if (!sugList.length) { sg.hidden = true; return; }
    sg.innerHTML = '<div class="sugg-h">Old customers — press one to fill name and number</div>' + sugList.map((c, k) => `<button type="button" class="sugg-i" data-k="${k}"><span class="av">${esc(initials(c.name || c.phone))}</span><span class="cinfo"><span class="cname">${highlightWords(c.name || "No name", d.name)}</span><span class="cmeta">${esc(c.phone || "no number")}</span></span></button>`).join("");
    sg.hidden = false;
  }
  foot.addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    const a = b.dataset.a;
    if (a === "cancel") return cancel(box, d, "Sell Product");
    if (a === "back") { step = "items"; render(); return; }
    if (a === "cash") { const err = checkSale(d); if (err) return alert(err); step = "pay"; render(); return; }
    withButtonLock(b, async () => {
      const err = checkSale(d); if (err) { alert(err); return; }
      const got = a === "loan" ? 0 : Math.min(toNumber(body.querySelector(".s-recv").value), saleTotal(d));
      try {
        const r = await saveSale(ctx.uid, d, got);
        done(box, d, `Sale of Rs ${fmt(r.total)}${d.name ? " to " + d.name : ""}${r.udhaar > 0 ? `, udhaar Rs ${fmt(r.udhaar)}` : ", paid in full"}.`, "sales.html", "Open Sales Summary");
      } catch (err2) { fail(err2); }
    });
  });
  render();
}

// ======================= Receive payment (customer udhaar) =======================
function udhaarForm(d) {
  const box = shell(d, "Receive payment", esc([d.name, d.phone].filter(Boolean).join(" · ")));
  const body = box.querySelector(".act-body"), foot = box.querySelector(".act-foot");
  const open = customerOpenBills(d).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const due = open.reduce((x, b) => x + b.remaining, 0);
  let mode = d.amount != null && d.amount < due ? "edit" : "paid";
  let got = d.amount != null ? Math.min(d.amount, due) : due;
  const preview = () => { const g = mode === "paid" ? due : got; return `<div><span>Udhaar now</span><b class="num">${money(due)}</b></div><div><span>Received</span><b class="num t-green">${money(g)}</b></div><div class="after"><span>Remaining after</span><b class="num ${due - g > 0 ? "t-amber" : "t-green"}">${money(due - g)}</b></div>`; };
  function render() {
    body.innerHTML = `<div class="stack" style="gap:8px"><span class="lbl">Udhaar bills</span><div class="crecv-bills">${open.map((b) => `<div class="crb"><span class="num muted">${formatDateDMY(b.date)}</span><span class="crb-items">${b.docs.map((x) => esc(x.productName)).join(", ")}</span><span class="num t-amber strong">Rs ${fmt(b.remaining)}</span></div>`).join("")}</div></div>
      <div class="seg"><button type="button" data-m="paid" aria-pressed="${mode === "paid"}" style="flex:1">Mark paid (full)</button><button type="button" data-m="edit" aria-pressed="${mode === "edit"}" style="flex:1">Edit amount</button></div>
      ${mode === "edit" ? `<div class="pay-row"><label class="fgroup"><span class="lbl">Received now <span class="req">*</span></span>${ibox("u-got", 0, got)}</label><label class="fgroup"><span class="lbl">Remaining after</span>${ibox("u-rem", 0, due - got)}</label></div>` : ""}
      <div class="pay-preview">${preview()}</div>`;
    foot.innerHTML = `<button type="button" class="btn sec" data-a="cancel">Cancel</button><button type="button" class="btn pri" data-a="save">${mode === "paid" ? "Mark paid" : "Save payment"}</button>`;
  }
  body.addEventListener("click", (e) => { const m = e.target.closest("[data-m]"); if (m) { mode = m.dataset.m; render(); } });
  body.addEventListener("input", (e) => {
    const t = e.target;
    if (t.classList.contains("u-got")) { got = Math.min(toNumber(t.value), due); t.value = t.value ? formatWithCommas(got) : ""; body.querySelector(".u-rem").value = formatWithCommas(due - got) || "0"; }
    else if (t.classList.contains("u-rem")) { const r = Math.min(toNumber(t.value), due); t.value = t.value ? formatWithCommas(r) : ""; got = due - r; body.querySelector(".u-got").value = formatWithCommas(got) || "0"; }
    else return;
    body.querySelector(".pay-preview").innerHTML = preview();
  });
  foot.addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    if (b.dataset.a === "cancel") return cancel(box, d, "Receive payment");
    withButtonLock(b, async () => {
      const g = mode === "paid" ? due : got;
      if (g <= 0) { alert("Please write how much money was received."); return; }
      try { const r = await saveUdhaar(ctx.uid, d, g); done(box, d, `Rs ${fmt(r)} received from ${d.name}. ${due - r > 0 ? "Remaining Rs " + fmt(due - r) + "." : "All clear."}`, "customers.html", "Open Customers"); }
      catch (err) { fail(err); }
    });
  });
  render();
}

// ======================= line editor (purchase / give stock) =======================
function linesHtml(lines, priceKey, priceLbl) {
  return `<div class="act-lines"><div class="act-lh"><span>Item</span><span>Qty</span><span>${priceLbl}</span><span>Total</span><span></span></div>
    ${lines.map((l, i) => { const p = productById(l.productId); return `<div class="act-line"><span><b>${esc(sellNameOf(p))}</b><small>${isLowStock(p) ? '<span class="low">Low</span> ' : ""}In stock ${esc(stockText(p))}</small></span>
      <input class="act-in mono l-qty" inputmode="numeric" data-i="${i}" value="${l.qty ? fmt(l.qty) : ""}" placeholder="${byFeet(p) ? "ft" : "pcs"}"><input class="act-in mono l-pr" inputmode="numeric" data-i="${i}" value="${l[priceKey] ? fmt(l[priceKey]) : ""}" placeholder="Rs">
      <span class="num" data-lt="${i}">${fmt(l.qty * l[priceKey])}</span><button type="button" class="rm act-rm" data-rm="${i}" aria-label="Remove">×</button></div>`; }).join("")}</div>`;
}
function wireLines(body, lines, priceKey, onChange) {
  body.addEventListener("input", (e) => {
    const t = e.target, i = Number(t.dataset.i), l = lines[i]; if (!l) return;
    if (t.classList.contains("l-qty")) l.qty = toNumber(t.value); else if (t.classList.contains("l-pr")) l[priceKey] = toNumber(t.value); else return;
    t.value = t.value ? formatWithCommas(toNumber(t.value)) : "";
    body.querySelector(`[data-lt="${i}"]`).textContent = fmt(l.qty * l[priceKey]);
    onChange();
  });
}

// ======================= New Purchase =======================
function purchaseForm(d) {
  const box = shell(d, "New Purchase", `${esc(d.supName)}${d.isNew ? ' <span class="act-new">New supplier</span>' : ""}`);
  const body = box.querySelector(".act-body"), foot = box.querySelector(".act-foot");
  const total = () => d.lines.reduce((x, l) => x + l.qty * l.cost, 0);
  function render() {
    body.innerHTML = `<div class="grid2"><label class="fgroup"><span class="lbl">Date</span><input class="inp p-date mono" value="${formatDateDMY(d.date)}" inputmode="numeric" placeholder="DD-MM-YY"></label>
        <label class="fgroup"><span class="lbl">Bill no. (optional)</span><input class="inp p-bill" value="${esc(d.billNo)}"></label></div>
      ${linesHtml(d.lines, "cost", "Cost (Rs)")}
      <button type="button" class="btn sec p-add" style="justify-content:center">${PLUS}Add item</button>
      <label class="checkline"><input type="checkbox" class="p-ord" ${d.ordered ? "checked" : ""}> Add these items to Upcoming Products</label>
      <span class="hint-line">${d.ordered ? "Ordered: a bill is saved with the supplier and the items wait in Upcoming Products (stock goes up when you mark them Arrived)." : "Not ordered yet: the items go to Pending Products. No bill, nothing paid."}</span>
      ${d.ordered ? `<div class="pay-row"><label class="fgroup"><span class="lbl">Paid now</span>${ibox("p-paid", 0, d.paid)}</label><div class="pay-preview p-prev"></div></div>` : '<div class="sell-total"><span>Value</span><span class="p-tot"></span></div>'}`;
    foot.innerHTML = `<button type="button" class="btn sec" data-a="cancel">Cancel</button><button type="button" class="btn pri" data-a="save">${d.ordered ? "Save purchase" : "Save to Pending"}</button>`;
    attachDateMask(body.querySelector(".p-date"));
    totals();
  }
  function totals() {
    const t = total(), pd = Math.min(d.paid, t);
    const pv = body.querySelector(".p-prev"); if (pv) pv.innerHTML = `<div><span>Bill total</span><b class="num">${money(t)}</b></div><div class="after"><span>To pay later</span><b class="num ${t - pd > 0 ? "t-amber" : "t-green"}">${money(t - pd)}</b></div>`;
    const pt = body.querySelector(".p-tot"); if (pt) pt.textContent = money(t);
  }
  wireLines(body, d.lines, "cost", totals);
  body.addEventListener("input", (e) => {
    const t = e.target;
    if (t.classList.contains("p-paid")) { d.paid = toNumber(t.value); t.value = t.value ? formatWithCommas(d.paid) : ""; totals(); }
    if (t.classList.contains("p-bill")) d.billNo = t.value;
  });
  body.addEventListener("change", (e) => { if (e.target.classList.contains("p-ord")) { d.ordered = e.target.checked; render(); } });
  body.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]"); if (rm) { d.lines.splice(Number(rm.dataset.rm), 1); render(); return; }
    if (e.target.closest(".p-add") && !body.querySelector(".act-pick")) {
      e.target.closest(".p-add").insertAdjacentHTML("afterend", pickerHtml(new Set(d.lines.map((l) => l.productId)), false));
      wirePicker(body, new Set(d.lines.map((l) => l.productId)), false, (pid) => { d.lines.push({ productId: pid, qty: 0, cost: Number(productById(pid).cost || 0) }); render(); });
    }
  });
  foot.addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    if (b.dataset.a === "cancel") return cancel(box, d, "New Purchase");
    withButtonLock(b, async () => {
      d.date = parseDMY(body.querySelector(".p-date").value);
      if (!d.date) { alert("Please enter the date as DD-MM-YY."); return; }
      if (!d.lines.length) { alert("Please add at least one item."); return; }
      for (const l of d.lines) { const nm = sellNameOf(productById(l.productId)); if (l.qty <= 0) { alert(`Please enter the quantity for ${nm}.`); return; } if (l.cost <= 0) { alert(`Please enter the cost for ${nm}.`); return; } }
      try {
        const r = await savePurchase(ctx.uid, d);
        if (r.where === "pending") done(box, d, `${d.lines.length} item(s) saved in Pending Products for ${r.sup.name}.`, "pending-products.html", "Open Pending Products");
        else done(box, d, `Purchase bill of Rs ${fmt(r.total)} saved with ${r.sup.name}; the items are in Upcoming Products.`, "upcoming.html", "Open Upcoming");
      } catch (err) { fail(err); }
    });
  });
  render();
}

// ======================= Pay supplier / Receive from shop =======================
function moneyForm(d, { title, who, balanceLabel, balance, amountLabel, methodLabel, saveLabel, save, link }) {
  const box = shell(d, title, esc(who));
  const body = box.querySelector(".act-body"), foot = box.querySelector(".act-foot");
  const preview = () => `<div><span>${balanceLabel}</span><b class="num">${money(balance)}</b></div><div><span>${amountLabel}</span><b class="num t-green">${money(d.amount)}</b></div><div class="after"><span>Remaining after</span><b class="num ${balance - d.amount > 0 ? "t-amber" : "t-green"}">${money(balance - d.amount)}</b></div>`;
  body.innerHTML = `<div class="pay-row"><label class="fgroup"><span class="lbl">${amountLabel} <span class="req">*</span></span>${ibox("m-amt", 0, d.amount || "")}</label>
      <label class="fgroup"><span class="lbl">Date</span><input class="inp m-date mono" value="${formatDateDMY(d.date)}" inputmode="numeric"></label></div>
    <div class="pay-row"><label class="fgroup"><span class="lbl">${methodLabel}</span>${methodSel("m-meth", d.method)}</label><label class="fgroup"><span class="lbl">Note</span><input class="inp m-note" value="${esc(d.note)}" placeholder="Optional"></label></div>
    <div class="pay-preview">${preview()}</div>`;
  foot.innerHTML = `<button type="button" class="btn sec" data-a="cancel">Cancel</button><button type="button" class="btn pri" data-a="save">${saveLabel}</button>`;
  attachDateMask(body.querySelector(".m-date"));
  body.addEventListener("input", (e) => { if (e.target.classList.contains("m-amt")) { d.amount = toNumber(e.target.value); e.target.value = e.target.value ? formatWithCommas(d.amount) : ""; body.querySelector(".pay-preview").innerHTML = preview(); } });
  foot.addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    if (b.dataset.a === "cancel") return cancel(box, d, title);
    withButtonLock(b, async () => {
      d.date = parseDMY(body.querySelector(".m-date").value); d.method = body.querySelector(".m-meth").value; d.note = body.querySelector(".m-note").value;
      if (d.amount <= 0) { alert("Please enter the amount."); return; }
      if (!d.date) { alert("Please enter the date as DD-MM-YY."); return; }
      try { await save(); done(box, d, `Rs ${fmt(d.amount)} ${title === "Pay supplier" ? "paid to" : "received from"} ${who.replace(/\.$/, "")}. Remaining Rs ${fmt(balance - d.amount)}.`, link[0], link[1]); }
      catch (err) { fail(err); }
    });
  });
  setTimeout(() => body.querySelector(".m-amt").focus({ preventScroll: true }), 50);
}
function supPayForm(d) {
  const s = supplierBalance(d);
  moneyForm(d, { title: "Pay supplier", who: d.supName, balanceLabel: "Remaining now", balance: s ? s.balance : 0, amountLabel: "Amount paid", methodLabel: "Paid by", saveLabel: "Save payment",
    save: () => saveSupplierPayment(ctx.uid, d), link: [`supplier.html?id=${encodeURIComponent(d.supId)}`, "Open supplier"] });
}
function shopPayForm(d) {
  const s = shopBalance(d);
  moneyForm(d, { title: "Receive from shop", who: d.shopName, balanceLabel: "Remaining now", balance: s ? s.remaining : 0, amountLabel: "Received", methodLabel: "Received by", saveLabel: "Save",
    save: () => saveShopPayment(ctx.uid, d), link: [`shop.html?id=${encodeURIComponent(d.shopId)}`, "Open shop"] });
}

// ======================= Give stock to a wholesale shop =======================
function shopBillForm(d) {
  const box = shell(d, "Give stock", esc(d.shopName) + " · not a customer sale; kept in the shop's account");
  const body = box.querySelector(".act-body"), foot = box.querySelector(".act-foot");
  const total = () => d.lines.reduce((x, l) => x + l.qty * l.price, 0);
  function render() {
    body.innerHTML = `<div class="grid2"><label class="fgroup"><span class="lbl">Date</span><input class="inp g-date mono" value="${formatDateDMY(d.date)}" inputmode="numeric"></label><label class="fgroup"><span class="lbl">Bill no. (optional)</span><input class="inp g-bill" value="${esc(d.billNo)}"></label></div>
      ${linesHtml(d.lines, "price", "Price (Rs)")}
      <button type="button" class="btn sec g-add" style="justify-content:center">${PLUS}Add item</button>
      <div class="pay-row"><label class="fgroup"><span class="lbl">Received now <span class="req">*</span></span>${ibox("g-recv", 0, d.recv == null ? "" : d.recv)}<span class="hint-line">Write 0 if nothing was received.</span></label><div class="pay-preview g-prev"></div></div>`;
    foot.innerHTML = `<button type="button" class="btn sec" data-a="cancel">Cancel</button><button type="button" class="btn pri" data-a="save">Save bill</button>`;
    attachDateMask(body.querySelector(".g-date"));
    totals();
  }
  function totals() { const t = total(), r = Math.min(d.recv || 0, t); body.querySelector(".g-prev").innerHTML = `<div><span>Bill total</span><b class="num">${money(t)}</b></div><div class="after"><span>Added to the shop's remaining</span><b class="num ${t - r > 0 ? "t-amber" : "t-green"}">${money(t - r)}</b></div>`; }
  wireLines(body, d.lines, "price", totals);
  body.addEventListener("input", (e) => {
    if (e.target.classList.contains("g-recv")) { d.recv = e.target.value.trim() ? toNumber(e.target.value) : null; e.target.value = e.target.value ? formatWithCommas(toNumber(e.target.value)) : ""; totals(); }
    if (e.target.classList.contains("g-bill")) d.billNo = e.target.value;
  });
  body.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]"); if (rm) { d.lines.splice(Number(rm.dataset.rm), 1); render(); return; }
    if (e.target.closest(".g-add") && !body.querySelector(".act-pick")) {
      e.target.closest(".g-add").insertAdjacentHTML("afterend", pickerHtml(new Set(d.lines.map((l) => l.productId)), true));
      wirePicker(body, new Set(d.lines.map((l) => l.productId)), true, (pid) => { d.lines.push({ productId: pid, qty: 0, price: Number(productById(pid).price || 0) }); render(); });
    }
  });
  foot.addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    if (b.dataset.a === "cancel") return cancel(box, d, "Give stock");
    withButtonLock(b, async () => {
      d.date = parseDMY(body.querySelector(".g-date").value);
      if (!d.date) { alert("Please enter the date as DD-MM-YY."); return; }
      if (d.recv == null) { alert("Please enter how much you received now (write 0 if nothing)."); return; }
      if (!d.lines.length) { alert("Please add at least one item."); return; }
      for (const l of d.lines) { const nm = sellNameOf(productById(l.productId)); if (l.qty <= 0) { alert(`Please enter the quantity for ${nm}.`); return; } if (l.price <= 0) { alert(`Please enter the price for ${nm}.`); return; } }
      try { const r = await saveShopBill(ctx.uid, d); done(box, d, `Stock bill of Rs ${fmt(r.total)} saved for ${d.shopName}; items taken out of Stock.`, `shop.html?id=${encodeURIComponent(d.shopId)}`, "Open shop"); }
      catch (err) { fail(err); }
    });
  });
  render();
}

// ======================= Return (customer) - same as the Returns page =======================
const RTYPES = [["refund", "Cash refund", "Pay from galla"], ["udhaar", "Cut udhaar", "Reduce what they owe"], ["exchange", "Exchange", "Give another item"]];
const REASONS = ["Not working / faulty", "Wrong size", "Customer changed mind", "Damaged in transport", "Other"];
function returnForm(d) {
  const c0 = returnCalc(d); if (!c0) return;
  const x = c0.x;
  const box = shell(d, "Return", esc(`${x.customerName || "Walk-in customer"} · sold ${formatDateDMY(x.date)}`));
  const body = box.querySelector(".act-body"), foot = box.querySelector(".act-foot");
  if (!d.reason) d.reason = REASONS[0];
  function render() {
    const c = returnCalc(d);
    if (c.owed <= 0 && d.rtype === "udhaar") d.rtype = "refund";
    const amount = d.rtype === "exchange" ? 0 : d.rtype === "udhaar" ? c.cut : c.refund;
    body.innerHTML = `<div class="crecv-bills" style="border-color:#E3E6E8"><div class="crb" style="background:#fff"><span class="num muted">${formatDateDMY(x.date)}</span><span class="crb-items">${esc(x.productName)} · sold ${esc(saleUnitsShow(x))}</span><span class="num strong">Rs ${fmt(x.amount)}</span></div></div>
      <div class="grid2"><label class="fgroup"><span class="lbl">${c.unit === "ft" ? "Feet back" : "Quantity back"} <span class="req">*</span></span>${ibox("r-qty", 0, d.qty, "", c.unit)}<span class="hint-line">Up to ${fmt(c.max)} ${c.unit}</span></label>
        <label class="fgroup"><span class="lbl">Reason</span><select class="inp r-reason">${REASONS.map((r) => `<option${r === d.reason ? " selected" : ""}>${r}</option>`).join("")}</select></label></div>
      <div class="typegrid" style="grid-template-columns:repeat(3,minmax(0,1fr))">${RTYPES.map(([k, b, sm]) => `<button type="button" class="typebtn" data-rt="${k}" aria-pressed="${d.rtype === k}" ${k === "udhaar" && c.owed <= 0 ? "disabled" : ""}><b>${b}</b><small>${sm}</small></button>`).join("")}</div>
      <span class="hint-line">${c.owed <= 0 ? "This customer owes nothing on this sale, so udhaar can't be cut." : d.rtype === "udhaar" && c.refund > 0 ? `Only Rs ${fmt(c.owed)} is owed. The other Rs ${fmt(c.refund)} will be given back in cash.` : d.rtype === "exchange" ? "The item comes back and no money is returned. Sell the new item as usual." : ""}</span>
      <label class="checkline"><input type="checkbox" class="r-back" ${d.back ? "checked" : ""}>Item is fine, put it back in Stock</label>
      ${d.back ? "" : '<span class="hint-line warn">Not going back into Stock. It waits in "Damaged / kept aside" on the Returns page.</span>'}
      <div class="pay-preview"><div class="after"><span>${d.rtype === "refund" ? "Give back in cash" : d.rtype === "udhaar" ? "Remove from customer udhaar" : "Exchange, no money back"}</span><b class="num">Rs ${fmt(amount)}${d.rtype === "udhaar" && c.refund > 0 ? ` + Rs ${fmt(c.refund)} cash` : ""}</b></div></div>`;
    foot.innerHTML = `<button type="button" class="btn sec" data-a="cancel">Cancel</button><button type="button" class="btn pri" data-a="save">Save return</button>`;
  }
  body.addEventListener("click", (e) => { const b = e.target.closest("[data-rt]"); if (b && !b.disabled) { d.rtype = b.dataset.rt; render(); } });
  body.addEventListener("change", (e) => {
    if (e.target.classList.contains("r-back")) { d.back = e.target.checked; render(); }
    if (e.target.classList.contains("r-reason")) d.reason = e.target.value;
    if (e.target.classList.contains("r-qty")) render();
  });
  body.addEventListener("input", (e) => {
    if (!e.target.classList.contains("r-qty")) return;
    const c = returnCalc(d); let v = toNumber(e.target.value); if (v > c.max) v = c.max; d.qty = v; e.target.value = e.target.value ? String(v) : "";
  });
  foot.addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    if (b.dataset.a === "cancel") return cancel(box, d, "Return");
    withButtonLock(b, async () => {
      try {
        const r = await saveReturn(ctx.uid, d);
        const m = d.rtype === "exchange" ? "exchanged" : d.rtype === "udhaar" ? `Rs ${fmt(r.c.cut)} cut from udhaar${r.c.refund ? ` + Rs ${fmt(r.c.refund)} cash back` : ""}` : `Rs ${fmt(r.c.refund)} cash back`;
        done(box, d, `Return saved: ${fmt(r.c.qty)} ${r.c.unit} of ${x.productName} from ${x.customerName || "walk-in customer"}, ${m}. ${d.back ? (r.stockUpdated ? "Back in Stock." : "Product not found in Stock: kept aside.") : "Kept aside as damaged."}`, "returns.html", "Open Returns");
      } catch (err) { fail(err); }
    });
  });
  render();
}
const saleUnitsShow = (x) => (x.pricePerFt && x.lengthFt ? `${x.lengthFt} ft` : `${x.quantity} pcs`);

// ======================= Change payment of an old sale - same as Sales Summary =======================
function payfixForm(d) {
  const i0 = payfixInfo(d); if (!i0) return;
  const box = shell(d, "Change payment", esc(`${i0.b.customerName || "Walk-in customer"} · ${formatDateDMY(i0.b.date)}`));
  const body = box.querySelector(".act-body"), foot = box.querySelector(".act-foot");
  let paid = d.mode === "loan" ? 0 : d.mode === "cash" ? i0.max : Math.min(d.paid ?? i0.nowPaid, i0.max);
  function render() {
    const i = payfixInfo(d);
    if (d.mode === "loan") paid = 0; if (d.mode === "cash") paid = i.max;
    body.innerHTML = `<span class="hint-line" style="margin:0">Saved as Cash by mistake but it was on Loan (or the other way)? Correct how much was really paid at the time of the sale. The rest goes to Pending Payments as udhaar.</span>
      <div class="crecv-bills" style="border-color:#E3E6E8">${i.rows.map(([, x]) => `<div class="crb" style="background:#fff"><span class="num muted">${formatDateDMY(x.date)}</span><span class="crb-items">${esc(x.productName)}</span><span class="num strong">Rs ${fmt(x.amount)}</span></div>`).join("")}</div>
      <div class="seg"><button type="button" data-pm="loan" aria-pressed="${d.mode === "loan"}" style="flex:1">All on Loan</button><button type="button" data-pm="part" aria-pressed="${d.mode === "part"}" style="flex:1">Part paid</button><button type="button" data-pm="cash" aria-pressed="${d.mode === "cash"}" style="flex:1">Fully paid</button></div>
      ${d.mode === "part" ? `<label class="fgroup"><span class="lbl">Paid at the time of sale</span>${ibox("pf-amt", 0, paid)}</label>` : ""}
      <div class="pay-preview pf-prev"></div>`;
    foot.innerHTML = `<button type="button" class="btn sec" data-a="cancel">Cancel</button><button type="button" class="btn pri" data-a="save">Save change</button>`;
    prev();
  }
  function prev() {
    const i = payfixInfo(d), u = i.max - paid;
    body.querySelector(".pf-prev").innerHTML = `<div><span>Bill total</span><b class="num">${money(i.total)}</b></div>${i.cuts ? `<div><span>Taken off by returns</span><b class="num">${money(i.cuts)}</b></div>` : ""}${i.logged ? `<div><span>Udhaar already paid back later</span><b class="num t-green">${money(i.logged)}</b></div>` : ""}<div><span>Paid at the time of sale</span><b class="num t-green">${money(paid)}</b></div><div class="after"><span>Udhaar (goes to Pending Payments)</span><b class="num ${u > 0 ? "t-amber" : "t-green"}">${money(u)}</b></div>`;
  }
  body.addEventListener("click", (e) => { const b = e.target.closest("[data-pm]"); if (b) { d.mode = b.dataset.pm; if (d.mode === "part") paid = Math.min(payfixInfo(d).nowPaid, payfixInfo(d).max); render(); } });
  body.addEventListener("input", (e) => { if (!e.target.classList.contains("pf-amt")) return; const i = payfixInfo(d); paid = Math.min(toNumber(e.target.value), i.max); d.paid = paid; e.target.value = e.target.value ? formatWithCommas(paid) : ""; prev(); });
  foot.addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    if (b.dataset.a === "cancel") return cancel(box, d, "Change payment");
    withButtonLock(b, async () => {
      try { const r = await savePayfix(ctx.uid, d, paid); done(box, d, r.udhaar > 0 ? `Payment changed: Rs ${fmt(r.udhaar)} is now udhaar${i0.b.customerName ? " for " + i0.b.customerName : ""}.` : "Payment changed: the sale is now fully paid.", "pending.html", "Open Pending Payments"); }
      catch (err) { fail(err); }
    });
  });
  render();
}

// ======================= Expense (Expenses page) =======================
function expenseForm(d) {
  const title = d.editId ? "Edit expense" : "Add expense";
  const box = shell(d, title, "Shop running cost");
  const body = box.querySelector(".act-body"), foot = box.querySelector(".act-foot");
  body.innerHTML = `<div class="fgroup"><span class="lbl">Kind <span class="req">*</span></span><div class="x-kinds e-kinds"></div></div>
    <div class="pay-row"><label class="fgroup"><span class="lbl">Amount <span class="req">*</span></span>${ibox("e-amt", 0, d.amount || "")}</label>
      <label class="fgroup"><span class="lbl">Date</span><input class="inp e-date mono" value="${formatDateDMY(d.date)}" inputmode="numeric"></label></div>
    <div class="pay-row"><label class="fgroup"><span class="lbl">Paid by</span>${methodSel("e-meth", d.method)}</label><label class="fgroup"><span class="lbl">Note</span><input class="inp e-note" value="${esc(d.note)}" placeholder="e.g. October rent"></label></div>
    <span class="hint-line" style="margin:0">Paid by Cash = it came out of the galla, so Cash Closing takes it off too.</span>`;
  const kinds = () => { body.querySelector(".e-kinds").innerHTML = KINDS.map(([k, l, c]) => `<button type="button" class="x-kind" data-k="${k}" aria-pressed="${d.kind === k}" style="--kc:${c}">${l}</button>`).join(""); };
  kinds();
  attachDateMask(body.querySelector(".e-date"));
  body.addEventListener("click", (e) => { const b = e.target.closest("[data-k]"); if (b) { d.kind = b.dataset.k; kinds(); } });
  body.addEventListener("input", (e) => { if (e.target.classList.contains("e-amt")) { d.amount = toNumber(e.target.value); e.target.value = e.target.value ? formatWithCommas(d.amount) : ""; } });
  foot.innerHTML = `<button type="button" class="btn sec" data-a="cancel">Cancel</button><button type="button" class="btn pri" data-a="save">${d.editId ? "Save changes" : "Save expense"}</button>`;
  foot.addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    if (b.dataset.a === "cancel") return cancel(box, d, title);
    withButtonLock(b, async () => {
      d.date = parseDMY(body.querySelector(".e-date").value); d.method = body.querySelector(".e-meth").value; d.note = body.querySelector(".e-note").value;
      if (d.amount <= 0) { alert("Please enter the amount."); return; }
      if (!d.date) { alert("Please enter the date as DD-MM-YY."); return; }
      try { await saveExpense(ctx.uid, d); done(box, d, `${kindLabel(d.kind)} Rs ${fmt(d.amount)} ${d.editId ? "updated" : "added"} (${formatDateDMY(d.date)}, ${d.method}).`, "expenses.html", "Open Expenses"); }
      catch (err) { fail(err); }
    });
  });
  setTimeout(() => body.querySelector(".e-amt").focus({ preventScroll: true }), 50);
}

// ======================= Product (Stock List → Add Product / Edit) =======================
function productForm(d) {
  const title = d.editId ? "Edit product" : "Add Product";
  const box = shell(d, title, d.editId ? esc(CATEGORY_LABELS[d.category]) : "New item for the Stock List");
  const body = box.querySelector(".act-body"), foot = box.querySelector(".act-foot");
  const collect = () => { const v = {}; body.querySelectorAll("input[data-key]").forEach((i) => { v[i.dataset.key] = i.disabled ? "" : i.value; }); return v; };
  function render() {
    const defs = FIELDS[d.category];
    body.innerHTML = (d.editId ? "" : `<div class="fgroup" style="gap:8px"><span class="lbl">Category <span class="req">*</span></span><div class="cats">${CATEGORY_ORDER.map((c) => `<button type="button" class="catbtn" data-cat="${c}" aria-pressed="${d.category === c}">${CATEGORY_LABELS[c]}</button>`).join("")}</div></div>`)
      + `<div class="grid2">${defs.map((f) => `<label class="fgroup${f.full ? " full" : ""}"><span class="lbl">${f.label}${f.required ? ' <span class="req">*</span>' : ""}</span><span class="ibox">${f.prefix ? `<span class="aff">${f.prefix}</span>` : ""}<input type="text" data-key="${f.key}" data-kind="${f.kind}" inputmode="${f.mode}" placeholder="${esc(f.placeholder)}" class="${f.mono ? "mono" : ""}" value="${esc(f.kind === "commas" && d.values[f.key] ? formatWithCommas(d.values[f.key]) : d.values[f.key] ?? "")}" autocomplete="off">${f.suffix ? `<span class="aff">${f.suffix}</span>` : ""}</span></label>`).join("")}</div>`
      + `<span class="hint-line" style="margin:0">${d.category === "pump" ? "Price and cost are per piece." : d.category === "other" ? "Enter either a quantity (pieces) or a length (feet), not both." : "Length is the total feet; prices are per foot. Bundles split the feet equally."}${d.editId ? "" : " Bought from a supplier? Save it here, then use New Purchase for the bill."}</span>`;
    excl();
  }
  function excl() {
    if (d.category !== "other") return;
    const q = body.querySelector('input[data-key="quantity"]'), l = body.querySelector('input[data-key="length"]');
    const hq = toNumber(q.value) > 0, hl = toNumber(l.value) > 0;
    q.disabled = hl && !hq; l.disabled = hq && !hl;
  }
  render();
  body.addEventListener("click", (e) => { const b = e.target.closest("[data-cat]"); if (b && !d.editId) { d.values = Object.assign(collect(), {}); d.category = b.dataset.cat; render(); } });
  body.addEventListener("input", (e) => {
    const i = e.target, k = i.dataset.kind; if (!i.dataset.key) return;
    if (k === "commas") i.value = formatWithCommas(i.value); else if (k === "digits") i.value = digitsOnly(i.value);
    else if (k === "cap" && i.value) i.value = i.value.charAt(0).toUpperCase() + i.value.slice(1);
    d.values = collect(); excl();
  });
  foot.innerHTML = `<button type="button" class="btn sec" data-a="cancel">Cancel</button><button type="button" class="btn pri" data-a="save">${d.editId ? "Save Changes" : "Save Product"}</button>`;
  foot.addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    if (b.dataset.a === "cancel") return cancel(box, d, title);
    withButtonLock(b, async () => {
      try { const p = await saveProduct(ctx.uid, d, collect()); done(box, d, `${sellNameOf(p)} ${d.editId ? "updated" : "added to the Stock List"} · Rs ${fmt(p.price)}${byFeet(p) ? " / ft" : ""}.`, "stock.html", "Open Stock List"); }
      catch (err) { fail(err); }
    });
  });
}

// ======================= New supplier / wholesale shop =======================
function partyForm(d) {
  const shop = d.kind === "shop", title = shop ? "Add shop" : "Add supplier";
  const box = shell(d, title, shop ? "Wholesale shop (takes stock on account)" : "Company / person you buy stock from");
  const body = box.querySelector(".act-body"), foot = box.querySelector(".act-foot");
  body.innerHTML = `<div class="pay-row"><label class="fgroup"><span class="lbl">${shop ? "Shop name" : "Supplier name"} <span class="req">*</span></span><input class="inp p-name" value="${esc(d.name)}"></label>
      <label class="fgroup"><span class="lbl">Phone</span><input class="inp p-phone mono" inputmode="numeric" maxlength="13" value="${esc(d.phone)}" placeholder="03XXXXXXXXX"></label></div>
    <div class="pay-row">${shop ? `<label class="fgroup"><span class="lbl">Owner</span><input class="inp p-owner" value="${esc(d.owner)}"></label>` : ""}<label class="fgroup"><span class="lbl">Address / city</span><input class="inp p-addr" value="${esc(d.address)}"></label></div>
    <label class="fgroup"><span class="lbl">${shop ? "Old balance they owe you" : "Old balance you owe them"} (optional)</span>${ibox("p-open", 0, d.opening || "")}</label>`;
  body.addEventListener("input", (e) => { if (e.target.classList.contains("p-open")) { d.opening = toNumber(e.target.value); e.target.value = e.target.value ? formatWithCommas(d.opening) : ""; } if (e.target.classList.contains("p-phone")) e.target.value = digitsOnly(e.target.value); });
  foot.innerHTML = `<button type="button" class="btn sec" data-a="cancel">Cancel</button><button type="button" class="btn pri" data-a="save">${title}</button>`;
  foot.addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    if (b.dataset.a === "cancel") return cancel(box, d, title);
    withButtonLock(b, async () => {
      d.name = body.querySelector(".p-name").value.trim(); d.phone = body.querySelector(".p-phone").value; d.address = body.querySelector(".p-addr").value;
      if (shop) d.owner = body.querySelector(".p-owner").value;
      try { const id = await saveParty(ctx.uid, d); done(box, d, `${d.name} added as a ${shop ? "wholesale shop" : "supplier"}.`, `${shop ? "shop" : "supplier"}.html?id=${encodeURIComponent(id)}`, shop ? "Open shop" : "Open supplier"); }
      catch (err) { fail(err); }
    });
  });
}

// ======================= Wholesale shop return =======================
function shopReturnForm(d) {
  const c0 = shopReturnCalc(d); if (!c0) return;
  const box = shell(d, "Shop return", esc(`${c0.shop.name || "Shop"} · bill of ${formatDateDMY(c0.b.date)}`));
  const body = box.querySelector(".act-body"), foot = box.querySelector(".act-foot");
  function render() {
    const c = shopReturnCalc(d);
    body.innerHTML = `<div class="crecv-bills" style="border-color:#E3E6E8"><div class="crb" style="background:#fff"><span class="num muted">${formatDateDMY(c.b.date)}</span><span class="crb-items">${esc(c.i.name)} · given ${fmt(c.i.qty)} ${c.unit}${Number(c.i.returnedQty || 0) ? `, ${fmt(c.i.returnedQty)} back already` : ""}</span><span class="num strong">Rs ${fmt(c.i.price || 0)}${c.unit === "ft" ? "/ft" : ""}</span></div></div>
      <div class="pay-row"><label class="fgroup"><span class="lbl">${c.unit === "ft" ? "Feet back" : "Quantity back"} <span class="req">*</span></span>${ibox("sr-qty", 0, d.qty, "", c.unit)}<span class="hint-line" style="margin:0">Up to ${fmt(c.max)} ${c.unit}</span></label>
        <label class="fgroup"><span class="lbl">Reason</span><input class="inp sr-reason" value="${esc(d.reason)}" placeholder="Optional"></label></div>
      <label class="checkline"><input type="checkbox" class="sr-back" ${d.back ? "checked" : ""}> Put back into Stock (untick if damaged)</label>
      <label class="checkline"><input type="checkbox" class="sr-exch" ${d.exch ? "checked" : ""}> Exchange (they take another item instead)</label>
      <div class="pay-preview"><div class="after"><span>Taken off ${esc(c.shop.name || "the shop")}'s bill</span><b class="num t-green">${money(c.value)}</b></div></div>`;
  }
  render();
  body.addEventListener("input", (e) => {
    if (e.target.classList.contains("sr-qty")) { const c = shopReturnCalc(d); d.qty = Math.min(toNumber(e.target.value), c.max); body.querySelector(".pay-preview").innerHTML = `<div class="after"><span>Taken off ${esc(c.shop.name || "the shop")}'s bill</span><b class="num t-green">${money(shopReturnCalc(d).value)}</b></div>`; }
    if (e.target.classList.contains("sr-reason")) d.reason = e.target.value;
  });
  body.addEventListener("change", (e) => { if (e.target.classList.contains("sr-back")) d.back = e.target.checked; if (e.target.classList.contains("sr-exch")) d.exch = e.target.checked; });
  foot.innerHTML = `<button type="button" class="btn sec" data-a="cancel">Cancel</button><button type="button" class="btn pri" data-a="save">Save return</button>`;
  foot.addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    if (b.dataset.a === "cancel") return cancel(box, d, "Shop return");
    withButtonLock(b, async () => {
      try { const r = await saveShopReturn(ctx.uid, d); done(box, d, `${fmt(r.c.qty)} ${r.c.unit} of ${r.c.i.name} back from ${r.c.shop.name}: Rs ${fmt(r.c.value)} taken off their bill.${d.back ? (r.stockUpdated ? " Added back to Stock." : " Product not found in Stock (kept aside).") : " Kept aside as damaged."}`, `shop.html?id=${encodeURIComponent(d.shopId)}${d.exch ? "&give=1" : ""}`, d.exch ? "Give the new item" : "Open shop"); }
      catch (err) { fail(err); }
    });
  });
}

// ======================= Edit customer on sales =======================
function custfixForm(d) {
  const box = shell(d, "Edit customer", esc(`${d.billKeys.length} sale${d.billKeys.length === 1 ? "" : "s"} · now: ${d.oldName || "no name"}${d.oldPhone ? " · " + d.oldPhone : ""}`));
  const body = box.querySelector(".act-body"), foot = box.querySelector(".act-foot");
  body.innerHTML = `<div class="pay-row"><label class="fgroup"><span class="lbl">Customer name</span><input class="inp c-name" value="${esc(d.name)}"></label>
    <label class="fgroup"><span class="lbl">Contact number</span><input class="inp c-phone mono" inputmode="numeric" maxlength="13" value="${esc(d.phone)}"></label></div>
    <span class="hint-line" style="margin:0">Changes the name and number on ${d.billKeys.length === 1 ? "this sale" : "these sales"} (Sales Summary, Customers, Pending Payments).</span>`;
  body.addEventListener("input", (e) => { if (e.target.classList.contains("c-phone")) e.target.value = digitsOnly(e.target.value); });
  foot.innerHTML = `<button type="button" class="btn sec" data-a="cancel">Cancel</button><button type="button" class="btn pri" data-a="save">Save</button>`;
  foot.addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    if (b.dataset.a === "cancel") return cancel(box, d, "Edit customer");
    withButtonLock(b, async () => {
      d.name = body.querySelector(".c-name").value; d.phone = body.querySelector(".c-phone").value;
      try { const n = await saveCustfix(ctx.uid, d); done(box, d, `Customer changed to ${d.name || "no name"}${d.phone ? " · " + d.phone : ""} on ${n} sale record${n === 1 ? "" : "s"}.`, "sales.html", "Open Sales Summary"); }
      catch (err) { fail(err); }
    });
  });
}

// ======================= Delete a record =======================
function deleteForm(d) {
  const title = "Delete " + d.kind.replace(/_/g, " ");
  const box = shell(d, title, "Entered by mistake?");
  const body = box.querySelector(".act-body"), foot = box.querySelector(".act-foot");
  body.innerHTML = `<div class="crecv-bills" style="border-color:#E2B4AF"><div class="crb" style="background:#FBF1F0"><span class="crb-items" style="grid-column:1/-1">${esc(d.label)}</span></div></div>
    <span class="hint-line" style="margin:0">${esc(d.effect)}</span>`;
  foot.innerHTML = `<button type="button" class="btn sec" data-a="cancel">Keep it</button><button type="button" class="btn red" data-a="del">Delete</button>`;
  foot.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    if (b.dataset.a === "cancel") return cancel(box, d, title);
    if (!(await confirmDialog({ title: title.charAt(0).toUpperCase() + title.slice(1) + "?", message: `${d.label}. ${d.effect}`, confirmLabel: "Delete", danger: true }))) return;
    withButtonLock(b, async () => {
      try { await doDelete(ctx.uid, d); done(box, d, `Deleted: ${d.label}.`, ({ expense: "expenses.html", product: "stock.html", supplier_payment: "suppliers.html", shop_payment: "shops.html", purchase_bill: "purchases.html", shop_bill: "shops.html", pending_product: "pending-products.html" })[d.kind], "Open page"); }
      catch (err) { fail(err); }
    });
  });
}
