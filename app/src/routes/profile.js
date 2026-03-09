import path from 'path';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';

export default async function profileRoutes(fastify) {
  const { db, config } = fastify;

  const requireAuth = async (request, reply) => {
    if (!request.user) {
      return reply.redirect('/auth/login');
    }
  };

  // GET /profile/settings - Edit own profile
  fastify.get('/settings', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const result = await db.query(
        'SELECT id, email, username, name, bio, location, avatar_path, plan, kyc_status, phone, address_line1, address_line2, city, postal_code, country, created_at FROM users WHERE id = $1',
        [request.user.id]
      );

      if (result.rows.length === 0) {
        return reply.redirect('/auth/login');
      }

      return reply.view('profile/settings.ejs', {
        user: request.user,
        profile: result.rows[0],
        error: null,
        success: null,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/');
    }
  });

  // POST /profile/settings - Update profile
  fastify.post('/settings', { preHandler: requireAuth }, async (request, reply) => {
    const { name, bio, location, phone, address_line1, address_line2, city, postal_code, country } = request.body;

    // Input length limits
    if ((name && name.length > 255) || (bio && bio.length > 2000) || (location && location.length > 255) ||
        (phone && phone.length > 50) || (address_line1 && address_line1.length > 255) ||
        (address_line2 && address_line2.length > 255) || (city && city.length > 100) ||
        (postal_code && postal_code.length > 20) || (country && country.length > 100)) {
      const result = await db.query(
        'SELECT id, email, username, name, bio, location, avatar_path, plan, kyc_status, phone, address_line1, address_line2, city, postal_code, country, created_at FROM users WHERE id = $1',
        [request.user.id]
      );
      return reply.view('profile/settings.ejs', {
        user: request.user,
        profile: result.rows[0],
        error: 'Input too long.',
        success: null,
      });
    }

    try {
      await db.query(
        `UPDATE users SET name = $1, bio = $2, location = $3, phone = $4,
         address_line1 = $5, address_line2 = $6, city = $7, postal_code = $8, country = $9
         WHERE id = $10`,
        [name || null, bio || null, location || null, phone || null,
         address_line1 || null, address_line2 || null, city || null,
         postal_code || null, country || null, request.user.id]
      );

      const result = await db.query(
        'SELECT id, email, username, name, bio, location, avatar_path, plan, kyc_status, phone, address_line1, address_line2, city, postal_code, country, created_at FROM users WHERE id = $1',
        [request.user.id]
      );

      return reply.view('profile/settings.ejs', {
        user: request.user,
        profile: result.rows[0],
        error: null,
        success: 'Profile updated successfully.',
      });
    } catch (err) {
      fastify.log.error(err);
      const result = await db.query(
        'SELECT id, email, username, name, bio, location, avatar_path, plan, kyc_status, phone, address_line1, address_line2, city, postal_code, country, created_at FROM users WHERE id = $1',
        [request.user.id]
      );
      return reply.view('profile/settings.ejs', {
        user: request.user,
        profile: result.rows[0],
        error: 'Failed to update profile.',
        success: null,
      });
    }
  });

  // GET /profile/verify - KYC upload form
  fastify.get('/verify', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const result = await db.query(
        'SELECT id, kyc_status, kyc_document_type, kyc_verified, kyc_submitted_at, kyc_verified_at, kyc_rejected_reason FROM users WHERE id = $1',
        [request.user.id]
      );
      return reply.view('profile/verify.ejs', {
        user: request.user,
        profile: result.rows[0],
        error: null,
        success: null,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/profile/settings');
    }
  });

  // POST /profile/verify - Handle KYC document upload
  fastify.post('/verify', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const parts = request.parts();
      const fields = {};
      let documentFile = null;

      for await (const part of parts) {
        if (part.type === 'file' && part.filename) {
          const ext = path.extname(part.filename).toLowerCase();
          const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
          if (!['.jpg', '.jpeg', '.png', '.webp', '.pdf'].includes(ext)) continue;
          if (!ALLOWED_MIMES.includes(part.mimetype)) continue;

          const filename = `kyc_${request.user.id}_${randomUUID()}${ext}`;
          const uploadDir = path.join(config.UPLOAD_DIR, 'kyc');
          await fs.mkdir(uploadDir, { recursive: true });
          const filepath = path.join(uploadDir, filename);

          const buffer = await part.toBuffer();
          await fs.writeFile(filepath, buffer);
          documentFile = `kyc/${filename}`;
        } else {
          fields[part.fieldname] = part.value;
        }
      }

      const { document_type } = fields;
      const validTypes = ['passport', 'id_card', 'drivers_license', 'cie'];

      if (!document_type || !validTypes.includes(document_type)) {
        const result = await db.query(
          'SELECT id, kyc_status, kyc_document_type, kyc_verified, kyc_submitted_at, kyc_verified_at, kyc_rejected_reason FROM users WHERE id = $1',
          [request.user.id]
        );
        return reply.view('profile/verify.ejs', {
          user: request.user,
          profile: result.rows[0],
          error: 'Please select a valid document type.',
          success: null,
        });
      }

      if (!documentFile) {
        const result = await db.query(
          'SELECT id, kyc_status, kyc_document_type, kyc_verified, kyc_submitted_at, kyc_verified_at, kyc_rejected_reason FROM users WHERE id = $1',
          [request.user.id]
        );
        return reply.view('profile/verify.ejs', {
          user: request.user,
          profile: result.rows[0],
          error: 'Please upload a document image or PDF.',
          success: null,
        });
      }

      await db.query(
        `UPDATE users SET kyc_document_type = $1, kyc_document_path = $2, kyc_submitted_at = NOW(),
         kyc_status = 'pending', kyc_verified = false, kyc_rejected_reason = NULL
         WHERE id = $3`,
        [document_type, documentFile, request.user.id]
      );

      const result = await db.query(
        'SELECT id, kyc_status, kyc_document_type, kyc_verified, kyc_submitted_at, kyc_verified_at, kyc_rejected_reason FROM users WHERE id = $1',
        [request.user.id]
      );

      return reply.view('profile/verify.ejs', {
        user: request.user,
        profile: result.rows[0],
        error: null,
        success: 'Document submitted for verification. We will review it shortly.',
      });
    } catch (err) {
      fastify.log.error(err);
      const result = await db.query(
        'SELECT id, kyc_status, kyc_document_type, kyc_verified, kyc_submitted_at, kyc_verified_at, kyc_rejected_reason FROM users WHERE id = $1',
        [request.user.id]
      );
      return reply.view('profile/verify.ejs', {
        user: request.user,
        profile: result.rows[0],
        error: 'Failed to upload document. Please try again.',
        success: null,
      });
    }
  });

  // GET /profile/:id - Public profile
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params;

    try {
      const userResult = await db.query(
        'SELECT id, username, name, bio, location, reputation_score, avatar_path, plan, kyc_status, created_at FROM users WHERE id = $1',
        [parseInt(id)]
      );

      if (userResult.rows.length === 0) {
        return reply.redirect('/');
      }

      const profile = userResult.rows[0];

      // Get seller rating stats
      let sellerRating = { avg: 0, count: 0, trustBadge: null };
      try {
        const ratingResult = await db.query(
          `SELECT AVG(rating)::numeric(3,2) as avg_rating, COUNT(*) as review_count
           FROM seller_reviews WHERE seller_id = $1`,
          [parseInt(id)]
        );
        const avg = parseFloat(ratingResult.rows[0].avg_rating) || 0;
        const count = parseInt(ratingResult.rows[0].review_count);
        let trustBadge = null;
        if (count >= 50 && avg >= 4.5) trustBadge = 'gold';
        else if (count >= 20 && avg >= 4.0) trustBadge = 'silver';
        else if (count >= 5) trustBadge = 'bronze';
        sellerRating = { avg, count, trustBadge };
      } catch { /* table may not exist */ }

      // Parallel queries for listings and reviews
      const [listingsResult, reviewsResult] = await Promise.all([
        db.query(
          `SELECT l.*,
           (SELECT file_path FROM listing_images WHERE listing_id = l.id ORDER BY position LIMIT 1) as image
           FROM listings l
           WHERE l.seller_id = $1 AND l.status = 'active'
           ORDER BY l.created_at DESC
           LIMIT 50`,
          [parseInt(id)]
        ),
        db.query(
          `SELECT r.*, u.username as reviewer_name
           FROM reviews r
           JOIN users u ON r.reviewer_id = u.id
           WHERE r.reviewee_id = $1
           ORDER BY r.created_at DESC LIMIT 10`,
          [parseInt(id)]
        ),
      ]);

      return reply.view('profile/view.ejs', {
        user: request.user,
        profile,
        listings: listingsResult.rows,
        reviews: reviewsResult.rows,
        sellerRating,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/');
    }
  });
}
