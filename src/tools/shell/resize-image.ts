import sharp from 'sharp';
import type { ImageData } from '../../core/types.js';

const MAX_DIM = 1568; // Anthropic recommended max dimension

/**
 * Downscale an image if either dimension exceeds MAX_DIM.
 * Small images pass through unchanged. Oversized images are resized
 * and re-encoded as WebP.
 */
export async function resizeImageIfNeeded(
  base64: string,
  mediaType: ImageData['mediaType'],
): Promise<{ base64: string; mediaType: ImageData['mediaType'] }> {
  const buf = Buffer.from(base64, 'base64');

  let meta: sharp.Metadata;
  try {
    meta = await sharp(buf).metadata();
  } catch {
    // Can't parse — return as-is, let the API reject if needed
    return { base64, mediaType };
  }

  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w <= MAX_DIM && h <= MAX_DIM) {
    return { base64, mediaType };
  }

  const resized = await sharp(buf)
    .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();

  return {
    base64: resized.toString('base64'),
    mediaType: 'image/webp',
  };
}
