/**
 * Demo data built from the reference costing sheet, so the numbers can be checked by hand:
 *   Metal frame 20.94 × 98 = 2,052.12 · Black matt powder 0.8 × 270 = 216 · Bush 4 × 4 = 16
 *   Additional item 14 × 3 = 42 · Metal labour 1,200 · Powder labour 600
 *   → material 2,326.12 + labour 1,800 = basic cost 4,126.12 (GST and markup are 0 in the demo).
 * The image's own totals may include adjustments; reconcile them with the business owner before changing the defaults.
 *
 * Run after `pnpm db:seed` (needs a super admin):  pnpm db:seed:demo
 * Safe to re-run: existing demo records are reused.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { PERMISSION_ACTIONS, PERMISSION_MODULES } from '@costing/config';
import { AppModule } from '../app.module';
import { CostingsService } from '../costings/costings.service';
import { TemplatesService } from '../templates/templates.service';
import { seed } from './seed';

async function main() {
  const prisma = new PrismaClient();
  await seed(prisma);

  const admin = await prisma.user.findFirst({ where: { isSuperAdmin: true, isActive: true } });
  if (!admin) throw new Error('No super admin found. Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD, run `pnpm db:seed`, then retry.');
  const actor = {
    id: admin.id, email: admin.email, name: admin.name, isSuperAdmin: true, sessionId: 'seed',
    permissions: new Set(PERMISSION_MODULES.flatMap((m) => PERMISSION_ACTIONS.map((a) => `${m}:${a}`))),
  };

  const unit = async (symbol: string) => (await prisma.unit.findUniqueOrThrow({ where: { symbol } })).id;
  const [KG, PC, M] = await Promise.all([unit('KG'), unit('PC'), unit('M')]);

  const type = await prisma.type.upsert({ where: { code: 'CHAIRS' }, update: {}, create: { name: 'Chairs', code: 'CHAIRS' } });
  const group = (code: string, name: string) => prisma.itemGroup.upsert({ where: { code }, update: {}, create: { name, code, typeId: type.id } });
  const [metal, powder] = await Promise.all([group('METAL', 'Metal'), group('POWDER', 'Powder')]);
  const category = (code: string, name: string, groupId: string) => prisma.itemCategory.upsert({ where: { code }, update: {}, create: { name, code, groupId } });
  const [frame, hardware, coating] = await Promise.all([
    category('METAL-FRAME', 'Metal Frame', metal.id), category('HARDWARE', 'Hardware', metal.id), category('POWDER-COATING', 'Powder Coating', powder.id),
  ]);
  const item = (code: string, name: string, categoryId: string, groupId: string, unitId: string, rate: string, gst = '18') =>
    prisma.item.upsert({ where: { code }, update: {}, create: { name, code, typeId: type.id, groupId, categoryId, unitId, defaultPurchaseRate: rate, gstPercent: gst } });
  const pipe = await item('MPM', 'Metal Pipe MAX', frame.id, metal.id, KG, '98');
  await prisma.itemUnitConversion.upsert({ where: { itemId_unitId: { itemId: pipe.id, unitId: M } }, update: {}, create: { itemId: pipe.id, unitId: M, conversionValue: '3.15' } });
  const powderItem = await item('BMP', 'Black Matt Powder', coating.id, powder.id, KG, '270');
  const bush = await item('BUSH', 'Bush', hardware.id, metal.id, PC, '4');
  const extra = await item('ADDL', 'Additional item', hardware.id, metal.id, PC, '3');
  const labour = (code: string, name: string, rate: string) => prisma.labour.upsert({ where: { code }, update: {}, create: { name, code, defaultRate: rate, unitId: PC } });
  const [metalLabour, powderLabour] = await Promise.all([labour('LAB-METAL', 'Metal Labour', '1200'), labour('LAB-POWDER', 'Powder Labour', '600')]);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const templates = app.get(TemplatesService);
    const costings = app.get(CostingsService);

    let template = await prisma.template.findFirst({ where: { code: 'METAL-CHAIR-GENERAL', deletedAt: null } });
    if (!template) {
      template = await prisma.template.findUniqueOrThrow({
        where: { id: ((await templates.create(actor, {
          name: 'Metal Chair General', code: 'METAL-CHAIR-GENERAL', typeId: type.id, description: 'Demo template from the reference sheet', wastagePercent: '0', gstPercent: '0', markupPercent: '0', status: 'ACTIVE',
          groups: [
            { groupId: metal.id, categories: [
              { categoryId: frame.id, items: [{ itemId: pipe.id, quantity: '20.94', unitId: KG }] },
              { categoryId: hardware.id, items: [{ itemId: bush.id, quantity: '4', unitId: PC }, { itemId: extra.id, quantity: '14', unitId: PC }] },
            ], labour: [{ labourId: metalLabour.id, quantity: '1' }] },
            { groupId: powder.id, categories: [{ categoryId: coating.id, items: [{ itemId: powderItem.id, quantity: '0.8', unitId: KG }] }], labour: [{ labourId: powderLabour.id, quantity: '1' }] },
          ],
          expenses: [],
        })) as { id: string }).id },
      });
      console.log('Created template Metal Chair General');
    }

    let costing = await prisma.costing.findFirst({ where: { productCode: 'DEMO-CHAIR', deletedAt: null } });
    if (!costing) {
      const draft = await costings.fromTemplate(template.id);
      const created = await costings.create(actor, { ...draft, productName: 'Demo Metal Chair', productCode: 'DEMO-CHAIR' });
      costing = await prisma.costing.findUniqueOrThrow({ where: { id: created.id } });
      console.log('Created demo costing');
    }
    console.log(`Demo costing ${costing.costingNumber}: basic cost ${costing.basicCost} (expected 4126.12), selling price ${costing.sellingPrice}`);
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
