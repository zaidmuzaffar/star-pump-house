// Tiny PDF writer (no internet / library needed). A4 pages, Helvetica text, lines and filled boxes.
// Coordinates are in points from the TOP-LEFT corner.
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

// Only plain characters are used in the PDF fonts.
export function clean(s) {
  return String(s ?? "").replace(/[–—−]/g, "-").replace(/·/g, "|").replace(/×/g, "x").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x20-\x7E]/g, "");
}

const hex = (c) => { const h = c.replace("#", ""); return [0, 2, 4].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(" "); };
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

export function createPdf() {
  const PW = 595.28, PH = 841.89;
  const pages = [];
  let cur = null;
  const doc = {
    PW, PH,
    addPage() { cur = []; pages.push(cur); return doc; },
    width(str, size = 10, bold = false) {
      const t = bold ? W_BOLD : W_REG;
      let w = 0;
      for (const ch of clean(str)) { const c = ch.charCodeAt(0); w += t[c - 32] || 556; }
      return w * size / 1000;
    },
    // Cuts text to fit a width, adding "..." if needed.
    fit(str, maxW, size = 10, bold = false) {
      let s = clean(str);
      if (doc.width(s, size, bold) <= maxW) return s;
      while (s.length && doc.width(s + "...", size, bold) > maxW) s = s.slice(0, -1);
      return s + "...";
    },
    // Splits text into lines that fit a width.
    wrap(str, maxW, size = 10, bold = false) {
      const words = clean(str).split(" "), lines = [];
      let line = "";
      for (const w of words) {
        const t = line ? line + " " + w : w;
        if (doc.width(t, size, bold) <= maxW) line = t;
        else { if (line) lines.push(line); line = doc.width(w, size, bold) > maxW ? doc.fit(w, maxW, size, bold) : w; }
      }
      if (line) lines.push(line);
      return lines.length ? lines : [""];
    },
    text(x, y, str, { size = 10, bold = false, color = "#16202A", align = "left" } = {}) {
      const s = clean(str);
      let tx = x;
      if (align === "right") tx = x - doc.width(s, size, bold);
      if (align === "center") tx = x - doc.width(s, size, bold) / 2;
      cur.push(`BT ${hex(color)} rg /${bold ? "F2" : "F1"} ${size} Tf ${tx.toFixed(2)} ${(PH - y).toFixed(2)} Td (${esc(s)}) Tj ET`);
    },
    rect(x, y, w, h, fill, stroke) {
      if (fill) cur.push(`${hex(fill)} rg ${x.toFixed(2)} ${(PH - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
      if (stroke) cur.push(`${hex(stroke)} RG 0.6 w ${x.toFixed(2)} ${(PH - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
    },
    line(x1, y1, x2, y2, color = "#CBD1D6", width = 0.6) {
      cur.push(`${hex(color)} RG ${width} w ${x1.toFixed(2)} ${(PH - y1).toFixed(2)} m ${x2.toFixed(2)} ${(PH - y2).toFixed(2)} l S`);
    },
    pageCount() { return pages.length; },
    onPage(i) { cur = pages[i]; },
    blob() {
      const objs = [];
      const add = (s) => { objs.push(s); return objs.length; };
      add("<< /Type /Catalog /Pages 2 0 R >>");
      add("PAGES");
      add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
      add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
      const kids = [];
      pages.forEach((p) => {
        const content = p.join("\n");
        const c = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
        kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${c} 0 R >>`));
      });
      objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${kids.length} >>`;
      let out = "%PDF-1.4\n";
      const offs = [];
      objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
      const xref = out.length;
      out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
      out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
      return new Blob([out], { type: "application/pdf" });
    }
  };
  return doc.addPage();
}

// Saves the PDF straight to the device with the given file name.
export function savePdf(doc, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(doc.blob());
  a.download = clean(filename).replace(/[\\/:*?"<>|]/g, "-");
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
