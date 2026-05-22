import { createHmac, createHash } from 'crypto';
import { readFile, unlink } from 'fs/promises';
import path from 'path';

function encodePathPart(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeObjectKey(key: string): string {
  return key.split('/').map(encodePathPart).join('/');
}

function hmac(key: string | Buffer, value: string, encoding?: 'hex'): string | Buffer {
  return createHmac('sha256', key).update(value).digest(encoding as 'hex');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function amzDate(now: Date): string {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function r2ConfigFromEnv() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error('R2 storage requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME');
  }
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

export function signR2Url(method: string, objectKey: string, expiresSeconds = 900): string {
  const { accountId, accessKeyId, secretAccessKey, bucket } = r2ConfigFromEnv();
  const now = new Date();
  const date = amzDate(now);
  const shortDate = date.slice(0, 8);
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const credentialScope = `${shortDate}/auto/s3/aws4_request`;
  const canonicalUri = `/${bucket}/${encodeObjectKey(objectKey)}`;
  const params: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': date,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    date,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n');
  const dateKey = hmac(`AWS4${secretAccessKey}`, shortDate) as Buffer;
  const regionKey = hmac(dateKey, 'auto') as Buffer;
  const serviceKey = hmac(regionKey, 's3') as Buffer;
  const signingKey = hmac(serviceKey, 'aws4_request') as Buffer;
  const signature = hmac(signingKey, stringToSign, 'hex') as string;
  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export interface StorageUploadResult {
  driver: string;
  filePath?: string;
  objectKey?: string;
  filename: string;
  contentType: string;
}

export function createStorage(options: { localDir?: string } = {}) {
  const driver = process.env.STORAGE_DRIVER || 'local';
  const localDir = options.localDir || path.join(process.cwd(), 'output');

  return {
    driver,
    async uploadPptx({
      jobId,
      filePath,
      filename,
    }: {
      jobId: string;
      filePath: string;
      filename: string;
    }): Promise<StorageUploadResult> {
      if (driver === 'local') {
        return {
          driver,
          filePath,
          filename,
          contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        };
      }

      if (driver !== 'r2') {
        throw new Error(`Unsupported STORAGE_DRIVER "${driver}"`);
      }

      const objectKey = `pptx/${jobId}.pptx`;
      const body = await readFile(filePath);
      const url = signR2Url('PUT', objectKey, 900);
      const response = await fetch(url, {
        method: 'PUT',
        body,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        },
      });
      if (!response.ok) {
        throw new Error(`R2 upload failed with HTTP ${response.status}`);
      }
      await unlink(filePath).catch(() => undefined);
      return {
        driver,
        objectKey,
        filename,
        contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      };
    },
    async localPath(jobId: string): Promise<string> {
      return path.join(localDir, `${jobId}.pptx`);
    },
    async downloadUrl(objectKey: string, expiresSeconds = 300): Promise<string | null> {
      if (driver !== 'r2') return null;
      return signR2Url('GET', objectKey, expiresSeconds);
    },
  };
}
