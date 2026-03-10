import path from 'path';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import { scanContent } from '../utils/moderation.js';
import { calculateCommission } from '../utils/commission.js';
import { generateSlug } from '../utils/slug.js';

export default async function listingsRoutes(fastify) {
  const { db, config } = fastify;

  // Migration: add slug column
  await db.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS slug VARCHAR(255)`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_slug ON listings(slug) WHERE slug IS NOT NULL`);
  // Backfill slugs for existing listings without one
  const noSlug = await db.query('SELECT id, title FROM listings WHERE slug IS NULL');
  for (const row of noSlug.rows) {
    const slug = generateSlug(row.title);
    await db.query('UPDATE listings SET slug = $1 WHERE id = $2', [slug, row.id]);
  }

  // Helper: require auth
  const requireAuth = async (request, reply) => {
    if (!request.user) {
      return reply.redirect('/auth/login');
    }
  };

  // Helper: check if user is KYC verified
  const isKycVerified = async (userId) => {
    const result = await db.query('SELECT kyc_verified FROM users WHERE id = $1', [userId]);
    return result.rows.length > 0 && result.rows[0].kyc_verified === true;
  };

  // Helper: finalize ended auctions lazily
  const finalizeAuction = async (listing) => {
    if (listing.listing_mode !== 'auction') return listing;
    if (!listing.auction_end) return listing;
    if (new Date(listing.auction_end) > new Date()) return listing;
    if (listing.status !== 'active') return listing;

    // Auction has ended - check for bids
    const topBid = await db.query(
      'SELECT b.*, u.username as bidder_name FROM bids b JOIN users u ON b.bidder_id = u.id WHERE b.listing_id = $1 ORDER BY b.amount DESC LIMIT 1',
      [listing.id]
    );

    if (topBid.rows.length > 0) {
      const bid = topBid.rows[0];
      // Create an accepted offer for the winner
      const offerResult = await db.query(
        `INSERT INTO offers (listing_id, buyer_id, type, cash_amount, message, status)
         VALUES ($1, $2, 'cash', $3, $4, 'accepted') RETURNING id`,
        [listing.id, bid.bidder_id, bid.amount, `Auction won with bid of CHF ${parseFloat(bid.amount).toFixed(2)}`]
      );

      // Mark listing as sold
      await db.query("UPDATE listings SET status = 'sold', updated_at = NOW() WHERE id = $1", [listing.id]);
      listing.status = 'sold';
      listing._auction_winner = bid;
      listing._auction_offer_id = offerResult.rows[0].id;
    } else {
      // No bids - mark as expired
      await db.query("UPDATE listings SET status = 'expired', updated_at = NOW() WHERE id = $1", [listing.id]);
      listing.status = 'expired';
    }

    return listing;
  };

  // GET /listings - Browse with filters
  fastify.get('/', async (request, reply) => {
    const { category, min_price, max_price, type, mode, q, search, sort, page = 1 } = request.query;
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
      where.push(`COALESCE(l.price, l.starting_price, 0) >= $${idx}`);
      params.push(parseFloat(min_price));
      idx++;
    }
    if (max_price) {
      where.push(`COALESCE(l.price, l.starting_price, 0) <= $${idx}`);
      params.push(parseFloat(max_price));
      idx++;
    }
    if (type && ['sell', 'swap', 'both'].includes(type)) {
      where.push(`l.type = $${idx}`);
      params.push(type);
      idx++;
    }
    if (mode && ['fixed', 'auction'].includes(mode)) {
      where.push(`l.listing_mode = $${idx}`);
      params.push(mode);
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
      orderClause = 'COALESCE(l.price, l.starting_price) ASC NULLS LAST';
    } else if (sort === 'price_desc') {
      orderClause = 'COALESCE(l.price, l.starting_price) DESC NULLS LAST';
    } else if (sort === 'oldest') {
      orderClause = 'l.created_at ASC';
    } else if (sort === 'ending_soon') {
      orderClause = 'l.auction_end ASC NULLS LAST';
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
         (SELECT file_path FROM listing_images WHERE listing_id = l.id ORDER BY position LIMIT 1) as image,
         (SELECT COUNT(*) FROM bids WHERE listing_id = l.id) as bid_count,
         (SELECT MAX(amount) FROM bids WHERE listing_id = l.id) as current_bid
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
        filters: { category, min_price, max_price, type, mode, q: searchTerm, sort },
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
    const kycVerified = await isKycVerified(request.user.id);
    return reply.view('listings/new.ejs', {
      user: request.user,
      categories: catResult.rows,
      kycVerified,
      error: null,
    });
  });

  // POST /listings/new - Create listing
  fastify.post('/new', { preHandler: requireAuth }, async (request, reply) => {
    if (fastify.checkActionRateLimit && !fastify.checkActionRateLimit(request, reply, 'listing')) return;
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

      const { title, description, price, category_id, condition, location, type,
              listing_mode, starting_price, buy_now_price, auction_duration, min_bid_increment, _csrf } = fields;

      // CSRF validation for multipart form
      if (!fastify.validateCsrf(request, _csrf)) {
        return reply.code(403).send('Invalid or missing CSRF token.');
      }

      const kycVerified = await isKycVerified(request.user.id);
      const catResult = await db.query('SELECT * FROM categories ORDER BY name');

      // Input length limits
      if (title && title.length > 255) {
        return reply.view('listings/new.ejs', {
          user: request.user, categories: catResult.rows, kycVerified,
          error: 'Title is too long (max 255 characters).',
        });
      }
      if (description && description.length > 10000) {
        return reply.view('listings/new.ejs', {
          user: request.user, categories: catResult.rows, kycVerified,
          error: 'Description is too long (max 10,000 characters).',
        });
      }

      if (files.length === 0) {
        return reply.view('listings/new.ejs', {
          user: request.user, categories: catResult.rows, kycVerified,
          error: 'At least 1 photo is required.',
        });
      }
      if (files.length > 5) {
        return reply.view('listings/new.ejs', {
          user: request.user, categories: catResult.rows, kycVerified,
          error: 'Maximum 5 photos allowed.',
        });
      }

      if (!title || !category_id || !condition || !type) {
        return reply.view('listings/new.ejs', {
          user: request.user, categories: catResult.rows, kycVerified,
          error: 'Title, category, condition, and listing type are required.',
        });
      }

      const isAuction = listing_mode === 'auction';

      // KYC restriction: listings above CHF 500 require KYC
      const listingPrice = isAuction ? parseFloat(starting_price || 0) : parseFloat(price || 0);
      if (listingPrice > 500 && !kycVerified) {
        return reply.view('listings/new.ejs', {
          user: request.user, categories: catResult.rows, kycVerified,
          error: 'Identity verification (KYC) is required to create listings above CHF 500. Please verify your identity first.',
        });
      }

      // KYC restriction: auctions require KYC
      if (isAuction && !kycVerified) {
        return reply.view('listings/new.ejs', {
          user: request.user, categories: catResult.rows, kycVerified,
          error: 'Identity verification (KYC) is required to create auction listings. Please verify your identity first.',
        });
      }

      // Auction validation
      if (isAuction) {
        if (!starting_price || parseFloat(starting_price) < 0) {
          return reply.view('listings/new.ejs', {
            user: request.user, categories: catResult.rows, kycVerified,
            error: 'Starting price is required for auctions.',
          });
        }
        if (!auction_duration || !['3', '5', '7', '10'].includes(auction_duration)) {
          return reply.view('listings/new.ejs', {
            user: request.user, categories: catResult.rows, kycVerified,
            error: 'Please select a valid auction duration.',
          });
        }
      }

      // Content moderation
      const moderationResult = scanContent((title || '') + ' ' + (description || ''));
      const hasPhone = moderationResult.flags.some(f => f.type === 'auto_phone');
      const listingStatus = hasPhone ? 'blocked' : 'active';

      // Calculate auction end time
      let auctionEnd = null;
      if (isAuction && auction_duration) {
        auctionEnd = new Date();
        auctionEnd.setDate(auctionEnd.getDate() + parseInt(auction_duration));
      }

      const slug = generateSlug(title);

      const result = await db.query(
        `INSERT INTO listings (seller_id, title, description, price, category_id, condition, location, type, status,
         listing_mode, starting_price, buy_now_price, auction_end, min_bid_increment, slug)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id, slug`,
        [
          request.user.id, title, description || null,
          isAuction ? null : (price ? parseFloat(price) : null),
          parseInt(category_id), condition, location || null, type, listingStatus,
          isAuction ? 'auction' : 'fixed',
          isAuction ? parseFloat(starting_price) : null,
          (isAuction && buy_now_price) ? parseFloat(buy_now_price) : null,
          auctionEnd,
          (isAuction && min_bid_increment) ? parseFloat(min_bid_increment) : 1.00,
          slug,
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
        return reply.view('listings/new.ejs', {
          user: request.user, categories: catResult.rows, kycVerified,
          error: 'Listing blocked: phone numbers are not allowed in listings. Contact info is exchanged after a completed transaction.',
        });
      }

      return reply.redirect(`/listings/${result.rows[0].slug}`);
    } catch (err) {
      fastify.log.error(err);
      const catResult = await db.query('SELECT * FROM categories ORDER BY name');
      const kycVerified = await isKycVerified(request.user.id);
      return reply.view('listings/new.ejs', {
        user: request.user, categories: catResult.rows, kycVerified,
        error: 'Failed to create listing. Please try again.',
      });
    }
  });

  // GET /listings/:slug - Detail (lookup by slug or legacy numeric ID)
  fastify.get('/:slug', async (request, reply) => {
    const { slug } = request.params;

    try {
      // Support both slug and legacy numeric ID lookups
      const isNumericId = /^\d+$/.test(slug);
      const listingResult = await db.query(
        `SELECT l.*, u.username as seller_name, u.id as seller_user_id, u.reputation_score, u.avatar_path, u.location as seller_location,
         c.name as category_name, c.slug as category_slug
         FROM listings l
         JOIN users u ON l.seller_id = u.id
         JOIN categories c ON l.category_id = c.id
         WHERE ${isNumericId ? 'l.id = $1' : 'l.slug = $1'}`,
        [isNumericId ? parseInt(slug) : slug]
      );

      // If accessed by numeric ID and listing has a slug, redirect to slug URL
      if (isNumericId && listingResult.rows.length > 0 && listingResult.rows[0].slug) {
        return reply.redirect(`/listings/${listingResult.rows[0].slug}`, 301);
      }

      if (listingResult.rows.length === 0) {
        return reply.code(404).view('index.ejs', { user: request.user, categories: [], featured: [] });
      }

      let listing = listingResult.rows[0];

      // Track view
      try {
        const viewerId = request.user ? request.user.id : null;
        const ip = request.ip;
        await db.query(
          'INSERT INTO listing_views (listing_id, viewer_id, ip_address) VALUES ($1, $2, $3)',
          [listing.id, viewerId, ip]
        );
      } catch { /* table may not exist yet, or insert fails - non-critical */ }

      // Track recently viewed for logged-in users
      if (request.user) {
        try {
          await db.query(
            `INSERT INTO recently_viewed (user_id, listing_id, viewed_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (user_id, listing_id) DO UPDATE SET viewed_at = NOW()`,
            [request.user.id, listing.id]
          );
          // Keep only last 20 per user
          await db.query(
            `DELETE FROM recently_viewed WHERE user_id = $1 AND id NOT IN (
              SELECT id FROM recently_viewed WHERE user_id = $1 ORDER BY viewed_at DESC LIMIT 20
            )`,
            [request.user.id]
          );
        } catch { /* non-critical */ }
      }

      // Lazy-finalize ended auctions
      listing = await finalizeAuction(listing);

      // Parallel queries for images, similar listings, bids, and user listings
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
        // Get bids for auction listings
        db.query(
          `SELECT b.*, u.username as bidder_name FROM bids b
           JOIN users u ON b.bidder_id = u.id
           WHERE b.listing_id = $1
           ORDER BY b.amount DESC`,
          [listing.id]
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
      const bidsResult = results[2];
      const userListings = results[3] ? results[3].rows : [];

      // Check KYC status for current user
      let kycVerified = false;
      if (request.user) {
        kycVerified = await isKycVerified(request.user.id);
      }

      // Check if user has favorited this listing
      let isFavorited = false;
      let favoriteCount = 0;
      try {
        const favCountResult = await db.query('SELECT COUNT(*) FROM user_favorites WHERE listing_id = $1', [listing.id]);
        favoriteCount = parseInt(favCountResult.rows[0].count);
        if (request.user) {
          const favCheck = await db.query(
            'SELECT id FROM user_favorites WHERE user_id = $1 AND listing_id = $2',
            [request.user.id, listing.id]
          );
          isFavorited = favCheck.rows.length > 0;
        }
      } catch { /* table may not exist */ }

      // Get seller rating info
      let sellerRating = { avg: 0, count: 0, trustBadge: null };
      try {
        const ratingResult = await db.query(
          `SELECT AVG(rating)::numeric(3,2) as avg_rating, COUNT(*) as review_count
           FROM seller_reviews WHERE seller_id = $1`,
          [listing.seller_user_id]
        );
        const avg = parseFloat(ratingResult.rows[0].avg_rating) || 0;
        const count = parseInt(ratingResult.rows[0].review_count);
        let trustBadge = null;
        if (count >= 50 && avg >= 4.5) trustBadge = 'gold';
        else if (count >= 20 && avg >= 4.0) trustBadge = 'silver';
        else if (count >= 5) trustBadge = 'bronze';
        sellerRating = { avg, count, trustBadge };
      } catch { /* table may not exist */ }

      // Check for offer feedback from query params
      const offerStatus = request.query.offer;
      let success = null;
      if (offerStatus === 'sent') success = 'Your offer has been sent to the seller!';
      if (offerStatus === 'reported') success = 'Listing has been reported. Thank you for helping keep SwapMart safe.';
      if (offerStatus === 'already_reported') success = 'You have already reported this listing.';
      if (offerStatus === 'bid_placed') success = 'Your bid has been placed successfully!';
      if (offerStatus === 'buy_now') success = 'Buy Now offer sent to the seller!';
      const error = offerStatus === 'error' ? 'Failed to send offer. Please try again.'
        : offerStatus === 'kyc_required' ? 'Identity verification (KYC) is required for this action. Please verify your identity first.'
        : offerStatus === 'bid_too_low' ? 'Your bid must be higher than the current bid plus the minimum increment.'
        : offerStatus === 'auction_ended' ? 'This auction has ended.'
        : null;

      return reply.view('listings/detail.ejs', {
        user: request.user,
        listing,
        images: imagesResult.rows,
        similar: similarResult.rows,
        bids: bidsResult.rows,
        userListings,
        kycVerified,
        isFavorited,
        favoriteCount,
        sellerRating,
        error,
        success,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/listings');
    }
  });

  // POST /listings/:id/bid - Place a bid
  fastify.post('/:id/bid', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params;
    const { bid_amount } = request.body;

    try {
      // Get listing with slug for redirects
      const listingResult = await db.query(
        "SELECT * FROM listings WHERE id = $1 AND listing_mode = 'auction' AND status = 'active'",
        [parseInt(id)]
      );
      const slug = listingResult.rows[0]?.slug || id;

      // Check KYC
      const kycOk = await isKycVerified(request.user.id);
      if (!kycOk) {
        return reply.redirect(`/listings/${slug}?offer=kyc_required`);
      }

      if (listingResult.rows.length === 0) {
        return reply.redirect(`/listings/${slug}?offer=auction_ended`);
      }

      const listing = listingResult.rows[0];

      if (new Date(listing.auction_end) <= new Date()) {
        return reply.redirect(`/listings/${slug}?offer=auction_ended`);
      }

      if (listing.seller_id === request.user.id) {
        return reply.redirect(`/listings/${slug}`);
      }

      const amount = parseFloat(bid_amount);

      const topBid = await db.query(
        'SELECT MAX(amount) as max_bid FROM bids WHERE listing_id = $1',
        [parseInt(id)]
      );
      const currentMax = topBid.rows[0].max_bid ? parseFloat(topBid.rows[0].max_bid) : parseFloat(listing.starting_price);
      const minRequired = topBid.rows[0].max_bid
        ? currentMax + parseFloat(listing.min_bid_increment)
        : parseFloat(listing.starting_price);

      if (amount < minRequired) {
        return reply.redirect(`/listings/${slug}?offer=bid_too_low`);
      }

      await db.query(
        'INSERT INTO bids (listing_id, bidder_id, amount) VALUES ($1, $2, $3)',
        [parseInt(id), request.user.id, amount]
      );

      return reply.redirect(`/listings/${slug}?offer=bid_placed`);
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect(`/listings/${id}?offer=error`);
    }
  });

  // POST /listings/:id/buy-now - Buy now at auction price
  fastify.post('/:id/buy-now', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params;

    try {
      const listingResult = await db.query(
        "SELECT * FROM listings WHERE id = $1 AND listing_mode = 'auction' AND status = 'active' AND buy_now_price IS NOT NULL",
        [parseInt(id)]
      );
      const slug = listingResult.rows[0]?.slug || id;

      const kycOk = await isKycVerified(request.user.id);
      if (!kycOk) {
        return reply.redirect(`/listings/${slug}?offer=kyc_required`);
      }

      if (listingResult.rows.length === 0) {
        return reply.redirect(`/listings/${slug}?offer=error`);
      }

      const listing = listingResult.rows[0];

      if (new Date(listing.auction_end) <= new Date()) {
        return reply.redirect(`/listings/${slug}?offer=auction_ended`);
      }

      if (listing.seller_id === request.user.id) {
        return reply.redirect(`/listings/${slug}`);
      }

      await db.query(
        `INSERT INTO offers (listing_id, buyer_id, type, cash_amount, message, status)
         VALUES ($1, $2, 'cash', $3, 'Buy Now purchase', 'accepted')`,
        [parseInt(id), request.user.id, listing.buy_now_price]
      );

      await db.query("UPDATE listings SET status = 'sold', updated_at = NOW() WHERE id = $1", [parseInt(id)]);

      return reply.redirect(`/listings/${slug}?offer=buy_now`);
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect(`/listings/${id}?offer=error`);
    }
  });

  // POST /listings/:id/report - Report a listing
  fastify.post('/:id/report', { preHandler: requireAuth }, async (request, reply) => {
    if (fastify.checkActionRateLimit && !fastify.checkActionRateLimit(request, reply, 'listing')) return;
    const { id } = request.params;
    const { reason } = request.body;

    try {
      const listingResult = await db.query('SELECT * FROM listings WHERE id = $1', [parseInt(id)]);
      if (listingResult.rows.length === 0) {
        return reply.redirect('/listings');
      }

      const listing = listingResult.rows[0];
      const slug = listing.slug || id;

      if (listing.seller_id === request.user.id) {
        return reply.redirect(`/listings/${slug}`);
      }

      const existingFlag = await db.query(
        "SELECT id FROM flags WHERE listing_id = $1 AND user_id = $2 AND type = 'user_report' AND status = 'pending'",
        [parseInt(id), request.user.id]
      );

      if (existingFlag.rows.length > 0) {
        return reply.redirect(`/listings/${slug}?offer=already_reported`);
      }

      await db.query(
        "INSERT INTO flags (type, listing_id, user_id, details) VALUES ('user_report', $1, $2, $3)",
        [parseInt(id), request.user.id, reason || 'No reason provided']
      );

      return reply.redirect(`/listings/${slug}?offer=reported`);
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect(`/listings/${id}`);
    }
  });

  // POST /listings/:id/offer - Make an offer
  fastify.post('/:id/offer', { preHandler: requireAuth }, async (request, reply) => {
    if (fastify.checkActionRateLimit && !fastify.checkActionRateLimit(request, reply, 'listing')) return;
    const { id } = request.params;
    const { offer_type, cash_amount, swap_listing_id, message } = request.body;

    try {
      const listingResult = await db.query('SELECT * FROM listings WHERE id = $1', [parseInt(id)]);
      if (listingResult.rows.length === 0) {
        return reply.redirect('/listings');
      }

      const listing = listingResult.rows[0];
      const slug = listing.slug || id;

      if (listing.seller_id === request.user.id) {
        return reply.redirect(`/listings/${slug}`);
      }

      // Input length validation for offer message
      if (message && message.length > 2000) {
        return reply.redirect(`/listings/${slug}?offer=error`);
      }

      const offerAmount = cash_amount ? parseFloat(cash_amount) : 0;
      if (offerAmount > 50) {
        const kycOk = await isKycVerified(request.user.id);
        if (!kycOk) {
          return reply.redirect(`/listings/${slug}?offer=kyc_required`);
        }
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

      return reply.redirect(`/listings/${slug}?offer=sent`);
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect(`/listings/${id}?offer=error`);
    }
  });
}
