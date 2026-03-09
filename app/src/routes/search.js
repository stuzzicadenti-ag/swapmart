export default async function searchRoutes(fastify) {
  const { db } = fastify;

  // Auto-create table if not exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS saved_searches (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(255),
      query TEXT,
      category VARCHAR(100),
      min_price NUMERIC(12,2),
      max_price NUMERIC(12,2),
      condition VARCHAR(20),
      type VARCHAR(20),
      mode VARCHAR(20),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  const requireAuth = async (request, reply) => {
    if (!request.user) {
      return reply.redirect('/auth/login');
    }
  };

  // POST /search/save - Save current search filters
  fastify.post('/save', { preHandler: requireAuth }, async (request, reply) => {
    const { name, query, category, min_price, max_price, condition, type, mode } = request.body;

    try {
      // Check limit: 10 saved searches per user
      const countResult = await db.query(
        'SELECT COUNT(*) FROM saved_searches WHERE user_id = $1',
        [request.user.id]
      );

      if (parseInt(countResult.rows[0].count) >= 10) {
        // Return JSON for AJAX or redirect for form
        const accept = request.headers.accept || '';
        if (accept.includes('application/json')) {
          return reply.code(400).send({ error: 'Maximum 10 saved searches allowed. Please delete one first.' });
        }
        return reply.redirect('/search/saved?error=limit');
      }

      // Validate name length
      const searchName = (name && name.length <= 255) ? name : (query || category || 'Search');

      await db.query(
        `INSERT INTO saved_searches (user_id, name, query, category, min_price, max_price, condition, type, mode)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          request.user.id,
          searchName,
          query || null,
          category || null,
          min_price ? parseFloat(min_price) : null,
          max_price ? parseFloat(max_price) : null,
          condition || null,
          type || null,
          mode || null,
        ]
      );

      const accept = request.headers.accept || '';
      if (accept.includes('application/json')) {
        return { success: true };
      }
      return reply.redirect('/search/saved');
    } catch (err) {
      fastify.log.error(err);
      const accept = request.headers.accept || '';
      if (accept.includes('application/json')) {
        return reply.code(500).send({ error: 'Failed to save search' });
      }
      return reply.redirect('/search/saved?error=failed');
    }
  });

  // GET /search/saved - List saved searches
  fastify.get('/saved', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const result = await db.query(
        'SELECT * FROM saved_searches WHERE user_id = $1 ORDER BY created_at DESC',
        [request.user.id]
      );

      const error = request.query.error === 'limit' ? 'Maximum 10 saved searches allowed. Please delete one first.'
        : request.query.error === 'failed' ? 'Failed to save search. Please try again.'
        : null;

      return reply.view('search/saved.ejs', {
        user: request.user,
        searches: result.rows,
        error,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.view('search/saved.ejs', {
        user: request.user,
        searches: [],
        error: null,
      });
    }
  });

  // DELETE /search/saved/:id - Remove a saved search
  fastify.post('/saved/:id/delete', { preHandler: requireAuth }, async (request, reply) => {
    const searchId = parseInt(request.params.id);
    if (isNaN(searchId)) return reply.redirect('/search/saved');

    try {
      await db.query(
        'DELETE FROM saved_searches WHERE id = $1 AND user_id = $2',
        [searchId, request.user.id]
      );
      return reply.redirect('/search/saved');
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/search/saved');
    }
  });
}
