import { BadRequestException, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { Pdf, latin } from './pdf';
import { PrintService } from './print.service';

const D = (v: string) => ({ toString: () => v });
const date = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Reads text back out of an uncompressed pdfkit document (hex strings inside TJ operators). */
function pdfText(buf: Buffer): string {
  const raw = buf.toString('latin1');
  const lines: string[] = [];
  for (const m of raw.matchAll(/\[(.*?)\]\s*TJ/gs)) {
    lines.push([...m[1].matchAll(/<([0-9a-f]+)>/gi)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join(''));
  }
  return lines.join('\n');
}
const pages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
const mediaBox = (buf: Buffer) => buf.toString('latin1').match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)!.slice(1).map(Number);

const costingRecord = () => ({
  id: 'c1', costingNumber: 'COST-2026-0001', productName: 'Metal Chair', productCode: 'MC1', costingDate: date('2026-02-01'), status: 'APPROVED', version: 4, pricingMode: 'SNAPSHOT', approvedAt: date('2026-02-03'),
  description: 'Stackable chair', length: D('45'), width: D('50'), height: D('90'), dimensionUnitId: 'u-cm', quantity: D('2'), unitId: 'u-pc',
  materialCost: D('2326.12'), materialWastage: D('0'), labourCost: D('1800'), expenseCost: D('0'), basicCost: D('4126.12'), gstPercent: D('18'), gstAmount: D('742.7'), totalCostInclGst: D('4868.82'),
  extraPercent: D('5'), extraAmount: D('243.44'), companyExpenseCost: D('30'), markupPercent: D('10'), markupAmount: D('486.88'), sellingPrice: D('5355.7'), profitAmount: D('486.88'), profitPercent: D('11.8'), netBasicRate: D('2063.06'), netSellingPrice: D('2677.85'),
  type: { name: 'Chairs' }, preparedBy: { name: 'Asha' }, template: { name: 'Metal Chair General' },
  groups: [
    { group: { name: 'Metal' }, wastagePercent: D('2'), categories: [{ category: { name: 'Metal Frame' }, materials: [{ item: { code: 'MPM', name: 'Metal Pipe MAX' }, notes: '25mm', quantity: D('20.94'), unitId: 'u-kg', effectiveQuantity: D('20.94'), rate: D('98'), total: D('2052.12') }] }], labour: [{ labour: { name: 'Metal Labour' }, quantity: D('1'), unitId: 'u-pc', rate: D('1200'), total: D('1200') }] },
    { group: { name: 'Powder' }, wastagePercent: null, categories: [{ category: { name: 'Coating' }, materials: [{ item: { code: 'BMP', name: 'Black Matt Powder' }, notes: null, quantity: D('0.8'), unitId: 'u-kg', effectiveQuantity: D('0.8'), rate: D('270'), total: D('216') }] }], labour: [{ labour: { name: 'Powder Labour' }, quantity: D('1'), unitId: 'u-pc', rate: D('600'), total: D('600') }] },
  ],
  expenses: [{ expense: { name: 'Packing' }, costingGroup: null, calculationMethod: 'FIXED', value: D('50'), applyTiming: 'BEFORE_GST', amount: D('50') }],
});

async function make(costing: any = costingRecord()) {
  Pdf.compress = false;
  const jpeg = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#3366cc' } }).jpeg().toBuffer();
  const prisma: any = {
    costing: { findFirst: jest.fn().mockResolvedValue(costing) },
    unit: { findMany: jest.fn().mockResolvedValue([{ id: 'u-kg', symbol: 'KG' }, { id: 'u-pc', symbol: 'PC' }, { id: 'u-cm', symbol: 'cm' }]) },
  };
  const images: any = { mainImages: jest.fn().mockResolvedValue(new Map([['c1', { thumbUrl: '/files/t', url: '/files/f', description: null }]])), mainImageBuffers: jest.fn().mockResolvedValue(new Map([['c1', jpeg]])) };
  const company: any = {
    getRaw: jest.fn().mockResolvedValue({ name: 'Acme Furniture Pvt Ltd', address: '12 Industrial Area, Pune', phone: '+91 20 1234', email: 'sales@acme.test', gstin: '27ABCDE1234F1Z5', currencyCode: 'INR', footerNote: 'Thank you for your business' }),
    logoBuffer: jest.fn().mockResolvedValue(jpeg), get: jest.fn().mockResolvedValue({ name: 'Acme', logoUrl: '/files/logo' }),
  };
  const quotations: any = { get: jest.fn() };
  const priceLists: any = { get: jest.fn() };
  return { svc: new PrintService(prisma, images, company, quotations, priceLists), prisma, images, quotations, priceLists };
}

afterAll(() => { Pdf.compress = true; });

describe('latin()', () => {
  it('keeps Latin text, maps typography and replaces unsupported characters', () => {
    expect(latin('Café – 5 × 3 ₹100')).toBe('Café - 5 x 3 Rs.100');
    expect(latin('नमस्ते')).toBe('??????');
    expect(latin(null)).toBe('');
  });
});

describe('PrintService.costingModel / preview', () => {
  it('names everything and numbers the material lines across groups', async () => {
    const { svc } = await make();
    const m = await svc.costingModel('c1');
    expect(m.doc).toMatchObject({ number: 'COST-2026-0001', status: 'APPROVED', preparedBy: 'Asha', approvedAt: '2026-02-03', template: 'Metal Chair General' });
    expect(m.product).toMatchObject({ name: 'Metal Chair', dimensionUnit: 'cm', unit: 'PC', length: '45' });
    expect(m.groups.map((g) => g.name)).toEqual(['Metal', 'Powder']);
    expect(m.groups[0].materials[0]).toMatchObject({ sl: 1, item: 'Metal Pipe MAX', unit: 'KG', total: '2052.12' });
    expect(m.groups[1].materials[0].sl).toBe(2);
    expect(m.groups[0]).toMatchObject({ materialTotal: '2052.12', labourTotal: '1200.00' });
    expect(m.expenses[0]).toMatchObject({ name: 'Packing', scope: 'Whole product', timing: 'before GST', amount: '50' });
    expect(m.summary.sellingPrice).toBe('5355.7');
  });

  it('adds signed image links and the company for the on-screen preview', async () => {
    const { svc } = await make();
    const p = await svc.costingPreview('c1');
    expect(p.image).toMatchObject({ thumbUrl: '/files/t' });
    expect(p.company.name).toBe('Acme');
  });

  it('404s for a missing costing', async () => {
    const { svc } = await make(null);
    await expect(svc.costingModel('x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PrintService.costingPdf', () => {
  it('produces an A4 portrait PDF with company, product, tables and the summary', async () => {
    const { svc } = await make();
    const { buffer, filename } = await svc.costingPdf('c1', 'detailed', 'portrait');
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(filename).toBe('COST-2026-0001-detailed.pdf');
    const [w, h] = mediaBox(buffer);
    expect(w).toBeCloseTo(595.28, 0); expect(h).toBeCloseTo(841.89, 0);
    const text = pdfText(buffer);
    for (const needle of ['Acme Furniture Pvt Ltd', 'GSTIN 27ABCDE1234F1Z5', 'COST-2026-0001', 'Metal Chair', 'Metal Pipe MAX', 'Black Matt Powder', 'Metal Labour', 'Packing', '2,052.12', '1,200.00', '4,126.12', '4,868.82', '5,355.70', 'Asha', 'approved']) {
      expect(text).toContain(needle);
    }
    expect(text).toContain(`Page 1 of ${pages(buffer)}`);
    expect(pages(buffer)).toBeLessThanOrEqual(2);
  });

  it('supports landscape orientation', async () => {
    const { svc } = await make();
    const [w, h] = mediaBox((await svc.costingPdf('c1', 'detailed', 'landscape')).buffer);
    expect(w).toBeGreaterThan(h);
  });

  it('prints each layout with the right sections', async () => {
    const { svc } = await make();
    const text = async (mode: string) => pdfText((await svc.costingPdf('c1', mode, 'portrait')).buffer);
    const summary = await text('summary');
    expect(summary).toContain('Costing Summary'); expect(summary).toContain('5,355.70'); expect(summary).toContain('Extra 5%'); expect(summary).toContain('243.44'); expect(summary).toContain('of which company expenses'); expect(summary).not.toContain('Metal Pipe MAX');
    const product = await text('product');
    expect(product).toContain('Product Costing'); expect(product).toContain('Selling price');
    const materials = await text('materials');
    expect(materials).toContain('Material Details'); expect(materials).toContain('Black Matt Powder'); expect(materials).not.toContain('Metal Labour');
    const labour = await text('labour');
    expect(labour).toContain('Labour Details'); expect(labour).toContain('Powder Labour'); expect(labour).not.toContain('Black Matt Powder');
  });

  it('paginates long tables with repeated headers and page numbers', async () => {
    const rec = costingRecord();
    rec.groups[0].categories[0].materials = Array.from({ length: 120 }, (_, i) => ({ item: { code: `I${i}`, name: `Item number ${i}` }, notes: null, quantity: D('1'), unitId: 'u-kg', effectiveQuantity: D('1'), rate: D('10'), total: D('10') })) as never;
    const { svc } = await make(rec);
    const { buffer } = await svc.costingPdf('c1', 'materials', 'portrait');
    const n = pages(buffer);
    expect(n).toBeGreaterThan(2);
    const text = pdfText(buffer);
    expect(text).toContain(`Page ${n} of ${n}`);
    expect((text.match(/Category/g) ?? []).length).toBeGreaterThanOrEqual(n); // header repeated on every page
    expect(text).toContain('Item number 119');
  });

  it('survives a missing image / logo and non-Latin text', async () => {
    const rec = costingRecord();
    rec.productName = 'कुर्सी Chair';
    const { svc, images } = await make(rec);
    images.mainImageBuffers.mockResolvedValue(new Map());
    const { buffer } = await svc.costingPdf('c1', 'product', 'portrait');
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdfText(buffer)).toContain('Chair');
  });

  it('rejects unknown modes', async () => {
    const { svc } = await make();
    await expect(svc.costingPdf('c1', 'fancy', 'portrait')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('quotation and price list PDFs', () => {
  it('prints a quotation with customer, lines, GST and terms', async () => {
    const { svc, quotations } = await make();
    quotations.get.mockResolvedValue({
      number: 'QTN-2026-0007', quotationDate: date('2026-02-01'), validUntil: date('2026-03-03'), preparedBy: { name: 'Asha' }, customerName: 'Acme Traders', customerGstin: '27AAAAA0000A1Z5', customerAddress: 'Mumbai', customerState: 'MH', customerMobile: null, customerEmail: null,
      subject: 'Chairs for office', terms: '1. Payment in 30 days', notes: null, subtotal: D('10000'), lineDiscountTotal: D('0'), headerDiscount: D('500'), taxableAmount: D('9500'), gstAmount: D('1710'), roundOff: D('0'), grandTotal: D('11210'),
      items: [{ costingId: 'c1', productName: 'Metal Chair', productCode: 'MC1', description: 'Black finish', quantity: D('10'), unitLabel: 'PC', unitPrice: D('1000'), lineDiscount: D('0'), headerDiscountShare: D('500'), gstPercent: D('18'), gstAmount: D('1710'), lineTotal: D('11210') }],
    });
    const { buffer, filename } = await svc.quotationPdf('q1', 'portrait');
    const text = pdfText(buffer);
    expect(filename).toBe('QTN-2026-0007.pdf');
    for (const needle of ['Acme Furniture Pvt Ltd', 'QTN-2026-0007', 'Acme Traders', 'Chairs for office', 'Metal Chair', '11,210.00', 'Terms & conditions', 'Payment in 30 days']) expect(text).toContain(needle);
  });

  it('prints a price list with GST columns for exclusive lists', async () => {
    const { svc, priceLists } = await make();
    priceLists.get.mockResolvedValue({
      number: 'PL-2026-0001', name: 'Retail 2026', effectiveDate: date('2026-04-01'), status: 'ACTIVE', gstTreatment: 'EXCLUSIVE', notes: 'Prices valid for April',
      items: [{ costingId: 'c1', productCode: 'MC1', productName: 'Metal Chair', sellingPrice: D('4951.34'), discountApplied: D('0'), gstAmount: D('891.24'), effectiveInclGst: D('5842.58'), effectivePrice: D('4951.34') }],
    });
    const text = pdfText((await svc.priceListPdf('p1', 'landscape')).buffer);
    for (const needle of ['Retail 2026', 'PL-2026-0001', 'Metal Chair', '4,951.34', '891.24', '5,842.58', 'Price incl. GST']) expect(text).toContain(needle);
  });
});
