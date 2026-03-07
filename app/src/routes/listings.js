import path from 'path';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';

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
    const { category, min_price, max_price, type, q, page = 1 } = request.query;
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
    if (q) {
      where.push(`(l.title ILIKE $${idx} OR l.description ILIKE $${idx})`);
      params.push(`%${q}%`);
      idx++;
    }

    const whereClause = where.join(' AND ');

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
         ORDER BY l.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      );

      const catResult = await db.query('SELECT * FROM categories WHERE parent_id IS NULL ORDER BY name');

      return reply.view('listings/list.ejs', {
        user: request.user,
        listings: listingsResult.rows,
        categories: catResult.rows,
        filters: { category, min_price, max_price, type, q },
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
          if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue;

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

      if (!title || !category_id || !condition || !type) {
        const catResult = await db.query('SELECT * FROM categories ORDER BY name');
        return reply.view('listings/new.ejs', {
          user: request.user,
          categories: catResult.rows,
          error: 'Title, category, condition, and listing type are required.',
        });
      }

      const result = await db.query(
        `INSERT INTO listings (seller_id, title, description, price, category_id, condition, location, type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          request.user.id, title, description || null,
          price ? parseFloat(price) : null, parseInt(category_id),
          condition, location || null, type,
        ]
      );

      const listingId = result.rows[0].id;

      // Save images
      for (let i = 0; i < files.length; i++) {
        await db.query(
          'INSERT INTO listing_images (listing_id, file_path, position) VALUES ($1, $2, $3)',
          [listingId, files[i], i]
        );
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

      const imagesResult = await db.query(
        'SELECT * FROM listing_images WHERE listing_id = $1 ORDER BY position',
        [listing.id]
      );

      // Similar listings
      const similarResult = await db.query(
        `SELECT l.*, u.username as seller_name,
         (SELECT file_path FROM listing_images WHERE listing_id = l.id ORDER BY position LIMIT 1) as image
         FROM listings l
         JOIN users u ON l.seller_id = u.id
         WHERE l.category_id = $1 AND l.id != $2 AND l.status = 'active'
         ORDER BY l.created_at DESC LIMIT 4`,
        [listing.category_id, listing.id]
      );

      // User's listings for swap offers
      let userListings = [];
      if (request.user) {
        const userListingsResult = await db.query(
          "SELECT id, title FROM listings WHERE seller_id = $1 AND status = 'active' AND id != $2",
          [request.user.id, listing.id]
        );
        userListings = userListingsResult.rows;
      }

      return reply.view('listings/detail.ejs', {
        user: request.user,
        listing,
        images: imagesResult.rows,
        similar: similarResult.rows,
        userListings,
        error: null,
        success: null,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/listings');
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

      return reply.redirect(`/listings/${id}`);
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect(`/listings/${id}`);
    }
  });
}
