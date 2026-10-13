// Statement (khata) shared by Suppliers and Shops, plus the "Total Bill" PDF.
import { fmt, formatDateDMY, todayString } from './utils.js?v=55';
import { createPdf, savePdf } from './pdf.js?v=55';

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function dayOf(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return DAYS[new Date(y, m - 1, d).getDay()];
}

const itemLine = (b) => (b.items || []).map((i) => `${i.name} × ${fmt(i.qty)}${i.unit === "ft" ? " ft" : ""}`).join(", ");

// One line per bill (with the money paid on the spot) and one line per later payment, oldest first.
//   linkField: field on a payment that points to its bill ("purchaseId" for suppliers, "billId" for shops)
export function buildStatement({ opening = 0, openingDate = "", bills, pays, linkField }) {
  const billIds = new Set(bills.map(([id]) => id));
  const linked = new Map();
  const loose = [];
  pays.forEach(([id, p]) => {
    const k = p[linkField];
    if (k && billIds.has(k)) { const arr = linked.get(k) || []; arr.push([id, p]); linked.set(k, arr); }
    else loose.push([id, p]);
  });
  // Older "Paid with bill" payments had no link: attach them to a bill on the same day.
  for (let i = loose.length - 1; i >= 0; i--) {
    const [, p] = loose[i];
    if (!/with bill/i.test(p.note || "")) continue;
    const b = bills.find(([bid, x]) => x.date === p.date && !linked.has(bid));
    if (b) { linked.set(b[0], [loose[i]]); loose.splice(i, 1); }
  }
  const rows = [];
  if (opening) rows.push({ kind: "open", date: openingDate, ts: -1, detail: "Old balance (before using the website)", bill: opening, paid: 0, method: "" });
  bills.forEach(([id, b]) => {
    const lp = linked.get(id) || [];
    rows.push({
      kind: "bill", id, date: b.date || "", ts: b.timestamp || 0, billNo: b.billNo || "", detail: itemLine(b),
      bill: Number(b.total || 0), paid: lp.reduce((a, [, p]) => a + Number(p.amount || 0), 0),
      method: lp.map(([, p]) => p.method).filter(Boolean)[0] || "", payIds: lp.map(([pid]) => pid), source: b.source || ""
    });
  });
  loose.forEach(([id, p]) => rows.push({ kind: "pay", id, date: p.date || "", ts: p.timestamp || 0, detail: p.note || "Payment", bill: 0, paid: Number(p.amount || 0), method: p.method || "" }));
  rows.sort((a, b) => (a.kind === "open" ? -1 : b.kind === "open" ? 1 : 0) || a.date.localeCompare(b.date) || a.ts - b.ts);
  let rem = 0;
  rows.forEach((r, i) => { r.n = i + 1; r.day = dayOf(r.date); r.prev = rem; rem += r.bill - r.paid; r.remaining = rem; });
  return rows;
}

export function statementTotals(rows) {
  const bill = rows.reduce((a, r) => a + r.bill, 0), paid = rows.reduce((a, r) => a + r.paid, 0);
  return { bill, paid, remaining: bill - paid };
}

// "Total Bill" as a PDF file, saved with the party's name.
//   labels: { title, total, paid, remaining, bill, pay }
export function saveStatementPdf({ name, phone, labels, rows }) {
  const doc = createPdf();
  const M = 30, PW = doc.PW, RIGHT = PW - M;
  const t = statementTotals(rows);
  const today = todayString();
  const cols = [
    { k: "n", t: "#", w: 20 }, { k: "date", t: "Date", w: 50 }, { k: "day", t: "Day", w: 56 }, { k: "detail", t: "Detail", w: 157 },
    { k: "prev", t: "Previous", w: 62, r: true }, { k: "bill", t: labels.bill, w: 60, r: true }, { k: "paid", t: labels.pay, w: 60, r: true }, { k: "remaining", t: "Remaining", w: 70, r: true }
  ];
  let y = 0;
  const header = (first) => {
    y = M;
    doc.text(M, y + 10, "STAR PUMP HOUSE", { size: 9, bold: true, color: "#0E6A8C" });
    doc.text(RIGHT, y + 10, `Saved on ${dayOf(today)}, ${formatDateDMY(today)}`, { size: 9, color: "#5A6672", align: "right" });
    y += 30;
    doc.text(M, y, `${labels.title} - ${name}`, { size: first ? 18 : 12, bold: true });
    if (first && phone) { y += 16; doc.text(M, y, phone, { size: 10, color: "#5A6672" }); }
    y += first ? 18 : 12;
    if (first) {
      const bw = (PW - 2 * M - 20) / 3;
      [[labels.total, t.bill, "#16202A", "#F3F4F1"], [labels.paidTotal, t.paid, "#22583A", "#EEF7F1"], [labels.remaining, t.remaining, "#7A4205", "#FFF4E0"]].forEach(([l, v, c, bg], i) => {
        const x = M + i * (bw + 10);
        doc.rect(x, y, bw, 50, bg, "#E3E6E8");
        doc.text(x + 12, y + 18, l + " (Rs)", { size: 9, color: "#5A6672" });
        doc.text(x + 12, y + 38, fmt(v), { size: 16, bold: true, color: c });
      });
      y += 70;
    }
    // table head
    doc.rect(M, y, PW - 2 * M, 20, "#14202B");
    let x = M;
    cols.forEach((c) => { doc.text(c.r ? x + c.w - 4 : x + 4, y + 13.5, c.t, { size: 8, bold: true, color: "#FFFFFF", align: c.r ? "right" : "left" }); x += c.w; });
    y += 20;
  };
  header(true);
  rows.slice().reverse().forEach((r, i) => {
    const kind = r.kind === "pay" ? (labels.payWord || "Payment") : "Bill";
    const detail = r.kind === "open" ? r.detail : `${kind}${r.billNo ? " No. " + r.billNo : ""}: ${r.detail}${r.method && r.paid ? " (" + r.method + ")" : ""}`;
    const lines = doc.wrap(detail, cols[3].w - 8, 8).slice(0, 3);
    const h = Math.max(20, 8 + lines.length * 10);
    if (y + h > doc.PH - 50) { doc.addPage(); header(false); }
    if (i % 2) doc.rect(M, y, PW - 2 * M, h, "#F8F9F7");
    let x = M;
    const vals = { n: String(r.n), date: formatDateDMY(r.date) || "-", day: r.day, prev: fmt(r.prev), bill: r.bill ? fmt(r.bill) : "-", paid: r.paid ? fmt(r.paid) : "-", remaining: fmt(r.remaining) };
    cols.forEach((c) => {
      if (c.k === "detail") lines.forEach((ln, j) => doc.text(x + 4, y + 13 + j * 10, ln, { size: 8 }));
      else doc.text(c.r ? x + c.w - 4 : x + 4, y + 13, vals[c.k], { size: 8.5, bold: c.k === "remaining", color: c.k === "paid" && r.paid ? "#22583A" : c.k === "remaining" ? "#7A4205" : "#16202A", align: c.r ? "right" : "left" });
      x += c.w;
    });
    y += h;
    doc.line(M, y, PW - M, y, "#E3E6E8");
  });
  const n = doc.pageCount();
  for (let i = 0; i < n; i++) { doc.onPage(i); doc.text(PW / 2, doc.PH - 22, `Page ${i + 1} of ${n}`, { size: 8, color: "#8A949D", align: "center" }); }
  savePdf(doc, `${name} - ${labels.title} - ${formatDateDMY(today)}.pdf`);
}

