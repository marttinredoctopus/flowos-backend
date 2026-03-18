import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';

// Support both CF_* and R2_* env var naming (CF_* takes priority)
const CF_ACCESS_KEY  = process.env.CF_ACCESS_KEY  || process.env.R2_ACCESS_KEY_ID || '';
const CF_SECRET_KEY  = process.env.CF_SECRET_KEY  || process.env.R2_SECRET_KEY    || '';
const CF_BUCKET      = process.env.CF_BUCKET      || process.env.R2_BUCKET_NAME   || 'flowos-files';
const CF_ACCOUNT_ID  = process.env.CF_ACCOUNT_ID  || process.env.R2_ACCOUNT_ID    || '';

// CF_ENDPOINT can be a full endpoint URL; if not set, build from account ID
const CF_ENDPOINT    = process.env.CF_ENDPOINT
  ? process.env.CF_ENDPOINT.replace(/\/$/, '')
  : CF_ACCOUNT_ID ? `https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com` : '';

const BUCKET     = CF_BUCKET;
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || process.env.CF_PUBLIC_URL || '').replace(/\/$/, '');
const USE_R2     = !!(CF_ACCESS_KEY && CF_SECRET_KEY && CF_ENDPOINT);

const r2 = USE_R2 ? new S3Client({
  region: 'auto',
  endpoint: CF_ENDPOINT,
  credentials: {
    accessKeyId:     CF_ACCESS_KEY,
    secretAccessKey: CF_SECRET_KEY,
  },
}) : null;

// Local fallback: save to disk
function saveLocally(params: { buffer: Buffer; filename: string; orgId: string; folder?: string }): { key: string; url: string } {
  const uploadDir = path.join(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
  const subDir    = path.join(uploadDir, params.orgId, params.folder || 'files');
  fs.mkdirSync(subDir, { recursive: true });

  const ext      = path.extname(params.filename);
  const safeName = `${randomUUID()}${ext}`;
  const fullPath = path.join(subDir, safeName);
  fs.writeFileSync(fullPath, params.buffer);

  const baseUrl = process.env.BACKEND_URL || process.env.API_URL || 'https://api.tasksdone.cloud';
  const key     = `${params.orgId}/${params.folder || 'files'}/${safeName}`;
  const url     = `${baseUrl}/uploads/${key}`;
  return { key, url };
}

export async function uploadToR2(params: {
  buffer:   Buffer;
  filename: string;
  mimeType: string;
  orgId:    string;
  folder?:  string;
}): Promise<{ key: string; url: string; size: number }> {
  if (!USE_R2) {
    const local = saveLocally(params);
    return { key: local.key, url: local.url, size: params.buffer.length };
  }

  const ext = path.extname(params.filename);
  const key = `${params.orgId}/${params.folder || 'files'}/${randomUUID()}${ext}`;

  await r2!.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    Body:        params.buffer,
    ContentType: params.mimeType,
    Metadata: {
      originalName: encodeURIComponent(params.filename),
      orgId:        params.orgId,
    },
  }));

  return {
    key,
    url:  `${PUBLIC_URL}/${key}`,
    size: params.buffer.length,
  };
}

export async function deleteFromR2(key: string): Promise<void> {
  if (!USE_R2) {
    // Local fallback: delete from disk
    const uploadDir = path.join(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
    const filePath  = path.join(uploadDir, key);
    try { fs.unlinkSync(filePath); } catch {}
    return;
  }
  await r2!.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function getPresignedUploadUrl(params: {
  orgId:      string;
  filename:   string;
  mimeType:   string;
  folder?:    string;
  expiresIn?: number;
}): Promise<{ uploadUrl: string; key: string; publicUrl: string }> {
  if (!USE_R2) {
    // Without R2, presigned URLs are not supported — return a dummy that instructs direct upload
    const ext = path.extname(params.filename);
    const key = `${params.orgId}/${params.folder || 'files'}/${randomUUID()}${ext}`;
    return {
      uploadUrl: `/api/upload/single`,
      key,
      publicUrl: '',
    };
  }

  const ext = path.extname(params.filename);
  const key = `${params.orgId}/${params.folder || 'files'}/${randomUUID()}${ext}`;

  const uploadUrl = await getSignedUrl(
    r2!,
    new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      ContentType: params.mimeType,
    }),
    { expiresIn: params.expiresIn || 300 }
  );

  return { uploadUrl, key, publicUrl: `${PUBLIC_URL}/${key}` };
}

export function getPublicUrl(key: string): string {
  if (!USE_R2) {
    const baseUrl = process.env.BACKEND_URL || process.env.API_URL || 'https://api.tasksdone.cloud';
    return `${baseUrl}/uploads/${key}`;
  }
  return `${PUBLIC_URL}/${key}`;
}
