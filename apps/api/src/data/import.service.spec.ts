import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { ImportService } from './import.service';
import { MasterService } from '../masters/master.service';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TYPE = u(1), GROUP = u(2), CAT = u(3), KG = u(10), M = u(11), SUP = u(20), ITEM = u(30), LAB = u(40), COSTING = u(50);

async function book(headers: string[], rows: (string | number)[][], sheet = 'Data') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.addRow(headers);
  rows.forEach((r) => ws.addRow(r));
  return { originalname: 'import.xlsx', buffer: Buffer.from(await wb.xlsx.writeBuffer()) } as Express.Multer.File;
}

function make(existing: Record<string, string[]> = {}) {
  const created: any[] = [];
  const tx: any = new Proxy({}, { get: (_t, model: string) => ({ create: jest.fn(async ({ data }: any) => { created.push({ model, data }); return { id: `new-${created.length}` }; }), createMany: jest.fn(), deleteMany: jest.fn() }) });
  const rows = (key: string, field: string) => (existing[key] ?? []).map((v, i) => ({ [field]: v, id: u(900 + i) }));
  const prisma: any = {
    type: { findMany: jest.fn(async () => [{ id: TYPE, code: 'CHAIRS' }, ...rows('types', 'code')]), findFirst: jest.fn(async ({ where }: any) => (where.id === TYPE ? { id: TYPE } : null)) },
    itemGroup: { findMany: jest.fn(async () => [{ id: GROUP, code: 'METAL', typeId: TYPE }, ...rows('groups', 'code')]), findFirst: jest.fn(async ({ where }: any) => (where.id === GROUP ? { id: GROUP, typeId: TYPE, name: 'Metal' } : null)) },
    itemCategory: { findMany: jest.fn(async () => [{ id: CAT, code: 'FRAME', groupId: GROUP }]), findFirst: jest.fn(async ({ where }: any) => (where.id === CAT ? { id: CAT, groupId: GROUP, name: 'Frame' } : null)) },
    unit: { findMany: jest.fn(async () => [{ id: KG, symbol: 'KG' }, { id: M, symbol: 'M' }]), findFirst: jest.fn(async ({ where }: any) => ({ id: where.id })), count: jest.fn(async ({ where }: any) => where.id.in.length) },
    supplier: { findMany: jest.fn(async () => [{ id: SUP, code: 'SUP01' }]), count: jest.fn(async () => 1) },
    item: { findMany: jest.fn(async ({ select }: any) => (select?.unitId ? [{ id: ITEM, code: 'MPM', unitId: KG }, ...rows('items', 'code')] : rows('items', 'code'))) },
    labour: { findMany: jest.fn(async () => [{ id: LAB, code: 'LAB1' }, ...rows('labour', 'code')]) },
    expense: { findMany: jest.fn(async () => []) },
    template: { findMany: jest.fn(async () => rows('templates', 'code')) },
    customer: { findMany: jest.fn(async () => []) },
    costing: { findMany: jest.fn(async () => [{ id: COSTING, costingNumber: 'COST-2026-0001' }]) },
    importHistory: { create: jest.fn(async () => ({ id: 'imp1' })), findMany: jest.fn() },
    user: { findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const audit: any = { log: jest.fn() };
  const masters = new MasterService(prisma, audit);
  const templates: any = { validateTree: jest.fn(), createWithin: jest.fn(async () => 'tpl1') };
  const priceLists: any = { preview: jest.fn(), create: jest.fn() };
  const svc = new ImportService(prisma, audit, masters, templates, priceLists);
  const actor = (perms: string[]): any => ({ id: 'u1', permissions: new Set(['data_management:import', ...perms]) });
  return { svc, prisma, created, templates, priceLists, actor, audit };
}

const TYPE_HEADERS = ['Code *', 'Name *', 'Description', 'Active'];

describe('ImportService permissions and templates', () => {
  it('needs both the import permission and create permission on the target module', async () => {
    const { svc, actor } = make();
    await expect(svc.preview(actor([]), 'types', await book(TYPE_HEADERS, [['A', 'A', '', '']]))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.preview({ id: 'u', permissions: new Set(['types:create']) } as any, 'types', await book(TYPE_HEADERS, []))).rejects.toBeInstanceOf(ForbiddenException);
    expect(svc.kinds(actor(['types:create'])).map((k) => k.kind)).toEqual(['types']);
  });

  it('builds a downloadable template with a header-only sheet and an instructions sheet', async () => {
    const { svc, actor } = make();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await svc.template(actor(['items:create']), 'items')) as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Items', 'Instructions']);
    expect(wb.getWorksheet('Items')!.rowCount).toBe(1); // nothing sample-like can be imported by accident
    expect(String(wb.getWorksheet('Items')!.getRow(1).getCell(1).value)).toBe('Code *');
    await expect(svc.template(actor([]), 'nonsense')).rejects.toThrow(/Unknown import type/);
  });
});

describe('ImportService masters', () => {
  it('validates rows, flags duplicates (database and within the file) and reports every problem', async () => {
    const { svc, actor } = make({ types: ['EXISTING'] });
    const file = await book(TYPE_HEADERS, [['TBL', 'Tables', '', 'Y'], ['existing', 'Dup', '', ''], ['TBL', 'Again', '', ''], ['bad code!', 'Bad', '', ''], ['X1', '', '', ''], ['X2', 'Inactive', '', 'N'], ['X3', 'Odd', '', 'maybe']]);
    const r = await svc.preview(actor(['types:create']), 'types', file);
    expect(r.rows.map((x) => x.status)).toEqual(['ok', 'duplicate', 'duplicate', 'error', 'error', 'ok', 'error']);
    expect(r.rows[1].errors[0]).toMatch(/already exists/);
    expect(r.rows[2].errors[0]).toMatch(/more than once/);
    expect(r.rows[4].errors.join(' ')).toMatch(/name/i);
    expect(r.rows[6].errors[0]).toMatch(/Active must be Y or N/);
    expect(r).toMatchObject({ total: 7, valid: 2, invalid: 3, duplicates: 2 });
  });

  it('rejects files without the required columns and non-xlsx uploads', async () => {
    const { svc, actor } = make();
    await expect(svc.preview(actor(['types:create']), 'types', await book(['Code'], [['A']]))).rejects.toThrow(/Missing column\(s\): Name/);
    await expect(svc.preview(actor(['types:create']), 'types', { originalname: 'a.csv', buffer: Buffer.from('a') } as any)).rejects.toThrow(/Only \.xlsx/);
    await expect(svc.preview(actor(['types:create']), 'types', await book(TYPE_HEADERS, []))).rejects.toThrow(/no data rows/);
  });

  it('resolves references by code and reports unknown ones', async () => {
    const { svc, actor } = make();
    const r = await svc.preview(actor(['item_groups:create']), 'item-groups', await book(['Code *', 'Name *', 'Type Code *'], [['G1', 'Wood', 'chairs'], ['G2', 'Glass', 'NOPE'], ['G3', 'Cloth', '']]));
    expect(r.rows.map((x) => x.status)).toEqual(['ok', 'error', 'error']);
    expect(r.rows[1].errors).toEqual(['Unknown type code "NOPE"']);
    expect(r.rows[2].errors).toEqual(['Type code is required']);
  });

  const ITEM_HEADERS = ['Code *', 'Name *', 'Type Code *', 'Group Code *', 'Category Code *', 'Base Unit *', 'Default Purchase Rate', 'GST %', 'Min/Max/Avg Capable', 'Min Rate', 'Unit Conversions', 'Suppliers'];
  it('imports items with unit conversions, suppliers and a default supplier', async () => {
    const { svc, actor, created } = make();
    const file = await book(ITEM_HEADERS, [['PIPE', 'Metal Pipe', 'CHAIRS', 'METAL', 'FRAME', 'KG', 98, 18, 'N', '', 'M=3.15', 'SUP01=95*']]);
    const r = await svc.preview(actor(['items:create']), 'items', file);
    expect(r.rows[0]).toMatchObject({ status: 'ok', errors: [] });
    await svc.confirm(actor(['items:create']), 'items', file, false);
    const item = created.find((c) => c.model === 'item')!.data;
    expect(item).toMatchObject({ code: 'PIPE', defaultPurchaseRate: '98', gstPercent: '18', hasRateRange: false, defaultSupplierId: SUP });
  });

  it('catches malformed pairs, rates without the range flag, and hierarchy mismatches', async () => {
    const { svc, actor, prisma } = make();
    prisma.itemCategory.findFirst = jest.fn(async () => ({ id: CAT, groupId: u(999), name: 'Frame' })); // category belongs to another group
    const file = await book(ITEM_HEADERS, [
      ['I1', 'A', 'CHAIRS', 'METAL', 'FRAME', 'KG', 1, 0, 'N', '', 'M-3.15', ''],
      ['I2', 'B', 'CHAIRS', 'METAL', 'FRAME', 'KG', 1, 0, 'N', 5, '', ''],
      ['I3', 'C', 'CHAIRS', 'METAL', 'FRAME', 'KG', 1, 0, 'N', '', 'ZZ=2', ''],
      ['I4', 'D', 'CHAIRS', 'METAL', 'FRAME', 'KG', 1, 0, 'N', '', '', ''],
    ]);
    const r = await svc.preview(actor(['items:create']), 'items', file);
    expect(r.rows[0].errors[0]).toMatch(/cannot read "M-3.15"/);
    expect(r.rows[1].errors[0]).toMatch(/only allowed when Min\/Max\/Avg Capable is Y/);
    expect(r.rows[2].errors[0]).toMatch(/Unknown unit symbol "ZZ"/);
    expect(r.rows[3].errors.join(' ')).toMatch(/does not belong to the selected group/);
  });

  it('confirm blocks the whole import when any row is bad, unless the user chose to skip', async () => {
    const { svc, actor, created, prisma } = make();
    const file = await book(TYPE_HEADERS, [['T1', 'One', '', ''], ['bad code!', 'Bad', '', ''], ['T3', 'Three', '', '']]);
    await expect(svc.confirm(actor(['types:create']), 'types', file, false)).rejects.toThrow(BadRequestException);
    expect(created).toHaveLength(0);
    expect(prisma.importHistory.create).not.toHaveBeenCalled();

    const r = await svc.confirm(actor(['types:create']), 'types', file, true);
    expect(r).toMatchObject({ imported: 2, skipped: 1, records: 2 });
    expect(created.map((c) => c.data.code)).toEqual(['T1', 'T3']);
    expect(created[0].data).toMatchObject({ createdBy: 'u1', isActive: true });
    expect(prisma.importHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'types', totalRows: 3, successRows: 2, failedRows: 1 }) });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1); // all inserted rows share one transaction
  });

  it('refuses an import with nothing valid', async () => {
    const { svc, actor } = make();
    await expect(svc.confirm(actor(['types:create']), 'types', await book(TYPE_HEADERS, [['bad code!', 'x', '', '']]), true)).rejects.toThrow(/no valid rows/);
  });
});

