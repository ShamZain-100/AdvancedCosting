import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

const me: any = { id: 'u1' };
function make() {
  const prisma: any = {
    notification: { createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), updateMany: jest.fn().mockResolvedValue({ count: 0 }), findFirst: jest.fn().mockResolvedValue(null) },
    pushSubscription: { upsert: jest.fn(), findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
    userPriceListDealer: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const svc = new NotificationsService(prisma, { get: () => undefined } as any);
  return { svc, prisma };
}
const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } };

describe('NotificationsService', () => {
  it('push is off without VAPID keys, but messages are still saved for the bell', async () => {
    const { svc, prisma } = make();
    expect(svc.pushKey()).toEqual({ enabled: false, publicKey: null });
    await svc.send(new Map([['u1', [{ kind: 'K', title: 'T', body: 'B' }]]]));
    expect(prisma.notification.createMany).toHaveBeenCalledWith({ data: [{ userId: 'u1', kind: 'K', title: 'T', body: 'B', url: null }] });
  });

  it('accepts only https push endpoints with well-formed keys', async () => {
    const { svc, prisma } = make();
    await svc.subscribe(me, sub, 'Chrome');
    expect(prisma.pushSubscription.upsert).toHaveBeenCalled();
    for (const bad of [{ ...sub, endpoint: 'http://169.254.169.254/latest' }, { ...sub, endpoint: 'file:///etc/passwd' }, { ...sub, keys: { p256dh: 'short', auth: 'x' } }, {}]) {
      await expect(svc.subscribe(me, bad as any)).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('keeps at most 10 devices per user, dropping the oldest', async () => {
    const { svc, prisma } = make();
    prisma.pushSubscription.findMany.mockResolvedValue(Array.from({ length: 12 }, (_, i) => ({ id: `s${i}` })));
    await svc.subscribe(me, sub);
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['s10', 's11'] } } });
  });

  it('a user reads and unsubscribes only their own', async () => {
    const { svc, prisma } = make();
    await expect(svc.markRead(me, 'n-of-someone-else')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.notification.updateMany.mock.calls[0][0].where).toMatchObject({ userId: 'u1' });
    await svc.unsubscribe(me, sub.endpoint);
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { endpoint: sub.endpoint, userId: 'u1' } });
    await svc.list(me, { unread: 'true' });
    expect(prisma.notification.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1', readAt: null });
  });

  it('sends one push per device: a single message as is, several as a summary', async () => {
    const { svc, prisma } = make();
    const sent: any[] = [];
    svc.useSender(async (_s, payload) => { sent.push(JSON.parse(payload)); return { statusCode: 201 }; });
    prisma.pushSubscription.findMany.mockResolvedValue([{ id: 's1', userId: 'u1', endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth }]);
    await svc.send(new Map([['u1', [{ kind: 'K', title: 'One', body: 'B', url: '/price-list' }]]]));
    await svc.send(new Map([['u1', [{ kind: 'K', title: 'A', body: '' }, { kind: 'K', title: 'B', body: '' }]]]));
    expect(sent).toEqual([{ title: 'One', body: 'B', url: '/price-list' }, { title: '2 price list updates', body: 'A · B', url: '/price-list' }]);
  });
});
