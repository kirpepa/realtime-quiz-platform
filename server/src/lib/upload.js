import path from 'node:path';
import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import multer from 'multer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const EXTENSION_BY_TYPE = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Browser-provided MIME and filename are attacker-controlled. Verify a small
// set of image signatures before a file is ever written to public storage.
export function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  const header = buffer.subarray(0, 6).toString('ascii');
  if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif';
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) cb(null, true);
    else {
      const error = new Error('Недопустимый тип файла (только PNG, JPEG, WEBP, GIF)');
      error.status = 415;
      error.expose = true;
      cb(error);
    }
  },
});

export async function persistImage(file) {
  const actualType = detectImageType(file?.buffer);
  if (!actualType || actualType !== file.mimetype) {
    const error = new Error('Содержимое файла не соответствует заявленному типу изображения');
    error.status = 415;
    error.expose = true;
    throw error;
  }

  const filename = `${randomUUID()}${EXTENSION_BY_TYPE.get(actualType)}`;
  await fsPromises.writeFile(path.join(UPLOAD_DIR, filename), file.buffer, {
    flag: 'wx',
    mode: 0o600,
  });
  return filename;
}
