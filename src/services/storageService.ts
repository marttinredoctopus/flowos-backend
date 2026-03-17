import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import path from 'path';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_KEY!,
  },
});

const BUCKET     = process.env.R2_BUCKET_NAME || 'flowos-files';
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

export async function uploadToR2(params: {
  buffer:   Buffer;
  filename: string;
  mimeType: string;
  orgId:    string;
  folder?:  string;
}): Promise<{ key: string; url: string; size: number }> {
  const ext = path.extname(params.filename);
  const key = `${params.orgId}/${params.folder || 'files'}/${randomUUID()}${ext}`;

  await r2.send(new PutObjectCommand({
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
  await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function getPresignedUploadUrl(params: {
  orgId:      string;
  filename:   string;
  mimeType:   string;
  folder?:    string;
  expiresIn?: number;
}): Promise<{ uploadUrl: string; key: string; publicUrl: string }> {
  const ext = path.extname(params.filename);
  const key = `${params.orgId}/${params.folder || 'files'}/${randomUUID()}${ext}`;

  const uploadUrl = await getSignedUrl(
    r2,
    new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      ContentType: params.mimeType,
    }),
    { expiresIn: params.expiresIn || 300 }
  );

  return {
    uploadUrl,
    key,
    publicUrl: `${PUBLIC_URL}/${key}`,
  };
}

export function getPublicUrl(key: string): string {
  return `${PUBLIC_URL}/${key}`;
}
