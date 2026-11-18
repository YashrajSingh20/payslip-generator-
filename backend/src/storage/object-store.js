import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const DOWNLOAD_EXPIRY_SECONDS = 60;

export const sha256Base64 = (bytes) => createHash('sha256').update(bytes).digest('base64');

/** RFC 5987 filename for Content-Disposition. */
function disposition(name, attachment) {
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${attachment ? 'attachment' : 'inline'}; filename*=UTF-8''${encoded}`;
}

/**
 * Private S3 bucket, the same way the Team Portal uses it: objects are written
 * with a SHA-256 checksum and never overwritten, and reads go through 60-second
 * signed URLs issued only after the API has checked permissions.
 */
export function createS3Store({ bucket, region, s3 = new S3Client({ region }), signUrl = getSignedUrl }) {
  return {
    kind: 's3',
    async put({ key, bytes, contentType }) {
      const checksum = sha256Base64(bytes);
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        ChecksumSHA256: checksum,
        IfNoneMatch: '*',
      }));
      return { checksum };
    },
    async get(key) {
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return Buffer.from(await res.Body.transformToByteArray());
    },
    async remove(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    signedUrl(key, { name, contentType, attachment = false }) {
      return signUrl(s3, new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentType: contentType,
        ResponseContentDisposition: disposition(name, attachment),
        ResponseCacheControl: 'private, no-store',
      }), { expiresIn: DOWNLOAD_EXPIRY_SECONDS });
    },
  };
}

/**
 * Local development stand-in for S3: files under backend/.dev-storage. There is
 * no signed URL, so the API streams the bytes itself after the same permission
 * check.
 */
export function createLocalStore({ root }) {
  const resolve = (key) => {
    const full = path.resolve(root, key);
    if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error('Invalid object key');
    return full;
  };
  return {
    kind: 'local',
    async put({ key, bytes }) {
      const full = resolve(key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, bytes, { flag: 'wx' });
      return { checksum: sha256Base64(bytes) };
    },
    async get(key) { return readFile(resolve(key)); },
    async remove(key) { await rm(resolve(key), { force: true }); },
    signedUrl: async () => null,
  };
}

export function createObjectStore(config) {
  const storage = config.storage;
  if (storage.bucket) return createS3Store({ bucket: storage.bucket, region: storage.region });
  return createLocalStore({ root: storage.localRoot });
}
