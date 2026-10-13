// Shared "Add / Edit product" dialog (used by Stock List and Upcoming Products).
import { digitsOnly, formatWithCommas, toNumber, esc, withButtonLock } from './utils.js?v=55';
import { pickerHtml, initPicker } from './supplierUtils.js?v=55';

const F = (key, label, required, placeholder, o = {}) => ({ key, label, required, placeholder, mode: "text", prefix: "", suffix: "", full: false, mono: false, kind: "text", ...o });
const price = F("price", "Sale price", true, "0", { mode: "numeric", prefix: "Rs", mono: true, kind: "commas" });
// Cost price = what you paid for it. Optional; only used for the Profit Report.
const cost = F("cost", "Cost price", false, "0", { mode: "numeric", prefix: "Rs", mono: true, kind: "commas" });
const quantity = F("quantity", "Quantity", true, "0", { mode: "numeric", suffix: "pcs", mono: true, kind: "digits", step: true });
const cable = [
  F("name", "Name", false, "e.g. Polycab (optional)", { full: true, kind: "cap" }),
  F("size", "Size", true, "e.g. 7/29", {}),
  F("length", "Length", true, "0", { mode: "numeric", suffix: "ft", mono: true, kind: "digits" }),
  F("bundle", "Bundle", false, "0", { mode: "numeric", mono: true, kind: "digits", full: true }),
  cost,
  price
];

export const FIELDS = {
  pump: [F("name", "Name", true, "e.g. Submersible Pump 1 HP", { full: true, kind: "cap" }), F("brand", "Detail", false, "e.g. 1 HP, 2 inch outlet", { full: true, kind: "cap" }), cost, price, Object.assign({}, quantity, { full: true })],
  wire: cable,
  safety_cable: cable,
  other: [F("name", "Name", true, "e.g. Foot Valve", { full: true, kind: "cap" }), F("size", "Size", true, "e.g. 1.5 inch", {}), F("length", "Length", true, "0", { mode: "numeric", suffix: "ft", mono: true, kind: "digits" }), quantity, cost, Object.assign({}, price, { full: true })]
};

const DATE_FIELD = F("expected", "Expected date", true, "DD-MM-YY", { mono: true, kind: "date", full: true });

const COST_HINT = " Cost price (optional) is what you paid — only you see it, and it is used for the Profit Report.";
const HINTS = {
  text: "Text starts with a capital letter automatically. Price and quantity take digits only and show commas." + COST_HINT,
  other: "Enter either a Quantity (pieces) or a Length (feet) — filling one switches the other off. Prices are per piece, or per foot when you use length." + COST_HINT,
  cable: "Length is the total feet. With bundles, feet are split equally (2 bundles + 1000 ft = 500 ft each). Prices are per foot. Name and bundle are optional." + COST_HINT
};

// Turns the typed values into the object saved in Firestore, or returns { error }.
export function buildProduct(category, v, { allowZeroQty = false } = {}) {
  const p = toNumber(v.price);
  if (p <= 0) return { error: "Please enter a price greater than 0." };
  const data = { category, price: p, cost: toNumber(v.cost) };
  if (category === "pump" || category === "other") {
    const name = (v.name || "").trim();
    if (!name) return { error: "Please enter a name." };
    data.name = name;
    if (category === "pump") data.brand = (v.brand || "").trim();
    if (category === "other") {
      const size = (v.size || "").trim();
      if (!size) return { error: "Please enter a size." };
      data.size = size;
      const olen = toNumber(v.length), oq = toNumber(v.quantity);
      if (olen > 0 && oq > 0) return { error: "Enter either a quantity or a length, not both." };
      if (olen <= 0 && oq <= 0 && !allowZeroQty) return { error: "Please enter a quantity or a length." };
      data.length = olen > 0 ? olen + "ft" : "";
      data.unit = olen > 0 ? "ft" : "pcs";
      data.quantity = olen > 0 ? 0 : oq;
      return { data };
    }
    const q = toNumber(v.quantity);
    if (q <= 0 && !allowZeroQty) return { error: "Please enter a quantity greater than 0." };
    data.quantity = q;
  } else {
    const size = (v.size || "").trim();
    if (!size) return { error: "Please enter a size." };
    const len = toNumber(v.length);
    if (len <= 0) return { error: "Please enter a length greater than 0." };
    data.size = size;
    data.name = (v.name || "").trim();
    data.length = len + "ft";
    data.bundle = digitsOnly(v.bundle || "");
    const nb = Number(data.bundle) || 0;
    data.perBundle = nb > 0 ? Math.round(len / nb * 100) / 100 : 0;
  }
  return { data };
}

