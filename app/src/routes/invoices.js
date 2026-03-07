export default async function invoicesRoutes(fastify) {
  const { db } = fastify;

  const requireAuth = async (request, reply) => {
    if (!request.user) {
      return reply.redirect('/auth/login');
    }
  };

  // GET /invoices - Seller's invoices
  fastify.get('/', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const result = await db.query(
        `SELECT i.*, t.amount as transaction_amount, t.offer_id,
         l.title as listing_title, l.id as listing_id
         FROM invoices i
         JOIN transactions t ON i.transaction_id = t.id
         JOIN offers o ON t.offer_id = o.id
         JOIN listings l ON o.listing_id = l.id
         WHERE i.seller_id = $1
         ORDER BY i.created_at DESC
         LIMIT 100`,
        [request.user.id]
      );

      return reply.view('invoices/list.ejs', {
        user: request.user,
        invoices: result.rows,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.view('invoices/list.ejs', {
        user: request.user,
        invoices: [],
      });
    }
  });
}
