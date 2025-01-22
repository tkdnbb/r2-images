// src/index.ts
import { Hono } from 'hono';
import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const app = new Hono<{
  Bindings: {
    R2_ACCESS_KEY_ID: string;
    R2_SECRET_ACCESS_KEY: string;
    R2_BUCKET_NAME: string;
    R2_ENDPOINT: string;
  }
}>();

// 安全验证与类型映射（保持不变）
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
} as const;

function validateFilename(filename: string): boolean {
  return /^[\w\-.]{1,256}$/.test(filename) &&
    !filename.includes('..') &&
    filename.split('.').length <= 10;
}

app.get('/images/:filename', async (c) => {
  const filename = c.req.param('filename');
  const BUCKET_NAME = c.env.R2_BUCKET_NAME!;
  const env = c.env;
  // 初始化 S3 客户端（Cloudflare R2 特化配置）
  const s3 = new S3Client({
    region: "auto",
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
    endpoint: env.R2_ENDPOINT,
    forcePathStyle: true, // 重要：R2 需要路径类型访问
  });



  if (!validateFilename(filename)) {
    return c.text('Invalid filename format', 400);
  }

  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return c.text('Unsupported file type', 415);
  }

  try {
    // 检查文件是否存在并获取元数据
    const headCommand = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: filename,
    });
    const headResponse = await s3.send(headCommand);

    // 获取文件流
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: filename,
    });
    const response = await s3.send(getCommand);

    return c.newResponse(response.Body as ReadableStream, 200, {
      'Content-Type': CONTENT_TYPES[ext as keyof typeof CONTENT_TYPES],
      'Cache-Control': 'public, max-age=604800',
      'ETag': headResponse.ETag?.replace(/"/g, ''), // 移除可能的引号
      'Content-Length': headResponse.ContentLength?.toString(),
      'X-Content-Type-Options': 'nosniff'
    });

  } catch (error: any) {
    if (error.name === 'NotFound') {
      return c.text('Image not found', 404);
    }
    console.error(`[S3 Error] ${new Date().toISOString()}`, error);
    return c.text('Internal Server Error', 500);
  }
});

// 健康检查端点（调整状态检测）
app.get('/health', async (c) => {
  const env = c.env;
  // 初始化 S3 客户端（Cloudflare R2 特化配置）
  const s3 = new S3Client({
    region: "auto",
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
    endpoint: env.R2_ENDPOINT,
    forcePathStyle: true, // 重要：R2 需要路径类型访问
  });
  return c.json({
    status: 'OK',
    s3: await s3.config.credentials() ? 'connected' : 'disconnected'
  });
});

export default app;