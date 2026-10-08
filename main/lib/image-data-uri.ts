/** Shared validation/decoding for Base64 image data URIs (products, business logo). */

const DATA_URI_RE = /^data:(image\/(webp|png|jpeg|jpg));base64,(.+)$/;

/** Max Base64 data URI length (characters), matching the frontend compression target. */
export const MAX_IMAGE_DATA_URI_LENGTH = 50_000;

/** Validates image data URI format (webp/png/jpeg) and length limit. `null`/`undefined` mean "clear". */
export function validateImageDataUri(value: unknown): { valid: boolean; error?: string } {
  if (value === null || value === undefined) {
    return { valid: true };
  }
  if (typeof value !== 'string') {
    return { valid: false, error: 'Value must be a string or null' };
  }
  if (!value.startsWith('data:image/')) {
    return { valid: false, error: 'Value must be a Base64 data URI' };
  }
  if (!DATA_URI_RE.test(value)) {
    return { valid: false, error: 'Invalid image format. Supported: webp, png, jpeg' };
  }
  if (value.length > MAX_IMAGE_DATA_URI_LENGTH) {
    return { valid: false, error: `Image too large (max ${MAX_IMAGE_DATA_URI_LENGTH.toLocaleString()} characters)` };
  }
  return { valid: true };
}

/** Decodes a validated image data URI into its content type and raw bytes, or null if malformed. */
export function decodeImageDataUri(value: string): { contentType: string; buffer: Buffer; base64: string } | null {
  const match = value.match(DATA_URI_RE);
  if (!match) return null;
  const base64 = match[3];
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) return null;
  return { contentType: match[1], buffer, base64 };
}
