import { Prisma } from '@prisma/client';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import type { Readable } from 'stream';
import { imageUpdateSchema } from '@costing/validators';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { parseOrThrow } from '../masters/master.service';
import type { AuthUser } from '../common/decorators';
import { FileStorageService } from './file-storage.service';
import { processImage } from './image-processor';
import { UrlSigner, Variant } from './url-signer';

export type OwnerKind = 'costing' | 'template';
export const MAX_IMAGES_PER_OWNER = 20;
export const MAX_FILES_PER_REQUEST = 10;
const bad = (m: string) => new BadRequestException(m);

interface OwnerCfg { model: 'costingImage' | 'templateImage'; fk: 'costingId' | 'templateId'; entity: string }
const OWNERS: Record<OwnerKind, OwnerCfg> = {
  costing: { model: 'costingImage', fk: 'costingId', entity: 'Costing' },
  template: { model: 'templateImage', fk: 'templateId', entity: 'Template' },
};

export interface ImageView {
  id: string; fileId: string; description: string | null; isMain: boolean; width: number; height: number; size: number; originalName: string;
  thumbUrl: string; url: string;
}

/** Display name only: no paths, no control characters. */
export const safeName = (name: string) => (name || 'image').split(/[\\/]/).pop()!.replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 120) || 'image';

