import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ImagesService } from '../images/images.service';
import { CompanyService } from '../company/company.service';
import { QuotationsService } from '../quotations/quotations.service';
import { PriceListsService } from '../price-lists/price-lists.service';
import { CompanyInfo, Orientation, Pdf, money, qty } from './pdf';

export const COSTING_MODES = ['detailed', 'summary', 'product', 'materials', 'labour'] as const;
export type CostingMode = (typeof COSTING_MODES)[number];

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v.toString()));
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const day = (d: Date) => d.toISOString().slice(0, 10);

export interface CostingPrintModel {
  doc: { number: string; date: string; status: string; version: number; pricingMode: string; preparedBy: string; approvedAt: string | null; template: string | null };
  product: { name: string; code: string; type: string; description: string; length: string; width: string; height: string; dimensionUnit: string; quantity: string; unit: string };
  groups: {
    name: string; wastagePercent: string | null; materialTotal: string; labourTotal: string;
    materials: { sl: number; category: string; code: string; item: string; notes: string; qty: string; unit: string; wastage: string; effectiveQty: string; rate: string; total: string }[];
    labour: { labour: string; qty: string; unit: string; rate: string; total: string }[];
  }[];
  expenses: { name: string; scope: string; method: string; value: string; timing: string; amount: string }[];
  summary: { materialCost: string; materialWastage: string; labourCost: string; expenseCost: string; companyExpenseCost: string; extraPercent: string; extraAmount: string; basicCost: string; gstPercent: string; gstAmount: string; totalCostInclGst: string; markupPercent: string; markupAmount: string; sellingPrice: string; profitAmount: string; profitPercent: string; netBasicRate: string; netSellingPrice: string };
}

