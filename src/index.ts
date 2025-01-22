// src/index.ts
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { S3Client } from 'bun';

// 初始化 S3 客户端（Cloudflare R2 特化配置）
const s3 = new S3Client({
  accessKeyId: process.env.R2_ACCESS_KEY_ID!,      // 建议通过环境变量注入
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  bucket: process.env.R2_BUCKET_NAME!,             // R2 存储桶名称
  endpoint: process.env.R2_ENDPOINT,               // R2 特定端点
  region: "auto",                                  // R2 要求固定值
});

const app = new Hono();

// 安全验证与类型映射
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
} as const;

// 增强型安全验证
function validateFilename(filename: string): boolean {
  return /^[\w\-\.]{1,256}$/.test(filename) &&      // 长度限制+安全字符
    !filename.includes('..') &&                // 防止路径遍历
    filename.split('.').length <= 10;          // 防止过度分段
}

app.get('/images/:filename', async (c) => {
  const filename = c.req.param('filename');

  // 安全验证
  if (!validateFilename(filename)) {
    return c.text('Invalid filename format', 400);
  }

  // 文件扩展名验证
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return c.text('Unsupported file type', 415);
  }

  try {
    // 创建 S3 文件引用
    const file = s3.file(`${filename}`);  // 带目录前缀
    const [stat, exists] = await Promise.all([
      file.stat(),
      file.exists()                                  // 存在性检查
    ]);
    if (!exists) {
      return c.text('Image not found', 404);
    }

    // 响应头优化
    return c.newResponse(file.stream(), 200, {
      'Content-Type': CONTENT_TYPES[ext as keyof typeof CONTENT_TYPES],
      'Cache-Control': 'public, max-age=604800',   // 7天缓存
      'ETag': stat.etag,                   // 自动哈希校验
      'X-Content-Type-Options': 'nosniff'          // 安全增强
    });

  } catch (error) {
    console.error(`[S3 Error] ${new Date().toISOString()}`, error);
    return c.text('Internal Server Error', 500);
  }
});

// 健康检查端点
app.get('/health', (c) => {
  return c.json({
    status: 'OK',
    s3: s3 ? 'connected' : 'disconnected'
  });
});

// 启动服务
const port = process.env.PORT || 3000;
serve({
  fetch: app.fetch,
  port: Number(port),
}, () => {
  console.log(`Server running on http://localhost:${port}`);
});

export default app;