import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { MAX_EDGE, processImage, THUMB_EDGE } from './image-processor';

const make = (w: number, h: number, fmt: 'jpeg' | 'png' | 'webp' | 'gif' | 'tiff', channels: 3 | 4 = 3) =>
  sharp({ create: { width: w, height: h, channels, background: channels === 4 ? { r: 255, g: 0, b: 0, alpha: 0.5 } : { r: 200, g: 100, b: 50 } } })[fmt]().toBuffer();

describe('processImage', () => {
  it.each(['jpeg', 'png', 'webp'] as const)('accepts %s and returns compressed JPEG + thumbnail within size limits', async (fmt) => {
    const out = await processImage(await make(3000, 2000, fmt), 'a.' + fmt);
    expect(Math.max(out.width, out.height)).toBe(MAX_EDGE);
    expect(out.width / out.height).toBeCloseTo(1.5, 1);
    expect((await sharp(out.full).metadata()).format).toBe('jpeg');
    const t = await sharp(out.thumb).metadata();
    expect(t.format).toBe('jpeg');
    expect(Math.max(t.width!, t.height!)).toBe(THUMB_EDGE);
  });

  it('never enlarges small images', async () => {
    const out = await processImage(await make(200, 100, 'png'));
    expect([out.width, out.height]).toEqual([200, 100]);
  });

  it('flattens transparency onto white', async () => {
    const out = await processImage(await make(50, 50, 'png', 4));
    const { data } = await sharp(out.full).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(200); // red at 50% over white is light, not black
    expect(data[1]).toBeGreaterThan(100);
  });

  it('strips EXIF metadata (including GPS) and applies the rotation', async () => {
    const src = await sharp({ create: { width: 300, height: 100, channels: 3, background: '#888' } }).jpeg().withMetadata({ orientation: 6 }).withExif({ IFD0: { Copyright: 'secret' } }).toBuffer();
    expect((await sharp(src).metadata()).exif).toBeDefined();
    const out = await processImage(src);
    expect((await sharp(out.full).metadata()).exif).toBeUndefined();
    expect([out.width, out.height]).toEqual([100, 300]); // orientation 6 = rotated 90°
  });

  it('rejects non-images, disguised files and unsupported formats', async () => {
    await expect(processImage(Buffer.from('<?php system($_GET[0]); ?>'))).rejects.toThrow(/not a valid image/);
    await expect(processImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(processImage(await make(20, 20, 'gif' as never))).rejects.toThrow(/unsupported image type|not a valid image/);
    await expect(processImage(await make(20, 20, 'tiff'))).rejects.toThrow(/unsupported image type/);
    await expect(processImage(Buffer.alloc(0))).rejects.toThrow(/empty/);
  });

  it('rejects a truncated image instead of storing a broken file', async () => {
    const good = await make(500, 500, 'jpeg');
    await expect(processImage(good.subarray(0, 300))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects files over the size limit and images with too many pixels', async () => {
    await expect(processImage(Buffer.alloc(9 * 1024 * 1024, 1))).rejects.toThrow(/larger than 8 MB/);
    const huge = await sharp({ create: { width: 9000, height: 9000, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toBuffer();
    await expect(processImage(huge)).rejects.toThrow(/not a valid image/);
  }, 30_000);

  it('strips payload appended after the image data', async () => {
    const good = await make(100, 100, 'jpeg');
    const withTrailer = Buffer.concat([good, Buffer.from('<?php evil(); ?>')]);
    const out = await processImage(withTrailer);
    expect(out.full.includes(Buffer.from('<?php'))).toBe(false);
  });
});
