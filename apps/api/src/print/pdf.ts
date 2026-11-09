import PDFDocument from 'pdfkit';

export type Orientation = 'portrait' | 'landscape';

export interface CompanyInfo { name: string; address?: string | null; phone?: string | null; email?: string | null; gstin?: string | null; currencyCode: string; footerNote?: string | null; logo?: Buffer | null }

const INK = '#0f172a', MUTED = '#64748b', LINE = '#cbd5e1', HEAD_BG = '#e2e8f0';

/** The built-in PDF fonts only cover Latin-1: map common typography and replace anything else so text never garbles. */
export function latin(input: unknown): string {
  const map: Record<string, string> = { '₹': 'Rs.', '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '•': '-', '×': 'x', '…': '...', ' ': ' ' };
  return String(input ?? '').replace(/[^\x20-\x7e\xa0-\xff\n]/gu, (c) => map[c] ?? '?').replace(/[ ₹–—‘’“”•×…]/g, (c) => map[c] ?? c);
}

export const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const qty = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 4 });

export interface Column { header: string; width: number; align?: 'left' | 'right' | 'center' }
export type Cell = string | number | { text?: string; image?: Buffer | null; bold?: boolean };

/**
 * Small layout toolkit over pdfkit: letterhead, key/value blocks, paginated tables with repeated headers,
 * totals and a "Page x of y" footer on every page.
 */
export class Pdf {
  /** tests switch this off to read the text back out of the PDF */
  static compress = true;
  readonly doc: PDFKit.PDFDocument;
  private readonly chunks: Buffer[] = [];
  readonly left: number;
  readonly width: number;
  private readonly bottom: number;

  constructor(private readonly company: CompanyInfo, private readonly title: string, orientation: Orientation, private readonly docRef = '') {
    this.doc = new PDFDocument({ size: 'A4', layout: orientation, margin: 36, bufferPages: true, compress: Pdf.compress, info: { Title: latin(`${title} ${docRef}`.trim()), Author: latin(company.name), Producer: 'Costing System' } });
    this.doc.on('data', (c: Buffer) => this.chunks.push(c));
    this.left = this.doc.page.margins.left;
    this.width = this.doc.page.width - this.left - this.doc.page.margins.right;
    this.bottom = this.doc.page.height - this.doc.page.margins.bottom - 18;
  }

  get y() { return this.doc.y; }
  private ensure(h: number) { if (this.doc.y + h > this.bottom) { this.doc.addPage(); return true; } return false; }

  letterhead() {
    const d = this.doc, top = d.y;
    let textX = this.left;
    if (this.company.logo) {
      try { d.image(this.company.logo, this.left, top, { fit: [64, 48] }); textX = this.left + 74; } catch { /* unreadable logo: skip it */ }
    }
    d.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(latin(this.company.name), textX, top, { width: this.width - (textX - this.left) });
    d.font('Helvetica').fontSize(8.5).fillColor(MUTED);
    const lines = [this.company.address, [this.company.phone && `Tel ${this.company.phone}`, this.company.email].filter(Boolean).join('  |  '), this.company.gstin && `GSTIN ${this.company.gstin}`].filter(Boolean);
    lines.forEach((l) => d.text(latin(l), textX, d.y, { width: this.width - (textX - this.left) }));
    const end = Math.max(d.y, top + (this.company.logo ? 52 : 0)) + 6;
    d.moveTo(this.left, end).lineTo(this.left + this.width, end).lineWidth(1.2).strokeColor(INK).stroke();
    d.x = this.left; d.y = end + 10;
  }

  heading(text: string, size = 12) {
    this.ensure(30);
    this.doc.font('Helvetica-Bold').fontSize(size).fillColor(INK).text(latin(text), this.left, this.doc.y, { width: this.width });
    this.doc.moveDown(0.3);
  }

  documentTitle(title: string, right: [string, string][]) {
    const d = this.doc, top = d.y;
    d.font('Helvetica-Bold').fontSize(16).fillColor(INK).text(latin(title), this.left, top, { width: this.width * 0.5 });
    d.font('Helvetica').fontSize(9).fillColor(INK);
    let y = top;
    right.forEach(([k, v]) => {
      d.font('Helvetica').fillColor(MUTED).text(latin(k), this.left + this.width * 0.55, y, { width: this.width * 0.17 });
      d.font('Helvetica-Bold').fillColor(INK).text(latin(v), this.left + this.width * 0.72, y, { width: this.width * 0.28 });
      y += 13;
    });
    d.x = this.left; d.y = Math.max(d.y, y) + 8;
  }

  /** Two-column label/value pairs laid out in `cols` columns. */
  kv(pairs: [string, string | number | null | undefined][], cols = 2, width = this.width, x = this.left) {
    const d = this.doc, rows = Math.ceil(pairs.length / cols), colW = width / cols, top = d.y;
    pairs.forEach(([k, v], i) => {
      const cx = x + (i % cols) * colW, cy = top + Math.floor(i / cols) * 14;
      d.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(latin(k), cx, cy, { width: colW * 0.4 });
      d.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(latin(v === null || v === undefined || v === '' ? '-' : v), cx + colW * 0.4, cy, { width: colW * 0.6 - 4 });
    });
    d.x = this.left; d.y = top + rows * 14 + 6;
  }

