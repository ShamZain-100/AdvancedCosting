import { BadRequestException } from '@nestjs/common';
import { ImagesService } from './images.service';

function make(status: string) {
  const prisma: any = {
    costing: { findFirst: jest.fn().mockResolvedValue({ status }), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    costingImage: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const svc = new ImagesService(prisma, {} as any, { log: jest.fn() } as any, { get: () => 'test-secret' } as any);
  return { svc, prisma };
}
const designer: any = { id: 'd', permissions: new Set(['images:view', 'images:create', 'images:edit', 'images:delete']) };
const editor: any = { id: 'e', permissions: new Set(['costing:view', 'costing:edit']) };

describe('designer photos', () => {
  it('a designer may change photos on an approved or pending costing; a costing editor still may not', async () => {
    for (const status of ['APPROVED', 'PENDING_APPROVAL']) {
      const { svc } = make(status);
      await expect(svc.assertEditable('costing', 'c1', designer, 'create')).resolves.toBeUndefined();
      await expect(svc.assertEditable('costing', 'c1', editor, 'create')).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('a designer without delete rights cannot use them to delete on an approved costing', async () => {
    const { svc } = make('APPROVED');
    const uploader: any = { id: 'u', permissions: new Set(['images:view', 'images:create']) };
    await expect(svc.assertEditable('costing', 'c1', uploader, 'delete')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('the product photo list asks for names, codes and status only, never a cost figure', async () => {
    const { svc, prisma } = make('DRAFT');
    await svc.products({ search: 'chair' });
    const select = prisma.costing.findMany.mock.calls[0][0].select;
    expect(Object.keys(select).sort()).toEqual(['_count', 'costingNumber', 'id', 'productCode', 'productName', 'status']);
  });
});
