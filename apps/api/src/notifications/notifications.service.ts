import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/decorators';

export interface Message { kind: string; title: string; body: string; url?: string | null }
export interface PushTarget { endpoint: string; keys: { p256dh: string; auth: string } }
/** Sends one push; replaced in tests. Returns the HTTP status of the push service, or throws. */
export type PushSender = (sub: PushTarget, payload: string) => Promise<{ statusCode: number }>;

const MAX_SUBSCRIPTIONS_PER_USER = 10;

/**
 * Messages for users: a row per user (the bell in the app) and, where the user turned it on, a browser / phone push.
 * Pushing happens after the rows are saved and never throws: a dead push service must not undo or block a price change.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly publicKey: string | null;
  private sender: PushSender | null;

  constructor(private readonly prisma: PrismaService, cfg: ConfigService) {
    const pub = cfg.get<string>('VAPID_PUBLIC_KEY'), priv = cfg.get<string>('VAPID_PRIVATE_KEY');
    const subject = cfg.get<string>('VAPID_SUBJECT') || 'mailto:admin@example.com';
    if (pub && priv) {
      webpush.setVapidDetails(subject, pub, priv);
      this.publicKey = pub;
      this.sender = (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 24 * 3600 });
    } else {
      this.publicKey = null;
      this.sender = null;
      this.logger.warn('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set: notifications appear in the app only, no browser push');
    }
  }

  /** for tests */
  useSender(sender: PushSender | null) { this.sender = sender; }

  pushKey() { return { enabled: !!this.publicKey, publicKey: this.publicKey }; }

  /** Saves the messages, then pushes them. `messages` maps a user id to that user's messages. */
  async send(messages: Map<string, Message[]>): Promise<number> {
    const rows = [...messages.entries()].flatMap(([userId, list]) => list.map((m) => ({ userId, kind: m.kind, title: m.title.slice(0, 200), body: m.body.slice(0, 1000), url: m.url ?? null })));
    if (!rows.length) return 0;
    await this.prisma.notification.createMany({ data: rows });
    if (this.sender) await this.pushAll(rows).catch((e) => this.logger.error(`Push failed: ${(e as Error).message}`));
    return rows.length;
  }

  /** Every active user tied to these dealers gets the dealer's messages. */
  async notifyDealers(byDealer: Map<string, Message[]>): Promise<number> {
    const dealerIds = [...byDealer.keys()];
    if (!dealerIds.length) return 0;
    const links = await this.prisma.userPriceListDealer.findMany({ where: { dealerId: { in: dealerIds }, user: { isActive: true } }, select: { userId: true, dealerId: true } });
    const perUser = new Map<string, Message[]>();
    for (const l of links) perUser.set(l.userId, [...(perUser.get(l.userId) ?? []), ...(byDealer.get(l.dealerId) ?? [])]);
    return this.send(perUser);
  }

  private async pushAll(rows: { userId: string; title: string; body: string; url: string | null }[]) {
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId: { in: [...new Set(rows.map((r) => r.userId))] } } });
    const dead: string[] = [];
    for (const sub of subs) {
      const mine = rows.filter((r) => r.userId === sub.userId);
      // one push per device: a long list becomes a summary, the bell holds the details
      const payload = JSON.stringify(mine.length === 1
        ? { title: mine[0].title, body: mine[0].body, url: mine[0].url ?? '/' }
        : { title: `${mine.length} price list updates`, body: mine.slice(0, 3).map((m) => m.title).join(' · '), url: '/price-list' });
      try {
        await this.sender!({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(sub.id); // the browser unsubscribed or the subscription expired
        else this.logger.warn(`Push to a device of user ${sub.userId} failed: ${(e as Error).message}`);
      }
    }
    if (dead.length) await this.prisma.pushSubscription.deleteMany({ where: { id: { in: dead } } });
  }

  // ───────── the user's own notifications ─────────

  async list(user: AuthUser, q: { page?: string; pageSize?: string; unread?: string }) {
    const page = Math.max(1, Number(q.page) || 1), pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 20));
    const where = { userId: user.id, ...(q.unread === 'true' ? { readAt: null } : {}) };
    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return { items, total, unread, page, pageSize };
  }

  async markRead(user: AuthUser, id: string) {
    const r = await this.prisma.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
    if (!r.count && !(await this.prisma.notification.findFirst({ where: { id, userId: user.id } }))) throw new NotFoundException('Notification not found');
    return { id };
  }

  async markAllRead(user: AuthUser) {
    const r = await this.prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: r.count };
  }

  async subscribe(user: AuthUser, body: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }, userAgent?: string) {
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
    const p256dh = typeof body?.keys?.p256dh === 'string' ? body.keys.p256dh : '';
    const auth = typeof body?.keys?.auth === 'string' ? body.keys.auth : '';
    // push services are always https; anything else could make the server call an address of the sender's choosing
    if (!/^https:\/\/[^\s]{1,2000}$/.test(endpoint) || !/^[A-Za-z0-9_-]{20,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(auth)) {
      throw new BadRequestException('Invalid push subscription');
    }
    await this.prisma.pushSubscription.upsert({
      where: { endpoint }, update: { userId: user.id, p256dh, auth, userAgent: userAgent?.slice(0, 255) ?? null },
      create: { userId: user.id, endpoint, p256dh, auth, userAgent: userAgent?.slice(0, 255) ?? null },
    });
    const mine = await this.prisma.pushSubscription.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (mine.length > MAX_SUBSCRIPTIONS_PER_USER) await this.prisma.pushSubscription.deleteMany({ where: { id: { in: mine.slice(MAX_SUBSCRIPTIONS_PER_USER).map((m) => m.id) } } });
    return { subscribed: true };
  }

  async unsubscribe(user: AuthUser, endpoint: unknown) {
    if (typeof endpoint !== 'string') throw new BadRequestException('endpoint is required');
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
    return { subscribed: false };
  }
}