describe('ImportService templates', () => {
  const H = ['Template Code *', 'Template Name', 'Type Code', 'Wastage %', 'GST %', 'Markup %', 'Description', 'Line Type *', 'Group Code', 'Category Code', 'Item / Labour / Expense Code *', 'Quantity', 'Unit', 'Line Wastage %', 'Rate Override', 'Expense Method', 'Expense Value', 'Notes'];
  const line = (code: string, over: Record<number, string | number> = {}) => {
    const r: (string | number)[] = [code, 'Metal Chair', 'CHAIRS', 2, 18, 25, '', 'MATERIAL', 'METAL', 'FRAME', 'MPM', 20.94, 'KG', '', '', '', '', ''];
    Object.entries(over).forEach(([i, v]) => (r[Number(i)] = v));
    return r;
  };

  it('groups lines into one template and creates it inside the shared transaction', async () => {
    const { svc, actor, templates } = make();
    const file = await book(H, [line('T1'), line('T1', { 7: 'LABOUR', 9: '', 10: 'LAB1', 11: 1, 12: '' })], 'Template Lines');
    const r = await svc.preview(actor(['templates:create']), 'templates', file);
    expect(r.rows.map((x) => x.status)).toEqual(['ok', 'ok']);
    const res = await svc.confirm(actor(['templates:create']), 'templates', file, false);
    expect(res.records).toBe(1);
    expect(templates.createWithin).toHaveBeenCalledTimes(1);
    const payload = templates.createWithin.mock.calls[0][2];
    expect(payload).toMatchObject({ code: 'T1', typeId: TYPE, markupPercent: '25' });
    expect(payload.groups).toHaveLength(1);
    expect(payload.groups[0].categories[0].items[0]).toMatchObject({ itemId: ITEM, quantity: '20.94', unitId: KG });
    expect(payload.groups[0].labour[0].labourId).toBe(LAB);
  });

  it('rejects the whole template when one line is wrong', async () => {
    const { svc, actor, templates } = make();
    const file = await book(H, [line('T1'), line('T1', { 10: 'GHOST' })], 'Template Lines');
    const r = await svc.preview(actor(['templates:create']), 'templates', file);
    expect(r.rows.map((x) => x.status)).toEqual(['error', 'error']);
    expect(r.rows[1].errors[0]).toMatch(/Unknown item code "GHOST"/);
    expect(r.rows[0].errors[0]).toMatch(/whole template is rejected/);
    await expect(svc.confirm(actor(['templates:create']), 'templates', file, true)).rejects.toThrow(/no valid rows/);
    expect(templates.createWithin).not.toHaveBeenCalled();
  });

  it('surfaces server-side hierarchy errors and existing template codes', async () => {
    const { svc, actor, templates } = make({ templates: ['T2'] });
    templates.validateTree.mockRejectedValueOnce(new BadRequestException('groups.0.groupId: Group does not belong to the template\'s type'));
    const r = await svc.preview(actor(['templates:create']), 'templates', await book(H, [line('T1'), line('T2')], 'Template Lines'));
    expect(r.rows[0].errors[0]).toMatch(/does not belong/);
    expect(r.rows[1]).toMatchObject({ status: 'duplicate' });
  });

  it('rejects unknown line types', async () => {
    const { svc, actor } = make();
    const r = await svc.preview(actor(['templates:create']), 'templates', await book(H, [line('T1', { 7: 'WIDGET' })], 'Template Lines'));
    expect(r.rows[0].errors.join(' ')).toMatch(/Line Type must be MATERIAL, LABOUR or EXPENSE/);
  });
});

