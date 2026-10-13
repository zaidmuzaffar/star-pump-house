// Shared helpers used across pages.

export const CATEGORY_LABELS = { pump: "Pump", wire: "Wire", safety_cable: "Safety Cable", other: "Other" };
export const CATEGORY_ORDER = ["pump", "wire", "safety_cable", "other"];
export const HAS_QUANTITY = { pump: true, wire: false, safety_cable: false, other: true };
export const LOW_QTY = 3;      // pumps / other items: this many pieces or fewer = low stock
export const LOW_CABLE_FT = 150; // wire / safety cable: this many feet or less = low stock

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function digitsOnly(value) { return String(value).replace(/\D/g, ""); }

export function formatWithCommas(value) {
  const digits = digitsOnly(value);
  if (!digits) return "";
  return Number(digits).toLocaleString("en-US");
}

export function attachNumberFormatting(input, withCommas) {
  input.addEventListener("input", () => {
    input.value = withCommas ? formatWithCommas(input.value) : digitsOnly(input.value);
  });
}

export function toNumber(value) { return Number(digitsOnly(value)) || 0; }
export function fmt(n) { return Number(n || 0).toLocaleString("en-US"); }

// Internal storage always uses YYYY-MM-DD; only the display converts to DD-MM-YY.
export function todayString() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export function isoFromDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export function formatDateDMY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y.slice(2)}`;
}

// "07-10-26" -> "2026-10-07" (or "" if it is not a real date)
export function parseDMY(text) {
  const m = /^(\d{2})-(\d{2})-(\d{2})$/.exec(String(text).trim());
  if (!m) return "";
  const day = Number(m[1]), month = Number(m[2]), year = 2000 + Number(m[3]);
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return "";
  return `${year}-${m[2]}-${m[1]}`;
}

// Types digits and turns them into DD-MM-YY automatically.
export function attachDateMask(input) {
  input.addEventListener("input", () => {
    const d = digitsOnly(input.value).slice(0, 6);
    let out = d;
    if (d.length > 4) out = d.slice(0, 2) + "-" + d.slice(2, 4) + "-" + d.slice(4);
    else if (d.length > 2) out = d.slice(0, 2) + "-" + d.slice(2);
    input.value = out;
  });
}

export function daysFromToday(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - t) / 86400000);
}

export async function withButtonLock(button, action) {
  if (button.disabled) return;
  button.disabled = true;
  try { await action(); } finally { button.disabled = false; }
}

// Wraps the first case-insensitive match of query inside text with <mark>.
export function highlightMatch(text, query) {
  const str = String(text ?? "");
  if (!query) return esc(str);
  const idx = str.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return esc(str);
  return esc(str.slice(0, idx)) + "<mark>" + esc(str.slice(idx, idx + query.length)) + "</mark>" + esc(str.slice(idx + query.length));
}

// Highlights every searched word inside a text (commas in numbers are ignored, so 75250 finds 75,250).
export function highlightWords(text, query) {
  const str = String(text ?? "");
  const words = String(query || "").trim().toLowerCase().split(/\s+/).map((w) => w.replace(/,/g, "")).filter(Boolean);
  if (!words.length || !str) return esc(str);
  const plain = str.toLowerCase(), digitsMap = [];
  let flat = "";
  for (let i = 0; i < plain.length; i++) { if (plain[i] === "," && /\d/.test(plain[i - 1] || "") && /\d/.test(plain[i + 1] || "")) continue; digitsMap.push(i); flat += plain[i]; }
  const marks = new Array(str.length).fill(false);
  words.forEach((w) => {
    let from = 0, at;
    while ((at = flat.indexOf(w, from)) !== -1) {
      const s = digitsMap[at], e = digitsMap[at + w.length - 1];
      for (let i = s; i <= e; i++) marks[i] = true;
      from = at + w.length;
    }
  });
  let out = "", open = false;
  for (let i = 0; i < str.length; i++) {
    if (marks[i] && !open) { out += "<mark>"; open = true; }
    if (!marks[i] && open) { out += "</mark>"; open = false; }
    out += esc(str[i]);
  }
  return out + (open ? "</mark>" : "");
}

export function attachAutoCapitalize(input) {
  input.addEventListener("input", () => {
    const val = input.value;
    if (!val) return;
    const capitalized = val.charAt(0).toUpperCase() + val.slice(1);
    if (capitalized !== val) {
      const pos = input.selectionStart;
      input.value = capitalized;
      input.setSelectionRange(pos, pos);
    }
  });
}

// ---------- Product helpers ----------

export function metres(p) {
  const n = parseFloat(String(p.length ?? "").replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

export function isCable(p) { return p.category === "wire" || p.category === "safety_cable"; }

// An "Other" item sold by length (feet) instead of pieces.
export function isLengthItem(p) {
  return p.category === "other" && (p.unit === "ft" || (!p.unit && metres(p) > 0 && !(Number(p.quantity) > 0)));
}

// Wire, Safety Cable and length-based Other items are counted in feet.
export function byFeet(p) { return isCable(p) || isLengthItem(p); }

export function isLowStock(p) {
  return byFeet(p) ? metres(p) <= LOW_CABLE_FT : Number(p.quantity || 0) <= LOW_QTY;
}

export function stockNumber(p) { return byFeet(p) ? metres(p) : Number(p.quantity || 0); }

// Feet in one bundle (total length / number of bundles). 0 when sold loose.
export function perBundle(p) {
  const saved = Number(p.perBundle);
  if (saved > 0) return saved;
  const b = Number(String(p.bundle ?? "").replace(/\D/g, ""));
  return b > 0 && metres(p) > 0 ? metres(p) / b : 0;
}

export function perBundleText(p) {
  const n = perBundle(p);
  return n > 0 ? fmt(Math.round(n * 100) / 100) + " ft each" : "";
}

export function productName(p) { return isCable(p) ? ((p.name ? p.name + " " : "") + (p.size || "")).trim() : (p.name || ""); }

export function productLabel(p) {
  if (!isCable(p)) return p.name;
  return `${CATEGORY_LABELS[p.category]} — ${productName(p)}${p.length ? " / " + fmt(metres(p)) + " ft" : ""}`;
}

export function stockText(p) {
  if (byFeet(p)) { const m = metres(p); return m || p.length ? fmt(m) + " ft" : "—"; }
  return fmt(p.quantity) + " pcs";
}

export function lengthText(p) { const n = metres(p); return n ? fmt(n) + " ft" : "—"; }

export function bundleText(p) {
  const b = String(p.bundle ?? "").trim();
  if (!b || b === "0") return "—";
  return /^\d+$/.test(b) ? fmt(b) : b;
}

export function stockValue(p) { return byFeet(p) ? 0 : Number(p.price || 0) * Number(p.quantity || 0); }

// ---------- Sale helpers ----------

export function remainingOf(s) {
  if (s.status === "received") return 0;
  if (typeof s.remainingCost === "number") return s.remainingCost;
  return s.paymentType === "credit" ? s.amount : 0;
}

export function receivedOf(s) { return Math.max(0, s.amount - remainingOf(s)); }

export function saleCategory(s, productsByName) {
  if (s.category) return s.category;
  const n = s.productName || "";
  if (n.startsWith("Safety Cable")) return "safety_cable";
  if (n.startsWith("Wire")) return "wire";
  if (productsByName && productsByName[n]) return productsByName[n];
  return "";
}

export function pillHtml(cat, big) {
  if (!cat) return '<span class="t-dim">—</span>';
  return `<span class="pill ${big ? "big " : ""}cat-${cat}">${CATEGORY_LABELS[cat]}</span>`;
}

export function itemText(s) {
  if (s.pricePerFt && s.lengthFt) return `${s.productName} · ${fmt(s.lengthFt)} ft`;
  return `${s.productName}${s.quantity > 1 ? " × " + fmt(s.quantity) : ""}${s.lengthFt ? " · " + fmt(s.lengthFt) + " ft" : ""}`;
}

export function saleQtyText(s) { return s.pricePerFt && s.lengthFt ? fmt(s.lengthFt) + " ft" : fmt(s.quantity); }

// ---------- Accounts helpers (Customers, Purchases, Returns, Profit, Cash Closing) ----------

// Name used on sale records for a product (same as the Sell dialog).
export function sellNameOf(p) { return isCable(p) ? `${CATEGORY_LABELS[p.category]} — ${productName(p)}` : (p.name || ""); }

// Cost price per piece (or per foot for cable / length items). 0 when not set.
export function costOf(p) { return Number(p.cost || 0); }

// One customer = same phone number, or (no phone) the same name.
// Phone numbers are compared by digits; +92 / 92 / 3xx forms all become 03xx.
export function phoneKey(contact) {
  let c = digitsOnly(contact || "");
  // A number typed twice by mistake (e.g. 0300123456703001234567) counts as the one number.
  while (c.length >= 20 && c.length % 2 === 0 && c.slice(0, c.length / 2) === c.slice(c.length / 2)) c = c.slice(0, c.length / 2);
  if (c.length === 12 && c.startsWith("92")) c = "0" + c.slice(2);
  else if (c.length === 10 && c.startsWith("3")) c = "0" + c;
  return c;
}
export function nameKey(name) { return String(name || "").trim().replace(/\s+/g, " ").toLowerCase(); }
export function customerKey(name, contact) {
  const c = phoneKey(contact), n = nameKey(name);
  return c ? "c" + c : n ? "n" + n : "";
}

// Units on a sale record: feet for cable sold by the foot, otherwise pieces.
export function saleUnits(s) { return s.pricePerFt && s.lengthFt ? Number(s.lengthFt) : Number(s.quantity || 0); }
export function saleUnitName(s) { return s.pricePerFt && s.lengthFt ? "ft" : "pcs"; }

// Cash actually taken at the moment of sale (new sales store it; older ones fall back to "received").
export function paidAtSale(s) { return typeof s.paidAtSale === "number" ? s.paidAtSale : receivedOf(s); }

export function daysAgoIso(n) { const d = new Date(); d.setDate(d.getDate() - n); return isoFromDate(d); }

export function initials(name) {
  return String(name || "?").trim().split(/\s+/).map((w) => w.charAt(0)).slice(0, 2).join("").toUpperCase() || "?";
}

export const ICONS = {
  edit: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"></path><path d="M13.5 6.5l4 4"></path></svg>',
  del: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"></path><path d="M9 7V4h6v3"></path><path d="M6 7l1 13h10l1-13"></path></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"></path></svg>',
  pencil: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"></path></svg>'
};

// One customer bill = all sale records created together (they share a timestamp).
export function groupBills(entries) {
  const map = new Map();
  entries.forEach(([id, s]) => {
    const key = s.timestamp ? "t" + s.timestamp : "i" + id;
    let b = map.get(key);
    if (!b) {
      b = { key, ids: [], docs: [], date: s.date, time: s.time, timestamp: s.timestamp || 0, customerName: s.customerName || "", customerContact: s.customerContact || "", amount: 0, received: 0, remaining: 0, origAmount: 0, returnedValue: 0, returnCount: 0, returnedQty: 0, refunded: 0 };
      map.set(key, b);
    }
    b.ids.push(id); b.docs.push(s);
    b.amount += s.amount; b.received += receivedOf(s); b.remaining += remainingOf(s);
    // filled only when the sales went through withReturns()
    b.origAmount += s.origAmount ?? s.amount; b.returnedValue += s.returnedValue || 0; b.returnCount += s.returnCount || 0;
    b.returnedQty += s.returnedQty2 || 0; b.refunded += s.refunded || 0;
  });
  return [...map.values()].sort((a, b) => b.timestamp - a.timestamp);
}

// ---------- Customer returns on sales ----------
// Returns (Returns page, from a customer) reduce what a sale is worth:
//   cash refund / cut udhaar -> the sale's amount goes down by the returned value;
//   exchange -> the item swapped, the sale keeps its value (only counted as a return).
// Gives copies of the sales with: amount (after returns), origAmount, returnedValue, returnedQty2, returnCount, refunded.
// receivedOf()/remainingOf() keep working on these copies (received = amount after returns - remaining).
export function withReturns(saleRows, returnList) {
  const by = new Map();
  (returnList || []).forEach((x) => {
    const r = Array.isArray(x) ? x[1] : x;
    if (!r || r.source === "shop" || !r.saleId) return;
    const a = by.get(r.saleId) || { value: 0, qty: 0, count: 0, refund: 0, damaged: 0 };
    if (r.type !== "exchange") a.value += Number(r.value || 0);
    a.qty += Number(r.qty || 0); a.count++; a.refund += Number(r.refund || 0);
    if (!r.stockUpdated) a.damaged += Number(r.qty || 0);
    by.set(r.saleId, a);
  });
  return saleRows.map(([id, s]) => {
    const a = by.get(id);
    if (!a) return [id, s];
    return [id, Object.assign({}, s, {
      origAmount: s.amount, amount: Math.max(0, Number(s.amount || 0) - a.value),
      returnedValue: a.value, returnedQty2: a.qty, returnCount: a.count, refunded: a.refund, damagedQty: a.damaged
    })];
  });
}

// ---------- Period buttons (Sales Summary, Profit Report) ----------
//   today = today's sales · daily = day by day, last 7 days · week = week by week, last 30 days (one month)
//   month = last 12 months · all = everything
export const PERIOD_LABEL = { today: "Today", daily: "Last 7 days", week: "Last 30 days", month: "Last 12 months", all: "All time" };
export const PERIOD_WORDS = { today: "today", daily: "in the last 7 days", week: "in the last 30 days", month: "in the last 12 months", all: "so far" };
export function periodFrom(p) {
  if (p === "today") return todayString();
  if (p === "daily") return daysAgoIso(6);
  if (p === "week") return daysAgoIso(29);
  if (p === "month") { const d = new Date(); return isoFromDate(new Date(d.getFullYear(), d.getMonth() - 11, 1)); }
  return "";
}
export function inPeriodRange(p, date) {
  const d = date || "";
  if (p === "all") return true;
  return d >= periodFrom(p) && d <= todayString();
}
export function periodRangeText(p) {
  const t = todayString();
  if (p === "today") return formatDateDMY(t);
  if (p === "all") return "All time";
  return formatDateDMY(periodFrom(p)) + " to " + formatDateDMY(t);
}

// ---------- Same customer, same day = one entry (bills stay separate inside it) ----------
// bills: from groupBills(). Customers are matched by phone number, or by name when there is no number.
// Walk-in sales without name or number are never joined. Each entry keeps .parts = its bills (oldest first).
export function mergeSameDay(bills) {
  const map = new Map(), out = [];
  bills.forEach((b) => {
    const who = phoneKey(b.customerContact) ? "c" + phoneKey(b.customerContact) : nameKey(b.customerName) ? "n" + nameKey(b.customerName) : "";
    const k = who ? (b.date || "") + "|" + who : "";
    let e = k && map.get(k);
    if (!e) {
      e = { key: b.key, parts: [], ids: [], docs: [], date: b.date, time: b.time, timestamp: 0, customerName: "", customerContact: "" };
      ["amount", "received", "remaining", "origAmount", "returnedValue", "returnCount", "returnedQty", "refunded", "cashAtSale", "paidLater"].forEach((f) => { e[f] = 0; });
      if (k) map.set(k, e);
      out.push(e);
    }
    e.parts.push(b); e.ids.push(...b.ids); e.docs.push(...b.docs);
    ["amount", "received", "remaining", "origAmount", "returnedValue", "returnCount", "returnedQty", "refunded", "cashAtSale", "paidLater"].forEach((f) => { e[f] += Number(b[f] || 0); });
    if (b.timestamp >= e.timestamp) { e.timestamp = b.timestamp; e.customerName = b.customerName || e.customerName; e.customerContact = b.customerContact || e.customerContact; }
  });
  out.forEach((e) => { e.parts.sort((a, b) => a.timestamp - b.timestamp); e.key = e.parts.map((p) => p.key).join(","); e.time = e.parts[0].time; });
  return out.sort((a, b) => b.timestamp - a.timestamp);
}
