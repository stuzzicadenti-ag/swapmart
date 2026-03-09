export default async function recentRoutes(fastify) {
  const { db } = fastify;

  // Auto-create table if not exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS recently_viewed (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      viewed_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.query('CREATE INDEX IF NOT EXISTS idx_recently_viewed_user ON recently_viewed(user_id, viewed_at DESC)');
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_recently_viewed_unique ON recently_viewed(user_id, listing_id)');

  const requireAuth = async (request, reply) => {
    if (!request.user) {
      return reply.redirect('/auth/login');
    }
  };

  // GET /recently-viewed - Page showing recently viewed items
  fastify.get('/', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const result = await db.query(
        `SELECT l.*, u.username as seller_name, c.name as category_name,
         (SELECT file_path FROM listing_images WHERE listing_id = l.id ORDER BY position LIMIT 1) as image,
         rv.viewed_at
         FROM recently_viewed rv
         JOIN listings l ON rv.listing_id = l.id
         JOIN users u ON l.seller_id = u.id
         JOIN categories c ON l.category_id = c.id
         WHERE rv.user_id = $1
         ORDER BY rv.viewed_at DESC
         LIMIT 20`,
        [request.user.id]
      );

      return reply.view('recent/list.ejs', {
        user: request.user,
        listings: result.rows,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.view('recent/list.ejs', {
        user: request.user,
        listings: [],
      });
    }
  });
}
