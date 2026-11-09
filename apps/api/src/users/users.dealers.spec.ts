import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user = { id: uuid(1), email: 'a@x.com', name: 'A', roles: [], dealers: [{ dealer: { id: uuid(10), name: 'Dealer', code: 'DLR' } }], permissions: [] };

function make(groupCount = 2) {
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    priceListDealer: { count: jest.fn().mockResolvedValue(groupCount) },
    userPriceListDealer: { deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn(async (ops: any[]) => ops),
  };
  const audit: any = { log: jest.fn() };
  return { svc: new UsersService(prisma, audit, {} as any), prisma, audit };
}
const actor: any = { id: 'admin', isSuperAdmin: true };

describe('UsersService.setDealers', () => {
  it('replaces the user\'s groups and audits the change', async () => {
    const { svc, prisma, audit } = make();
    const r = await svc.setDealers(actor, uuid(1), [uuid(10), uuid(11)]);
    expect(prisma.userPriceListDealer.deleteMany).toHaveBeenCalledWith({ where: { userId: uuid(1) } });
    expect(prisma.userPriceListDealer.createMany).toHaveBeenCalledWith({ data: [{ userId: uuid(1), dealerId: uuid(10) }, { userId: uuid(1), dealerId: uuid(11) }] });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'set_dealers', entity: 'User', entityId: uuid(1) }));
    expect(r.dealers).toEqual([{ id: uuid(10), name: 'Dealer', code: 'DLR' }]);
  });

  it('an empty list removes every dealer from the user', async () => {
    const { svc, prisma } = make(0);
    await svc.setDealers(actor, uuid(1), []);
    expect(prisma.userPriceListDealer.deleteMany).toHaveBeenCalled();
    expect(prisma.userPriceListDealer.createMany).toHaveBeenCalledWith({ data: [] });
  });

  it('rejects unknown or deleted groups and writes nothing', async () => {
    const { svc, prisma } = make(1);
    await expect(svc.setDealers(actor, uuid(1), [uuid(10), uuid(99)])).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('404 for an unknown user', async () => {
    const { svc, prisma } = make();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(svc.setDealers(actor, uuid(2), [])).rejects.toBeInstanceOf(NotFoundException);
  });
});
