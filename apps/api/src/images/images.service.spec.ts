import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { FileStorageService } from './file-storage.service';
import { safeName, ImagesService } from './images.service';
import { UrlSigner } from './url-signer';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = u(1);
const png = (color: string, w = 400, h = 300) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
const file = (buffer: Buffer, name = 'photo.png') => ({ buffer, originalname: name } as Express.Multer.File);

async function make(status = 'DRAFT', existing: any[] = []) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'costing-img-'));
  const storage = new FileStorageService({ get: () => dir } as unknown as ConfigService);
  const links: any[] = [...existing];
  const files: any[] = [];
  const model = {
    findMany: jest.fn(async () => links), count: jest.fn(async ({ where }: any) => links.filter((l) => (where.isMain === undefined || l.isMain === where.isMain)).length),
    createMany: jest.fn(async ({ data }: any) => { links.push(...data.map((d: any, i: number) => ({ id: `l${links.length + i}`, ...d }))); }),
    findFirst: jest.fn(async () => links[0]), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn(),
  };
  const prisma: any = {
    costing: { findFirst: jest.fn().mockResolvedValue({ id: OWNER, status }) }, template: { findFirst: jest.fn().mockResolvedValue({ id: OWNER, status: 'ACTIVE' }) },
    costingImage: model, templateImage: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn() }, companySettings: { count: jest.fn().mockResolvedValue(0) },
    fileAttachment: { create: jest.fn(async ({ data }: any) => { files.push(data); return data; }), deleteMany: jest.fn().mockResolvedValue({ count: 0 }), delete: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (fn: any) => fn({ costingImage: model })),
  };
  const svc = new ImagesService(prisma, storage, { log: jest.fn() } as any, { get: (k: string) => (k === 'JWT_SECRET' ? 'secret' : undefined) } as unknown as ConfigService);
  return { svc, prisma, storage, dir, links, files, model, actor: { id: 'u1' } as any };
}

