/** Image upload and compression utilities (WebP pipeline, size validation, fallback colors). */

const MAX_BASE64_LENGTH = 50_000;

export type CropArea = { x: number; y: number; width: number; height: number };

const CROP_ENCODING_ATTEMPTS = [
  { size: 400, quality: 0.8 },
  { size: 400, quality: 0.6 },
  { size: 400, quality: 0.4 },
  { size: 320, quality: 0.6 },
  { size: 320, quality: 0.4 },
];

/** Encode a selected product-image crop within the database size limit. */
export function compressCroppedImage(image: HTMLImageElement, crop: CropArea): string | null {
  try {
    for (const { size, quality } of CROP_ENCODING_ATTEMPTS) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, size, size);
      const dataUri = canvas.toDataURL('image/webp', quality);
      if (dataUri !== 'data:,' && dataUri.length <= MAX_BASE64_LENGTH) return dataUri;
    }
  } catch {
    return null;
  }

  return null;
}

export type LogoPadding = { top: number; right: number; bottom: number; left: number };

/** Max padding per side, as a fraction of the crop's own width/height — caps
 * opposite sides at a combined 80%, leaving a 20% floor for the logo itself. */
const MAX_LOGO_PADDING_FRACTION = 0.4;

const PADDED_CROP_ENCODING_ATTEMPTS = [
  { scale: 1, quality: 0.8 },
  { scale: 1, quality: 0.6 },
  { scale: 1, quality: 0.4 },
  { scale: 0.75, quality: 0.6 },
  { scale: 0.75, quality: 0.4 },
  { scale: 0.5, quality: 0.6 },
];

/**
 * Encodes a free-aspect crop (any ratio, not forced square) with four
 * independent padding fractions baked in as opaque white whitespace around
 * the image — e.g. the bottom padding becomes the printed gap before the
 * business name on a ticket logo. Each padding value is a fraction (0–0.4) of
 * the crop's own width/height, so it scales with whatever was cropped rather
 * than needing a fixed pixel budget per aspect ratio.
 */
export function compressCroppedImageWithPadding(
  image: HTMLImageElement,
  crop: CropArea,
  padding: LogoPadding,
): string | null {
  const clamp = (value: number) => Math.min(MAX_LOGO_PADDING_FRACTION, Math.max(0, value));
  const top = clamp(padding.top);
  const right = clamp(padding.right);
  const bottom = clamp(padding.bottom);
  const left = clamp(padding.left);

  try {
    for (const { scale, quality } of PADDED_CROP_ENCODING_ATTEMPTS) {
      const innerWidth = Math.max(1, Math.round(crop.width * scale));
      const innerHeight = Math.max(1, Math.round(crop.height * scale));
      const padLeft = Math.round(innerWidth * left);
      const padRight = Math.round(innerWidth * right);
      const padTop = Math.round(innerHeight * top);
      const padBottom = Math.round(innerHeight * bottom);

      const canvas = document.createElement('canvas');
      canvas.width = innerWidth + padLeft + padRight;
      canvas.height = innerHeight + padTop + padBottom;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      // Printed on a white receipt — padding must be opaque white, not transparent.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, padLeft, padTop, innerWidth, innerHeight);

      const dataUri = canvas.toDataURL('image/webp', quality);
      if (dataUri !== 'data:,' && dataUri.length <= MAX_BASE64_LENGTH) return dataUri;
    }
  } catch {
    return null;
  }

  return null;
}

/** Compresses an image file to a 1:1 WebP data URI within size limits. */
export function compressImage(file: File, quality = 0.8): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      // Determine crop dimensions (center-crop to 1:1)
      const size = Math.min(img.width, img.height);
      const offsetX = (img.width - size) / 2;
      const offsetY = (img.height - size) / 2;

      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(null); return; }

      ctx.drawImage(img, offsetX, offsetY, size, size, 0, 0, size, size);

      // Try compression with retry at lower quality
      const qualities = [Math.min(1, Math.max(0, quality)), 0.6, 0.4];
      try {
        for (const q of qualities) {
          const dataUri = canvas.toDataURL('image/webp', q);
          if (dataUri.length <= MAX_BASE64_LENGTH) {
            resolve(dataUri);
            return;
          }
        }

        // All qualities too large — try PNG as fallback (smaller than original)
        const pngUri = canvas.toDataURL('image/png');
        if (pngUri.length <= MAX_BASE64_LENGTH) {
          resolve(pngUri);
          return;
        }
      } catch {
        resolve(null);
        return;
      }

      resolve(null); // Image too complex for the size limit
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    img.src = url;
  });
}

/** Generates deterministic HSL color from product name for fallback tiles. */
export function nameToColor(name: string): string {
  let hash = 0;
  for (const character of name) {
    const codePoint = character.codePointAt(0) ?? 0;
    hash = codePoint + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 45%, 65%)`;
}

/** Checks whether Base64 data URI is within character size limit (50K chars). */
export function validateImageSize(dataUri: string): boolean {
  return typeof dataUri === 'string' && dataUri.length <= MAX_BASE64_LENGTH;
}

/** Max Base64 string length (characters). ~36.6 KB decoded. */
export const MAX_IMAGE_LENGTH = MAX_BASE64_LENGTH;

/** Max raw file size before loading into memory (5 MB). */
export const MAX_RAW_FILE_SIZE = 5 * 1024 * 1024;
