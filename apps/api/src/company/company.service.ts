import { Injectable } from '@nestjs/common';
import { companySettingsSchema } from '@costing/validators';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ImagesService } from '../images/images.service';
import { parseOrThrow } from '../masters/master.service';
import type { AuthUser } from '../common/decorators';

const DEFAULTS = { name: 'Your Company', address: null, phone: null, email: null, gstin: null, state: null, website: null, currencyCode: 'INR', currencySymbol: '₹', footerNote: null, logoFileId: null };

/** Company identity shown on printed documents (logo, name, address, GSTIN). */
@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly images: ImagesService) {}

  async getRaw() {
    return (await this.prisma.companySettings.findUnique({ where: { id: 1 } })) ?? { id: 1, ...DEFAULTS, updatedAt: new Date(), updatedBy: null };
  }

  /** For API responses: includes a signed logo URL. */
  async get() {
    const c = await this.getRaw();
    return { ...c, logoUrl: c.logoFileId ? this.images.signer.path(c.logoFileId, 'thumb', 3600) : null };
  }

  async update(actor: AuthUser, body: unknown) {
    const data = parseOrThrow(companySettingsSchema, body) as Record<string, string | undefined>;
    const clean = Object.fromEntries(Object.entries({ ...DEFAULTS, ...data }).map(([k, v]) => [k, v === undefined ? null : v]));
    delete (clean as Record<string, unknown>).logoFileId;
    await this.prisma.companySettings.upsert({ where: { id: 1 }, update: { ...clean, updatedBy: actor.id }, create: { id: 1, ...clean, updatedBy: actor.id } as never });
    await this.audit.log({ userId: actor.id, action: 'update', entity: 'CompanySettings', entityId: '1', metadata: { name: data.name } });
    return this.get();
  }

  async setLogo(actor: AuthUser, file: Express.Multer.File | undefined) {
    const current = await this.getRaw();
    const created = await this.images.createStandalone(actor, file);
    await this.prisma.companySettings.upsert({ where: { id: 1 }, update: { logoFileId: created.id, updatedBy: actor.id }, create: { id: 1, name: current.name, logoFileId: created.id, updatedBy: actor.id } });
    await this.images.releaseFile(current.logoFileId);
    await this.audit.log({ userId: actor.id, action: 'set_logo', entity: 'CompanySettings', entityId: '1' });
    return this.get();
  }

  async removeLogo(actor: AuthUser) {
    const current = await this.getRaw();
    if (!current.logoFileId) return this.get();
    await this.prisma.companySettings.update({ where: { id: 1 }, data: { logoFileId: null, updatedBy: actor.id } });
    await this.images.releaseFile(current.logoFileId);
    await this.audit.log({ userId: actor.id, action: 'remove_logo', entity: 'CompanySettings', entityId: '1' });
    return this.get();
  }

  /** Logo bytes for PDFs (null when none). */
  async logoBuffer(): Promise<Buffer | null> {
    const c = await this.getRaw();
    return c.logoFileId ? this.images.readFull(c.logoFileId) : null;
  }
}
