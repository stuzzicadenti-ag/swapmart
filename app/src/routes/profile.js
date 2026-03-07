export default async function profileRoutes(fastify) {
  const { db } = fastify;

  const requireAuth = async (request, reply) => {
    if (!request.user) {
      return reply.redirect('/auth/login');
    }
  };

  // GET /profile/settings - Edit own profile
  fastify.get('/settings', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const result = await db.query(
        'SELECT id, email, username, name, bio, location, avatar_path, plan, kyc_status, created_at FROM users WHERE id = $1',
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
    const { name, bio, location } = request.body;

    // Input length limits
    if ((name && name.length > 255) || (bio && bio.length > 2000) || (location && location.length > 255)) {
      const result = await db.query(
        'SELECT id, email, username, name, bio, location, avatar_path, plan, kyc_status, created_at FROM users WHERE id = $1',
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
        'UPDATE users SET name = $1, bio = $2, location = $3 WHERE id = $4',
        [name || null, bio || null, location || null, request.user.id]
      );

      const result = await db.query(
        'SELECT id, email, username, name, bio, location, avatar_path, plan, kyc_status, created_at FROM users WHERE id = $1',
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
        'SELECT id, email, username, name, bio, location, avatar_path, plan, kyc_status, created_at FROM users WHERE id = $1',
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
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/');
    }
  });
}
