import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const IS_PROD = process.env.NODE_ENV === 'production';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function authRoutes(fastify) {
  const { db, config } = fastify;

  // GET /auth/register
  fastify.get('/register', async (request, reply) => {
    return reply.view('auth/register.ejs', { user: request.user, error: null });
  });

  // POST /auth/register
  fastify.post('/register', async (request, reply) => {
    if (fastify.checkAuthRateLimit && !fastify.checkAuthRateLimit(request, reply)) return;
    const { email, username, password, name, location } = request.body;
    const t = reply.locals.t;

    if (!email || !username || !password) {
      return reply.view('auth/register.ejs', { user: request.user, error: t('auth.err_required') });
    }

    if (!EMAIL_RE.test(email)) {
      return reply.view('auth/register.ejs', { user: request.user, error: t('auth.err_email_format') });
    }

    if (username.length < 3 || username.length > 50) {
      return reply.view('auth/register.ejs', { user: request.user, error: t('auth.err_username_length') });
    }

    if (password.length < 8 || password.length > 1000) {
      return reply.view('auth/register.ejs', { user: request.user, error: t('auth.err_password_length') });
    }

    if (email.length > 255 || (name && name.length > 255) || (location && location.length > 255)) {
      return reply.view('auth/register.ejs', { user: request.user, error: t('auth.err_input_long') });
    }

    try {
      // Check for existing user
      const existing = await db.query(
        'SELECT id FROM users WHERE email = $1 OR username = $2',
        [email.toLowerCase(), username]
      );
      if (existing.rows.length > 0) {
        return reply.view('auth/register.ejs', { user: request.user, error: t('auth.err_taken') });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const result = await db.query(
        `INSERT INTO users (email, password_hash, username, name, location)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, email, username, name, plan, role`,
        [email.toLowerCase(), passwordHash, username, name || null, location || null]
      );

      const user = result.rows[0];
      const token = jwt.sign(
        { id: user.id, email: user.email, username: user.username, name: user.name, plan: user.plan, role: user.role || 'user' },
        config.JWT_SECRET,
        { expiresIn: '7d' }
      );

      reply.setCookie('token', token, {
        path: '/',
        httpOnly: true,
        secure: false, // behind Caddy reverse proxy on HTTP/Tailscale
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60,
      });

      return reply.redirect('/');
    } catch (err) {
      fastify.log.error(err);
      return reply.view('auth/register.ejs', { user: request.user, error: t('auth.err_register_fail') });
    }
  });

  // GET /auth/login
  fastify.get('/login', async (request, reply) => {
    return reply.view('auth/login.ejs', { user: request.user, error: null });
  });

  // POST /auth/login
  fastify.post('/login', async (request, reply) => {
    if (fastify.checkAuthRateLimit && !fastify.checkAuthRateLimit(request, reply)) return;
    const { email, password } = request.body;
    const t = reply.locals.t;

    if (!email || !password) {
      return reply.view('auth/login.ejs', { user: request.user, error: t('auth.err_login_required') });
    }

    try {
      const result = await db.query(
        'SELECT id, email, password_hash, username, name, plan, role, banned, banned_reason FROM users WHERE email = $1',
        [email.toLowerCase()]
      );

      if (result.rows.length === 0) {
        return reply.view('auth/login.ejs', { user: request.user, error: t('auth.err_invalid_credentials') });
      }

      const user = result.rows[0];

      if (user.banned) {
        return reply.view('auth/banned.ejs', { user: null, reason: user.banned_reason || null });
      }

      const valid = await bcrypt.compare(password, user.password_hash);

      if (!valid) {
        return reply.view('auth/login.ejs', { user: request.user, error: t('auth.err_invalid_credentials') });
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, username: user.username, name: user.name, plan: user.plan, role: user.role || 'user' },
        config.JWT_SECRET,
        { expiresIn: '7d' }
      );

      reply.setCookie('token', token, {
        path: '/',
        httpOnly: true,
        secure: false, // behind Caddy reverse proxy on HTTP/Tailscale
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60,
      });

      return reply.redirect('/');
    } catch (err) {
      fastify.log.error(err);
      return reply.view('auth/login.ejs', { user: request.user, error: t('auth.err_login_fail') });
    }
  });

  // GET /auth/logout
  fastify.get('/logout', async (request, reply) => {
    reply.clearCookie('token', { path: '/' });
    return reply.redirect('/');
  });
}
