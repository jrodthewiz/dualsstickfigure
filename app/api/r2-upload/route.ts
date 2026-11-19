import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

// Force dynamic rendering for this route (required for API routes with static export builds)
export const dynamic = 'force-dynamic';

// Initialize R2 client (S3-compatible)
const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'platformer-animations';
const PUBLIC_URL_BASE = process.env.R2_PUBLIC_URL || '';

// GET - List files in bucket
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const prefix = searchParams.get('prefix') || '';
    const maxKeys = parseInt(searchParams.get('maxKeys') || '10000');
    const continuationToken = searchParams.get('continuationToken') || undefined;

    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
      MaxKeys: maxKeys,
      ContinuationToken: continuationToken,
    });

    const response = await r2Client.send(listCommand);

    const files = response.Contents?.map(obj => ({
      key: obj.Key,
      size: obj.Size,
      lastModified: obj.LastModified,
      url: `${PUBLIC_URL_BASE}/${obj.Key}`,
    })) || [];

    return NextResponse.json({
      success: true,
      files,
      isTruncated: response.IsTruncated,
      nextContinuationToken: response.NextContinuationToken,
    });
  } catch (error) {
    console.error('[R2] List error:', error);
    return NextResponse.json(
      { error: 'Failed to list files', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// POST - Upload, delete, or sync operations
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const formData = await request.formData();
    const action = formData.get('action') as string;

    // Upload file
    if (action === 'upload') {
      const file = formData.get('file') as File;
      const path = formData.get('path') as string | null;

      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      }

      const key = path ? `${path}/${file.name}` : file.name;
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      const uploadCommand = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: file.type || 'application/octet-stream',
      });

      await r2Client.send(uploadCommand);

      return NextResponse.json({
        success: true,
        message: 'File uploaded successfully',
        url: `${PUBLIC_URL_BASE}/${key}`,
        key: key,
        size: file.size,
        type: file.type,
      });
    }

    // Delete single file
    if (action === 'delete') {
      const key = formData.get('key') as string;
      if (!key) {
        return NextResponse.json({ error: 'No key provided' }, { status: 400 });
      }

      const deleteCommand = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      });

      await r2Client.send(deleteCommand);

      return NextResponse.json({
        success: true,
        message: 'File deleted successfully',
        key: key,
      });
    }

    // Bulk delete
    if (action === 'bulk-delete') {
      const keysJson = formData.get('keys') as string;
      const keys: string[] = JSON.parse(keysJson);

      if (!Array.isArray(keys) || keys.length === 0) {
        return NextResponse.json({ error: 'Keys array empty' }, { status: 400 });
      }

      const deleteObjectsCommand = new DeleteObjectsCommand({
        Bucket: BUCKET_NAME,
        Delete: {
          Objects: keys.map(key => ({ Key: key })),
        },
      });

      await r2Client.send(deleteObjectsCommand);

      return NextResponse.json({
        success: true,
        message: `Bulk deleted ${keys.length} files`,
        deleted: keys.length,
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[R2] Operation error:', error);
    return NextResponse.json(
      { error: 'Operation failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