export function initProductModal() {
  const $ = (id) => document.getElementById(id);
  const modal = $("product-modal"), title = $("pm-title"), sub = $("pm-sub");
  const catWrap = $("pm-cat-wrap"), cats = $("pm-cats"), fields = $("pm-fields"), hint = $("pm-hint");
  const saveBtn = $("pm-save");
  let st = { category: "pump", withDate: false, edit: false, onSave: null, values: {}, withSupplier: false, getBalance: null };

  // "Bought from" supplier box (shown only when adding a product to stock).
  fields.insertAdjacentHTML("afterend", pickerHtml("pmb", { allowNone: true }));
  const buyBox = $("pmb-box");
  const picker = initPicker("pmb", { allowNone: true, getBill: () => billOf(), getBalance: (id) => (st.getBalance ? st.getBalance(id) : 0) });
  buyBox.hidden = true;

  // Bill for this purchase = cost price × quantity (or × feet).
  function billOf() {
    const v = collect(), cost = toNumber(v.cost);
    const units = st.category === "pump" ? toNumber(v.quantity)
      : st.category === "other" ? (toNumber(v.length) || toNumber(v.quantity)) : toNumber(v.length);
    return cost * units;
  }
  function refreshBill() {
    if (!st.withSupplier) return;
    picker.summary();
  }

  function renderFields() {
    const defs = FIELDS[st.category].slice();
    if (st.withDate) defs.push(DATE_FIELD);
    fields.innerHTML = defs.map((f) => {
      const stepper = f.step && st.edit
        ? '<button type="button" class="step" data-step="-1" aria-label="Decrease">−</button><button type="button" class="step" data-step="1" aria-label="Increase">+</button>' : "";
      return `<label class="fgroup${f.full ? " full" : ""}">
        <span class="lbl">${f.label}${f.required ? ' <span class="req">*</span>' : ""}</span>
        <span class="ibox">${f.prefix ? `<span class="aff">${f.prefix}</span>` : ""}<input type="text" data-key="${f.key}" data-kind="${f.kind}" inputmode="${f.mode}" placeholder="${esc(f.placeholder)}" class="${f.mono ? "mono" : ""}" value="${esc(st.values[f.key] ?? "")}" autocomplete="off">${f.suffix ? `<span class="aff">${f.suffix}</span>` : ""}${stepper}</span>
      </label>`;
    }).join("");
    if (st.category === "safety_cable" || st.category === "wire") fields.insertAdjacentHTML("beforeend", '<span class="hint-line full" id="pm-per"></span>');
    hint.textContent = st.category === "pump" ? HINTS.text : st.category === "other" ? HINTS.other : HINTS.cable;
    syncExclusive(false);
    updatePer();
    refreshBill();
    cats.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.cat === st.category ? "true" : "false"));
  }

  // "Other": a quantity (pcs) OR a length (ft) — filling one switches the other off.
  function syncExclusive(clearOther) {
    if (st.category !== "other") return;
    const q = fields.querySelector('input[data-key="quantity"]'), l = fields.querySelector('input[data-key="length"]');
    if (!q || !l) return;
    const hasQ = toNumber(q.value) > 0, hasL = toNumber(l.value) > 0;
    if (hasQ && !hasL) { if (clearOther) l.value = ""; l.disabled = true; q.disabled = false; }
    else if (hasL && !hasQ) { if (clearOther) q.value = ""; q.disabled = true; l.disabled = false; }
    else { q.disabled = false; l.disabled = false; }
  }

  function updatePer() {
    const out = fields.querySelector("#pm-per");
    if (!out) return;
    const len = toNumber(fields.querySelector('input[data-key="length"]').value);
    const nb = toNumber(fields.querySelector('input[data-key="bundle"]').value);
    out.textContent = len > 0 && nb > 0 ? `${nb} bundle${nb === 1 ? "" : "s"} → ${Math.round(len / nb * 100) / 100} ft in each bundle` : "";
  }

  function collect() {
    const v = {};
    fields.querySelectorAll("input").forEach((i) => { v[i.dataset.key] = i.disabled ? "" : i.value; });
    return v;
  }

  fields.addEventListener("input", (e) => {
    const input = e.target, kind = input.dataset.kind;
    if (kind === "commas") input.value = formatWithCommas(input.value);
    else if (kind === "digits") input.value = digitsOnly(input.value);
    if (input.dataset.key === "quantity" || input.dataset.key === "length") syncExclusive(true);
    refreshBill();
    if (input.dataset.key === "length" || input.dataset.key === "bundle") updatePer();
    else if (kind === "cap" && input.value) {
      const pos = input.selectionStart;
      input.value = input.value.charAt(0).toUpperCase() + input.value.slice(1);
      input.setSelectionRange(pos, pos);
    }
  });
  fields.addEventListener("input", (e) => {
    const input = e.target;
    if (input.dataset.kind !== "date") return;
    const d = digitsOnly(input.value).slice(0, 6);
    input.value = d.length > 4 ? d.slice(0, 2) + "-" + d.slice(2, 4) + "-" + d.slice(4) : d.length > 2 ? d.slice(0, 2) + "-" + d.slice(2) : d;
  });

  fields.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-step]");
    if (!btn) return;
    const input = fields.querySelector('input[data-key="quantity"]');
    input.value = Math.max(0, toNumber(input.value) + Number(btn.dataset.step));
    syncExclusive(true);
    refreshBill();
  });

  cats.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cat]");
    if (!btn || st.edit) return;
    st.category = btn.dataset.cat;
    st.values = {};
    renderFields();
  });

  function close() { modal.classList.remove("active"); }
  $("pm-close").addEventListener("click", close);
  $("pm-cancel").addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal.classList.contains("active")) close(); });

  saveBtn.addEventListener("click", () => withButtonLock(saveBtn, async () => {
    let buy = null;
    if (st.withSupplier) {
      buy = picker.read();
      if (buy.error) { alert(buy.error); return; }
    }
    const done = await st.onSave(st.category, collect(), buy);
    if (done) close();
  }));

  return {
    close,
    setSuppliers(list) { picker.setSuppliers(list); },
    open({ title: t, sub: s, saveLabel, category = "pump", edit = false, withDate = false, values = {}, onSave, withSupplier = false, suppliers = [], getBalance = null }) {
      st = { category, edit, withDate, values, onSave, withSupplier, getBalance };
      buyBox.hidden = !withSupplier;
      if (withSupplier) { picker.setSuppliers(suppliers); picker.reset(); }
      title.textContent = t;
      sub.textContent = s;
      saveBtn.textContent = saveLabel;
      catWrap.hidden = edit;
      renderFields();
      modal.classList.add("active");
      const first = fields.querySelector("input");
      if (first) setTimeout(() => first.focus(), 50);
    }
  };
}
