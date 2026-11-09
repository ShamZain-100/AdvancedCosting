import type { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './decorators';

/**
 * The price list dealers a user may see: `null` means all of them.
 * A user tied to dealers sees only those. Anyone else sees all dealers only with `price_list_dealers:view` (staff, admins);
 * a dealer login created without a dealer therefore sees none rather than everyone's prices.
 */
export async function dealerScope(prisma: Pick<PrismaService, 'userPriceListDealer'>, user: Pick<AuthUser, 'id' | 'isSuperAdmin' | 'permissions'>): Promise<string[] | null> {
  const own = await prisma.userPriceListDealer.findMany({ where: { userId: user.id }, select: { dealerId: true } });
  if (own.length) return own.map((o) => o.dealerId);
  return user.isSuperAdmin || user.permissions.has('price_list_dealers:view') ? null : [];
}
