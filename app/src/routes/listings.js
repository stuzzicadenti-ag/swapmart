import path from 'path';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import { scanContent } from '../utils/moderation.js';

export default async function listingsRoutes(fastify) {
  const { db, config } = fastify;

  // Helper: require auth
  const requireAuth = async (request, reply) => {
    if (!request.user) {
      return reply.redirect('/auth/login');
    }
  };

  // GET /listings - Browse with filters
  fastify.get('/', async (request, reply) => {
    const { category, min_price, max_price, type, q, search, sort, page = 1 } = request.query;
    // Support both ?q= and ?search= for text search
    const searchTerm = q || search || '';
    const limit = 12;
    const offset = (Math.max(1, parseInt(page)) - 1) * limit;

    let where = ['l.status = $1'];
    let params = ['active'];
    let idx = 2;

    if (category) {
      where.push(`c.slug = $${idx}`);
      params.push(category);
      idx++;
    }
    if (min_price) {
      where.push(`l.price >= $${idx}`);
      params.push(parseFloat(min_price));
      idx++;
    }
    if (max_price) {
      where.push(`l.price <= $${idx}`);
      params.push(parseFloat(max_price));
      idx++;
    }
    if (type && ['sell', 'swap', 'both'].includes(type)) {
      where.push(`l.type = $${idx}`);
      params.push(type);
      idx++;
    }
    if (searchTerm) {
      where.push(`(l.title ILIKE $${idx} OR l.description ILIKE $${idx})`);
      params.push(`%${searchTerm}%`);
      idx++;
    }

    const whereClause = where.join(' AND ');

    // Determine sort order
    let orderClause = 'l.created_at DESC'; // default: newest
    if (sort === 'price_asc') {
      orderClause = 'l.price ASC NULLS LAST';
    } else if (sort === 'price_desc') {
      orderClause = 'l.price DESC NULLS LAST';
    } else if (sort === 'oldest') {
      orderClause = 'l.created_at ASC';
    }

    try {
      const countResult = await db.query(
        `SELECT COUNT(*) FROM listings l JOIN categories c ON l.category_id = c.id WHERE ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].count);
      const totalPages = Math.ceil(total / limit);

      const listingsResult = await db.query(
        `SELECT l.*, u.username as seller_name, c.name as category_name, c.slug as category_slug,
         (SELECT file_path FROM listing_images WHERE listing_id = l.id ORDER BY position LIMIT 1) as image
         FROM listings l
         JOIN users u ON l.seller_id = u.id
         JOIN categories c ON l.category_id = c.id
         WHERE ${whereClause}
         ORDER BY ${orderClause}
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      );

      const catResult = await db.query('SELECT * FROM categories WHERE parent_id IS NULL ORDER BY name');

      return reply.view('listings/list.ejs', {
        user: request.user,
        listings: listingsResult.rows,
        categories: catResult.rows,
        filters: { category, min_price, max_price, type, q: searchTerm, sort },
        pagination: { page: parseInt(page), totalPages, total },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.view('listings/list.ejs', {
        user: request.user,
        listings: [],
        categories: [],
        filters: {},
        pagination: { page: 1, totalPages: 0, total: 0 },
      });
    }
  });

  // GET /listings/new - Create form
  fastify.get('/new', { preHandler: requireAuth }, async (request, reply) => {
    const catResult = await db.query('SELECT * FROM categories ORDER BY name');
    return reply.view('listings/new.ejs', {
      user: request.user,
      categories: catResult.rows,
      error: null,
    });
  });

  // POST /listings/new - Create listing
  fastify.post('/new', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const parts = request.parts();
      const fields = {};
      const files = [];

      for await (const part of parts) {
        if (part.type === 'file' && part.filename) {
          const ext = path.extname(part.filename).toLowerCase();
          const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
          if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue;
          if (!ALLOWED_MIMES.includes(part.mimetype)) continue;

          const filename = `${randomUUID()}${ext}`;
          const uploadDir = config.UPLOAD_DIR;
          await fs.mkdir(uploadDir, { recursive: true });
          const filepath = path.join(uploadDir, filename);

          // Import sharp dynamically to handle cases where it might not be available
          try {
            const sharp = (await import('sharp')).default;
            const buffer = await part.toBuffer();
            await sharp(buffer)
              .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 85 })
              .toFile(filepath);
          } catch {
            // Fallback: save raw file
            const buffer = await part.toBuffer();
            await fs.writeFile(filepath, buffer);
          }

          files.push(filename);
        } else {
          fields[part.fieldname] = part.value;
        }
      }

      const { title, description, price, category_id, condition, location, type } = fields;

      // Input length limits
      if (title && title.length > 255) {
        const catResult = await db.query('SELECT * FROM categories ORDER BY name');
        return reply.view('listings/new.ejs', {
          user: request.user,
          categories: catResult.rows,
          error: 'Title is too long (max 255 characters).',
        });
      }
      if (description && description.length > 10000) {
        const catResult = await db.query('SELECT * FROM categories ORDER BY name');
        return reply.view('listings/new.ejs', {
          user: request.user,
          categories: catResult.rows,
          error: 'Description is too long (max 10,000 characters).',
        });
      }

      if (files.length === 0) {
        const catResult = await db.query('SELECT * FROM categories ORDER BY name');
        return reply.view('listings/new.ejs', {
          user: request.user,
          categories: catResult.rows,
          error: 'At least 1 photo is required.',
        });
      }
      if (files.length > 5) {
        const catResult = await db.query('SELECT * FROM categories ORDER BY name');
        return reply.view('listings/new.ejs', {
          user: request.user,
          categories: catResult.rows,
          error: 'Maximum 5 photos allowed.',
        });
      }

      if (!title || !category_id || !condition || !type) {
        const catResult = await db.query('SELECT * FROM categories ORDER BY name');
        return reply.view('listings/new.ejs', {
          user: request.user,
          categories: catResult.rows,
          error: 'Title, category, condition, and listing type are required.',
        });
      }

      // Content moderation
      const moderationResult = scanContent((title || '') + ' ' + (description || ''));
      const hasPhone = moderationResult.flags.some(f => f.type === 'auto_phone');
      const listingStatus = hasPhone ? 'blocked' : 'active';

      const result = await db.query(
        `INSERT INTO listings (seller_id, title, description, price, category_id, condition, location, type, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          request.user.id, title, description || null,
          price ? parseFloat(price) : null, parseInt(category_id),
          condition, location || null, type, listingStatus,
        ]
      );

      const listingId = result.rows[0].id;

      // Save images (batch insert)
      if (files.length > 0) {
        const values = [];
        const params = [];
        for (let i = 0; i < files.length; i++) {
          const offset = i * 3;
          values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
          params.push(listingId, files[i], i);
        }
        await db.query(
          `INSERT INTO listing_images (listing_id, file_path, position) VALUES ${values.join(', ')}`,
          params
        );
      }

      // Create flags if moderation found issues
      if (moderationResult.flags.length > 0) {
        for (const flag of moderationResult.flags) {
          await db.query(
            'INSERT INTO flags (type, listing_id, user_id, details) VALUES ($1, $2, $3, $4)',
            [flag.type, listingId, request.user.id, flag.detail]
          );
        }
      }

      // If phone detected, block and show error
      if (hasPhone) {
        const catResult = await db.query('SELECT * FROM categories ORDER BY name');
        return reply.view('listings/new.ejs', {
          user: request.user,
          categories: catResult.rows,
          error: 'Listing blocked: phone numbers are not allowed in listings. Contact info is exchanged after a completed transaction.',
        });
      }

      return reply.redirect(`/listings/${listingId}`);
    } catch (err) {
      fastify.log.error(err);
      const catResult = await db.query('SELECT * FROM categories ORDER BY name');
      return reply.view('listings/new.ejs', {
        user: request.user,
        categories: catResult.rows,
        error: 'Failed to create listing. Please try again.',
      });
    }
  });

  // GET /listings/:id - Detail
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params;

    try {
      const listingResult = await db.query(
        `SELECT l.*, u.username as seller_name, u.id as seller_user_id, u.reputation_score, u.avatar_path, u.location as seller_location,
         c.name as category_name, c.slug as category_slug
         FROM listings l
         JOIN users u ON l.seller_id = u.id
         JOIN categories c ON l.category_id = c.id
         WHERE l.id = $1`,
        [parseInt(id)]
      );

      if (listingResult.rows.length === 0) {
        return reply.code(404).view('index.ejs', { user: request.user, categories: [], featured: [] });
      }

      const listing = listingResult.rows[0];

      // Parallel queries for images, similar listings, and user listings
      const parallelQueries = [
        db.query(
          'SELECT * FROM listing_images WHERE listing_id = $1 ORDER BY position',
          [listing.id]
        ),
        db.query(
          `SELECT l.*, u.username as seller_name,
           (SELECT file_path FROM listing_images WHERE listing_id = l.id ORDER BY position LIMIT 1) as image
           FROM listings l
           JOIN users u ON l.seller_id = u.id
           WHERE l.category_id = $1 AND l.id != $2 AND l.status = 'active'
           ORDER BY l.created_at DESC LIMIT 4`,
          [listing.category_id, listing.id]
        ),
      ];

      if (request.user) {
        parallelQueries.push(
          db.query(
            "SELECT id, title FROM listings WHERE seller_id = $1 AND status = 'active' AND id != $2 LIMIT 50",
            [request.user.id, listing.id]
          )
        );
      }

      const results = await Promise.all(parallelQueries);
      const imagesResult = results[0];
      const similarResult = results[1];
      const userListings = results[2] ? results[2].rows : [];

      // Check for offer feedback from query params
      const offerStatus = request.query.offer;
      let success = null;
      if (offerStatus === 'sent') success = 'Your offer has been sent to the seller!';
      if (offerStatus === 'reported') success = 'Listing has been reported. Thank you for helping keep SwapMart safe.';
      if (offerStatus === 'already_reported') success = 'You have already reported this listing.';
      const error = offerStatus === 'error' ? 'Failed to send offer. Please try again.' : null;

      return reply.view('listings/detail.ejs', {
        user: request.user,
        listing,
        images: imagesResult.rows,
        similar: similarResult.rows,
        userListings,
        error,
        success,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/listings');
    }
  });

  // POST /listings/:id/report - Report a listing
  fastify.post('/:id/report', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params;
    const { reason } = request.body;

    try {
      // Verify listing exists and user is not the seller
      const listingResult = await db.query('SELECT * FROM listings WHERE id = $1', [parseInt(id)]);
      if (listingResult.rows.length === 0) {
        return reply.redirect('/listings');
      }

      const listing = listingResult.rows[0];
      if (listing.seller_id === request.user.id) {
        return reply.redirect(`/listings/${id}`);
      }

      // Check if user already reported this listing
      const existingFlag = await db.query(
        "SELECT id FROM flags WHERE listing_id = $1 AND user_id = $2 AND type = 'user_report' AND status = 'pending'",
        [parseInt(id), request.user.id]
      );

      if (existingFlag.rows.length > 0) {
        return reply.redirect(`/listings/${id}?offer=already_reported`);
      }

      await db.query(
        "INSERT INTO flags (type, listing_id, user_id, details) VALUES ('user_report', $1, $2, $3)",
        [parseInt(id), request.user.id, reason || 'No reason provided']
      );

      return reply.redirect(`/listings/${id}?offer=reported`);
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect(`/listings/${id}`);
    }
  });

  // POST /listings/:id/offer - Make an offer
  fastify.post('/:id/offer', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params;
    const { offer_type, cash_amount, swap_listing_id, message } = request.body;

    try {
      // Verify listing exists and user is not the seller
      const listingResult = await db.query('SELECT * FROM listings WHERE id = $1', [parseInt(id)]);
      if (listingResult.rows.length === 0) {
        return reply.redirect('/listings');
      }

      const listing = listingResult.rows[0];
      if (listing.seller_id === request.user.id) {
        return reply.redirect(`/listings/${id}`);
      }

      await db.query(
        `INSERT INTO offers (listing_id, buyer_id, type, cash_amount, swap_listing_id, message)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          parseInt(id), request.user.id, offer_type,
          cash_amount ? parseFloat(cash_amount) : null,
          swap_listing_id ? parseInt(swap_listing_id) : null,
          message || null,
        ]
      );

      return reply.redirect(`/listings/${id}?offer=sent`);
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect(`/listings/${id}?offer=error`);
    }
  });
}
