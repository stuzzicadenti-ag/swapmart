import Fastify from 'fastify';
import fastifyView from '@fastify/view';
import fastifyStatic from '@fastify/static';
import fastifyFormbody from '@fastify/formbody';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyWebsocket from '@fastify/websocket';
import ejs from 'ejs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';

import authRoutes from './routes/auth.js';
import listingsRoutes from './routes/listings.js';
import offersRoutes from './routes/offers.js';
import messagesRoutes from './routes/messages.js';
import profileRoutes from './routes/profile.js';
import invoicesRoutes from './routes/invoices.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '4003', 10);
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://swapmart_app:swapmart_pass@localhost:5432/stz_swapmart';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'change-me';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10, idleTimeoutMillis: 30000 });
const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 });

redis.on('error', (err) => {
  console.error('Redis connection error:', err.message);
});

const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 1048576 });

// Security headers
app.addHook('onSend', async (request, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '0');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});

// Rate limiting for auth routes (in-memory, per IP)
const authAttempts = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 10;

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of authAttempts) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW) authAttempts.delete(key);
  }
}, 60 * 1000);

app.decorate('checkAuthRateLimit', (request, reply) => {
  const ip = request.ip;
  const now = Date.now();
  let entry = authAttempts.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    entry = { count: 0, windowStart: now };
    authAttempts.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    reply.code(429).send('Too many attempts. Please try again later.');
    return false;
  }
  return true;
});

// Global error handler
app.setErrorHandler((error, request, reply) => {
  app.log.error(error);
  const statusCode = error.statusCode || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'An unexpected error occurred.'
    : error.message;
  reply.code(statusCode).send({ error: message });
});

// Plugins (must be registered before hooks that depend on them)
await app.register(fastifyCookie, { secret: COOKIE_SECRET });
await app.register(fastifyFormbody);

// Decorators
app.decorate('db', pool);
app.decorate('redis', redis);
app.decorate('jwt', { secret: JWT_SECRET });
app.decorate('config', { UPLOAD_DIR, JWT_SECRET, COOKIE_SECRET });

// Auth decorator - attaches user to request if valid JWT cookie
app.decorateRequest('user', null);
app.addHook('onRequest', async (request) => {
  const token = request.cookies?.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      request.user = decoded;
    } catch {
      request.user = null;
    }
  }
});
await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024 } });
await app.register(fastifyWebsocket);

await app.register(fastifyView, {
  engine: { ejs },
  root: path.join(__dirname, 'views'),
  defaultContext: { user: null },
  production: process.env.NODE_ENV === 'production',
});

await app.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/public/',
  maxAge: process.env.NODE_ENV === 'production' ? 86400000 : 0,
});

await app.register(fastifyStatic, {
  root: UPLOAD_DIR,
  prefix: '/uploads/',
  decorateReply: false,
  maxAge: process.env.NODE_ENV === 'production' ? 604800000 : 0,
});

// Inject user into all view contexts
app.addHook('preHandler', async (request, reply) => {
  reply.locals = { user: request.user };
});

// Health check
app.get('/health', async () => {
  let dbOk = false;
  let redisOk = false;
  try {
    await pool.query('SELECT 1');
    dbOk = true;
  } catch { /* noop */ }
  try {
    await redis.ping();
    redisOk = true;
  } catch { /* noop */ }
  return { status: 'ok', service: 'swapmart', db: dbOk, redis: redisOk };
});

// Routes
await app.register(authRoutes, { prefix: '/auth' });
await app.register(listingsRoutes, { prefix: '/listings' });
await app.register(offersRoutes, { prefix: '/offers' });
await app.register(messagesRoutes, { prefix: '/messages' });
await app.register(profileRoutes, { prefix: '/profile' });
await app.register(invoicesRoutes, { prefix: '/invoices' });

// Fees page
app.get('/fees', async (request, reply) => {
  return reply.view('fees.ejs', { user: request.user });
});

// Homepage
app.get('/', async (request, reply) => {
  let categories = [];
  let featured = [];
  try {
    const [catResult, featResult] = await Promise.all([
      pool.query('SELECT * FROM categories WHERE parent_id IS NULL ORDER BY name'),
      pool.query(
        `SELECT l.*, u.username as seller_name, c.name as category_name,
         (SELECT file_path FROM listing_images WHERE listing_id = l.id ORDER BY position LIMIT 1) as image
         FROM listings l
         JOIN users u ON l.seller_id = u.id
         JOIN categories c ON l.category_id = c.id
         WHERE l.status = 'active'
         ORDER BY l.created_at DESC LIMIT 8`
      ),
    ]);
    categories = catResult.rows;
    featured = featResult.rows;
  } catch (err) {
    app.log.error(err);
  }
  return reply.view('index.ejs', { user: request.user, categories, featured });
});

// Graceful shutdown
const shutdown = async () => {
  await app.close();
  await pool.end();
  redis.disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start
try {
  await redis.connect();
  app.log.info('Redis connected');
} catch (err) {
  app.log.warn('Redis not available, sessions will be limited:', err.message);
}

await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`SwapMart running on http://0.0.0.0:${PORT}`);
