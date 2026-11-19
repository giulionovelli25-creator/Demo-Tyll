// A small PDF writer for business documents such as purchase orders: A4 pages, Helvetica text, rules and shaded bands.
// No dependency. Text uses WinAnsi encoding, so Latin scripts and the euro sign print; other scripts print as "?".

const W = 595.28;
const H = 841.89;

// Helvetica glyph widths (per 1000) for WinAnsi 32 to 126, from the standard font metrics.
const WIDTHS = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const SPECIAL: Record<string, number> = { "€": 0x80, "‚": 0x82, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99, "−": 0x2d, " ": 0x20 };

/** The WinAnsi byte for a character, or "?" when the font cannot print it. */
function byteOf(ch: string): number {
  if (SPECIAL[ch] !== undefined) return SPECIAL[ch];
  const c = ch.codePointAt(0)!;
  return c >= 32 && c <= 126 ? c : c >= 160 && c <= 255 ? c : 63;
}

function widthOf(text: string, size: number, bold: boolean): number {
  let w = 0;
  for (const ch of text) {
    const b = byteOf(ch);
    w += b >= 32 && b <= 126 ? WIDTHS[b - 32] : b === 0x80 ? 556 : b === 0xd7 ? 584 : 556;
  }
  return (w * size * (bold ? 1.06 : 1)) / 1000;
}

const literal = (text: string) => {
  let out = "(";
  for (const ch of text) {
    const b = byteOf(ch);
    if (b === 40 || b === 41 || b === 92) out += `\\${String.fromCharCode(b)}`;
    else if (b >= 32 && b <= 126) out += String.fromCharCode(b);
    else out += `\\${b.toString(8).padStart(3, "0")}`;
  }
  return `${out})`;
};

export interface TextOpts { size?: number; bold?: boolean; align?: "left" | "right"; gray?: number }

export class PdfDoc {
  private pages: string[][] = [[]];
  readonly width = W;
  readonly height = H;

  private get ops() { return this.pages[this.pages.length - 1]; }

  addPage() { this.pages.push([]); }

  /** Text with its top-left (or top-right when aligned right) at x, y measured from the top of the page. */
  text(x: number, y: number, text: string, o: TextOpts = {}) {
    const size = o.size ?? 10;
    const left = o.align === "right" ? x - widthOf(text, size, !!o.bold) : x;
    this.ops.push(`${(o.gray ?? 0).toFixed(3)} g BT /${o.bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${left.toFixed(2)} ${(H - y - size * 0.8).toFixed(2)} Tm ${literal(text)} Tj ET`);
  }

  /** Text cut to fit a width, with an ellipsis when it is too long. */
  fit(x: number, y: number, text: string, maxWidth: number, o: TextOpts = {}) {
    let t = text;
    while (t.length > 1 && widthOf(t, o.size ?? 10, !!o.bold) > maxWidth) t = t.slice(0, -1);
    this.text(x, y, t === text ? t : `${t.slice(0, -1)}…`, o);
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.5, gray = 0.75) {
    this.ops.push(`${gray.toFixed(3)} G ${width} w ${x1.toFixed(2)} ${(H - y1).toFixed(2)} m ${x2.toFixed(2)} ${(H - y2).toFixed(2)} l S`);
  }

  rect(x: number, y: number, w: number, h: number, gray = 0.95) {
    this.ops.push(`${gray.toFixed(3)} g ${x.toFixed(2)} ${(H - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }

  measure(text: string, size = 10, bold = false) { return widthOf(text, size, bold); }

  toBuffer(meta: { title: string; author?: string } = { title: "Document" }): Buffer {
    const objects: string[] = [];
    const add = (body: string) => { objects.push(body); return objects.length; };
    add("<< /Type /Catalog /Pages 2 0 R >>");
    add("PAGES");
    const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const kids: number[] = [];
    for (const ops of this.pages) {
      const stream = ops.join("\n");
      const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
    }
    objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
    const info = add(`<< /Title ${literal(meta.title)} /Author ${literal(meta.author ?? "Tyll")} /Producer (Tyll) >>`);
    let out = "%PDF-1.4\n%âãÏÓ\n";
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets.push(Buffer.byteLength(out, "latin1"));
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, "latin1");
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, "latin1");
  }
}