describe('ImagesService.upload', () => {
  it('stores compressed files under generated keys and makes the first image the main one', async () => {
    const { svc, storage, dir, files, model, actor } = await make();
    jest.spyOn(svc, 'list').mockResolvedValue([] as any);
    await svc.upload(actor, 'costing', OWNER, [file(await png('#f00')), file(await png('#0f0'))]);
    expect(files).toHaveLength(2);
    for (const f of files) {
      expect(f.storageKey).toMatch(/^images\/[0-9a-f]{2}\/[0-9a-f-]{36}\.jpg$/);
      expect(f.mimeType).toBe('image/jpeg');
      expect((await sharp(await storage.read(f.storageKey)).metadata()).format).toBe('jpeg');
      expect(await storage.exists(f.thumbKey)).toBe(true);
    }
    const rows = model.createMany.mock.calls[0][0].data;
    expect(rows.map((r: any) => r.isMain)).toEqual([true, false]);
    await fs.rm(dir, { recursive: true });
  });

  it('keeps the existing main image when more are added', async () => {
    const { svc, dir, model, actor } = await make('DRAFT', [{ id: 'old', isMain: true, file: { sha256: 'x' } }]);
    jest.spyOn(svc, 'list').mockResolvedValue([] as any);
    await svc.upload(actor, 'costing', OWNER, [file(await png('#00f'))]);
    expect(model.createMany.mock.calls[0][0].data[0].isMain).toBe(false);
    await fs.rm(dir, { recursive: true });
  });

  it('is all-or-nothing: one bad file stores nothing', async () => {
    const { svc, dir, files, actor } = await make();
    await expect(svc.upload(actor, 'costing', OWNER, [file(await png('#f00')), file(Buffer.from('not an image'), 'evil.png')])).rejects.toBeInstanceOf(BadRequestException);
    expect(files).toHaveLength(0);
    await expect(fs.readdir(path.join(dir, 'images'))).rejects.toThrow();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('rejects duplicates, too many files and locked owners', async () => {
    const { svc, dir, actor } = await make();
    jest.spyOn(svc, 'list').mockResolvedValue([] as any);
    const same = await png('#abc');
    await expect(svc.upload(actor, 'costing', OWNER, [file(same), file(same, 'copy.png')])).rejects.toThrow(/already attached/);
    await expect(svc.upload(actor, 'costing', OWNER, Array.from({ length: 11 }, () => file(same)))).rejects.toThrow(/at most 10/);
    await expect(svc.upload(actor, 'costing', OWNER, [])).rejects.toThrow(/at least one/);
    for (const status of ['APPROVED', 'PENDING_APPROVAL']) {
      const locked = await make(status);
      await expect(locked.svc.upload(actor, 'costing', OWNER, [file(same)])).rejects.toThrow(/locked|waiting for approval/);
      await fs.rm(locked.dir, { recursive: true, force: true });
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('enforces the per-owner image limit', async () => {
    const existing = Array.from({ length: 20 }, (_, i) => ({ id: `l${i}`, isMain: i === 0, file: { sha256: `h${i}` } }));
    const { svc, dir, actor } = await make('DRAFT', existing);
    await expect(svc.upload(actor, 'costing', OWNER, [file(await png('#123'))])).rejects.toThrow(/at most 20/);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('cleans up written files when the database step fails', async () => {
    const { svc, prisma, dir, files, actor } = await make();
    prisma.$transaction.mockRejectedValue(new Error('db down'));
    await expect(svc.upload(actor, 'costing', OWNER, [file(await png('#f00'))])).rejects.toThrow('db down');
    const left = await fs.readdir(path.join(dir, 'images', files[0].storageKey.split('/')[1])).catch(() => []);
    expect(left).toEqual([]);
    expect(prisma.fileAttachment.deleteMany).toHaveBeenCalled();
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('ImagesService serving and signed URLs', () => {
  it('serves a file only with a valid, unexpired signature', async () => {
    const { svc, prisma, storage, dir } = await make();
    const id = u(50);
    const key = FileStorageService.keyFor(id, 'full');
    await storage.put(key, await sharp({ create: { width: 5, height: 5, channels: 3, background: '#000' } }).jpeg().toBuffer());
    prisma.fileAttachment.findUnique = jest.fn().mockResolvedValue({ id, storageKey: key, thumbKey: FileStorageService.keyFor(id, 'thumb') });
    const url = new URL('http://x' + svc.signer.path(id, 'full'));
    const q = Object.fromEntries(url.searchParams);
    const ok = await svc.open(id, q.v, q.exp, q.sig);
    const chunks: Buffer[] = [];
    for await (const c of ok.stream) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).length).toBeGreaterThan(100);
    await expect(svc.open(id, 'full', q.exp, 'bad')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.open(id, 'thumb', q.exp, q.sig)).rejects.toBeInstanceOf(NotFoundException); // signature is per variant
    await expect(svc.open(u(51), q.v, q.exp, q.sig)).rejects.toBeInstanceOf(NotFoundException); // and per file
    await expect(svc.open('../../etc/passwd', q.v, q.exp, q.sig)).rejects.toBeInstanceOf(NotFoundException);
    await fs.rm(dir, { recursive: true });
  });

  it('signed URLs expire and cannot be forged', () => {
    const s = new UrlSigner('k');
    const now = Date.now();
    const q = Object.fromEntries(new URL('http://x' + s.path('abc', 'thumb', 60, now)).searchParams);
    expect(s.verify('abc', 'thumb', q.exp, q.sig, now)).toBe(true);
    expect(s.verify('abc', 'thumb', q.exp, q.sig, now + 61_000)).toBe(false);
    expect(s.verify('abc', 'thumb', q.exp, q.sig.replace(/.$/, '0'), now)).toBe(false);
    expect(s.verify('abc', 'thumb', String(Number(q.exp) + 1000), q.sig, now)).toBe(false);
    expect(new UrlSigner('other').verify('abc', 'thumb', q.exp, q.sig, now)).toBe(false);
    expect(s.verify('abc', 'original', q.exp, q.sig, now)).toBe(false);
  });
});

describe('storage safety and helpers', () => {
  it('refuses keys that could escape the upload directory', async () => {
    const { storage, dir } = await make();
    for (const key of ['../x.jpg', 'images/../../x.jpg', '/etc/passwd', 'images/ab/../../c.jpg', 'images/zz/not-a-uuid.jpg']) {
      await expect(storage.put(key, Buffer.from('x'))).rejects.toThrow(/Invalid storage key/);
    }
    await fs.rm(dir, { recursive: true });
  });

  it('never overwrites an existing object', async () => {
    const { storage, dir } = await make();
    const key = FileStorageService.keyFor(u(60), 'full');
    await storage.put(key, Buffer.from('a'));
    await expect(storage.put(key, Buffer.from('b'))).rejects.toThrow();
    await fs.rm(dir, { recursive: true });
  });

  it('sanitises display names', () => {
    expect(safeName('../../etc/passwd')).toBe('passwd');
    expect(safeName('C:\\temp\\chair photo (1).JPG')).toBe('chair photo (1).JPG');
    expect(safeName('a\u0000b\nc<script>.png')).toBe('a_b_c_script_.png');
    expect(safeName('')).toBe('image');
    expect(safeName('x'.repeat(300)).length).toBe(120);
  });
});

describe('ImagesService.remove', () => {
  it('promotes another image when the main one is deleted and removes unused files', async () => {
    const { svc, prisma, storage, dir, model, actor } = await make();
    const id = u(70);
    const key = FileStorageService.keyFor(id, 'full'), tkey = FileStorageService.keyFor(id, 'thumb');
    await storage.put(key, Buffer.from('a')); await storage.put(tkey, Buffer.from('b'));
    model.findFirst.mockResolvedValueOnce({ id: 'l1', isMain: true, fileId: id, file: { storageKey: key, thumbKey: tkey } }).mockResolvedValueOnce({ id: 'l2' });
    prisma.costingImage.count = jest.fn().mockResolvedValue(0);
    jest.spyOn(svc, 'list').mockResolvedValue([] as any);
    await svc.remove(actor, 'costing', OWNER, 'l1');
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'l2' }, data: { isMain: true } });
    expect(await storage.exists(key)).toBe(false);
    expect(await storage.exists(tkey)).toBe(false);
    await fs.rm(dir, { recursive: true });
  });

  it('keeps the files when another owner still links them', async () => {
    const { svc, prisma, storage, dir, model, actor } = await make();
    const id = u(71);
    const key = FileStorageService.keyFor(id, 'full'), tkey = FileStorageService.keyFor(id, 'thumb');
    await storage.put(key, Buffer.from('a')); await storage.put(tkey, Buffer.from('b'));
    model.findFirst.mockResolvedValueOnce({ id: 'l1', isMain: false, fileId: id, file: { storageKey: key, thumbKey: tkey } });
    prisma.templateImage.count = jest.fn().mockResolvedValue(1);
    prisma.costingImage.count = jest.fn().mockResolvedValue(0);
    jest.spyOn(svc, 'list').mockResolvedValue([] as any);
    await svc.remove(actor, 'costing', OWNER, 'l1');
    expect(await storage.exists(key)).toBe(true);
    await fs.rm(dir, { recursive: true });
  });

  it('404s for an image that does not belong to the owner', async () => {
    const { svc, model, dir, actor } = await make();
    model.findFirst.mockResolvedValue(null);
    await expect(svc.remove(actor, 'costing', OWNER, u(99))).rejects.toBeInstanceOf(NotFoundException);
    await fs.rm(dir, { recursive: true });
  });
});
