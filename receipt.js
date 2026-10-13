// Sale receipt: a PDF to save / print, or a WhatsApp message for the customer.
// Works from one bill or a same-day entry with several bills (Sales Summary / the assistant).
import { ref, getDoc } from './common.js?v=55';
import { fmt, formatDateDMY, saleQtyText, saleUnits, phoneKey } from './utils.js?v=55';
import { createPdf, savePdf } from './pdf.js?v=55';

let shopCache = null;
export async function getShop(uid) {
  if (shopCache) return shopCache;
  try { const s = await getDoc(ref(uid, "settings", "shop")); const d = s.exists() ? s.data() : {}; shopCache = { name: d.shopName || "Star Pump House", phone: d.shopPhone || "" }; }
  catch (e) { shopCache = { name: "Star Pump House", phone: "" }; }
  return shopCache;
}

export const cachedShop = () => shopCache || { name: "Star Pump House", phone: "" };

// entry: { date, time, timestamp, customerName, customerContact, docs[], amount, received?, remaining, returnedValue? }
export function receiptFrom(entry) {
  const docs = entry.docs || [];
  const items = docs.map((s) => {
    const units = saleUnits(s) || 1, amount = Number(s.origAmount ?? s.amount ?? 0);
    return { name: s.productName || "", qty: saleQtyText(s), rate: Math.round(amount / units), amount };
  });
  const total = items.reduce((a, i) => a + i.amount, 0);
  const returned = Number(entry.returnedValue || 0);
  const remaining = Number(entry.remaining || 0);
  const net = total - returned;
  return { no: String(entry.timestamp || Date.now()).slice(-6), date: entry.date, time: entry.time || "", customer: entry.customerName || "", phone: entry.customerContact || "",
    items, total, returned, paid: Math.max(0, net - remaining), remaining };
}

function buildReceipt(shop, r) {
  const doc = createPdf();
  const M = 40, PW = doc.PW, R = PW - M;
  let y = M;
  doc.rect(M, y, PW - 2 * M, 64, "#0E6A8C");
  doc.text(M + 16, y + 28, shop.name.toUpperCase(), { size: 18, bold: true, color: "#FFFFFF" });
  doc.text(M + 16, y + 48, shop.phone ? "Phone: " + shop.phone : "Water pumps, wire, cable & hardware", { size: 10, color: "#DCEEF5" });
  doc.text(R - 16, y + 28, "RECEIPT", { size: 16, bold: true, color: "#FFFFFF", align: "right" });
  doc.text(R - 16, y + 48, "No. " + r.no, { size: 10, color: "#DCEEF5", align: "right" });
  y += 86;
  doc.text(M, y, "Customer", { size: 9, color: "#5A6672" });
  doc.text(R, y, "Date", { size: 9, color: "#5A6672", align: "right" });
  y += 16;
  doc.text(M, y, r.customer || "Walk-in customer", { size: 12, bold: true });
  doc.text(R, y, `${formatDateDMY(r.date)}${r.time ? "  " + r.time : ""}`, { size: 11, bold: true, align: "right" });
  if (r.phone) { y += 15; doc.text(M, y, r.phone, { size: 10, color: "#5A6672" }); }
  y += 22;
  const cols = [{ t: "#", w: 24 }, { t: "Item", w: 245 }, { t: "Qty", w: 70, r: true }, { t: "Rate (Rs)", w: 80, r: true }, { t: "Amount (Rs)", w: PW - 2 * M - 419, r: true }];
  doc.rect(M, y, PW - 2 * M, 22, "#14202B");
  let x = M;
  cols.forEach((c) => { doc.text(c.r ? x + c.w - 6 : x + 6, y + 15, c.t, { size: 9, bold: true, color: "#FFFFFF", align: c.r ? "right" : "left" }); x += c.w; });
  y += 22;
  r.items.forEach((it, i) => {
    const lines = doc.wrap(it.name, cols[1].w - 12, 10).slice(0, 2), h = Math.max(24, 10 + lines.length * 12);
    if (i % 2) doc.rect(M, y, PW - 2 * M, h, "#F8F9F7");
    let cx = M;
    const v = [String(i + 1), null, it.qty, fmt(it.rate), fmt(it.amount)];
    cols.forEach((c, k) => {
      if (k === 1) lines.forEach((ln, j) => doc.text(cx + 6, y + 16 + j * 12, ln, { size: 10 }));
      else doc.text(c.r ? cx + c.w - 6 : cx + 6, y + 16, v[k], { size: 10, bold: k === 4, align: c.r ? "right" : "left" });
      cx += c.w;
    });
    y += h; doc.line(M, y, R, y, "#E3E6E8");
  });
  y += 14;
  const line = (label, val, opt = {}) => { doc.text(R - 140, y, label, { size: opt.big ? 12 : 10, bold: !!opt.big, color: opt.color || "#2B3540", align: "right" }); doc.text(R, y, "Rs " + fmt(val), { size: opt.big ? 12 : 10, bold: true, color: opt.color || "#16202A", align: "right" }); y += opt.big ? 20 : 16; };
  line("Total", r.total, { big: true });
  if (r.returned) line("Returned", r.returned, { color: "#A3322A" });
  line("Paid", r.paid, { color: "#22583A" });
  if (r.remaining > 0) { doc.rect(R - 280, y - 4, 280, 26, "#FFF4E0", "#F1D9B0"); y += 13; line("Udhaar (remaining)", r.remaining, { big: true, color: "#7A4205" }); }
  y += 26;
  doc.line(M, y, R, y, "#CBD1D6");
  y += 18;
  doc.text(PW / 2, y, "Thank you for your purchase!", { size: 11, bold: true, color: "#0E6A8C", align: "center" });
  y += 14;
  doc.text(PW / 2, y, "Please keep this receipt for returns or warranty.", { size: 9, color: "#5A6672", align: "center" });
  return { doc, name: `Receipt ${r.no} - ${r.customer || "Walk-in"} - ${formatDateDMY(r.date)}.pdf` };
}
export function saveReceiptPdf(shop, r) { const { doc, name } = buildReceipt(shop, r); savePdf(doc, name); }