  paragraph(text: string, size = 9, color = INK) {
    this.ensure(size * 2);
    this.doc.font('Helvetica').fontSize(size).fillColor(color).text(latin(text), this.left, this.doc.y, { width: this.width });
    this.doc.moveDown(0.4);
  }

  image(buf: Buffer, fit: [number, number], x = this.left, y = this.doc.y) {
    try { this.doc.image(buf, x, y, { fit }); } catch { /* skip unreadable image */ }
  }

  /** Table with proportional column widths, wrapped text, optional images and repeated header rows across pages. */
  table(cols: Column[], rows: Cell[][], opts: { fontSize?: number; minRowHeight?: number; foot?: Cell[] } = {}) {
    const d = this.doc, fs = opts.fontSize ?? 8.5, pad = 3;
    const total = cols.reduce((s, c) => s + c.width, 0);
    const w = cols.map((c) => (c.width / total) * this.width);
    const xs = w.map((_, i) => this.left + w.slice(0, i).reduce((s, v) => s + v, 0));
    const text = (c: Cell) => latin(typeof c === 'object' && c !== null ? (c.text ?? '') : c);

    const header = () => {
      const h = 16;
      d.rect(this.left, d.y, this.width, h).fill(HEAD_BG);
      d.font('Helvetica-Bold').fontSize(fs).fillColor(INK);
      cols.forEach((c, i) => d.text(latin(c.header), xs[i] + pad, d.y + 4.5, { width: w[i] - pad * 2, align: c.align ?? 'left', lineBreak: false, ellipsis: true }));
      d.y += h;
    };
    const rowHeight = (r: Cell[]) => {
      let h = opts.minRowHeight ?? 14;
      r.forEach((c, i) => {
        if (typeof c === 'object' && c?.image) h = Math.max(h, 44);
        else { d.font(typeof c === 'object' && c?.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs); h = Math.max(h, d.heightOfString(text(c), { width: w[i] - pad * 2 }) + pad * 2); }
      });
      return h;
    };
    const drawRow = (r: Cell[], h: number, bold = false) => {
      const top = d.y;
      r.forEach((c, i) => {
        const isObj = typeof c === 'object' && c !== null;
        if (isObj && c.image) { this.image(c.image, [w[i] - pad * 2, h - pad * 2], xs[i] + pad, top + pad); return; }
        d.font(bold || (isObj && c.bold) ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs).fillColor(INK);
        d.text(text(c), xs[i] + pad, top + pad, { width: w[i] - pad * 2, align: cols[i].align ?? 'left' });
      });
      d.moveTo(this.left, top + h).lineTo(this.left + this.width, top + h).lineWidth(0.4).strokeColor(LINE).stroke();
      d.y = top + h;
    };

    this.ensure(40);
    header();
    rows.forEach((r) => {
      const h = rowHeight(r);
      if (d.y + h > this.bottom) { d.addPage(); header(); }
      drawRow(r, h);
    });
    if (opts.foot) { const h = rowHeight(opts.foot); if (d.y + h > this.bottom) { d.addPage(); header(); } drawRow(opts.foot, h, true); }
    d.x = this.left; d.y += 8;
  }

  /** Right-aligned amounts block. Lines marked strong get a rule above them. */
  totals(lines: { label: string; value: string; strong?: boolean }[], width = 260) {
    const d = this.doc, x = this.left + this.width - width;
    this.ensure(lines.length * 15 + 10);
    lines.forEach((l) => {
      if (l.strong) { d.moveTo(x, d.y).lineTo(x + width, d.y).lineWidth(0.8).strokeColor(INK).stroke(); d.y += 3; }
      const y = d.y;
      d.font(l.strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(l.strong ? 10 : 9).fillColor(INK);
      d.text(latin(l.label), x, y, { width: width * 0.58 });
      d.text(latin(l.value), x + width * 0.58, y, { width: width * 0.42, align: 'right' });
      d.y = y + (l.strong ? 15 : 13);
    });
    d.x = this.left; d.y += 6;
  }

  /** Adds "Page x of y" and the footer note to every page, then returns the finished PDF. */
  async finish(): Promise<Buffer> {
    const range = this.doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      // the footer sits inside the bottom margin; with a non-zero margin pdfkit would start a new page for it
      const bottomMargin = this.doc.page.margins.bottom;
      const y = this.doc.page.height - bottomMargin + 6;
      this.doc.page.margins.bottom = 0;
      this.doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
      this.doc.text(latin([this.company.footerNote, `Printed ${new Date().toISOString().slice(0, 10)}`].filter(Boolean).join('  |  ')), this.left, y, { width: this.width * 0.75, lineBreak: false });
      this.doc.text(`Page ${i + 1} of ${range.count}`, this.left, y, { width: this.width, align: 'right', lineBreak: false });
      this.doc.page.margins.bottom = bottomMargin;
    }
    return new Promise<Buffer>((resolve, reject) => {
      this.doc.on('end', () => resolve(Buffer.concat(this.chunks)));
      this.doc.on('error', reject);
      this.doc.end();
    });
  }
}
