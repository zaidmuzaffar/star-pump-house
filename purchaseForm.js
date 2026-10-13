// "New purchase bill" form. Used on the Purchases page (any supplier) and on a supplier's own page (that supplier only).
// Lines can be products already in stock, or a brand-new product made with the same Add Product dialog as the Stock List.
// "Add these items to Upcoming Products" (ticked): the bill goes to the supplier and every item goes to Upcoming Products
//   (stock is added later, when it arrives). Not ticked = not ordered yet: no bill, nothing paid, items wait in Pending Products.
import { col, ref, addDoc, updateDoc } from './common.js?v=55';
import {
  CATEGORY_LABELS, CATEGORY_ORDER, ICONS, esc, fmt, formatDateDMY, todayString, parseDMY, attachDateMask,
  attachNumberFormatting, formatWithCommas, toNumber, withButtonLock, byFeet, isCable, metres, perBundle, sellNameOf, productName, pillHtml,
  stockText, isLowStock
} from './utils.js?v=55';
import { upcomingDoc, addUpcoming, pendingDoc } from './orderUtils.js?v=55';
import { buildProduct } from './productForm.js?v=55';
import { pickerHtml, initPicker, ensureSupplier, recordPurchase, supplierSummary } from './supplierUtils.js?v=55';

export function initPurchaseForm(root, { prefix = "pf", fixedSupplierId = null, getUid, getSuppliers, getProducts, getPurchases, getPayments, productModal, onSaved }) {
  const id = (s) => `${prefix}-${s}`;
  const $ = (s) => document.getElementById(id(s));
  root.innerHTML = `
    <div class="form-pad">
      <div class="reorder-note" id="${id("reorder")}" hidden></div>
      ${fixedSupplierId ? "" : pickerHtml(prefix + "s", { showMoney: false })}
      <div class="grid3">
        <label class="fgroup"><span class="lbl">Purchase date <span class="req">*</span></span><input class="inp sm mono" type="text" inputmode="numeric" id="${id("date")}" placeholder="DD-MM-YY"></label>
        <label class="fgroup"><span class="lbl">Bill number</span><input class="inp sm" type="text" id="${id("billno")}" placeholder="Supplier's bill no. (optional)"></label>
        <label class="fgroup" id="${id("exp-wrap")}"><span class="lbl">Expected arrival</span><input class="inp sm mono" type="text" inputmode="numeric" id="${id("expected")}" placeholder="DD-MM-YY (optional)"></label>
      </div>
      <div class="lines scroll-x"><div style="min-width:780px" id="${id("lines")}"></div></div>
      <div class="ph-actions">
        <button type="button" class="btn sec" id="${id("addline")}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg>Item from Stock List</button>
        <button type="button" class="btn sec" id="${id("newprod")}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg>New product</button>
      </div>
      <div class="form-bottom">
        <div class="stack" style="gap:2px;max-width:420px">
          <label class="checkline"><input type="checkbox" id="${id("tostock")}" checked>Add these items to Upcoming Products</label>
          <span class="hint-line" id="${id("tostock-hint")}">Ordered: the bill goes to the supplier, items wait in Upcoming Products and go into Stock when they arrive.</span>
        </div>
        <div class="totals">
          <div class="tot"><span class="l">Bill total (Rs)</span><span class="v" id="${id("total")}">0</span></div>
          <label class="fgroup" style="width:170px"><span class="lbl">Paid now <span class="req">*</span></span><span class="ibox" style="height:44px"><span class="aff">Rs</span><input type="text" inputmode="numeric" class="mono" id="${id("paid")}" value="0"></span></label>
          <div class="tot amber"><span class="l">Remaining Cost (Rs)</span><span class="v" id="${id("due")}">0</span></div>
          <button type="button" class="btn pri" id="${id("save")}">Save Purchase</button>
        </div>
      </div>
    </div>`;

  const picker = fixedSupplierId ? null : initPicker(prefix + "s", {});
  let lines = [];
  attachDateMask($("date"));
  attachDateMask($("expected"));
  attachNumberFormatting($("paid"), true);

  const productById = (pid) => { const r = getProducts().find((x) => x[0] === pid); return r ? r[1] : null; };
  const lineUnitFeet = (l) => (l.newProduct ? byFeet(l.newProduct) : (productById(l.productId) ? byFeet(productById(l.productId)) : false));
  const lineTotal = (l) => toNumber(l.qty) * toNumber(l.cost);
  const COLS = "minmax(260px,2fr) 150px 170px 140px 48px";

  // ---------- Product picker: name on the left; on the right the LOW badge (only when low), then the stock left ----------
  const right = (p) => `<span class="ppk-right">${isLowStock(p) ? '<span class="low">Low</span>' : ""}<span class="ppk-qty">${esc(stockText(p))}</span></span>`;
  const pickLabel = (p) => p ? `<span class="ppk-name">${esc(sellNameOf(p))}</span>${right(p)}` : '<span class="ppk-name muted">Choose a product…</span>';
  let menu = null, menuFor = -1, menuAt = -1, menuItems = [];
  function closeMenu() { if (menu) { menu.remove(); menu = null; menuFor = -1; } }
  function openMenu(i, btn) {
    closeMenu();
    menuFor = i;
    menu = document.createElement("div");
    menu.className = "ppk-menu";
    menu.setAttribute("role", "listbox");
    menu.innerHTML = `<div class="ppk-search"><input type="search" placeholder="Search product…" aria-label="Search product" autocomplete="off"></div><div class="ppk-list"></div>`;
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect(), w = Math.max(r.width, 360);
    menu.style.width = w + "px";
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + "px";
    const below = window.innerHeight - r.bottom;
    if (below < 300 && r.top > below) { menu.style.bottom = (window.innerHeight - r.top + 4) + "px"; menu.style.maxHeight = Math.min(420, r.top - 16) + "px"; }
    else { menu.style.top = (r.bottom + 4) + "px"; menu.style.maxHeight = Math.min(420, below - 16) + "px"; }
    const inp = menu.querySelector("input");
    inp.addEventListener("input", () => fillMenu(inp.value));
    inp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); moveMenu(e.key === "ArrowDown" ? 1 : -1); }
      else if (e.key === "Enter") { e.preventDefault(); if (menuItems[menuAt]) choose(menuItems[menuAt]); }
      else if (e.key === "Escape") { e.preventDefault(); closeMenu(); btn.focus(); }
    });
    menu.addEventListener("mousedown", (e) => { const o = e.target.closest("[data-pid]"); if (o) { e.preventDefault(); choose(o.dataset.pid); } });
    fillMenu("");
    inp.focus();
  }
  function fillMenu(q) {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const sorted = getProducts().slice().sort((a, b) =>
      CATEGORY_ORDER.indexOf(a[1].category) - CATEGORY_ORDER.indexOf(b[1].category) ||
      Number(isLowStock(b[1])) - Number(isLowStock(a[1])) || productName(a[1]).localeCompare(productName(b[1])));
    const cur = lines[menuFor] ? lines[menuFor].productId : "";
    menuItems = []; menuAt = -1;
    const html = CATEGORY_ORDER.map((cat) => {
      const opts = sorted.filter(([, p]) => p.category === cat && words.every((w) => sellNameOf(p).toLowerCase().includes(w)));
      if (!opts.length) return "";
      return `<div class="ppk-group">${CATEGORY_LABELS[cat]}</div>` + opts.map(([pid, p]) => {
        menuItems.push(pid);
        return `<div class="ppk-opt${pid === cur ? " cur" : ""}" role="option" data-pid="${pid}" aria-selected="${pid === cur}"><span class="ppk-name">${esc(sellNameOf(p))}</span>${right(p)}</div>`;
      }).join("");
    }).join("");
    menu.querySelector(".ppk-list").innerHTML = html || '<div class="ppk-empty">No product found</div>';
  }
  function moveMenu(d) {
    if (!menuItems.length) return;
    menuAt = (menuAt + d + menuItems.length) % menuItems.length;
    menu.querySelectorAll(".ppk-opt").forEach((o, k) => o.classList.toggle("hot", k === menuAt));
    const hot = menu.querySelector(".ppk-opt.hot"); if (hot) hot.scrollIntoView({ block: "nearest" });
  }
  function choose(pid) {
    const i = menuFor;
    closeMenu();
    if (i < 0 || !lines[i]) return;
    lines[i].productId = pid;
    const p = productById(pid);
    if (p && p.cost && !toNumber(lines[i].cost)) lines[i].cost = formatWithCommas(p.cost);
    renderLines();
    const q = $("lines").querySelector(`[data-i="${i}"] input[data-k="qty"]`); if (q) q.focus();
  }
  document.addEventListener("mousedown", (e) => { if (menu && !menu.contains(e.target) && !e.target.closest("[data-pick]")) closeMenu(); });
  window.addEventListener("resize", closeMenu);
  document.addEventListener("scroll", (e) => { if (menu && !menu.contains(e.target)) closeMenu(); }, true);

  function totals() {
    const bill = lines.reduce((a, l) => a + lineTotal(l), 0);
    const paid = Math.min(toNumber($("paid").value), bill);
    $("total").textContent = fmt(bill);
    $("due").textContent = fmt(bill - paid);
  }

  function renderLines() {
    $("lines").innerHTML = `<div class="head" style="grid-template-columns:${COLS};height:40px"><span>Product</span><span class="num">Qty</span><span class="num">Cost price (Rs)</span><span class="num">Line total</span><span></span></div>` +
      (lines.length ? lines.map((l, i) => {
        const unit = lineUnitFeet(l) ? "ft" : "pcs";
        const product = l.newProduct
          ? `<span class="newline"><span class="pill b-exch">New</span>${pillHtml(l.newProduct.category)}<span class="w500">${esc(sellNameOf(l.newProduct))}</span></span>`
          : `<button type="button" class="inp sm ppk-btn" data-pick="${i}" aria-haspopup="listbox" aria-label="Product">${pickLabel(productById(l.productId))}<span class="ppk-caret" aria-hidden="true">▾</span></button>`;
        return `<div class="row" style="grid-template-columns:${COLS}" data-i="${i}">
          ${product}
          <span class="ibox" style="height:44px"><input type="text" inputmode="numeric" class="mono" data-k="qty" value="${esc(l.qty)}" placeholder="0" aria-label="Quantity"><span class="aff">${unit}</span></span>
          <span class="ibox" style="height:44px"><span class="aff">Rs</span><input type="text" inputmode="numeric" class="mono" data-k="cost" value="${esc(l.cost)}" placeholder="0" aria-label="Cost price"><span class="aff">${unit === "ft" ? "/ ft" : ""}</span></span>
          <span class="num strong" data-total>${fmt(lineTotal(l))}</span>
          <span><button type="button" class="iconbtn del" data-rm="${i}" aria-label="Remove item">${ICONS.del}</button></span>
        </div>`;
      }).join("") : '<div class="empty" style="padding:24px">Add an item from your Stock List, or a New product.</div>');
    totals();
  }

  $("lines").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick]");
    if (!b) return;
    const i = Number(b.dataset.pick);
    if (menu && menuFor === i) closeMenu(); else openMenu(i, b);
  });
  $("lines").addEventListener("input", (e) => {
    const k = e.target.dataset.k;
    if (k !== "qty" && k !== "cost") return;
    const row = e.target.closest("[data-i]"), i = Number(row.dataset.i);
    e.target.value = k === "cost" ? formatWithCommas(e.target.value) : String(toNumber(e.target.value) || "");
    lines[i][k] = e.target.value;
    row.querySelector("[data-total]").textContent = fmt(lineTotal(lines[i]));
    totals();
  });
  $("lines").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm]");
    if (b) { lines.splice(Number(b.dataset.rm), 1); renderLines(); }
  });
  $("paid").addEventListener("input", totals);
  function applyMode() {
    const ordered = $("tostock").checked;
    $("paid").disabled = !ordered;
    if (!ordered) $("paid").value = "0";
    $("exp-wrap").hidden = !ordered;
    $("tostock-hint").textContent = ordered
      ? "Ordered: the bill goes to the supplier, items wait in Upcoming Products and go into Stock when they arrive."
      : "Not ordered yet: no bill and nothing paid. Items wait in Pending Products until you order them.";
    $("save").textContent = ordered ? "Save Purchase" : "Save to Pending Products";
    totals();
  }
  $("tostock").addEventListener("change", applyMode);
  $("addline").addEventListener("click", () => { lines.push({ productId: "", qty: "", cost: "" }); renderLines(); });

  // Brand-new product: same dialog as Stock List → Add Product. It is saved to Stock when the bill is saved.
  $("newprod").addEventListener("click", () => {
    productModal.open({
      title: "New product", sub: "It is added to your Stock List when you save this bill.", saveLabel: "Add to bill", category: "pump",
      onSave: async (category, v) => {
        const built = buildProduct(category, v);
        if (built.error) { alert(built.error); return false; }
        const data = built.data;
        if (!(data.cost > 0)) { alert("Please enter the Cost price — it is the price on this bill."); return false; }
        const units = byFeet(data) ? metres(data) : Number(data.quantity || 0);
        lines.push({ newProduct: data, qty: String(units), cost: formatWithCommas(data.cost) });
        renderLines();
        return true;
      }
    });
  });

  async function save() {
    const uid = getUid();
    const suppliers = getSuppliers();
    let pick;
    if (fixedSupplierId) {
      const r = suppliers.find((x) => x[0] === fixedSupplierId);
      if (!r) { alert("Supplier not found."); return; }
      pick = { id: r[0], name: r[1].name, phone: r[1].phone || "" };
    } else {
      pick = picker.read();
      if (pick.error) { alert(pick.error); return; }
    }
    const date = parseDMY($("date").value);
    if (!date) { alert("Please enter the purchase date as DD-MM-YY."); return; }
    if (!$("paid").value.trim()) { alert("Please enter how much you paid now (write 0 if nothing)."); return; }
    if (!lines.length) { alert("Please add at least one item."); return; }
    for (const l of lines) {
      const name = l.newProduct ? sellNameOf(l.newProduct) : (productById(l.productId) ? sellNameOf(productById(l.productId)) : "");
      if (!l.newProduct && !productById(l.productId)) { alert("Please choose a product for every item."); return; }
      if (toNumber(l.qty) <= 0) { alert(`Please enter the quantity for ${name}.`); return; }
      if (toNumber(l.cost) <= 0) { alert(`Please enter the cost price for ${name}.`); return; }
    }
    const ordered = $("tostock").checked;
    const expected = $("expected").value.trim() ? parseDMY($("expected").value) : "";
    if (ordered && $("expected").value.trim() && !expected) { alert("Please enter the expected arrival as DD-MM-YY, or leave it empty."); return; }
    const sumOf = (sid) => { const r = suppliers.find((x) => x[0] === sid); return r ? supplierSummary(sid, r[1], getPurchases(), getPayments()).balance : 0; };

    try {
      const sup = await ensureSupplier(uid, pick, suppliers);
      const items = [], products = [];
      for (const l of lines) {
        const qty = toNumber(l.qty), cost = toNumber(l.cost);
        if (l.newProduct) {
          // a brand-new product joins the Stock List with 0 in stock; the ordered amount comes in when it arrives
          const data = Object.assign({}, l.newProduct, { cost, supplierId: sup.id, supplierName: sup.name });
          if (byFeet(data)) {
            data.length = "0ft";
            const nb = Number(data.bundle) || 0;
            if (isCable(data)) { data.perBundle = nb > 0 ? Math.round(qty / nb * 100) / 100 : 0; data.bundle = "0"; }
          } else data.quantity = 0;
          const d = await addDoc(col(uid, "products"), data);
          items.push({ productId: d.id, name: sellNameOf(data), category: data.category, qty, unit: byFeet(data) ? "ft" : "pcs", cost, total: qty * cost, newProduct: true });
          products.push(data);
        } else {
          const p = productById(l.productId);
          items.push({ productId: l.productId, name: sellNameOf(p), category: p.category, qty, unit: byFeet(p) ? "ft" : "pcs", cost, total: qty * cost });
          products.push(p);
        }
      }
      if (!ordered) {
        for (const it of items) await addDoc(col(uid, "pendingProducts"), Object.assign(pendingDoc(it, sup, date), { billNo: $("billno").value.trim() }));
        onSaved && onSaved(sup, "pending");
        return;
      }
      const bill = await recordPurchase(uid, { sup, date, items, paid: toNumber($("paid").value), billNo: $("billno").value.trim(), balanceBefore: pick.id ? sumOf(pick.id) : 0, addedToStock: false, extra: { toUpcoming: true } });
      for (let i = 0; i < items.length; i++) {
        await addUpcoming(uid, Object.assign(upcomingDoc(products[i], items[i].productId, { qty: items[i].qty, cost: items[i].cost, sup, purchaseId: bill.id, itemIndex: i, expectedDate: expected }), { orderedDate: date }));
      }
      onSaved && onSaved(sup, "upcoming");
    } catch (error) { alert("Error saving purchase: " + error.message); }
  }
  $("save").addEventListener("click", (e) => withButtonLock(e.currentTarget, save));

  return {
    reset({ supplierId } = {}) {
      lines = [{ productId: "", qty: "", cost: "" }];
      $("date").value = formatDateDMY(todayString());
      $("billno").value = "";
      $("paid").value = "0";
      $("tostock").checked = true;
      $("expected").value = "";
      $("reorder").hidden = true;
      if (picker) { picker.setSuppliers(getSuppliers()); picker.reset(); if (supplierId) picker.select(supplierId); }
      applyMode();
      renderLines();
    },
    // Reorder from the Dashboard: the low items are already on the bill, with their stock shown; type how many to order.
    prefill(rows) {
      if (!rows.length) return;
      lines = rows.map(([pid, p]) => ({ productId: pid, qty: "", cost: p.cost ? formatWithCommas(p.cost) : "" }));
      $("reorder").innerHTML = `<b>Reorder:</b> ${rows.length} item${rows.length === 1 ? " is" : "s are"} running low and already added below with what is left in stock. Type how many to order, remove what you don't need.`;
      $("reorder").hidden = false;
      const sups = [...new Set(rows.map(([, p]) => p.supplierId).filter(Boolean))];
      if (picker && sups.length === 1) picker.select(sups[0]);
      renderLines();
    },
    setSuppliers(list) { if (picker) picker.setSuppliers(list); },
    refreshProducts() { if (lines.some((l) => !l.newProduct)) renderLines(); }
  };
}
