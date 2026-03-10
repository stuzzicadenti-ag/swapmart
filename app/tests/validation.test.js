/**
 * SwapMart Cross-Validation Tests
 *
 * Run with: node --test app/tests/validation.test.js
 *
 * Uses Node.js built-in test runner (node:test) and assertion module (node:assert).
 * These tests validate security invariants by reading source code and config,
 * without requiring a running server or database.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_SRC = path.join(__dirname, '..', 'src');
const API_DIR = path.join(__dirname, '..', '..', 'api');

// ─── Helper: read source file ─────────────────────────
function readSrc(relPath) {
  return fs.readFileSync(path.resolve(APP_SRC, relPath), 'utf-8');
}

function readApi(relPath) {
  return fs.readFileSync(path.resolve(API_DIR, relPath), 'utf-8');
}

// ─── Helper: collect all EJS templates ────────────────
function collectEjs(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectEjs(fullPath));
    } else if (entry.name.endsWith('.ejs')) {
      results.push(fullPath);
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════════
// 1. ROUTE SECURITY: Auth-required routes use requireAuth or preHandler
// ═══════════════════════════════════════════════════════
describe('Route Security', () => {
  const routeFiles = ['routes/auth.js', 'routes/listings.js', 'routes/messages.js',
    'routes/offers.js', 'routes/profile.js', 'routes/invoices.js', 'routes/admin.js'];

  it('messages routes require auth on all handlers', () => {
    const src = readSrc('routes/messages.js');
    // GET /messages, GET /messages/:offerId, POST /messages/:offerId must all use requireAuth
    const getRoutes = src.match(/fastify\.(get|post)\(/g);
    assert.ok(getRoutes, 'Should have route definitions');
    // All fastify.get and fastify.post should use preHandler: requireAuth
    const routeBlocks = src.match(/fastify\.(get|post)\([^{]+\{[^}]*preHandler:\s*requireAuth/g);
    assert.ok(routeBlocks && routeBlocks.length >= 3,
      'All 3 messages routes (GET /, GET /:offerId, POST /:offerId) should use requireAuth');
  });

  it('offers routes require auth on all handlers', () => {
    const src = readSrc('routes/offers.js');
    const routeBlocks = src.match(/fastify\.(get|post)\([^{]+\{[^}]*preHandler:\s*requireAuth/g);
    assert.ok(routeBlocks && routeBlocks.length >= 4,
      'All offers routes should use requireAuth (GET /, POST accept, POST reject, POST complete)');
  });

  it('invoices routes require auth', () => {
    const src = readSrc('routes/invoices.js');
    assert.ok(src.includes('preHandler: requireAuth'),
      'Invoices GET / must require auth');
  });

  it('admin routes use requireAdmin preHandler', () => {
    const src = readSrc('routes/admin.js');
    // Count how many routes use requireAdmin
    const adminGuardedRoutes = (src.match(/preHandler:\s*requireAdmin/g) || []).length;
    // There should be many admin routes guarded
    assert.ok(adminGuardedRoutes >= 10,
      `Expected at least 10 admin-guarded routes, found ${adminGuardedRoutes}`);
  });

  it('admin requireAdmin checks both auth and role', () => {
    const src = readSrc('routes/admin.js');
    // requireAdmin should check request.user exists
    assert.ok(src.includes("if (!request.user)"),
      'requireAdmin must check for authenticated user');
    // requireAdmin should check role is admin or owner
    assert.ok(src.includes("role !== 'admin' && role !== 'owner'"),
      'requireAdmin must verify admin or owner role');
  });

  it('profile settings and verify routes require auth', () => {
    const src = readSrc('routes/profile.js');
    const authCount = (src.match(/preHandler:\s*requireAuth/g) || []).length;
    assert.ok(authCount >= 3,
      'Profile settings GET, POST, and verify routes must require auth');
  });

  it('listing creation route requires auth', () => {
    const src = readSrc('routes/listings.js');
    // GET /new and POST /new should require auth
    assert.ok(src.includes("fastify.get('/new', { preHandler: requireAuth }"),
      'GET /listings/new must require auth');
    assert.ok(src.includes("fastify.post('/new', { preHandler: requireAuth }"),
      'POST /listings/new must require auth');
  });

  it('API auth middleware rejects missing Bearer token', () => {
    const src = readApi('server.js');
    assert.ok(src.includes("!header || !header.startsWith('Bearer ')"),
      'API authenticate must reject missing/invalid Authorization header');
    assert.ok(src.includes("401"),
      'API authenticate must return 401 on failure');
  });
});

// ═══════════════════════════════════════════════════════
// 2. INPUT VALIDATION
// ═══════════════════════════════════════════════════════
describe('Input Validation', () => {
  it('auth registration validates email format', () => {
    const src = readSrc('routes/auth.js');
    assert.ok(src.includes('EMAIL_RE.test(email)'),
      'Registration must validate email format');
  });

  it('auth registration enforces password length limits', () => {
    const src = readSrc('routes/auth.js');
    assert.ok(src.includes('password.length < 8'),
      'Password must be at least 8 chars');
    assert.ok(src.includes('password.length > 1000'),
      'Password must have an upper bound');
  });

  it('auth registration enforces username length', () => {
    const src = readSrc('routes/auth.js');
    assert.ok(src.includes('username.length < 3') && src.includes('username.length > 50'),
      'Username must be 3-50 chars');
  });

  it('listing creation validates title length', () => {
    const src = readSrc('routes/listings.js');
    assert.ok(src.includes('title.length > 255'),
      'Title must be capped at 255 chars');
  });

  it('listing creation validates description length', () => {
    const src = readSrc('routes/listings.js');
    assert.ok(src.includes('description.length > 10000'),
      'Description must be capped at 10,000 chars');
  });

  it('listing creation validates image count', () => {
    const src = readSrc('routes/listings.js');
    assert.ok(src.includes('files.length === 0'),
      'Listing must require at least 1 image');
    assert.ok(src.includes('files.length > 5'),
      'Listing must reject more than 5 images');
  });

  it('listing creation validates image types (MIME + extension)', () => {
    const src = readSrc('routes/listings.js');
    assert.ok(src.includes("ALLOWED_MIMES"),
      'Must validate MIME types');
    assert.ok(src.includes(".jpg") && src.includes(".png") && src.includes(".webp"),
      'Must whitelist file extensions');
  });

  it('message sending validates content length', () => {
    const src = readSrc('routes/messages.js');
    assert.ok(src.includes('content.length > 5000'),
      'Messages must be capped at 5000 chars');
  });

  it('profile update validates input lengths', () => {
    const src = readSrc('routes/profile.js');
    assert.ok(src.includes('name.length > 255'),
      'Profile name must be capped');
    assert.ok(src.includes('bio.length > 2000'),
      'Profile bio must be capped at 2000');
  });

  it('API listing creation validates title and description length', () => {
    const src = readApi('server.js');
    assert.ok(src.includes('body.title.length > 255'),
      'API must validate title length');
    assert.ok(src.includes('body.description.length > 10000'),
      'API must validate description length');
  });

  it('API message sending validates body length', () => {
    const src = readApi('server.js');
    assert.ok(src.includes('body.body.length > 2000'),
      'API must validate message body length');
  });

  it('multipart file size limit is set on Fastify app', () => {
    const src = readSrc('server.js');
    assert.ok(src.includes('fileSize: 10 * 1024 * 1024'),
      'Multipart file size limit must be 10MB');
  });
});

// ═══════════════════════════════════════════════════════
// 3. OPEN REDIRECT PREVENTION
// ═══════════════════════════════════════════════════════
describe('Open Redirect Prevention', () => {
  it('/lang/:code prevents open redirects', () => {
    const src = readSrc('server.js');
    // Must check redirect starts with / and doesn't start with //
    assert.ok(src.includes("redirect.startsWith('/')"),
      'Must check redirect starts with /');
    assert.ok(src.includes("!redirect.startsWith('//')"),
      'Must block protocol-relative URLs (//)');
    assert.ok(src.includes("!redirect.includes('://')"),
      'Must block absolute URLs with protocol');
  });

  it('/lang/:code validates language code against whitelist', () => {
    const src = readSrc('server.js');
    assert.ok(src.includes('SUPPORTED_LANGS.includes(code)'),
      'Must validate language code against supported list');
  });

  it('safe redirect falls back to / for invalid inputs', () => {
    const src = readSrc('server.js');
    assert.ok(src.includes("? redirect : '/'"),
      'Must fall back to / for unsafe redirects');
  });
});

// ═══════════════════════════════════════════════════════
// 4. RATE LIMITING
// ═══════════════════════════════════════════════════════
describe('Rate Limiting', () => {
  it('Fastify app has auth rate limiter', () => {
    const src = readSrc('server.js');
    assert.ok(src.includes('checkAuthRateLimit'),
      'Must define checkAuthRateLimit');
    assert.ok(src.includes('RATE_LIMIT_MAX'),
      'Must define max auth attempts');
  });

  it('Fastify app has action rate limiter for listings and messages', () => {
    const src = readSrc('server.js');
    assert.ok(src.includes('checkActionRateLimit'),
      'Must define checkActionRateLimit');
    assert.ok(src.includes('LISTING_RATE_MAX'),
      'Must define listing rate limit');
    assert.ok(src.includes('MESSAGE_RATE_MAX'),
      'Must define message rate limit');
  });

  it('auth login uses rate limiting', () => {
    const src = readSrc('routes/auth.js');
    const loginBlock = src.substring(src.indexOf("post('/login'"));
    assert.ok(loginBlock.includes('checkAuthRateLimit'),
      'POST /auth/login must check auth rate limit');
  });

  it('auth registration uses rate limiting', () => {
    const src = readSrc('routes/auth.js');
    const registerBlock = src.substring(src.indexOf("post('/register'"));
    assert.ok(registerBlock.includes('checkAuthRateLimit'),
      'POST /auth/register must check auth rate limit');
  });

  it('listing creation uses rate limiting', () => {
    const src = readSrc('routes/listings.js');
    assert.ok(src.includes("checkActionRateLimit(request, reply, 'listing')"),
      'POST /listings/new must check action rate limit');
  });

  it('message sending uses rate limiting', () => {
    const src = readSrc('routes/messages.js');
    assert.ok(src.includes("checkActionRateLimit(request, reply, 'message')"),
      'POST /messages/:offerId must check action rate limit');
  });

  it('listing report and offer routes use rate limiting', () => {
    const src = readSrc('routes/listings.js');
    const reportIdx = src.indexOf("'/:id/report'");
    const offerIdx = src.indexOf("'/:id/offer'");
    const reportBlock = src.substring(reportIdx, reportIdx + 300);
    const offerBlock = src.substring(offerIdx, offerIdx + 300);
    assert.ok(reportBlock.includes('checkActionRateLimit'),
      'POST /listings/:id/report must be rate limited');
    assert.ok(offerBlock.includes('checkActionRateLimit'),
      'POST /listings/:id/offer must be rate limited');
  });

  it('API has rate limiting middleware', () => {
    const src = readApi('server.js');
    assert.ok(src.includes('function rateLimit(action, max)'),
      'API must define rateLimit function');
  });

  it('API auth routes use rate limiting', () => {
    const src = readApi('server.js');
    assert.ok(src.includes("'/api/v1/auth/register', rateLimit('auth', 10)"),
      'API register must be rate limited');
    assert.ok(src.includes("'/api/v1/auth/login', rateLimit('auth', 10)"),
      'API login must be rate limited');
  });

  it('API refresh route uses rate limiting', () => {
    const src = readApi('server.js');
    assert.ok(src.includes("'/api/v1/auth/refresh', rateLimit('auth', 10)"),
      'API refresh must be rate limited');
  });

  it('API listing creation and messaging use rate limiting', () => {
    const src = readApi('server.js');
    assert.ok(src.includes("'/api/v1/listings', authenticate, rateLimit('listing', 20)"),
      'API POST listings must be rate limited');
    assert.ok(src.includes("rateLimit('message', 60)"),
      'API POST messages must be rate limited');
  });
});

// ═══════════════════════════════════════════════════════
// 5. SECURITY HEADERS
// ═══════════════════════════════════════════════════════
describe('Security Headers', () => {
  const requiredHeaders = [
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'X-Frame-Options',
    'X-XSS-Protection',
    'Referrer-Policy',
    'Content-Security-Policy',
  ];

  it('Fastify app sets all required security headers', () => {
    const src = readSrc('server.js');
    for (const header of requiredHeaders) {
      assert.ok(src.includes(header),
        `Fastify app must set ${header} header`);
    }
    assert.ok(src.includes('Permissions-Policy'),
      'Fastify app must set Permissions-Policy header');
  });

  it('Express API sets all required security headers', () => {
    const src = readApi('server.js');
    for (const header of requiredHeaders) {
      assert.ok(src.includes(header),
        `Express API must set ${header} header`);
    }
    assert.ok(src.includes('Permissions-Policy'),
      'Express API must set Permissions-Policy header');
  });

  it('Fastify app removes X-Powered-By', () => {
    const src = readSrc('server.js');
    assert.ok(src.includes("removeHeader('X-Powered-By')"),
      'Fastify app must remove X-Powered-By');
  });

  it('Express API disables x-powered-by', () => {
    const src = readApi('server.js');
    assert.ok(src.includes("app.disable('x-powered-by')"),
      'Express API must disable x-powered-by');
  });
});

// ═══════════════════════════════════════════════════════
// 6. ERROR HANDLING — No stack traces in production
// ═══════════════════════════════════════════════════════
describe('Error Handling', () => {
  it('Fastify global error handler hides details in production', () => {
    const src = readSrc('server.js');
    assert.ok(src.includes("process.env.NODE_ENV === 'production'"),
      'Error handler must check NODE_ENV');
    assert.ok(src.includes("'An unexpected error occurred.'"),
      'Error handler must return generic message in production');
  });
});

// ═══════════════════════════════════════════════════════
// 7. COOKIE SECURITY
// ═══════════════════════════════════════════════════════
describe('Cookie Security', () => {
  it('auth token cookie is httpOnly', () => {
    const src = readSrc('routes/auth.js');
    const cookieMatches = src.match(/setCookie\('token'[\s\S]*?\}/g);
    assert.ok(cookieMatches && cookieMatches.length > 0,
      'Must set token cookie');
    for (const match of cookieMatches) {
      assert.ok(match.includes('httpOnly: true'),
        'Token cookie must be httpOnly');
      assert.ok(match.includes("sameSite: 'lax'"),
        'Token cookie must have sameSite=lax');
    }
  });

  it('auth token cookie sets secure flag based on environment', () => {
    const src = readSrc('routes/auth.js');
    assert.ok(src.includes('secure: IS_PROD'),
      'Token cookie must set secure flag in production');
  });
});

// ═══════════════════════════════════════════════════════
// 8. DATABASE QUERY SAFETY — Parameterized queries
// ═══════════════════════════════════════════════════════
describe('Database Query Safety', () => {
  it('Fastify routes use parameterized queries ($1, $2)', () => {
    const routeFiles = ['routes/auth.js', 'routes/listings.js', 'routes/messages.js',
      'routes/offers.js', 'routes/profile.js', 'routes/invoices.js', 'routes/admin.js'];

    for (const file of routeFiles) {
      const src = readSrc(file);
      // Look for db.query calls — they should use $1/$2 placeholders, not string concatenation of user input
      const queries = src.match(/db\.query\(/g);
      if (queries) {
        // Check no direct user input interpolation in queries (e.g., `${email}` in SQL)
        const dangerousPatterns = src.match(/db\.query\(\s*`[^`]*\$\{(?:request\.body|request\.params|request\.query)[^`]*`/g);
        assert.ok(!dangerousPatterns || dangerousPatterns.length === 0,
          `${file} must not interpolate user input directly into SQL queries`);
      }
    }
  });

  it('API routes use parameterized queries (? placeholders)', () => {
    const src = readApi('server.js');
    // SQLite uses ? placeholders
    const prepareStatements = (src.match(/db\.prepare\(/g) || []).length;
    assert.ok(prepareStatements > 10,
      'API should use many prepared statements');

    // Check no direct user input interpolation
    const dangerousPatterns = src.match(/db\.prepare\(\s*['"`][^'"`]*\$\{(?:req\.body|req\.params|req\.query)/g);
    assert.ok(!dangerousPatterns || dangerousPatterns.length === 0,
      'API must not interpolate user input directly into SQL');
  });
});

// ═══════════════════════════════════════════════════════
// 9. ADMIN AUTHORIZATION
// ═══════════════════════════════════════════════════════
describe('Admin Authorization', () => {
  it('role changes validate against whitelist', () => {
    const src = readSrc('routes/admin.js');
    assert.ok(src.includes("validRoles.includes(role)"),
      'Role change must validate against valid roles list');
  });

  it('only owners can promote to admin/owner', () => {
    const src = readSrc('routes/admin.js');
    assert.ok(src.includes("request.adminRole !== 'owner'"),
      'Only owners should be able to promote to admin/owner');
  });

  it('users cannot ban themselves', () => {
    const src = readSrc('routes/admin.js');
    assert.ok(src.includes('parseInt(id) === request.user.id'),
      'Must prevent self-ban');
  });

  it('admins cannot ban owners', () => {
    const src = readSrc('routes/admin.js');
    assert.ok(src.includes("target.rows[0].role === 'owner'"),
      'Must prevent banning owners');
  });

  it('warning system validates reason against whitelist', () => {
    const src = readSrc('routes/admin.js');
    assert.ok(src.includes('WARNING_REASONS.includes(reason)'),
      'Warning reason must be validated against whitelist');
  });

  it('users cannot warn themselves', () => {
    const src = readSrc('routes/admin.js');
    assert.ok(src.includes('targetId === request.user.id'),
      'Must prevent self-warning');
  });
});

// ═══════════════════════════════════════════════════════
// 10. EJS TEMPLATE SAFETY — XSS prevention
// ═══════════════════════════════════════════════════════
describe('EJS Template Safety', () => {
  const ejsDir = path.join(APP_SRC, 'views');
  const ejsFiles = collectEjs(ejsDir);

  it('finds EJS templates', () => {
    assert.ok(ejsFiles.length >= 15,
      `Expected at least 15 EJS templates, found ${ejsFiles.length}`);
  });

  it('unescaped <%- %> is only used for includes, i18n HTML, and safe HTML entities', () => {
    const issues = [];
    for (const file of ejsFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const fileName = path.relative(ejsDir, file);
      // Find all <%- ... %> usages
      const unescaped = content.match(/<%-([\s\S]*?)%>/g) || [];
      for (const match of unescaped) {
        const inner = match.slice(3, -2).trim();
        // Safe patterns: include(), catIcons[], iconEmoji, hardcoded HTML entities
        const isSafe = inner.startsWith('include(')
          || inner.includes('catIcons[')
          || inner === 'iconEmoji'
          || inner.startsWith("t('") // i18n function — developer-controlled locale files
          || inner.startsWith('JSON.stringify(') // safe server-side serialization
          || /^&#\d+;$/.test(inner)  // HTML entity
          || /^'&#\d+;'$/.test(inner);
        if (!isSafe) {
          issues.push(`${fileName}: ${match.trim()}`);
        }
      }
    }
    assert.ok(issues.length === 0,
      `Found potentially unsafe <%- %> usages:\n${issues.join('\n')}`);
  });

  it('user content uses escaped <%= %> output', () => {
    // Check that key user-generated content fields are escaped
    const detailEjs = fs.readFileSync(path.join(ejsDir, 'listings', 'detail.ejs'), 'utf-8');
    // listing.title, listing.description, seller_name should use <%=
    assert.ok(detailEjs.includes('<%= listing.title %>'),
      'Listing title must be escaped');
    assert.ok(detailEjs.includes('<%= listing.description %>'),
      'Listing description must be escaped');
    assert.ok(detailEjs.includes('<%= listing.seller_name'),
      'Seller name must be escaped');

    const chatEjs = fs.readFileSync(path.join(ejsDir, 'messages', 'chat.ejs'), 'utf-8');
    assert.ok(chatEjs.includes('<%= msg.content %>'),
      'Message content must be escaped');
    assert.ok(chatEjs.includes('<%= msg.sender_name %>'),
      'Sender name must be escaped');

    const profileEjs = fs.readFileSync(path.join(ejsDir, 'profile', 'view.ejs'), 'utf-8');
    assert.ok(profileEjs.includes('<%= profile.bio %>'),
      'Profile bio must be escaped');
  });
});

// ═══════════════════════════════════════════════════════
// 11. N+1 QUERY FIX — Messages inbox uses JOIN
// ═══════════════════════════════════════════════════════
describe('N+1 Query Prevention', () => {
  it('messages inbox uses JOIN (not subquery per row)', () => {
    const src = readSrc('routes/messages.js');
    // The inbox query should use JOINs and LATERAL subqueries, not N+1 pattern
    assert.ok(src.includes('JOIN listings l ON o.listing_id = l.id'),
      'Inbox query must JOIN listings');
    assert.ok(src.includes('JOIN users bu ON o.buyer_id = bu.id'),
      'Inbox query must JOIN buyer users');
    assert.ok(src.includes('JOIN users su ON l.seller_id = su.id'),
      'Inbox query must JOIN seller users');
    assert.ok(src.includes('LEFT JOIN LATERAL'),
      'Inbox query should use LATERAL for last message (efficient single query)');
  });

  it('messages chat uses single query with JOIN for messages', () => {
    const src = readSrc('routes/messages.js');
    assert.ok(src.includes('JOIN users u ON m.sender_id = u.id'),
      'Chat messages query must JOIN users');
  });

  it('listings browse uses single query with JOINs', () => {
    const src = readSrc('routes/listings.js');
    assert.ok(src.includes('JOIN users u ON l.seller_id = u.id'),
      'Listings query must JOIN users');
    assert.ok(src.includes('JOIN categories c ON l.category_id = c.id'),
      'Listings query must JOIN categories');
  });
});

// ═══════════════════════════════════════════════════════
// 12. FILE UPLOAD VALIDATION
// ═══════════════════════════════════════════════════════
describe('File Upload Validation', () => {
  it('listing images validate both extension and MIME type', () => {
    const src = readSrc('routes/listings.js');
    assert.ok(src.includes("ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp']"),
      'Must whitelist MIME types');
    assert.ok(src.includes("'.jpg', '.jpeg', '.png', '.webp'"),
      'Must whitelist file extensions');
  });

  it('KYC uploads validate document types', () => {
    const src = readSrc('routes/profile.js');
    assert.ok(src.includes("'image/jpeg', 'image/png', 'image/webp', 'application/pdf'"),
      'KYC must accept jpeg, png, webp, pdf');
    assert.ok(src.includes("validTypes.includes(document_type)"),
      'KYC must validate document type against whitelist');
  });

  it('Fastify multipart has file size limit', () => {
    const src = readSrc('server.js');
    assert.ok(src.includes('fileSize: 10 * 1024 * 1024'),
      'File upload size limit must be configured');
  });
});

// ═══════════════════════════════════════════════════════
// 13. BUTTON AUDIT — All buttons have type attribute
// ═══════════════════════════════════════════════════════
describe('Button Audit', () => {
  const ejsDir = path.join(APP_SRC, 'views');
  const ejsFiles = collectEjs(ejsDir);

  it('all <button> elements have a type attribute', () => {
    const issues = [];
    for (const file of ejsFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const fileName = path.relative(ejsDir, file);
      // Find <button without type
      // Match <button that doesn't have type= before the closing >
      const buttonTags = content.match(/<button\b[^>]*>/gi) || [];
      for (const tag of buttonTags) {
        if (!tag.includes('type=')) {
          issues.push(`${fileName}: ${tag.trim().slice(0, 80)}`);
        }
      }
    }
    assert.ok(issues.length === 0,
      `Found <button> elements without type attribute:\n${issues.join('\n')}`);
  });

  it('submit buttons in forms use type="submit"', () => {
    const ejsDir2 = path.join(APP_SRC, 'views');
    const files = collectEjs(ejsDir2);
    let submitCount = 0;
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const submitButtons = content.match(/<button[^>]*type="submit"[^>]*>/gi) || [];
      submitCount += submitButtons.length;
    }
    assert.ok(submitCount > 5,
      `Expected multiple submit buttons across templates, found ${submitCount}`);
  });

  it('destructive actions use danger styling', () => {
    // Check that reject/ban/remove buttons use btn-danger
    const usersEjs = fs.readFileSync(path.join(ejsDir, 'admin', 'users.ejs'), 'utf-8');
    assert.ok(usersEjs.includes('class="btn btn-danger'),
      'Ban button should use btn-danger class');

    const offersEjs = fs.readFileSync(path.join(ejsDir, 'offers', 'list.ejs'), 'utf-8');
    assert.ok(offersEjs.includes('class="btn btn-danger btn-sm"'),
      'Reject offer button should use btn-danger class');

    const listingsAdminEjs = fs.readFileSync(path.join(ejsDir, 'admin', 'listings.ejs'), 'utf-8');
    assert.ok(listingsAdminEjs.includes('class="btn btn-danger'),
      'Remove listing button should use btn-danger class');
  });

  it('primary actions use primary styling', () => {
    const loginEjs = fs.readFileSync(path.join(ejsDir, 'auth', 'login.ejs'), 'utf-8');
    assert.ok(loginEjs.includes('class="btn btn-primary'),
      'Login button should use btn-primary class');

    const settingsEjs = fs.readFileSync(path.join(ejsDir, 'profile', 'settings.ejs'), 'utf-8');
    assert.ok(settingsEjs.includes('class="btn btn-primary'),
      'Save profile button should use btn-primary class');
  });
});

// ═══════════════════════════════════════════════════════
// 14. CONTENT MODERATION
// ═══════════════════════════════════════════════════════
describe('Content Moderation', () => {
  it('scanContent function exists and returns expected structure', async () => {
    const { scanContent } = await import('../src/utils/moderation.js');
    assert.ok(typeof scanContent === 'function', 'scanContent must be a function');

    const clean = scanContent('Hello world');
    assert.ok(clean.clean === true, 'Clean text should return clean: true');
    assert.ok(Array.isArray(clean.flags), 'Result must have flags array');
    assert.equal(clean.flags.length, 0, 'Clean text should have no flags');
  });

  it('scanContent detects phone numbers', async () => {
    const { scanContent } = await import('../src/utils/moderation.js');
    const result = scanContent('Call me at +41 79 123 45 67');
    assert.ok(!result.clean, 'Phone number text should not be clean');
    assert.ok(result.flags.some(f => f.type === 'auto_phone'),
      'Should flag phone numbers');
  });

  it('scanContent handles null/empty input', async () => {
    const { scanContent } = await import('../src/utils/moderation.js');
    assert.ok(scanContent(null).clean, 'null input should be clean');
    assert.ok(scanContent('').clean, 'empty input should be clean');
    assert.ok(scanContent(undefined).clean, 'undefined input should be clean');
  });
});

// ═══════════════════════════════════════════════════════
// 15. COMMISSION CALCULATOR
// ═══════════════════════════════════════════════════════
describe('Commission Calculator', () => {
  it('calculates correct commission for free plan', async () => {
    const { calculateCommission } = await import('../src/utils/commission.js');
    const result = calculateCommission(100, 'free');
    assert.ok(result.amount > 0, 'Commission should be positive');
    assert.ok(result.rate > 0, 'Rate should be positive');
    assert.equal(result.amount, 8, 'CHF 100 on free plan should be 8% = CHF 8');
  });

  it('uses free plan tiers by default', async () => {
    const { calculateCommission } = await import('../src/utils/commission.js');
    const result1 = calculateCommission(100);
    const result2 = calculateCommission(100, 'free');
    assert.equal(result1.amount, result2.amount, 'Default should use free plan');
  });
});

// ═══════════════════════════════════════════════════════
// 16. SLUG GENERATION
// ═══════════════════════════════════════════════════════
describe('Slug Generation', () => {
  it('generates URL-safe slugs', async () => {
    const { generateSlug } = await import('../src/utils/slug.js');
    const slug = generateSlug('iPhone 15 Pro Max 256GB!');
    assert.ok(/^[a-z0-9-]+$/.test(slug), 'Slug must only contain lowercase alphanumeric and hyphens');
    assert.ok(slug.startsWith('iphone-15-pro-max-256gb'),
      'Slug must be based on title');
  });

  it('generates unique slugs (includes random suffix)', async () => {
    const { generateSlug } = await import('../src/utils/slug.js');
    const slug1 = generateSlug('Test Item');
    const slug2 = generateSlug('Test Item');
    assert.notEqual(slug1, slug2, 'Two slugs from same title must be different');
  });

  it('truncates long titles', async () => {
    const { generateSlug } = await import('../src/utils/slug.js');
    const longTitle = 'A'.repeat(200);
    const slug = generateSlug(longTitle);
    // Base is max 60 chars + dash + 10 hex chars = max 71
    assert.ok(slug.length <= 71, `Slug too long: ${slug.length} chars`);
  });
});

// ═══════════════════════════════════════════════════════
// 17. API ESCROW ENDPOINT SECURITY
// ═══════════════════════════════════════════════════════
describe('API Escrow Security', () => {
  it('check-timeouts endpoint requires authentication', () => {
    const src = readApi('payments.js');
    assert.ok(src.includes("'/payments/check-timeouts', authenticate"),
      'check-timeouts must require authentication');
  });
});

// ═══════════════════════════════════════════════════════
// 18. CSRF PROTECTION
// ═══════════════════════════════════════════════════════
describe('CSRF Protection', () => {
  it('server imports randomBytes for CSRF token generation', () => {
    const src = readSrc('server.js');
    assert.ok(src.includes("import { randomBytes } from 'crypto'"),
      'Must import randomBytes from crypto');
  });

  it('server sets _csrf cookie via onRequest hook', () => {
    const src = readSrc('server.js');
    assert.ok(src.includes("request.cookies._csrf"),
      'Must check for existing _csrf cookie');
    assert.ok(src.includes("randomBytes(32).toString('hex')"),
      'Must generate random CSRF token');
    assert.ok(src.includes("setCookie('_csrf'"),
      'Must set _csrf cookie');
  });

  it('server validates CSRF token on state-changing requests', () => {
    const src = readSrc('server.js');
    assert.ok(src.includes("cookieToken !== bodyToken"),
      'Must compare cookie token with body token');
    assert.ok(src.includes("code(403)"),
      'Must return 403 for invalid CSRF');
  });

  it('server skips CSRF for GET/HEAD/OPTIONS and /api/ routes', () => {
    const src = readSrc('server.js');
    assert.ok(src.includes("['GET', 'HEAD', 'OPTIONS'].includes(method)"),
      'Must skip CSRF check for safe HTTP methods');
    assert.ok(src.includes("request.url.startsWith('/api/')"),
      'Must skip CSRF check for API routes');
  });

  it('server provides validateCsrf decorator for multipart routes', () => {
    const src = readSrc('server.js');
    assert.ok(src.includes("app.decorate('validateCsrf'"),
      'Must provide validateCsrf decorator');
  });

  it('listing creation validates CSRF for multipart forms', () => {
    const src = readSrc('routes/listings.js');
    assert.ok(src.includes('validateCsrf(request, _csrf)'),
      'POST /listings/new must validate CSRF for multipart');
  });

  it('KYC upload validates CSRF for multipart forms', () => {
    const src = readSrc('routes/profile.js');
    assert.ok(src.includes('validateCsrf(request, _csrf)'),
      'POST /profile/verify must validate CSRF for multipart');
  });

  it('csrfToken is injected into view context', () => {
    const src = readSrc('server.js');
    assert.ok(src.includes('csrfToken'),
      'Must inject csrfToken into view locals');
  });

  it('footer auto-injects _csrf hidden input into POST forms', () => {
    const footer = fs.readFileSync(path.join(APP_SRC, 'views', 'partials', 'footer.ejs'), 'utf-8');
    assert.ok(footer.includes("input.name = '_csrf'"),
      'Footer must auto-inject _csrf hidden input');
    assert.ok(footer.includes('csrfToken'),
      'Footer must reference csrfToken variable');
  });
});

// ═══════════════════════════════════════════════════════
// 19. COMPRESSION
// ═══════════════════════════════════════════════════════
describe('Compression', () => {
  it('server registers @fastify/compress', () => {
    const src = readSrc('server.js');
    assert.ok(src.includes("import fastifyCompress from '@fastify/compress'"),
      'Must import @fastify/compress');
    assert.ok(src.includes('fastifyCompress'),
      'Must register compression plugin');
  });

  it('@fastify/compress is in package.json dependencies', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(APP_SRC, '..', 'package.json'), 'utf-8'));
    assert.ok(pkg.dependencies['@fastify/compress'],
      '@fastify/compress must be in dependencies');
  });
});

// ═══════════════════════════════════════════════════════
// 20. ENVIRONMENT VARIABLE VALIDATION
// ═══════════════════════════════════════════════════════
describe('Environment Variable Validation', () => {
  it('server validates required env vars in production', () => {
    const src = readSrc('server.js');
    assert.ok(src.includes("IS_PROD") && src.includes("process.exit(1)"),
      'Must fail fast if required env vars are missing in production');
    assert.ok(src.includes('DATABASE_URL') && src.includes('JWT_SECRET') && src.includes('COOKIE_SECRET'),
      'Must check for DATABASE_URL, JWT_SECRET, and COOKIE_SECRET');
  });

  it('server rejects default "change-me" secrets in production', () => {
    const src = readSrc('server.js');
    assert.ok(src.includes("'change-me'"),
      'Must reject default "change-me" secrets');
  });
});

// ═══════════════════════════════════════════════════════
// 21. OPEN GRAPH META TAGS
// ═══════════════════════════════════════════════════════
describe('Open Graph Meta Tags', () => {
  it('header partial includes og:title and og:description', () => {
    const header = fs.readFileSync(path.join(APP_SRC, 'views', 'partials', 'header.ejs'), 'utf-8');
    assert.ok(header.includes('og:title'),
      'Header must include og:title meta tag');
    assert.ok(header.includes('og:description'),
      'Header must include og:description meta tag');
    assert.ok(header.includes('og:site_name'),
      'Header must include og:site_name meta tag');
    assert.ok(header.includes('twitter:card'),
      'Header must include twitter:card meta tag');
  });
});

// ═══════════════════════════════════════════════════════
// 22. ACCESSIBILITY
// ═══════════════════════════════════════════════════════
describe('Accessibility', () => {
  it('nav has role and aria-label', () => {
    const header = fs.readFileSync(path.join(APP_SRC, 'views', 'partials', 'header.ejs'), 'utf-8');
    assert.ok(header.includes('role="navigation"'),
      'Nav must have role="navigation"');
    assert.ok(header.includes('aria-label="Main navigation"'),
      'Nav must have aria-label');
  });

  it('main element has role attribute', () => {
    const header = fs.readFileSync(path.join(APP_SRC, 'views', 'partials', 'header.ejs'), 'utf-8');
    assert.ok(header.includes('role="main"'),
      'Main element must have role="main"');
  });

  it('footer has role attribute', () => {
    const footer = fs.readFileSync(path.join(APP_SRC, 'views', 'partials', 'footer.ejs'), 'utf-8');
    assert.ok(footer.includes('role="contentinfo"'),
      'Footer must have role="contentinfo"');
  });

  it('sr-only CSS class is defined', () => {
    const header = fs.readFileSync(path.join(APP_SRC, 'views', 'partials', 'header.ejs'), 'utf-8');
    assert.ok(header.includes('.sr-only'),
      'Must define .sr-only CSS class');
  });

  it('auth forms have aria-required on required inputs', () => {
    const login = fs.readFileSync(path.join(APP_SRC, 'views', 'auth', 'login.ejs'), 'utf-8');
    const register = fs.readFileSync(path.join(APP_SRC, 'views', 'auth', 'register.ejs'), 'utf-8');
    assert.ok(login.includes('aria-required="true"'),
      'Login form inputs must have aria-required');
    assert.ok(register.includes('aria-required="true"'),
      'Register form inputs must have aria-required');
  });

  it('chat message input has aria-label', () => {
    const chat = fs.readFileSync(path.join(APP_SRC, 'views', 'messages', 'chat.ejs'), 'utf-8');
    assert.ok(chat.includes('aria-label='),
      'Chat input must have aria-label');
  });
});

// ═══════════════════════════════════════════════════════
// 23. IMAGE ALT TEXT AND LAZY LOADING
// ═══════════════════════════════════════════════════════
describe('Image Alt Text and Lazy Loading', () => {
  it('offer listing images have descriptive alt text', () => {
    const offers = fs.readFileSync(path.join(APP_SRC, 'views', 'offers', 'list.ejs'), 'utf-8');
    // Should not have empty alt=""
    const emptyAlts = offers.match(/alt=""\s/g) || [];
    assert.equal(emptyAlts.length, 0,
      'Offer images must not have empty alt attributes');
  });

  it('gallery overlay image has alt text', () => {
    const detail = fs.readFileSync(path.join(APP_SRC, 'views', 'listings', 'detail.ejs'), 'utf-8');
    assert.ok(!detail.includes('id="galleryImage" src="" alt=""'),
      'Gallery overlay image must have alt text');
  });

  it('below-fold images use loading="lazy"', () => {
    const list = fs.readFileSync(path.join(APP_SRC, 'views', 'listings', 'list.ejs'), 'utf-8');
    const lazyMatches = (list.match(/loading="lazy"/g) || []).length;
    assert.ok(lazyMatches > 0,
      'Listing grid images should use loading="lazy"');
  });
});
