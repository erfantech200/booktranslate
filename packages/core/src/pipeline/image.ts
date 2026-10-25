import sharp from 'sharp';
import exifr from 'exifr';
// heic-convert ships no types; it decodes HEVC in pure JS (prebuilt sharp lacks a HEVC decoder).
// @ts-expect-error no type declarations
import heicConvert from 'heic-convert';

export interface NormalizedImage {
  /** OCR-ready JPEG (EXIF-rotated, resized, light contrast normalization). */
  normalized: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  takenAt: Date | null;
}

const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'];

export function isHeif(buf: Buffer): boolean {
  if (buf.length < 12 || buf.toString('ascii', 4, 8) !== 'ftyp') return false;
  return HEIF_BRANDS.includes(buf.toString('ascii', 8, 12));
}

export async function readTakenAt(buf: Buffer): Promise<Date | null> {
  try {
    const exif = await exifr.parse(buf, ['DateTimeOriginal', 'CreateDate']);
    const d = exif?.DateTimeOriginal ?? exif?.CreateDate;
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

/** Decode any supported input (JPG/PNG/WEBP/HEIC/HEIF) into something sharp can read. */
async function decodable(buf: Buffer): Promise<Buffer> {
  if (!isHeif(buf)) return buf;
  try {
    // libvips built with libheif+HEVC (e.g. the worker image) can do it natively.
    await sharp(buf).metadata().then((m) => {
      if (!m.width) throw new Error('no size');
    });
    return await sharp(buf).rotate().jpeg({ quality: 95 }).toBuffer();
  } catch {
    // heic-convert output has no EXIF orientation applied by sharp, but HEIC stores rotation
    // as an irot box that libheif applies while decoding, so the pixels come out upright.
    const out: ArrayBuffer = await heicConvert({ buffer: buf, format: 'JPEG', quality: 0.95 });
    return Buffer.from(out);
  }
}

export async function normalizeImage(input: Buffer, maxPx: number): Promise<NormalizedImage> {
  const takenAt = await readTakenAt(input);
  const src = await decodable(input);
  const pipeline = sharp(src, { failOn: 'error' })
    .rotate() // EXIF auto-orient
    .resize({ width: maxPx, height: maxPx, fit: 'inside', withoutEnlargement: true })
    .normalise({ lower: 1, upper: 99 }) // light contrast stretch
    .jpeg({ quality: 85, mozjpeg: true });
  const { data: normalized, info } = await pipeline.toBuffer({ resolveWithObject: true });
  const thumb = await sharp(normalized).resize({ width: 360, height: 480, fit: 'inside' })
    .jpeg({ quality: 70 }).toBuffer();
  return { normalized, thumb, width: info.width, height: info.height, takenAt };
}

/**
 * Split a two-page spread at the vertical centre (with a small overlap so letters at the gutter
 * aren't cut). Returns [left, right] halves; callers order them by reading direction.
 */
export async function splitSpread(normalized: Buffer): Promise<[Buffer, Buffer]> {
  const meta = await sharp(normalized).metadata();
  const w = meta.width!;
  const h = meta.height!;
  const overlap = Math.round(w * 0.02);
  const half = Math.floor(w / 2);
  const left = await sharp(normalized).extract({ left: 0, top: 0, width: Math.min(w, half + overlap), height: h })
    .jpeg({ quality: 85 }).toBuffer();
  const rightStart = Math.max(0, half - overlap);
  const right = await sharp(normalized).extract({ left: rightStart, top: 0, width: w - rightStart, height: h })
    .jpeg({ quality: 85 }).toBuffer();
  return [left, right];
}

export async function thumbnail(img: Buffer): Promise<Buffer> {
  return sharp(img).resize({ width: 360, height: 480, fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
}

export const toDataUrl = (jpeg: Buffer) => `data:image/jpeg;base64,${jpeg.toString('base64')}`;
