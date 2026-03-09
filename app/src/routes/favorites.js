export default async function favoritesRoutes(fastify) {
  const { db } = fastify;

  // Auto-create table if not exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_favorites (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, listing_id)
    )
  `);

  const requireAuth = async (request, reply) => {
    if (!request.user) {
      return reply.redirect('/auth/login');
    }
  };

  // POST /favorites/:id/toggle - Toggle favorite on a listing
  fastify.post('/:id/toggle', { preHandler: requireAuth }, async (request, reply) => {
    const listingId = parseInt(request.params.id);
    if (isNaN(listingId)) return reply.code(400).send({ error: 'Invalid listing ID' });

    try {
      // Check if listing exists
      const listing = await db.query('SELECT id, slug FROM listings WHERE id = $1', [listingId]);
      if (listing.rows.length === 0) {
        return reply.code(404).send({ error: 'Listing not found' });
      }

      // Check if already favorited
      const existing = await db.query(
        'SELECT id FROM user_favorites WHERE user_id = $1 AND listing_id = $2',
        [request.user.id, listingId]
      );

      let favorited;
      if (existing.rows.length > 0) {
        // Remove favorite
        await db.query('DELETE FROM user_favorites WHERE user_id = $1 AND listing_id = $2', [request.user.id, listingId]);
        favorited = false;
      } else {
        // Add favorite
        await db.query(
          'INSERT INTO user_favorites (user_id, listing_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [request.user.id, listingId]
        );
        favorited = true;
      }

      // Get updated favorite count for this listing
      const countResult = await db.query(
        'SELECT COUNT(*) FROM user_favorites WHERE listing_id = $1',
        [listingId]
      );

      // Get total favorites count for nav badge
      const totalResult = await db.query(
        'SELECT COUNT(*) FROM user_favorites WHERE user_id = $1',
        [request.user.id]
      );

      return { favorited, count: parseInt(countResult.rows[0].count), totalFavorites: parseInt(totalResult.rows[0].count) };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Failed to toggle favorite' });
    }
  });

  // GET /favorites - Page showing user's favorited listings
  fastify.get('/', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const result = await db.query(
        `SELECT l.*, u.username as seller_name, c.name as category_name, c.slug as category_slug,
         (SELECT file_path FROM listing_images WHERE listing_id = l.id ORDER BY position LIMIT 1) as image,
         uf.created_at as favorited_at
         FROM user_favorites uf
         JOIN listings l ON uf.listing_id = l.id
         JOIN users u ON l.seller_id = u.id
         JOIN categories c ON l.category_id = c.id
         WHERE uf.user_id = $1
         ORDER BY uf.created_at DESC`,
        [request.user.id]
      );

      return reply.view('favorites/list.ejs', {
        user: request.user,
        favorites: result.rows,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.view('favorites/list.ejs', {
        user: request.user,
        favorites: [],
      });
    }
  });

  // GET /favorites/count - Get favorite count for nav badge (JSON)
  fastify.get('/count', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const result = await db.query(
        'SELECT COUNT(*) FROM user_favorites WHERE user_id = $1',
        [request.user.id]
      );
      return { count: parseInt(result.rows[0].count) };
    } catch (err) {
      return { count: 0 };
    }
  });
}
