import { BadRequestException } from '@nestjs/common';
import sharp, { Metadata } from 'sharp';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_INPUT_PIXELS = 50_000_000; // ~7000×7000; guards against decompression bombs
export const MAX_EDGE = 1600;
export const THUMB_EDGE = 320;
const ALLOWED = new Set(['jpeg', 'png', 'webp']);

export interface ProcessedImage {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

const bad = (m: string) => new BadRequestException(m);

/**
 * Validate by decoding (never by file name or declared MIME type) and re-encode.
 * Re-encoding drops EXIF/GPS and any appended or embedded payload, applies the EXIF rotation, flattens
 * transparency onto white and converts to sRGB JPEG, so every stored file is a plain, compressed image
 * that browsers and PDF generators handle.
 */
export async function processImage(input: Buffer, label = 'file'): Promise<ProcessedImage> {
  if (!input?.length) throw bad(`${label}: the file is empty`);
  if (input.length > MAX_UPLOAD_BYTES) throw bad(`${label}: the file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  const open = () => sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });

  let meta: Metadata;
  try { meta = await open().metadata(); } catch { throw bad(`${label}: this is not a valid image (or it is too large in pixels)`); }
  if (!meta.format || !ALLOWED.has(meta.format)) throw bad(`${label}: unsupported image type${meta.format ? ` "${meta.format}"` : ''}. Use JPG, PNG or WEBP.`);
  if (!meta.width || !meta.height) throw bad(`${label}: could not read the image size`);
  if ((meta.pages ?? 1) > 1) throw bad(`${label}: animated images are not supported`);

  try {
    const { data, info } = await open()
      .rotate()
      .toColourspace('srgb')
      .flatten({ background: '#ffffff' })
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, progressive: true, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    const thumb = await sharp(data).resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside' }).jpeg({ quality: 75, progressive: true }).toBuffer();
    return { full: data, thumb, width: info.width, height: info.height };
  } catch {
    throw bad(`${label}: the image could not be processed`);
  }
}
