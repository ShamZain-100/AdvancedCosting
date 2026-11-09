import { columnKey } from '@costing/config';
import { CostingsService } from './costings.service';

describe('costing list column access', () => {
  const svc: any = Object.create(CostingsService.prototype);
  svc.list = async () => ({ items: [{ id: 'c1', costingNumber: 'COST-1', productName: 'Chair', productCode: 'CH', basicCost: '100', totalCostInclGst: '118', sellingPrice: '130', profitPercent: '30', version: 2 }], total: 1, page: 1, pageSize: 25 });

  it('drops the money columns a user may not see, keeps what lists need to work', async () => {
    const user: any = { isSuperAdmin: false, permissions: new Set([columnKey('costings', 'costingNumber'), columnKey('costings', 'productName'), columnKey('costings', 'sellingPrice')]) };
    const r = await svc.listFor(user, {});
    expect(r.items).toEqual([{ id: 'c1', costingNumber: 'COST-1', productName: 'Chair', productCode: 'CH', sellingPrice: '130', version: 2 }]);
  });

  it('a super admin sees every column', async () => {
    const r = await svc.listFor({ isSuperAdmin: true, permissions: new Set() }, {});
    expect(r.items[0]).toHaveProperty('basicCost', '100');
  });
});
