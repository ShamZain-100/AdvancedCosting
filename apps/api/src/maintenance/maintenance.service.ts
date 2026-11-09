import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DAY = 86_400_000;
const olderThan = (now: Date, days: number) => new Date(now.getTime() - days * DAY);

/**
 * Housekeeping for tables that only ever grow with throw-away rows: finished sessions, used / expired
 * password-reset tokens and dead share links. Business records (costings, quotations, audit logs,
 * rate history, import history) are never removed here.
 */
@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.DISABLE_MAINTENANCE === 'true') return;
    const run = () => this.cleanup().catch((e) => this.logger.warn(`Cleanup failed: ${(e as Error).message}`));
    this.timers = [setTimeout(run, 60_000), setInterval(run, 6 * 3600_000)];
    this.timers.forEach((t) => t.unref());
  }

  onModuleDestroy() { this.timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); }

  async cleanup(now = new Date()) {
    const [sessions, resetTokens, shares] = await Promise.all([
      this.prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: olderThan(now, 30) } }, { revokedAt: { lt: olderThan(now, 30) } }] } }),
      this.prisma.passwordResetToken.deleteMany({ where: { OR: [{ expiresAt: { lt: olderThan(now, 7) } }, { usedAt: { lt: olderThan(now, 7) } }] } }),
      this.prisma.quotationShare.deleteMany({ where: { OR: [{ expiresAt: { lt: olderThan(now, 90) } }, { revokedAt: { lt: olderThan(now, 90) } }] } }),
    ]);
    const result = { sessions: sessions.count, resetTokens: resetTokens.count, shareLinks: shares.count };
    if (result.sessions + result.resetTokens + result.shareLinks) this.logger.log(`Removed ${result.sessions} session(s), ${result.resetTokens} reset token(s), ${result.shareLinks} share link(s)`);
    return result;
  }
}