describe('ImportService price lists', () => {
  const H = ['Price List Name *', 'Effective Date *', 'Cost Base', 'GST Treatment', 'Round To', 'Costing Number *', 'Profit Method *', 'Profit Value *', 'Discount %', 'Discount Amount', 'Min Price', 'Max Price', 'Notes'];

  it('creates one draft list per name via the price list service', async () => {
    const { svc, actor, priceLists } = make();
    const file = await book(H, [['Retail', '2026-04-01', '', '', '', 'COST-2026-0001', 'PERCENT', 20, '', '', '', '', '']], 'Price List Items');
    const res = await svc.confirm(actor(['price_lists:create']), 'price-lists', file, false);
    expect(res.records).toBe(1);
    expect(priceLists.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: 'Retail', costBase: 'BASIC_COST', gstTreatment: 'EXCLUSIVE', items: [expect.objectContaining({ costingId: COSTING, profitValue: '20' })] }));
  });

  it('reports unknown costings and server validation errors (e.g. not approved)', async () => {
    const { svc, actor, priceLists } = make();
    priceLists.preview.mockRejectedValueOnce(new BadRequestException('Only approved costings can be priced. Not approved: COST-2026-0001'));
    const file = await book(H, [['A', '2026-04-01', '', '', '', 'COST-2026-0001', 'PERCENT', 20, '', '', '', '', ''], ['B', '2026-04-01', '', '', '', 'COST-NOPE', 'PERCENT', 20, '', '', '', '', '']], 'Price List Items');
    const r = await svc.preview(actor(['price_lists:create']), 'price-lists', file);
    expect(r.rows[0].errors[0]).toMatch(/Only approved costings/);
    expect(r.rows[1].errors[0]).toMatch(/Unknown costing number/);
    expect(priceLists.create).not.toHaveBeenCalled();
  });
});