// WhatsApp with the PDF itself: the share sheet (Mac Safari / Chrome, phones) sends the file straight to WhatsApp.
// Where a browser can't share files, the PDF is downloaded and the customer's WhatsApp chat opens to attach it.
export async function whatsappReceiptPdf(shop, r) {
  const { doc, name } = buildReceipt(shop, r);
  const safe = name.replace(/[\\/:*?"<>|]/g, "-");
  const file = new File([doc.blob()], safe, { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: `${shop.name} receipt`, text: `${shop.name} — receipt ${r.no}` }); return "shared"; }
    catch (e) { if (e && e.name === "AbortError") return "cancelled"; }
  }
  savePdf(doc, name);
  let p = phoneKey(r.phone);
  if (p && p.startsWith("0")) p = "92" + p.slice(1);
  const msg = `${shop.name}: aap ki receipt (No. ${r.no}, Rs ${fmt(r.total - r.returned)}) attach hai.`;
  window.open(`https://wa.me/${p && p.length >= 11 ? p : ""}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
  return "downloaded";
}

export function receiptText(shop, r) {
  const L = [`*${shop.name}*`, `Receipt No. ${r.no} · ${formatDateDMY(r.date)}${r.time ? " " + r.time : ""}`, r.customer ? `Customer: ${r.customer}` : "", ""];
  r.items.forEach((it) => L.push(`• ${it.name} × ${it.qty} = Rs ${fmt(it.amount)}`));
  L.push("", `*Total: Rs ${fmt(r.total)}*`);
  if (r.returned) L.push(`Returned: Rs ${fmt(r.returned)}`);
  L.push(`Paid: Rs ${fmt(r.paid)}`);
  if (r.remaining > 0) L.push(`*Udhaar remaining: Rs ${fmt(r.remaining)}*`);
  L.push("", "Thank you!" + (shop.phone ? ` · ${shop.phone}` : ""));
  return L.filter((x, i) => x !== "" || i > 0).join("\n");
}

// Opens WhatsApp with the receipt written out (to the customer's number when there is one).
export function whatsappReceipt(shop, r) {
  let p = phoneKey(r.phone);
  if (p && p.startsWith("0")) p = "92" + p.slice(1);
  const url = `https://wa.me/${p && p.length >= 11 ? p : ""}?text=${encodeURIComponent(receiptText(shop, r))}`;
  window.open(url, "_blank", "noopener");
}
