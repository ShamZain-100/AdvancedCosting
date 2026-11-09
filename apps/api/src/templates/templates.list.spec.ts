import { TemplatesService } from './templates.service';

describe('TemplatesService.list', () => {
  it('counts item lines with one grouped query instead of loading every line', async () => {
    const prisma: any = {
      template: { findMany: jest.fn().mockResolvedValue([{ id: 't1', name: 'A', _count: { groups: 2, expenses: 0 } }, { id: 't2', name: 'B', _count: { groups: 1, expenses: 1 } }]), count: jest.fn().mockResolvedValue(2) },
      $queryRaw: jest.fn().mockResolvedValue([{ templateId: 't1', n: 5n }]),
      templateItem: { findMany: jest.fn() },
    };
    const r = await new TemplatesService(prisma, { log: jest.fn() } as any).list({});
    expect(r.items.map((i: any) => [i.id, i.groupCount, i.itemCount])).toEqual([['t1', 2, 5], ['t2', 1, 0]]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.templateItem.findMany).not.toHaveBeenCalled();
  });
});