@Injectable()
export class ImagesService {
  readonly signer: UrlSigner;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorageService,
    private readonly audit: AuditService,
    cfg: ConfigService,
  ) {
    const fileSecret = cfg.get<string>('FILE_URL_SECRET') || cfg.get<string>('JWT_SECRET');
    if (!fileSecret && process.env.NODE_ENV === 'production') throw new Error('FILE_URL_SECRET (or JWT_SECRET) must be set in production');
    this.signer = new UrlSigner(fileSecret || 'dev-only-secret');
  }

  private delegate(kind: OwnerKind): any { return (this.prisma as any)[OWNERS[kind].model]; }

  /** Images follow the owner's edit lock, so documents that were approved or archived do not change underneath users. */
  async assertEditable(kind: OwnerKind, ownerId: string, actor?: AuthUser, need: 'create' | 'edit' | 'delete' = 'edit') {
    if (kind === 'costing') {
      const c = await this.prisma.costing.findFirst({ where: { id: ownerId, deletedAt: null }, select: { status: true } });
      if (!c) throw new NotFoundException('Costing not found');
      // a designer may change photos at any stage: photos never change the figures, and every change is audited
      if (actor?.permissions?.has(`images:${need}`)) return;
      if (c.status === 'APPROVED') throw bad('Approved costings are locked. Reopen the costing to change its images.');
      if (c.status === 'PENDING_APPROVAL') throw bad('This costing is waiting for approval. Reject or reopen it before changing images.');
    } else {
      const t = await this.prisma.template.findFirst({ where: { id: ownerId, deletedAt: null }, select: { status: true } });
      if (!t) throw new NotFoundException('Template not found');
      if (t.status === 'ARCHIVED') throw bad('Archived templates are read-only.');
    }
  }

  /** Products for the designer's photo screen: names, codes, status and the main photo; never a cost figure. */
  async products(q: Record<string, string | undefined>) {
    const page = Math.max(1, Number(q.page) || 1), pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 24));
    const where: Prisma.CostingWhereInput = { deletedAt: null };
    if (q.search) where.OR = ['productName', 'productCode', 'costingNumber'].map((f) => ({ [f]: { contains: q.search!.slice(0, 80), mode: 'insensitive' } }));
    if (q.photos === 'none') where.images = { none: {} };
    const [rows, total] = await Promise.all([
      this.prisma.costing.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, costingNumber: true, productName: true, productCode: true, status: true, _count: { select: { images: true } } } }),
      this.prisma.costing.count({ where }),
    ]);
    const main = await this.mainImages('costing', rows.map((r) => r.id));
    return { items: rows.map(({ _count, ...r }) => ({ ...r, imageCount: _count.images, image: main.get(r.id) ?? null })), total, page, pageSize };
  }

  async assertExists(kind: OwnerKind, ownerId: string) {
    const found = kind === 'costing'
      ? await this.prisma.costing.findFirst({ where: { id: ownerId, deletedAt: null }, select: { id: true } })
      : await this.prisma.template.findFirst({ where: { id: ownerId, deletedAt: null }, select: { id: true } });
    if (!found) throw new NotFoundException(`${OWNERS[kind].entity} not found`);
  }

  private view(link: any, ttl = 3600): ImageView {
    const f = link.file;
    return {
      id: link.id, fileId: f.id, description: link.description, isMain: link.isMain, width: f.width, height: f.height, size: f.size, originalName: f.originalName,
      thumbUrl: this.signer.path(f.id, 'thumb', ttl), url: this.signer.path(f.id, 'full', ttl),
    };
  }

  async list(kind: OwnerKind, ownerId: string): Promise<ImageView[]> {
    await this.assertExists(kind, ownerId);
    const rows = await this.delegate(kind).findMany({ where: { [OWNERS[kind].fk]: ownerId }, orderBy: [{ isMain: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }], include: { file: true } });
    return rows.map((r: any) => this.view(r));
  }

  async upload(actor: AuthUser, kind: OwnerKind, ownerId: string, files: Express.Multer.File[] | undefined) {
    if (!files?.length) throw bad('Choose at least one image');
    if (files.length > MAX_FILES_PER_REQUEST) throw bad(`Upload at most ${MAX_FILES_PER_REQUEST} images at a time`);
    await this.assertEditable(kind, ownerId, actor, 'create');
    const cfg = OWNERS[kind];
    const existing: { file: { sha256: string } }[] = await this.delegate(kind).findMany({ where: { [cfg.fk]: ownerId }, include: { file: { select: { sha256: true } } } });
    if (existing.length + files.length > MAX_IMAGES_PER_OWNER) throw bad(`A ${kind} can have at most ${MAX_IMAGES_PER_OWNER} images (it has ${existing.length})`);

    // validate and compress everything first so a bad file in the batch stores nothing
    const seen = new Set(existing.map((e) => e.file.sha256));
    const processed = [];
    for (const f of files) {
      const p = await processImage(f.buffer, safeName(f.originalname));
      const sha = createHash('sha256').update(p.full).digest('hex');
      if (seen.has(sha)) throw bad(`${safeName(f.originalname)}: this image is already attached`);
      seen.add(sha);
      processed.push({ p, sha, name: safeName(f.originalname), size: p.full.length });
    }

    const written: string[] = [];
    try {
      const created: string[] = [];
      for (const { p, sha, name, size } of processed) {
        const id = randomUUID();
        const storageKey = FileStorageService.keyFor(id, 'full');
        const thumbKey = FileStorageService.keyFor(id, 'thumb');
        await this.storage.put(storageKey, p.full); written.push(storageKey);
        await this.storage.put(thumbKey, p.thumb); written.push(thumbKey);
        created.push(id);
        await this.prisma.fileAttachment.create({ data: { id, storageKey, thumbKey, originalName: name, mimeType: 'image/jpeg', size, width: p.width, height: p.height, sha256: sha, uploadedBy: actor.id } });
      }
      await this.prisma.$transaction(async (tx) => {
        const model = (tx as any)[cfg.model];
        const hasMain = existing.length > 0 && (await model.count({ where: { [cfg.fk]: ownerId, isMain: true } })) > 0;
        const order = await model.count({ where: { [cfg.fk]: ownerId } });
        await model.createMany({ data: created.map((fileId, i) => ({ [cfg.fk]: ownerId, fileId, isMain: !hasMain && i === 0, sortOrder: order + i })) });
      });
    } catch (e) {
      // do not leave orphaned files or records behind if a later step failed
      await this.storage.remove(...written);
      await this.prisma.fileAttachment.deleteMany({ where: { storageKey: { in: written } } }).catch(() => undefined);
      throw e;
    }
    await this.audit.log({ userId: actor.id, action: 'upload_images', entity: cfg.entity, entityId: ownerId, metadata: { count: processed.length } });
    return this.list(kind, ownerId);
  }

  async update(actor: AuthUser, kind: OwnerKind, ownerId: string, imageId: string, body: unknown) {
    const patch = parseOrThrow(imageUpdateSchema, body) as { description?: string; isMain?: boolean };
    await this.assertEditable(kind, ownerId, actor, 'edit');
    const cfg = OWNERS[kind];
    const link = await this.delegate(kind).findFirst({ where: { id: imageId, [cfg.fk]: ownerId } });
    if (!link) throw new NotFoundException('Image not found');
    await this.prisma.$transaction(async (tx) => {
      const model = (tx as any)[cfg.model];
      if (patch.isMain === true) {
        await model.updateMany({ where: { [cfg.fk]: ownerId, isMain: true }, data: { isMain: false } });
        await model.update({ where: { id: imageId }, data: { isMain: true } });
      } else if (patch.isMain === false && link.isMain) {
        throw bad('Choose another image as the main image instead');
      }
      if (patch.description !== undefined) await model.update({ where: { id: imageId }, data: { description: patch.description || null } });
    });
    await this.audit.log({ userId: actor.id, action: 'update_image', entity: cfg.entity, entityId: ownerId, metadata: { imageId, ...patch } });
    return this.list(kind, ownerId);
  }

  async remove(actor: AuthUser, kind: OwnerKind, ownerId: string, imageId: string) {
    await this.assertEditable(kind, ownerId, actor, 'delete');
    const cfg = OWNERS[kind];
    const link = await this.delegate(kind).findFirst({ where: { id: imageId, [cfg.fk]: ownerId }, include: { file: true } });
    if (!link) throw new NotFoundException('Image not found');
    await this.prisma.$transaction(async (tx) => {
      const model = (tx as any)[cfg.model];
      await model.delete({ where: { id: imageId } });
      if (link.isMain) {
        const next = await model.findFirst({ where: { [cfg.fk]: ownerId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
        if (next) await model.update({ where: { id: next.id }, data: { isMain: true } });
      }
    });
    await this.deleteIfUnused(link.fileId, link.file.storageKey, link.file.thumbKey);
    await this.audit.log({ userId: actor.id, action: 'delete_image', entity: cfg.entity, entityId: ownerId, metadata: { imageId } });
    return this.list(kind, ownerId);
  }

  /** Physical files are deleted only when no costing or template still links them. */
  private async deleteIfUnused(fileId: string, ...keys: string[]) {
    const [c, t, co] = await Promise.all([
      this.prisma.costingImage.count({ where: { fileId } }), this.prisma.templateImage.count({ where: { fileId } }), this.prisma.companySettings.count({ where: { logoFileId: fileId } }),
    ]);
    if (c + t + co > 0) return;
    await this.prisma.fileAttachment.delete({ where: { id: fileId } }).catch(() => undefined);
    await this.storage.remove(...keys);
  }

  /** Store one validated image that is not tied to a costing / template (e.g. the company logo). */
  async createStandalone(actor: AuthUser, file: Express.Multer.File | undefined) {
    if (!file) throw bad('Choose an image');
    const p = await processImage(file.buffer, safeName(file.originalname));
    const id = randomUUID();
    const storageKey = FileStorageService.keyFor(id, 'full'), thumbKey = FileStorageService.keyFor(id, 'thumb');
    await this.storage.put(storageKey, p.full);
    try {
      await this.storage.put(thumbKey, p.thumb);
      return await this.prisma.fileAttachment.create({
        data: { id, storageKey, thumbKey, originalName: safeName(file.originalname), mimeType: 'image/jpeg', size: p.full.length, width: p.width, height: p.height, sha256: createHash('sha256').update(p.full).digest('hex'), uploadedBy: actor.id },
      });
    } catch (e) { await this.storage.remove(storageKey, thumbKey); throw e; }
  }

  async releaseFile(fileId: string | null | undefined) {
    if (!fileId) return;
    const f = await this.prisma.fileAttachment.findUnique({ where: { id: fileId } });
    if (f) await this.deleteIfUnused(f.id, f.storageKey, f.thumbKey);
  }

  /** Bytes of the full-size image, for embedding in PDFs. */
  async readFull(fileId: string): Promise<Buffer | null> {
    const f = await this.prisma.fileAttachment.findUnique({ where: { id: fileId } });
    return f && (await this.storage.exists(f.storageKey)) ? this.storage.read(f.storageKey) : null;
  }

  /** Main image (thumb + full URL) per owner, for lists and documents. */
  async mainImages(kind: OwnerKind, ownerIds: string[], ttl = 3600): Promise<Map<string, { thumbUrl: string; url: string; description: string | null }>> {
    const out = new Map<string, { thumbUrl: string; url: string; description: string | null }>();
    const ids = [...new Set(ownerIds.filter(Boolean))];
    if (!ids.length) return out;
    const cfg = OWNERS[kind];
    const rows = await this.delegate(kind).findMany({ where: { [cfg.fk]: { in: ids } }, orderBy: [{ isMain: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }], include: { file: { select: { id: true } } } });
    for (const r of rows) {
      const owner = r[cfg.fk] as string;
      if (!out.has(owner)) out.set(owner, { thumbUrl: this.signer.path(r.file.id, 'thumb', ttl), url: this.signer.path(r.file.id, 'full', ttl), description: r.description });
    }
    return out;
  }

  /** Main image bytes (small thumbnail by default) per owner, for embedding in generated PDFs. */
  async mainImageBuffers(kind: OwnerKind, ownerIds: string[], variant: Variant = 'thumb'): Promise<Map<string, Buffer>> {
    const out = new Map<string, Buffer>();
    const ids = [...new Set(ownerIds.filter(Boolean))];
    if (!ids.length) return out;
    const cfg = OWNERS[kind];
    const rows = await this.delegate(kind).findMany({ where: { [cfg.fk]: { in: ids } }, orderBy: [{ isMain: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }], include: { file: true } });
    for (const r of rows) {
      const owner = r[cfg.fk] as string;
      if (out.has(owner)) continue;
      const key = variant === 'thumb' ? r.file.thumbKey : r.file.storageKey;
      if (await this.storage.exists(key)) out.set(owner, await this.storage.read(key));
    }
    return out;
  }

  /** Link the same files to another owner (e.g. costing → the template made from it). */
  async copyLinks(from: { kind: OwnerKind; id: string }, to: { kind: OwnerKind; id: string }) {
    const src = OWNERS[from.kind], dst = OWNERS[to.kind];
    const rows = await this.delegate(from.kind).findMany({ where: { [src.fk]: from.id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    if (!rows.length) return;
    await this.delegate(to.kind).createMany({ data: rows.map((r: any, i: number) => ({ [dst.fk]: to.id, fileId: r.fileId, description: r.description, isMain: r.isMain, sortOrder: i })), skipDuplicates: true });
  }

  /** Stream a stored file after verifying the signed URL. */
  async open(id: string, variant: string, exp: string, sig: string): Promise<{ stream: Readable; variant: Variant }> {
    if (!/^[0-9a-f-]{36}$/.test(id) || !this.signer.verify(id, variant, exp, sig)) throw new NotFoundException();
    const f = await this.prisma.fileAttachment.findUnique({ where: { id } });
    if (!f) throw new NotFoundException();
    const v = variant as Variant;
    const key = v === 'thumb' ? f.thumbKey : f.storageKey;
    if (!(await this.storage.exists(key))) throw new NotFoundException();
    return { stream: this.storage.stream(key), variant: v };
  }
}