@Injectable()
export class PrintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ImagesService,
    private readonly company: CompanyService,
    private readonly quotations: QuotationsService,
    private readonly priceLists: PriceListsService,
  ) {}

  private async companyInfo(): Promise<CompanyInfo> {
    const c = await this.company.getRaw();
    return { name: c.name, address: c.address, phone: c.phone, email: c.email, gstin: c.gstin, currencyCode: c.currencyCode, footerNote: c.footerNote, logo: await this.company.logoBuffer() };
  }

  /** Everything a costing print layout needs, with names instead of ids. Used by the on-screen preview and the PDF. */
  async costingModel(id: string): Promise<CostingPrintModel> {
    const c = await this.prisma.costing.findFirst({
      where: { id, deletedAt: null },
      include: {
        type: true, preparedBy: { select: { name: true } }, template: { select: { name: true } },
        groups: { orderBy: { sortOrder: 'asc' }, include: { group: true, categories: { orderBy: { sortOrder: 'asc' }, include: { category: true, materials: { orderBy: { sortOrder: 'asc' }, include: { item: true } } } }, labour: { orderBy: { sortOrder: 'asc' }, include: { labour: true } } } },
        expenses: { orderBy: { sortOrder: 'asc' }, include: { expense: true, costingGroup: { include: { group: true } } } },
      },
    });
    if (!c) throw new NotFoundException('Costing not found');
    const unitIds = [c.unitId, c.dimensionUnitId, ...c.groups.flatMap((g) => [...g.categories.flatMap((x) => x.materials.map((m) => m.unitId)), ...g.labour.map((l) => l.unitId)])].filter((x): x is string => !!x);
    const units = new Map((await this.prisma.unit.findMany({ where: { id: { in: [...new Set(unitIds)] } }, select: { id: true, symbol: true } })).map((u) => [u.id, u.symbol]));
    const sym = (id?: string | null) => (id ? (units.get(id) ?? '') : '');

    let sl = 0;
    const groups = c.groups.map((g) => {
      const materials = g.categories.flatMap((cat) => cat.materials.map((m) => ({
        sl: ++sl, category: cat.category.name, code: m.item.code, item: m.item.name, notes: str(m.notes), qty: str(m.quantity), unit: sym(m.unitId),
        wastage: str(n(m.effectiveQuantity) - n(m.quantity) > 0.00005 ? +(n(m.effectiveQuantity) - n(m.quantity)).toFixed(4) : ''), effectiveQty: str(m.effectiveQuantity), rate: str(m.rate), total: str(m.total),
      })));
      return {
        name: g.group.name, wastagePercent: g.wastagePercent === null ? null : str(g.wastagePercent), materialTotal: str(materials.reduce((s, m) => s + n(m.total), 0).toFixed(2)), labourTotal: str(g.labour.reduce((s, l) => s + n(l.total), 0).toFixed(2)),
        materials, labour: g.labour.map((l) => ({ labour: l.labour.name, qty: str(l.quantity), unit: sym(l.unitId), rate: str(l.rate), total: str(l.total) })),
      };
    });
    return {
      doc: { number: c.costingNumber, date: day(c.costingDate), status: c.status, version: c.version, pricingMode: c.pricingMode, preparedBy: c.preparedBy.name, approvedAt: c.approvedAt ? day(c.approvedAt) : null, template: c.template?.name ?? null },
      product: { name: c.productName, code: str(c.productCode), type: c.type.name, description: str(c.description), length: str(c.length), width: str(c.width), height: str(c.height), dimensionUnit: sym(c.dimensionUnitId), quantity: str(c.quantity), unit: sym(c.unitId) },
      groups,
      expenses: c.expenses.map((e) => ({ name: e.expense.name, scope: e.costingGroup?.group.name ?? 'Whole product', method: e.calculationMethod.replace('_', ' ').toLowerCase(), value: str(e.value), timing: e.applyTiming === 'AFTER_GST' ? 'after GST' : 'before GST', amount: str(e.amount) })),
      summary: {
        materialCost: str(c.materialCost), materialWastage: str(c.materialWastage), labourCost: str(c.labourCost), expenseCost: str(c.expenseCost), companyExpenseCost: str(c.companyExpenseCost), extraPercent: str(c.extraPercent), extraAmount: str(c.extraAmount), basicCost: str(c.basicCost),
        gstPercent: str(c.gstPercent), gstAmount: str(c.gstAmount), totalCostInclGst: str(c.totalCostInclGst), markupPercent: str(c.markupPercent), markupAmount: str(c.markupAmount),
        sellingPrice: str(c.sellingPrice), profitAmount: str(c.profitAmount), profitPercent: str(c.profitPercent), netBasicRate: str(c.netBasicRate), netSellingPrice: str(c.netSellingPrice),
      },
    };
  }

  /** JSON for the on-screen print preview: the model plus signed image links and company details. */
  async costingPreview(id: string) {
    const [model, images, company] = await Promise.all([this.costingModel(id), this.images.mainImages('costing', [id]), this.company.get()]);
    return { ...model, image: images.get(id) ?? null, company };
  }

  // ───────── PDFs ─────────

  async costingPdf(id: string, mode: string, orientation: Orientation): Promise<{ buffer: Buffer; filename: string }> {
    if (!COSTING_MODES.includes(mode as CostingMode)) throw new BadRequestException(`mode must be one of: ${COSTING_MODES.join(', ')}`);
    const [m, company, bufs] = await Promise.all([this.costingModel(id), this.companyInfo(), this.images.mainImageBuffers('costing', [id], mode === 'product' ? 'full' : 'thumb')]);
    const img = bufs.get(id) ?? null;
    const cur = company.currencyCode;
    const titles: Record<CostingMode, string> = { detailed: 'Costing Sheet', summary: 'Costing Summary', product: 'Product Costing', materials: 'Material Details', labour: 'Labour Details' };
    const p = new Pdf(company, titles[mode as CostingMode], orientation, m.doc.number);
    p.letterhead();
    p.documentTitle(titles[mode as CostingMode], [['Costing no.', m.doc.number], ['Date', m.doc.date], ['Status', `${m.doc.status.replace('_', ' ').toLowerCase()}${m.doc.approvedAt ? ` (${m.doc.approvedAt})` : ''}`], ['Prepared by', m.doc.preparedBy], ['Version', `v${m.doc.version} · ${m.doc.pricingMode === 'LIVE' ? 'live rates' : 'frozen rates'}`]]);

    const dims = [m.product.length, m.product.width, m.product.height].some(Boolean) ? `${qty(m.product.length)} x ${qty(m.product.width)} x ${qty(m.product.height)} ${m.product.dimensionUnit}`.trim() : '';
    const productBlock = () => {
      const top = p.y;
      if (img && (mode === 'detailed' || mode === 'summary')) { p.image(img, [90, 80], p.left + p.width - 90, top); }
      p.kv([['Product', m.product.name], ['Code', m.product.code], ['Type', m.product.type], ['Quantity', `${qty(m.product.quantity)} ${m.product.unit}`], ['Dimensions (LxWxH)', dims], ['Template', m.doc.template]], 2, p.width - (img && (mode === 'detailed' || mode === 'summary') ? 100 : 0));
      if (m.product.description) p.paragraph(m.product.description, 8.5);
      if (img && (mode === 'detailed' || mode === 'summary')) p.doc.y = Math.max(p.doc.y, top + 86);
    };

    const matCols = [{ header: 'SL', width: 4, align: 'center' as const }, { header: 'Category', width: 13 }, { header: 'Item', width: 22 }, { header: 'Notes', width: 15 }, { header: 'Qty', width: 8, align: 'right' as const }, { header: 'Unit', width: 5 }, { header: 'Waste', width: 7, align: 'right' as const }, { header: 'Rate', width: 9, align: 'right' as const }, { header: 'Total', width: 10, align: 'right' as const }];
    const matRow = (x: CostingPrintModel['groups'][number]['materials'][number]) => [x.sl, x.category, x.item, x.notes, qty(x.qty), x.unit, x.wastage ? qty(x.wastage) : '', money(x.rate), money(x.total)];
    const labCols = [{ header: 'Labour', width: 40 }, { header: 'Qty', width: 10, align: 'right' as const }, { header: 'Unit', width: 8 }, { header: 'Rate', width: 15, align: 'right' as const }, { header: 'Total', width: 17, align: 'right' as const }];
    const labRow = (x: CostingPrintModel['groups'][number]['labour'][number]) => [x.labour, qty(x.qty), x.unit, money(x.rate), money(x.total)];
    const s = m.summary;

    if (mode === 'detailed') {
      productBlock();
      for (const g of m.groups) {
        p.heading(`${g.name}${g.wastagePercent !== null ? `  (wastage ${qty(g.wastagePercent)}%)` : ''}`, 11);
        if (g.materials.length) p.table(matCols, g.materials.map(matRow), { foot: ['', '', '', '', '', '', '', 'Material', money(g.materialTotal)] });
        if (g.labour.length) p.table(labCols, g.labour.map(labRow), { foot: ['', '', '', 'Labour', money(g.labourTotal)] });
      }
      if (m.expenses.length) { p.heading('Other expenses', 11); p.table([{ header: 'Expense', width: 30 }, { header: 'Applies to', width: 20 }, { header: 'Method', width: 16 }, { header: 'Value', width: 10, align: 'right' }, { header: 'Timing', width: 12 }, { header: 'Amount', width: 12, align: 'right' }], m.expenses.map((e) => [e.name, e.scope, e.method, qty(e.value), e.timing, money(e.amount)])); }
    } else if (mode === 'summary' || mode === 'product') {
      if (mode === 'product' && img) {
        const fit: [number, number] = orientation === 'landscape' ? [300, 220] : [330, 260];
        p.image(img, fit);
        productBlock();
        p.doc.y = Math.max(p.doc.y, p.y + fit[1] + 4);
      } else productBlock();
      if (mode === 'summary') p.table([{ header: 'Group', width: 40 }, { header: 'Material', width: 20, align: 'right' }, { header: 'Labour', width: 20, align: 'right' }, { header: 'Total', width: 20, align: 'right' }], m.groups.map((g) => [g.name, money(g.materialTotal), money(g.labourTotal), money(n(g.materialTotal) + n(g.labourTotal))]));
    } else if (mode === 'materials') {
      productBlock();
      const all = m.groups.flatMap((g) => g.materials.map((x) => ({ g: g.name, x })));
      p.table([{ header: 'SL', width: 4, align: 'center' }, { header: 'Group', width: 11 }, { header: 'Category', width: 12 }, { header: 'Code', width: 8 }, { header: 'Item', width: 20 }, { header: 'Qty', width: 8, align: 'right' }, { header: 'Unit', width: 5 }, { header: 'Waste', width: 7, align: 'right' }, { header: 'Eff. qty', width: 8, align: 'right' }, { header: 'Rate', width: 8, align: 'right' }, { header: 'Total', width: 9, align: 'right' }],
        all.map(({ g, x }) => [x.sl, g, x.category, x.code, x.item, qty(x.qty), x.unit, x.wastage ? qty(x.wastage) : '', qty(x.effectiveQty), money(x.rate), money(x.total)]), { foot: ['', '', '', '', '', '', '', '', '', 'Total', money(s.materialCost)] });
    } else {
      productBlock();
      const all = m.groups.flatMap((g) => g.labour.map((x) => ({ g: g.name, x })));
      p.table([{ header: 'Group', width: 22 }, { header: 'Labour', width: 30 }, { header: 'Qty', width: 9, align: 'right' }, { header: 'Unit', width: 7 }, { header: 'Rate', width: 14, align: 'right' }, { header: 'Total', width: 18, align: 'right' }], all.map(({ g, x }) => [g, x.labour, qty(x.qty), x.unit, money(x.rate), money(x.total)]), { foot: ['', '', '', '', 'Total', money(s.labourCost)] });
    }

    if (mode === 'detailed' || mode === 'summary' || mode === 'product') {
      p.totals([
        { label: `Material cost (${cur})`, value: money(s.materialCost) }, { label: '  of which wastage', value: money(s.materialWastage) }, { label: 'Labour cost', value: money(s.labourCost) }, { label: 'Other expenses', value: money(s.expenseCost) },
        ...(Number(s.companyExpenseCost) > 0 ? [{ label: '  of which company expenses', value: money(s.companyExpenseCost) }] : []),
        { label: 'Basic cost (before GST)', value: money(s.basicCost), strong: true }, { label: `GST ${qty(s.gstPercent)}%`, value: money(s.gstAmount) }, { label: 'Total cost incl. GST', value: money(s.totalCostInclGst), strong: true },
        ...(Number(s.extraAmount) > 0 ? [{ label: `Extra ${qty(s.extraPercent)}%`, value: money(s.extraAmount) }] : []),
        { label: `Markup ${qty(s.markupPercent)}%`, value: money(s.markupAmount) }, { label: 'Selling price', value: money(s.sellingPrice), strong: true },
        { label: 'Profit', value: `${money(s.profitAmount)}  (${qty(s.profitPercent)}%)` }, { label: `Net basic rate / unit`, value: money(s.netBasicRate) }, { label: 'Net selling price / unit', value: money(s.netSellingPrice) },
      ]);
    } else if (mode === 'materials') p.totals([{ label: 'Total material cost', value: money(s.materialCost), strong: true }, { label: 'of which wastage', value: money(s.materialWastage) }]);
    else p.totals([{ label: 'Total labour cost', value: money(s.labourCost), strong: true }]);
    return { buffer: await p.finish(), filename: `${m.doc.number}-${mode}.pdf` };
  }

  async quotationPdf(id: string, orientation: Orientation): Promise<{ buffer: Buffer; filename: string }> {
    const [q, company] = await Promise.all([this.quotations.get(id), this.companyInfo()]);
    const bufs = await this.images.mainImageBuffers('costing', q.items.map((i) => i.costingId).filter((x): x is string => !!x));
    const p = new Pdf(company, 'Quotation', orientation, q.number);
    p.letterhead();
    p.documentTitle('Quotation', [['Quotation no.', q.number], ['Date', day(q.quotationDate)], ['Valid until', day(q.validUntil)], ['Prepared by', q.preparedBy.name]]);
    p.kv([['Customer', q.customerName], ['GSTIN', q.customerGstin], ['Address', q.customerAddress], ['State', q.customerState], ['Mobile', q.customerMobile], ['Email', q.customerEmail]], 2);
    if (q.subject) p.paragraph(`Subject: ${q.subject}`, 10);
    const anyImage = q.items.some((i) => i.costingId && bufs.has(i.costingId));
    const cols = [{ header: 'SL', width: 4, align: 'center' as const }, ...(anyImage ? [{ header: '', width: 8 }] : []), { header: 'Product', width: 30 }, { header: 'Qty', width: 9, align: 'right' as const }, { header: 'Unit price', width: 11, align: 'right' as const }, { header: 'Discount', width: 9, align: 'right' as const }, { header: 'GST', width: 11, align: 'right' as const }, { header: 'Total', width: 13, align: 'right' as const }];
    p.table(cols, q.items.map((i, k) => [
      k + 1, ...(anyImage ? [{ image: i.costingId ? (bufs.get(i.costingId) ?? null) : null }] : []),
      { text: `${i.productName}${i.productCode ? ` (${i.productCode})` : ''}${i.description ? `\n${i.description}` : ''}` }, `${qty(i.quantity)} ${i.unitLabel ?? ''}`.trim(), money(i.unitPrice),
      n(i.lineDiscount) + n(i.headerDiscountShare) ? money(n(i.lineDiscount) + n(i.headerDiscountShare)) : '-', `${money(i.gstAmount)} (${qty(i.gstPercent)}%)`, money(i.lineTotal),
    ]));
    const discount = n(q.lineDiscountTotal) + n(q.headerDiscount);
    p.totals([
      { label: 'Subtotal', value: money(q.subtotal) }, ...(discount ? [{ label: 'Discount', value: money(discount) }] : []), { label: 'Taxable amount', value: money(q.taxableAmount) }, { label: 'GST', value: money(q.gstAmount) },
      ...(n(q.roundOff) ? [{ label: 'Round off', value: money(q.roundOff) }] : []), { label: `Grand total (${company.currencyCode})`, value: money(q.grandTotal), strong: true },
    ]);
    if (q.terms) { p.heading('Terms & conditions', 10); p.paragraph(q.terms, 8.5); }
    if (q.notes) { p.heading('Notes', 10); p.paragraph(q.notes, 8.5); }
    return { buffer: await p.finish(), filename: `${q.number}.pdf` };
  }

  async priceListPdf(id: string, orientation: Orientation): Promise<{ buffer: Buffer; filename: string }> {
    const [l, company] = await Promise.all([this.priceLists.get(id), this.companyInfo()]);
    const bufs = await this.images.mainImageBuffers('costing', l.items.map((i) => i.costingId));
    const p = new Pdf(company, 'Price List', orientation, l.number);
    p.letterhead();
    p.documentTitle(l.name, [['Price list no.', l.number], ['Effective', day(l.effectiveDate)], ['Status', l.status.toLowerCase()], ['GST', l.gstTreatment === 'EXCLUSIVE' ? 'prices exclude GST' : l.gstTreatment === 'INCLUSIVE' ? 'prices include GST' : 'no GST']]);
    const excl = l.gstTreatment === 'EXCLUSIVE';
    const anyImage = l.items.some((i) => bufs.has(i.costingId));
    const cols = [{ header: 'SL', width: 4, align: 'center' as const }, ...(anyImage ? [{ header: '', width: 8 }] : []), { header: 'Code', width: 10 }, { header: 'Product', width: 30 }, { header: 'List price', width: 13, align: 'right' as const }, { header: 'Discount', width: 11, align: 'right' as const },
      ...(excl ? [{ header: 'GST', width: 11, align: 'right' as const }] : []), { header: excl ? 'Price incl. GST' : 'Selling price', width: 14, align: 'right' as const }];
    p.table(cols, l.items.map((i, k) => [
      k + 1, ...(anyImage ? [{ image: bufs.get(i.costingId) ?? null }] : []), str(i.productCode), i.productName, money(i.sellingPrice), n(i.discountApplied) ? money(i.discountApplied) : '-',
      ...(excl ? [money(i.gstAmount)] : []), money(excl ? i.effectiveInclGst : i.effectivePrice),
    ]));
    if (l.notes) p.paragraph(l.notes, 8.5);
    return { buffer: await p.finish(), filename: `${l.number}.pdf` };
  }
}
