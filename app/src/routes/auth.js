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
    const { email, username, password, name, location } = request.body;

    if (!email || !username || !password) {
      return reply.view('auth/register.ejs', { user: request.user, error: 'Email, username, and password are required.' });
    }

    if (!EMAIL_RE.test(email)) {
      return reply.view('auth/register.ejs', { user: request.user, error: 'Invalid email format.' });
    }

    if (username.length < 3 || username.length > 50) {
      return reply.view('auth/register.ejs', { user: request.user, error: 'Username must be 3-50 characters.' });
    }

    if (password.length < 8) {
      return reply.view('auth/register.ejs', { user: request.user, error: 'Password must be at least 8 characters.' });
    }

    if (email.length > 255) {
      return reply.view('auth/register.ejs', { user: request.user, error: 'Input too long.' });
    }

    try {
      // Check for existing user
      const existing = await db.query(
        'SELECT id FROM users WHERE email = $1 OR username = $2',
        [email.toLowerCase(), username]
      );
      if (existing.rows.length > 0) {
        return reply.view('auth/register.ejs', { user: request.user, error: 'Email or username already taken.' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const result = await db.query(
        `INSERT INTO users (email, password_hash, username, name, location)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, email, username, name, plan`,
        [email.toLowerCase(), passwordHash, username, name || null, location || null]
      );

      const user = result.rows[0];
      const token = jwt.sign(
        { id: user.id, email: user.email, username: user.username, name: user.name, plan: user.plan },
        config.JWT_SECRET,
        { expiresIn: '7d' }
      );

      reply.setCookie('token', token, {
        path: '/',
        httpOnly: true,
        secure: IS_PROD,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60,
      });

      return reply.redirect('/');
    } catch (err) {
      fastify.log.error(err);
      return reply.view('auth/register.ejs', { user: request.user, error: 'Registration failed. Please try again.' });
    }
  });

  // GET /auth/login
  fastify.get('/login', async (request, reply) => {
    return reply.view('auth/login.ejs', { user: request.user, error: null });
  });

  // POST /auth/login
  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body;

    if (!email || !password) {
      return reply.view('auth/login.ejs', { user: request.user, error: 'Email and password are required.' });
    }

    try {
      const result = await db.query(
        'SELECT id, email, password_hash, username, name, plan FROM users WHERE email = $1',
        [email.toLowerCase()]
      );

      if (result.rows.length === 0) {
        return reply.view('auth/login.ejs', { user: request.user, error: 'Invalid email or password.' });
      }

      const user = result.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);

      if (!valid) {
        return reply.view('auth/login.ejs', { user: request.user, error: 'Invalid email or password.' });
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, username: user.username, name: user.name, plan: user.plan },
        config.JWT_SECRET,
        { expiresIn: '7d' }
      );

      reply.setCookie('token', token, {
        path: '/',
        httpOnly: true,
        secure: IS_PROD,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60,
      });

      return reply.redirect('/');
    } catch (err) {
      fastify.log.error(err);
      return reply.view('auth/login.ejs', { user: request.user, error: 'Login failed. Please try again.' });
    }
  });

  // GET /auth/logout
  fastify.get('/logout', async (request, reply) => {
    reply.clearCookie('token', { path: '/' });
    return reply.redirect('/');
  });
}
