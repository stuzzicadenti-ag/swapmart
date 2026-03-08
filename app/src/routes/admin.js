export default async function adminRoutes(fastify) {
  const { db } = fastify;

  // Database migrations for admin system
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user'`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS address_line1 VARCHAR(255)`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS address_line2 VARCHAR(255)`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(100)`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20)`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS country VARCHAR(100) DEFAULT 'Switzerland'`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT false`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_reason TEXT`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMP`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS flags (
      id SERIAL PRIMARY KEY,
      type VARCHAR(50) NOT NULL,
      listing_id INTEGER REFERENCES listings(id),
      user_id INTEGER,
      details TEXT,
      status VARCHAR(20) DEFAULT 'pending',
      reviewed_by INTEGER,
      reviewed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_log (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER NOT NULL,
      action VARCHAR(100) NOT NULL,
      target_type VARCHAR(50),
      target_id INTEGER,
      details TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Indices for new tables
  await db.query('CREATE INDEX IF NOT EXISTS idx_flags_status ON flags(status)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_flags_listing ON flags(listing_id)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_flags_created ON flags(created_at DESC)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_admin_log_created ON admin_log(created_at DESC)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_users_banned ON users(banned)');

  // KYC Document Verification columns
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_document_type VARCHAR(50)`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_document_path TEXT`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_verified BOOLEAN DEFAULT false`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMP`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_verified_at TIMESTAMP`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_rejected_reason TEXT`);

  // Auction/Bidding system
  await db.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS listing_mode VARCHAR(20) DEFAULT 'fixed'`);
  await db.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS starting_price NUMERIC(12,2)`);
  await db.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS buy_now_price NUMERIC(12,2)`);
  await db.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS auction_end TIMESTAMP`);
  await db.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS min_bid_increment NUMERIC(12,2) DEFAULT 1.00`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS bids (
      id SERIAL PRIMARY KEY,
      listing_id INTEGER NOT NULL REFERENCES listings(id),
      bidder_id INTEGER NOT NULL REFERENCES users(id),
      amount NUMERIC(12,2) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.query('CREATE INDEX IF NOT EXISTS idx_bids_listing ON bids(listing_id)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_bids_bidder ON bids(bidder_id)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_bids_amount ON bids(listing_id, amount DESC)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_listings_mode ON listings(listing_mode)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_listings_auction_end ON listings(auction_end)');

  // Warning system
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_warnings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      admin_id INTEGER NOT NULL REFERENCES users(id),
      reason VARCHAR(50) NOT NULL,
      details TEXT,
      evidence_url TEXT,
      expired BOOLEAN DEFAULT false,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await db.query('CREATE INDEX IF NOT EXISTS idx_user_warnings_user_id ON user_warnings(user_id)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_user_warnings_created ON user_warnings(created_at)');

  // Ensure at least one owner exists; if not, promote the first registered user
  const ownerCheck = await db.query("SELECT id FROM users WHERE role = 'owner' LIMIT 1");
  if (ownerCheck.rows.length === 0) {
    // Try nitrogerry first, otherwise first user
    const nitro = await db.query("SELECT id FROM users WHERE email = 'nitrogerry@hotmail.it' LIMIT 1");
    if (nitro.rows.length > 0) {
      await db.query("UPDATE users SET role = 'owner' WHERE id = $1", [nitro.rows[0].id]);
    } else {
      await db.query("UPDATE users SET role = 'owner' WHERE id = (SELECT id FROM users ORDER BY id LIMIT 1)");
    }
  }

  // Middleware
  const requireAdmin = async (request, reply) => {
    if (!request.user) {
      return reply.redirect('/auth/login');
    }
    const result = await db.query('SELECT role, banned FROM users WHERE id = $1', [request.user.id]);
    if (result.rows.length === 0 || result.rows[0].banned) {
      return reply.redirect('/');
    }
    const role = result.rows[0].role;
    if (role !== 'admin' && role !== 'owner') {
      return reply.redirect('/');
    }
    request.adminRole = role;
  };

  // Helper to log admin actions
  const logAction = async (adminId, action, targetType, targetId, details) => {
    await db.query(
      'INSERT INTO admin_log (admin_id, action, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5)',
      [adminId, action, targetType, targetId, details || null]
    );
  };

  // GET /admin - Dashboard
  fastify.get('/', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const [usersCount, listingsCount, revenueResult, flagsCount, kycPendingCount, recentFlags, recentTx] = await Promise.all([
        db.query('SELECT COUNT(*) FROM users'),
        db.query("SELECT COUNT(*) FROM listings WHERE status = 'active'"),
        db.query("SELECT COALESCE(SUM(commission), 0) as total FROM transactions WHERE status = 'completed'"),
        db.query("SELECT COUNT(*) FROM flags WHERE status = 'pending'"),
        db.query("SELECT COUNT(*) FROM users WHERE kyc_document_path IS NOT NULL AND kyc_verified = false"),
        db.query(`
          SELECT f.*, l.title as listing_title, u.username as reporter_name
          FROM flags f
          LEFT JOIN listings l ON f.listing_id = l.id
          LEFT JOIN users u ON f.user_id = u.id
          ORDER BY f.created_at DESC LIMIT 10
        `),
        db.query(`
          SELECT t.*, o.listing_id, l.title as listing_title,
            bu.username as buyer_name, su.username as seller_name
          FROM transactions t
          JOIN offers o ON t.offer_id = o.id
          JOIN listings l ON o.listing_id = l.id
          JOIN users bu ON o.buyer_id = bu.id
          JOIN users su ON l.seller_id = su.id
          ORDER BY t.created_at DESC LIMIT 10
        `),
      ]);

      return reply.view('admin/dashboard.ejs', {
        user: request.user,
        stats: {
          users: parseInt(usersCount.rows[0].count),
          listings: parseInt(listingsCount.rows[0].count),
          revenue: parseFloat(revenueResult.rows[0].total),
          pendingFlags: parseInt(flagsCount.rows[0].count),
          pendingKyc: parseInt(kycPendingCount.rows[0].count),
        },
        recentFlags: recentFlags.rows,
        recentTransactions: recentTx.rows,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.view('admin/dashboard.ejs', {
        user: request.user,
        stats: { users: 0, listings: 0, revenue: 0, pendingFlags: 0, pendingKyc: 0 },
        recentFlags: [],
        recentTransactions: [],
      });
    }
  });

  // GET /admin/users
  fastify.get('/users', { preHandler: requireAdmin }, async (request, reply) => {
    const { q, role, banned, page = 1 } = request.query;
    const limit = 25;
    const offset = (Math.max(1, parseInt(page)) - 1) * limit;

    let where = [];
    let params = [];
    let idx = 1;

    if (q) {
      where.push(`(username ILIKE $${idx} OR email ILIKE $${idx} OR name ILIKE $${idx})`);
      params.push(`%${q}%`);
      idx++;
    }
    if (role) {
      where.push(`role = $${idx}`);
      params.push(role);
      idx++;
    }
    if (banned === 'true') {
      where.push('banned = true');
    } else if (banned === 'false') {
      where.push('(banned = false OR banned IS NULL)');
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    try {
      const countResult = await db.query(`SELECT COUNT(*) FROM users ${whereClause}`, params);
      const total = parseInt(countResult.rows[0].count);
      const totalPages = Math.ceil(total / limit);

      const usersResult = await db.query(
        `SELECT id, email, username, name, role, reputation_score, banned, banned_reason, created_at
         FROM users ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      );

      return reply.view('admin/users.ejs', {
        user: request.user,
        adminRole: request.adminRole,
        users: usersResult.rows,
        filters: { q, role, banned },
        pagination: { page: parseInt(page), totalPages, total },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.view('admin/users.ejs', {
        user: request.user,
        adminRole: request.adminRole,
        users: [],
        filters: {},
        pagination: { page: 1, totalPages: 0, total: 0 },
      });
    }
  });

  // POST /admin/users/:id/role
  fastify.post('/users/:id/role', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params;
    const { role } = request.body;
    const validRoles = ['user', 'admin', 'owner'];

    if (!role || !validRoles.includes(role)) {
      return reply.redirect('/admin/users');
    }

    try {
      // Check target user
      const target = await db.query('SELECT id, role FROM users WHERE id = $1', [parseInt(id)]);
      if (target.rows.length === 0) return reply.redirect('/admin/users');

      const targetUser = target.rows[0];

      // Only owners can promote to admin/owner
      if (role === 'admin' || role === 'owner') {
        if (request.adminRole !== 'owner') {
          return reply.redirect('/admin/users');
        }
      }

      // Admins can't demote owners
      if (targetUser.role === 'owner' && request.adminRole !== 'owner') {
        return reply.redirect('/admin/users');
      }

      // Can't change own role to lower
      if (parseInt(id) === request.user.id && role !== request.adminRole) {
        return reply.redirect('/admin/users');
      }

      await db.query('UPDATE users SET role = $1 WHERE id = $2', [role, parseInt(id)]);
      await logAction(request.user.id, 'change_role', 'user', parseInt(id), `Role changed to: ${role}`);

      return reply.redirect('/admin/users');
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/admin/users');
    }
  });

  // POST /admin/users/:id/ban
  fastify.post('/users/:id/ban', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params;
    const { reason } = request.body;

    try {
      const target = await db.query('SELECT id, role FROM users WHERE id = $1', [parseInt(id)]);
      if (target.rows.length === 0) return reply.redirect('/admin/users');

      // Can't ban owners or other admins (unless you're owner)
      if (target.rows[0].role === 'owner') return reply.redirect('/admin/users');
      if (target.rows[0].role === 'admin' && request.adminRole !== 'owner') return reply.redirect('/admin/users');

      // Can't ban self
      if (parseInt(id) === request.user.id) return reply.redirect('/admin/users');

      await db.query(
        'UPDATE users SET banned = true, banned_reason = $1, banned_at = NOW() WHERE id = $2',
        [reason || 'No reason provided', parseInt(id)]
      );

      // Deactivate all their listings
      await db.query(
        "UPDATE listings SET status = 'removed' WHERE seller_id = $1 AND status = 'active'",
        [parseInt(id)]
      );

      await logAction(request.user.id, 'ban_user', 'user', parseInt(id), `Reason: ${reason || 'No reason'}`);

      return reply.redirect('/admin/users');
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/admin/users');
    }
  });

  // POST /admin/users/:id/unban
  fastify.post('/users/:id/unban', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params;

    try {
      await db.query(
        'UPDATE users SET banned = false, banned_reason = NULL, banned_at = NULL WHERE id = $1',
        [parseInt(id)]
      );

      await logAction(request.user.id, 'unban_user', 'user', parseInt(id), null);

      return reply.redirect('/admin/users');
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/admin/users');
    }
  });

  // GET /admin/listings
  fastify.get('/listings', { preHandler: requireAdmin }, async (request, reply) => {
    const { status, flagged, q, page = 1 } = request.query;
    const limit = 25;
    const offset = (Math.max(1, parseInt(page)) - 1) * limit;

    let where = [];
    let params = [];
    let idx = 1;

    if (status) {
      where.push(`l.status = $${idx}`);
      params.push(status);
      idx++;
    }
    if (q) {
      where.push(`(l.title ILIKE $${idx} OR l.description ILIKE $${idx})`);
      params.push(`%${q}%`);
      idx++;
    }

    let havingClause = '';
    if (flagged === 'true') {
      havingClause = 'HAVING COUNT(f.id) > 0';
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    try {
      const listingsResult = await db.query(
        `SELECT l.*, u.username as seller_name, c.name as category_name,
         COUNT(f.id) as flag_count,
         (SELECT file_path FROM listing_images WHERE listing_id = l.id ORDER BY position LIMIT 1) as image
         FROM listings l
         JOIN users u ON l.seller_id = u.id
         JOIN categories c ON l.category_id = c.id
         LEFT JOIN flags f ON f.listing_id = l.id AND f.status = 'pending'
         ${whereClause}
         GROUP BY l.id, u.username, c.name
         ${havingClause}
         ORDER BY l.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      );

      // Get total for pagination (simplified)
      const countResult = await db.query(
        `SELECT COUNT(DISTINCT l.id) FROM listings l
         LEFT JOIN flags f ON f.listing_id = l.id AND f.status = 'pending'
         ${whereClause}
         ${flagged === 'true' ? 'AND l.id IN (SELECT listing_id FROM flags WHERE status = \'pending\')' : ''}`,
        params
      );
      const total = parseInt(countResult.rows[0].count);
      const totalPages = Math.ceil(total / limit);

      return reply.view('admin/listings.ejs', {
        user: request.user,
        listings: listingsResult.rows,
        filters: { status, flagged, q },
        pagination: { page: parseInt(page), totalPages, total },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.view('admin/listings.ejs', {
        user: request.user,
        listings: [],
        filters: {},
        pagination: { page: 1, totalPages: 0, total: 0 },
      });
    }
  });

  // POST /admin/listings/:id/remove
  fastify.post('/listings/:id/remove', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params;

    try {
      await db.query("UPDATE listings SET status = 'removed' WHERE id = $1", [parseInt(id)]);
      await logAction(request.user.id, 'remove_listing', 'listing', parseInt(id), null);
      return reply.redirect('/admin/listings');
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/admin/listings');
    }
  });

  // POST /admin/listings/:id/approve
  fastify.post('/listings/:id/approve', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params;

    try {
      await db.query("UPDATE listings SET status = 'active' WHERE id = $1", [parseInt(id)]);
      // Dismiss all pending flags for this listing
      await db.query(
        "UPDATE flags SET status = 'reviewed', reviewed_by = $1, reviewed_at = NOW() WHERE listing_id = $2 AND status = 'pending'",
        [request.user.id, parseInt(id)]
      );
      await logAction(request.user.id, 'approve_listing', 'listing', parseInt(id), null);
      return reply.redirect('/admin/listings');
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/admin/listings');
    }
  });

  // GET /admin/flags
  fastify.get('/flags', { preHandler: requireAdmin }, async (request, reply) => {
    const { status: filterStatus, page = 1 } = request.query;
    const limit = 25;
    const offset = (Math.max(1, parseInt(page)) - 1) * limit;

    let where = [];
    let params = [];
    let idx = 1;

    if (filterStatus) {
      where.push(`f.status = $${idx}`);
      params.push(filterStatus);
      idx++;
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    try {
      const countResult = await db.query(`SELECT COUNT(*) FROM flags f ${whereClause}`, params);
      const total = parseInt(countResult.rows[0].count);
      const totalPages = Math.ceil(total / limit);

      const flagsResult = await db.query(
        `SELECT f.*, l.title as listing_title, l.status as listing_status,
         u.username as reporter_name, r.username as reviewer_name
         FROM flags f
         LEFT JOIN listings l ON f.listing_id = l.id
         LEFT JOIN users u ON f.user_id = u.id
         LEFT JOIN users r ON f.reviewed_by = r.id
         ${whereClause}
         ORDER BY
           CASE WHEN f.status = 'pending' THEN 0 ELSE 1 END,
           f.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      );

      return reply.view('admin/flags.ejs', {
        user: request.user,
        flags: flagsResult.rows,
        filters: { status: filterStatus },
        pagination: { page: parseInt(page), totalPages, total },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.view('admin/flags.ejs', {
        user: request.user,
        flags: [],
        filters: {},
        pagination: { page: 1, totalPages: 0, total: 0 },
      });
    }
  });

  // POST /admin/flags/:id/dismiss
  fastify.post('/flags/:id/dismiss', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params;

    try {
      await db.query(
        "UPDATE flags SET status = 'dismissed', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2",
        [request.user.id, parseInt(id)]
      );
      await logAction(request.user.id, 'dismiss_flag', 'flag', parseInt(id), null);
      return reply.redirect('/admin/flags');
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/admin/flags');
    }
  });

  // POST /admin/flags/:id/action (remove listing)
  fastify.post('/flags/:id/action', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params;

    try {
      // Get the flag to find the listing
      const flagResult = await db.query('SELECT * FROM flags WHERE id = $1', [parseInt(id)]);
      if (flagResult.rows.length === 0) return reply.redirect('/admin/flags');

      const flag = flagResult.rows[0];

      // Remove listing if there is one
      if (flag.listing_id) {
        await db.query("UPDATE listings SET status = 'removed' WHERE id = $1", [flag.listing_id]);
        await logAction(request.user.id, 'remove_listing', 'listing', flag.listing_id, `Via flag #${id}`);
      }

      // Mark flag as reviewed
      await db.query(
        "UPDATE flags SET status = 'reviewed', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2",
        [request.user.id, parseInt(id)]
      );

      await logAction(request.user.id, 'action_flag', 'flag', parseInt(id), 'Listing removed');
      return reply.redirect('/admin/flags');
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/admin/flags');
    }
  });

  // GET /admin/kyc - Pending KYC submissions
  fastify.get('/kyc', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const pendingResult = await db.query(
        `SELECT id, username, email, kyc_document_type, kyc_document_path, kyc_submitted_at, kyc_rejected_reason
         FROM users
         WHERE kyc_document_path IS NOT NULL AND kyc_verified = false
         ORDER BY kyc_submitted_at ASC`
      );

      return reply.view('admin/kyc.ejs', {
        user: request.user,
        submissions: pendingResult.rows,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.view('admin/kyc.ejs', {
        user: request.user,
        submissions: [],
      });
    }
  });

  // POST /admin/kyc/:userId/approve
  fastify.post('/kyc/:userId/approve', { preHandler: requireAdmin }, async (request, reply) => {
    const { userId } = request.params;
    try {
      await db.query(
        `UPDATE users SET kyc_verified = true, kyc_verified_at = NOW(), kyc_status = 'verified', kyc_rejected_reason = NULL WHERE id = $1`,
        [parseInt(userId)]
      );
      await logAction(request.user.id, 'approve_kyc', 'user', parseInt(userId), null);
      return reply.redirect('/admin/kyc');
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/admin/kyc');
    }
  });

  // POST /admin/kyc/:userId/reject
  fastify.post('/kyc/:userId/reject', { preHandler: requireAdmin }, async (request, reply) => {
    const { userId } = request.params;
    const { reason } = request.body;
    try {
      await db.query(
        `UPDATE users SET kyc_verified = false, kyc_rejected_reason = $1, kyc_status = 'none', kyc_document_path = NULL, kyc_document_type = NULL, kyc_submitted_at = NULL WHERE id = $2`,
        [reason || 'Document rejected', parseInt(userId)]
      );
      await logAction(request.user.id, 'reject_kyc', 'user', parseInt(userId), `Reason: ${reason || 'No reason'}`);
      return reply.redirect('/admin/kyc');
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/admin/kyc');
    }
  });

  // Warning System
  const WARNING_REASONS = ['spam', 'fraud', 'harassment', 'counterfeit', 'policy_violation', 'misleading_listing', 'shill_bidding', 'other'];

  // POST /admin/users/:id/warn - Issue a warning
  fastify.post('/users/:id/warn', { preHandler: requireAdmin }, async (request, reply) => {
    const targetId = parseInt(request.params.id);
    const { reason, details, evidence_url } = request.body;

    if (!WARNING_REASONS.includes(reason)) {
      return reply.code(400).send('Invalid warning reason');
    }

    if (targetId === request.user.id) {
      return reply.code(400).send('Cannot warn yourself');
    }

    try {
      const target = await db.query('SELECT id, role, banned FROM users WHERE id = $1', [targetId]);
      if (target.rows.length === 0) return reply.code(404).send('User not found');
      if (target.rows[0].role === 'owner') return reply.code(403).send('Cannot warn an owner');

      await db.query(
        `INSERT INTO user_warnings (user_id, admin_id, reason, details, evidence_url)
         VALUES ($1, $2, $3, $4, $5)`,
        [targetId, request.user.id, reason, details || null, evidence_url || null]
      );

      // Expire old warnings (6+ months with good conduct)
      await db.query(
        `UPDATE user_warnings SET expired = true
         WHERE user_id = $1 AND expired = false
           AND created_at < NOW() - INTERVAL '6 months'`,
        [targetId]
      );

      // Count active (non-expired) warnings
      const warnCount = await db.query(
        'SELECT COUNT(*) as count FROM user_warnings WHERE user_id = $1 AND expired = false',
        [targetId]
      );

      if (parseInt(warnCount.rows[0].count) >= 3 && !target.rows[0].banned) {
        await db.query(
          `UPDATE users SET banned = true, banned_reason = $1, banned_at = NOW() WHERE id = $2`,
          ['Account suspended: 3 active warnings for misconduct', targetId]
        );
        // Deactivate listings
        await db.query(
          "UPDATE listings SET status = 'removed' WHERE seller_id = $1 AND status = 'active'",
          [targetId]
        );
        await logAction(request.user.id, 'auto_ban_warnings', 'user', targetId, '3 active warnings reached');
      }

      await logAction(request.user.id, 'warn_user', 'user', targetId, `Reason: ${reason}. ${details || ''}`);
      return reply.redirect('/admin/users');
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/admin/users');
    }
  });

  // GET /admin/users/:id/warnings - View user's warning history
  fastify.get('/users/:id/warnings', { preHandler: requireAdmin }, async (request, reply) => {
    const targetId = parseInt(request.params.id);

    try {
      const [userResult, warnings] = await Promise.all([
        db.query('SELECT id, username, name, email, banned FROM users WHERE id = $1', [targetId]),
        db.query(
          `SELECT w.*, a.username as admin_name
           FROM user_warnings w
           JOIN users a ON w.admin_id = a.id
           WHERE w.user_id = $1
           ORDER BY w.created_at DESC`,
          [targetId]
        ),
      ]);

      if (userResult.rows.length === 0) return reply.code(404).send('User not found');

      return reply.view('admin/warnings.ejs', {
        user: request.user,
        targetUser: userResult.rows[0],
        warnings: warnings.rows,
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.redirect('/admin/users');
    }
  });

  // GET /admin/logs
  fastify.get('/logs', { preHandler: requireAdmin }, async (request, reply) => {
    const { page = 1 } = request.query;
    const limit = 50;
    const offset = (Math.max(1, parseInt(page)) - 1) * limit;

    try {
      const countResult = await db.query('SELECT COUNT(*) FROM admin_log');
      const total = parseInt(countResult.rows[0].count);
      const totalPages = Math.ceil(total / limit);

      const logsResult = await db.query(
        `SELECT al.*, u.username as admin_name
         FROM admin_log al
         JOIN users u ON al.admin_id = u.id
         ORDER BY al.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      return reply.view('admin/logs.ejs', {
        user: request.user,
        logs: logsResult.rows,
        pagination: { page: parseInt(page), totalPages, total },
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.view('admin/logs.ejs', {
        user: request.user,
        logs: [],
        pagination: { page: 1, totalPages: 0, total: 0 },
      });
    }
  });
}
