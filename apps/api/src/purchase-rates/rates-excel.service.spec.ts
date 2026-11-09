import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PurchaseRatesService } from './purchase-rates.service';
import { RateImpactService } from './rate-impact.service';
import { RatesExcelService } from './rates-excel.service';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const KG = { id: uuid(10), symbol: 'KG', unitType: 'WEIGHT', baseFactor: '1' };

async function workbook(rows: (string | number)[][], headers = ['Item Code', 'Supplier Code', 'Unit', 'Quantity', 'Rate', 'Purchase Date', 'Reference No', 'Notes']) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('S');
  ws.addRow(headers);
  rows.forEach((r) => ws.addRow(r));
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { originalname: 'rates.xlsx', buffer } as Express.Multer.File;
}

function make(existing = 0) {
  const prisma: any = {
    item: {
      findMany: jest.fn().mockResolvedValue([{ id: uuid(1), code: 'MPM', unitId: KG.id }]),
      findFirst: jest.fn().mockResolvedValue({ id: uuid(1), unitId: KG.id, unit: KG, unitConversions: [] }),
    },
    supplier: { findMany: jest.fn().mockResolvedValue([{ id: uuid(2), code: 'SUP1' }]), findFirst: jest.fn().mockResolvedValue({ id: uuid(2) }) },
    areaConversion: { findMany: jest.fn().mockResolvedValue([]) },
    unit: { findMany: jest.fn().mockResolvedValue([{ id: KG.id, symbol: 'KG' }]), findFirst: jest.fn().mockResolvedValue(KG) },
    purchaseRate: { count: jest.fn().mockResolvedValue(existing) },
    importHistory: { create: jest.fn().mockResolvedValue({ id: 'imp1' }) },
    $transaction: jest.fn(async (fn: any) => fn({})),
  };
  const rates = new PurchaseRatesService(prisma, { log: jest.fn() } as any, new RateImpactService());
  const insert = jest.spyOn(rates, 'insertEntries').mockResolvedValue([{ itemId: uuid(1), moved: true } as any]);
  const excel = new RatesExcelService(prisma, rates, { log: jest.fn() } as any);
  return { excel, prisma, insert };
}

describe('RatesExcelService', () => {
  it('rejects non-xlsx uploads', async () => {
    const { excel } = make();
    await expect(excel.preview({ originalname: 'x.csv', buffer: Buffer.from('a,b') } as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(excel.preview(undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects files with missing required columns', async () => {
    const { excel } = make();
    await expect(excel.preview(await workbook([['MPM', 98]], ['Item Code', 'Rate']))).rejects.toThrow(/Missing column/);
  });

  it('validates each row and reports every problem', async () => {
    const { excel } = make();
    const file = await workbook([
      ['MPM', 'SUP1', 'KG', 20, 98, '2026-01-15', 'INV1', ''],
      ['NOPE', '', '', '', 98, '2026-01-15', '', ''],
      ['MPM', 'GHOST', '', '', 'abc', '2999-01-01', '', ''],
    ]);
    const p = await excel.preview(file);
    expect(p.rows.map((r) => r.status)).toEqual(['ok', 'error', 'error']);
    expect(p.rows[1].errors).toEqual(['Unknown item code "NOPE"']);
    expect(p.rows[2].errors).toEqual(expect.arrayContaining(['Unknown supplier code "GHOST"', 'Rate must be a non-negative number', 'Purchase Date cannot be in the future']));
    expect(excel.summarise(p)).toMatchObject({ total: 3, valid: 1, invalid: 2, duplicates: 0 });
  });

  it('flags duplicates within the file and against existing records', async () => {
    const dupFile = await workbook([['MPM', '', '', 1, 98, '2026-01-15', 'A', ''], ['MPM', '', '', 1, 98, '2026-01-15', 'A', '']]);
    const inFile = await make().excel.preview(dupFile);
    expect(inFile.rows.map((r) => r.status)).toEqual(['ok', 'duplicate']);
    const existing = await make(1).excel.preview(await workbook([['MPM', '', '', 1, 98, '2026-01-15', 'A', '']]));
    expect(existing.rows[0]).toMatchObject({ status: 'duplicate', errors: ['Identical purchase already recorded'] });
  });

  it('confirm imports nothing when any row is invalid (no silent partial import)', async () => {
    const { excel, insert } = make();
    const file = await workbook([['MPM', '', '', 1, 98, '2026-01-15', '', ''], ['NOPE', '', '', 1, 98, '2026-01-15', '', '']]);
    await expect(excel.confirm({ id: 'u1' } as any, file, false)).rejects.toThrow(/nothing was imported/);
    expect(insert).not.toHaveBeenCalled();
  });

  it('confirm with skipInvalid imports only the valid rows and records history', async () => {
    const { excel, insert, prisma } = make();
    const file = await workbook([['MPM', '', '', 1, 98, '2026-01-15', '', ''], ['NOPE', '', '', 1, 98, '2026-01-15', '', '']]);
    const r = await excel.confirm({ id: 'u1' } as any, file, true);
    expect(r).toMatchObject({ imported: 1, skipped: 1 });
    expect(insert.mock.calls[0][1]).toHaveLength(1);
    expect(prisma.importHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ successRows: 1, failedRows: 1, kind: 'purchase_rates' }) });
  });

  it('builds a template and an export workbook', async () => {
    const { excel } = make();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await excel.template()) as never);
    expect(wb.getWorksheet('Purchase Rates')!.getRow(1).getCell(1).value).toBe('Item Code');
  });
});
