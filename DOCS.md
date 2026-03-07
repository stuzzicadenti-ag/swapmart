# SwapMart -- Technical Documentation

## Overview

SwapMart is a Swiss marketplace platform for buying, selling, and swapping items. It combines traditional fixed-price listings with an auction system and a unique barter/swap feature. The platform supports tiered seller plans with variable commission rates, KYC verification for high-value transactions and auctions, real-time messaging between buyers and sellers, and a comprehensive admin panel with content moderation.

**Target market:** Swiss consumers and small businesses looking for a fairer alternative to Ricardo.ch.
**Value proposition:** Lower commissions (5-8% free tier vs 8-12% on Ricardo.ch), zero-fee pure swaps, KYC-verified transactions, and an integrated auction system.

## Architecture

```
Client (Browser)
    |
    v
Caddy (reverse proxy, port 80, .local domain)
    |
    v
Fastify (port 4003)
    |
    +---> PostgreSQL (stz_swapmart)
    |
    +---> Redis (sessions, caching)
    |
    +---> WebSocket (real-time notifications)
    |
    +---> Filesystem (uploads via sharp image processing)
```

### Request flow

1. Client sends HTTP request to Caddy reverse proxy
2. Caddy forwards to Fastify on port 4003
3. Middleware chain: cookie parse -> JWT verify -> banned check (DB query) -> role attach -> route handler
4. Route handler queries PostgreSQL via raw `pg` Pool (parameterized queries)
5. EJS template rendered server-side and returned to client
6. Image uploads processed via `sharp` (resize to 1200x1200, JPEG 85%)

### Directory structure

```
swapmart/
  app/
    src/
      server.js              # Fastify app, plugins, Redis, homepage
      db/
        schema.js            # Drizzle ORM table definitions
        migrate.js           # Schema migration runner
        seed.js              # Seed data (categories, test users)
      routes/
        auth.js              # Register, login, logout
        listings.js          # Browse, create, detail, bid, buy-now, offer, report
        offers.js            # Offer management (accept, reject, complete, invoicing)
        messages.js          # Inbox, chat, send messages
        invoices.js          # Seller invoice listing
        profile.js           # Settings, KYC upload, public profile
        admin.js             # Dashboard, users, listings, flags, KYC, logs
      utils/
        commission.js        # Tiered commission calculator
        moderation.js        # Content scanner (phone, email, URL, profanity)
      views/                 # EJS templates
      public/                # Static assets
    package.json
  api/                       # Legacy Express API (deprecated, replaced by app/)
```

## Tech Stack

| Component        | Technology                                    |
|-----------------|----------------------------------------------|
| Runtime         | Node.js (ESM)                                 |
| Framework       | Fastify 5                                      |
| Template Engine | EJS via @fastify/view                          |
| Database        | PostgreSQL (raw pg Pool, parameterized queries)|
| Cache/Sessions  | Redis (ioredis)                                |
| Auth            | JWT (jsonwebtoken) in httpOnly cookies          |
| Password Hash   | bcryptjs (10 rounds)                            |
| Image Processing| sharp (resize, JPEG compression)                |
| File Uploads    | @fastify/multipart (10 MB limit)                |
| WebSocket       | @fastify/websocket                              |
| ORM (schema)    | Drizzle ORM (schema definitions only)           |

### Dependencies

- `fastify` ^5.0.0
- `@fastify/static` ^8.0.0
- `@fastify/formbody` ^8.0.0
- `@fastify/cookie` ^11.0.0
- `@fastify/multipart` ^9.0.0
- `@fastify/view` ^10.0.0
- `@fastify/websocket` ^11.0.0
- `ejs` ^3.1.10
- `pg` ^8.13.0
- `drizzle-orm` ^0.36.0
- `bcryptjs` ^2.4.3
- `jsonwebtoken` ^9.0.2
- `sharp` ^0.33.0
- `ioredis` ^5.4.0

## Database Schema

### Tables

#### users
| Column             | Type          | Constraints                |
|-------------------|---------------|----------------------------|
| id                | SERIAL        | PRIMARY KEY                 |
| email             | VARCHAR(255)  | NOT NULL, UNIQUE            |
| password_hash     | TEXT          | NOT NULL                    |
| username          | VARCHAR(100)  | NOT NULL, UNIQUE            |
| name              | VARCHAR(255)  |                             |
| bio               | TEXT          |                             |
| location          | VARCHAR(255)  |                             |
| phone             | VARCHAR(50)   |                             |
| address_line1     | VARCHAR(255)  |                             |
| address_line2     | VARCHAR(255)  |                             |
| city              | VARCHAR(100)  |                             |
| postal_code       | VARCHAR(20)   |                             |
| country           | VARCHAR(100)  | DEFAULT 'Switzerland'       |
| kyc_status        | TEXT          | DEFAULT 'none', NOT NULL    |
| kyc_document_type | VARCHAR(50)   |                             |
| kyc_document_path | TEXT          |                             |
| kyc_verified      | BOOLEAN       | DEFAULT false               |
| kyc_submitted_at  | TIMESTAMP     |                             |
| kyc_verified_at   | TIMESTAMP     |                             |
| kyc_rejected_reason| TEXT         |                             |
| reputation_score  | INTEGER       | DEFAULT 0, NOT NULL         |
| plan              | TEXT          | DEFAULT 'free', NOT NULL    |
| avatar_path       | TEXT          |                             |
| role              | VARCHAR(20)   | DEFAULT 'user'              |
| banned            | BOOLEAN       | DEFAULT false               |
| banned_reason     | TEXT          |                             |
| banned_at         | TIMESTAMP     |                             |
| created_at        | TIMESTAMP     | DEFAULT NOW(), NOT NULL     |

#### categories
| Column    | Type          | Constraints          |
|----------|---------------|----------------------|
| id       | SERIAL        | PRIMARY KEY           |
| name     | VARCHAR(100)  | NOT NULL              |
| slug     | VARCHAR(100)  | NOT NULL, UNIQUE      |
| icon     | VARCHAR(50)   |                       |
| parent_id| INTEGER       | (self-referencing)    |

#### listings
| Column           | Type           | Constraints                |
|-----------------|----------------|----------------------------|
| id              | SERIAL         | PRIMARY KEY                 |
| seller_id       | INTEGER        | NOT NULL, FK -> users(id)   |
| title           | VARCHAR(255)   | NOT NULL                    |
| description     | TEXT           |                             |
| price           | DECIMAL(12,2)  |                             |
| currency        | VARCHAR(10)    | DEFAULT 'CHF', NOT NULL     |
| category_id     | INTEGER        | NOT NULL, FK -> categories  |
| condition       | TEXT           | NOT NULL (new/like_new/good/fair) |
| location        | VARCHAR(255)   |                             |
| type            | TEXT           | NOT NULL (sell/swap/both)   |
| listing_mode    | TEXT           | DEFAULT 'fixed' (fixed/auction) |
| starting_price  | DECIMAL(12,2)  |                             |
| buy_now_price   | DECIMAL(12,2)  |                             |
| auction_end     | TIMESTAMP      |                             |
| min_bid_increment| DECIMAL(12,2) | DEFAULT 1.00                |
| status          | TEXT           | DEFAULT 'active'            |
| created_at      | TIMESTAMP      | DEFAULT NOW(), NOT NULL     |
| updated_at      | TIMESTAMP      | DEFAULT NOW(), NOT NULL     |

#### listing_images
| Column     | Type    | Constraints                    |
|-----------|---------|--------------------------------|
| id        | SERIAL  | PRIMARY KEY                     |
| listing_id| INTEGER | NOT NULL, FK -> listings(id)    |
| file_path | TEXT    | NOT NULL                        |
| position  | INTEGER | DEFAULT 0, NOT NULL             |

#### bids
| Column     | Type           | Constraints                |
|-----------|----------------|----------------------------|
| id        | SERIAL         | PRIMARY KEY                 |
| listing_id| INTEGER        | NOT NULL, FK -> listings(id)|
| bidder_id | INTEGER        | NOT NULL, FK -> users(id)   |
| amount    | DECIMAL(12,2)  | NOT NULL                    |
| created_at| TIMESTAMP      | DEFAULT NOW(), NOT NULL     |

#### offers
| Column          | Type           | Constraints              |
|----------------|----------------|--------------------------|
| id             | SERIAL         | PRIMARY KEY               |
| listing_id     | INTEGER        | NOT NULL                  |
| buyer_id       | INTEGER        | NOT NULL                  |
| type           | TEXT           | NOT NULL (cash/swap/swap_cash) |
| cash_amount    | DECIMAL(12,2)  |                           |
| swap_listing_id| INTEGER        |                           |
| message        | TEXT           |                           |
| status         | TEXT           | DEFAULT 'pending'         |
| created_at     | TIMESTAMP      | DEFAULT NOW(), NOT NULL   |

#### messages
| Column    | Type      | Constraints              |
|----------|-----------|--------------------------|
| id       | SERIAL    | PRIMARY KEY               |
| offer_id | INTEGER   | NOT NULL                  |
| sender_id| INTEGER   | NOT NULL                  |
| content  | TEXT      | NOT NULL                  |
| read_at  | TIMESTAMP |                           |
| created_at| TIMESTAMP| DEFAULT NOW(), NOT NULL   |

#### transactions
| Column          | Type           | Constraints          |
|----------------|----------------|----------------------|
| id             | SERIAL         | PRIMARY KEY           |
| offer_id       | INTEGER        | NOT NULL              |
| amount         | DECIMAL(12,2)  | NOT NULL              |
| commission     | DECIMAL(12,2)  | NOT NULL              |
| commission_rate| DECIMAL(5,4)   | NOT NULL              |
| status         | TEXT           | DEFAULT 'pending'     |
| created_at     | TIMESTAMP      | DEFAULT NOW(), NOT NULL|

#### invoices
| Column          | Type           | Constraints          |
|----------------|----------------|----------------------|
| id             | SERIAL         | PRIMARY KEY           |
| transaction_id | INTEGER        | NOT NULL              |
| seller_id      | INTEGER        | NOT NULL              |
| amount         | NUMERIC(12,2)  | NOT NULL              |
| status         | VARCHAR(20)    | DEFAULT 'pending'     |
| due_date       | TIMESTAMP      | NOT NULL              |
| created_at     | TIMESTAMP      | DEFAULT NOW()         |

#### reviews
| Column         | Type      | Constraints          |
|---------------|-----------|----------------------|
| id            | SERIAL    | PRIMARY KEY           |
| transaction_id| INTEGER   | NOT NULL              |
| reviewer_id   | INTEGER   | NOT NULL              |
| reviewee_id   | INTEGER   | NOT NULL              |
| rating        | INTEGER   | NOT NULL              |
| comment       | TEXT      |                       |
| created_at    | TIMESTAMP | DEFAULT NOW(), NOT NULL|

#### flags
| Column      | Type         | Constraints                |
|------------|--------------|----------------------------|
| id         | SERIAL       | PRIMARY KEY                 |
| type       | VARCHAR(50)  | NOT NULL                    |
| listing_id | INTEGER      | FK -> listings(id)          |
| user_id    | INTEGER      |                             |
| details    | TEXT         |                             |
| status     | VARCHAR(20)  | DEFAULT 'pending'           |
| reviewed_by| INTEGER      |                             |
| reviewed_at| TIMESTAMP    |                             |
| created_at | TIMESTAMP    | DEFAULT NOW()               |

#### admin_log
| Column      | Type         | Constraints          |
|------------|--------------|----------------------|
| id         | SERIAL       | PRIMARY KEY           |
| admin_id   | INTEGER      | NOT NULL              |
| action     | VARCHAR(100) | NOT NULL              |
| target_type| VARCHAR(50)  |                       |
| target_id  | INTEGER      |                       |
| details    | TEXT         |                       |
| created_at | TIMESTAMP    | DEFAULT NOW()         |

### ER Diagram

```
  +-----------+      +------------+      +------------+
  |   users   |<-----|  listings   |----->| categories |
  +-----------+ 1:N  +------------+ N:1  +------------+
  | id (PK)   |      | id (PK)    |      | id (PK)    |
  | email     |      | seller_id  |      | name       |
  | username  |      | title      |      | slug       |
  | plan      |      | price      |      | parent_id  |
  | kyc_*     |      | type       |      +------------+
  | role      |      | mode       |
  +-----------+      | status     |
       |             +-----+------+
       |                   |
       |     +-------------+-------------+
       |     |             |             |
       v     v             v             v
  +--------+ +----------+ +-------+ +--------+
  | offers | | list_imgs| |  bids | | flags  |
  +--------+ +----------+ +-------+ +--------+
  | buyer  | | file_path| | amount| | type   |
  | type   | | position | | bidder| | status |
  | status | +----------+ +-------+ +--------+
  +---+----+
      |
      +--------+--------+
      |        |        |
      v        v        v
  +--------+ +------+ +----------+
  |messages| |  tx   | | invoices |
  +--------+ +------+ +----------+
  |content | |amount| | seller   |
  |read_at | |comm. | | due_date |
  +--------+ +--+---+ +----------+
                |
                v
           +---------+
           | reviews |
           +---------+
           | rating  |
           | comment |
           +---------+
```

## API Routes

### Auth (`/auth`)
| Method | Path           | Auth | Description                          |
|--------|---------------|------|--------------------------------------|
| GET    | /auth/register | No   | Registration form                     |
| POST   | /auth/register | No   | Register (rate limited)               |
| GET    | /auth/login    | No   | Login form                            |
| POST   | /auth/login    | No   | Login with email/password (rate limited) |
| GET    | /auth/logout   | No   | Clear cookie and redirect             |

### Listings (`/listings`)
| Method | Path                    | Auth | Description                              |
|--------|------------------------|------|------------------------------------------|
| GET    | /listings              | No   | Browse with filters (category, price, type, mode, search, sort, pagination) |
| GET    | /listings/new          | Yes  | Create listing form                       |
| POST   | /listings/new          | Yes  | Create listing (multipart with images)    |
| GET    | /listings/:id          | No   | Listing detail (images, bids, similar)    |
| POST   | /listings/:id/bid      | Yes  | Place bid on auction (KYC required)       |
| POST   | /listings/:id/buy-now  | Yes  | Buy at auction buy-now price (KYC required) |
| POST   | /listings/:id/offer    | Yes  | Make offer (cash/swap/swap_cash)          |
| POST   | /listings/:id/report   | Yes  | Report listing                            |

### Offers (`/offers`)
| Method | Path                  | Auth | Description                          |
|--------|-----------------------|------|--------------------------------------|
| GET    | /offers               | Yes  | Received + sent offers                |
| POST   | /offers/:id/accept    | Yes  | Accept offer (seller only)            |
| POST   | /offers/:id/reject    | Yes  | Reject offer (seller only)            |
| POST   | /offers/:id/complete  | Yes  | Complete transaction (calculates commission, creates invoice) |

### Messages (`/messages`)
| Method | Path                  | Auth | Description                          |
|--------|-----------------------|------|--------------------------------------|
| GET    | /messages             | Yes  | Inbox (all conversations)             |
| GET    | /messages/:offerId    | Yes  | Chat thread for an offer              |
| POST   | /messages/:offerId    | Yes  | Send message (KYC required, offer must be accepted) |

### Invoices (`/invoices`)
| Method | Path       | Auth | Description              |
|--------|-----------|------|--------------------------|
| GET    | /invoices  | Yes  | Seller's commission invoices |

### Profile (`/profile`)
| Method | Path              | Auth | Description                          |
|--------|------------------|------|--------------------------------------|
| GET    | /profile/settings | Yes  | Edit profile form                     |
| POST   | /profile/settings | Yes  | Update profile (name, bio, address)   |
| GET    | /profile/verify   | Yes  | KYC upload form                       |
| POST   | /profile/verify   | Yes  | Submit KYC document (multipart)       |
| GET    | /profile/:id      | No   | Public profile (listings, reviews)    |

### Admin (`/admin`)
| Method | Path                          | Auth  | Description                           |
|--------|-------------------------------|-------|---------------------------------------|
| GET    | /admin                        | Admin | Dashboard (users, listings, revenue, flags, KYC) |
| GET    | /admin/users                  | Admin | User list (search, filter, pagination) |
| POST   | /admin/users/:id/role         | Admin | Change role                            |
| POST   | /admin/users/:id/ban          | Admin | Ban user (deactivates listings)        |
| POST   | /admin/users/:id/unban        | Admin | Unban user                             |
| GET    | /admin/listings               | Admin | All listings (filter by status, flagged) |
| POST   | /admin/listings/:id/remove    | Admin | Remove listing                         |
| POST   | /admin/listings/:id/approve   | Admin | Approve listing (dismiss flags)        |
| GET    | /admin/flags                  | Admin | Flag queue with pagination             |
| POST   | /admin/flags/:id/dismiss      | Admin | Dismiss flag                           |
| POST   | /admin/flags/:id/action       | Admin | Remove flagged listing                 |
| GET    | /admin/kyc                    | Admin | Pending KYC submissions                |
| POST   | /admin/kyc/:userId/approve    | Admin | Approve KYC                            |
| POST   | /admin/kyc/:userId/reject     | Admin | Reject KYC (with reason)               |
| GET    | /admin/logs                   | Admin | Activity log with pagination           |

### Other
| Method | Path    | Auth | Description                    |
|--------|---------|------|--------------------------------|
| GET    | /       | No   | Homepage (categories, featured listings) |
| GET    | /fees   | No   | Commission/fees page            |
| GET    | /faq    | No   | FAQ page                        |
| GET    | /health | No   | Health check (DB + Redis status)|

## Authentication & Authorization

### Auth flow
1. User registers with email, username, password (+ optional name, location)
2. Password hashed with bcryptjs (10 rounds)
3. JWT signed with `JWT_SECRET`, contains: `id`, `email`, `username`, `name`, `plan`, `role`
4. JWT stored in httpOnly cookie, 7-day expiry
5. Every request: JWT verified -> DB query for ban/role check -> `request.user` populated
6. Role from DB always overrides JWT claim (fresh on every request)

### Role hierarchy
- **owner** > **admin** > **user**
- Owners auto-assigned on startup (first user or specific email)
- Only owners can promote to admin/owner
- Admins cannot ban owners or other admins (unless owner)

### Rate limiting
- In-memory per-IP: 10 attempts per 15-minute window on auth endpoints
- Returns 429 when exceeded

## Security Measures

### Password hashing
- bcryptjs with 10 salt rounds

### Security headers
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 0`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### Content moderation (`utils/moderation.js`)
- Swiss phone number patterns (+41, 0xx xxx xx xx)
- International phone patterns
- Email address detection
- URL detection
- Profanity filter (EN/IT/DE, 30+ words)
- Applied to: listing title + description on creation
- Listings with phone numbers automatically blocked (status='blocked')
- All flags auto-created in `flags` table for admin review

### KYC verification
- Required for: listings > CHF 500, all auctions, offers > CHF 50, messaging
- Accepted documents: passport, ID card, driver's license, CIE
- Upload formats: JPEG, PNG, WebP, PDF
- Admin approval/rejection workflow with reason

### Image upload security
- Allowed extensions: `.jpg`, `.jpeg`, `.png`, `.webp`
- Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`
- Max file size: 10 MB
- Images resized via sharp to 1200x1200 max, JPEG 85% quality
- Filenames: UUID-generated (prevents path traversal)
- Max 5 photos per listing

### SQL injection prevention
- All queries use parameterized placeholders (`$1`, `$2`, etc.)
- Dynamic WHERE clauses built with indexed parameters

### Cookie security
- `httpOnly: true`
- `sameSite: lax`
- `secure: false` (behind Caddy/Tailscale)
- 7-day max age

### Input validation
- Email regex + max 255 chars
- Username: 3-50 chars
- Password: 8-1000 chars
- Title: max 255 chars
- Description: max 10,000 chars
- Bio: max 2,000 chars
- Message content: max 5,000 chars
- Body size limit: 1 MB

## Admin System

### Dashboard metrics
- Total registered users
- Active listings count
- Total revenue (sum of commissions from completed transactions)
- Pending flags count
- Pending KYC submissions count
- Recent flags and recent transactions

### User management
- Paginated user list (25 per page)
- Search by username, email, name
- Filter by role and ban status
- Role changes with hierarchy enforcement
- Ban: deactivates all active listings, sets banned flag
- Unban: clears ban status

### Listing management
- Paginated listing list with status/flagged filters
- Remove listing (set status='removed')
- Approve listing (set status='active', dismiss flags)

### KYC management
- View pending KYC submissions
- Approve: sets `kyc_verified=true`, `kyc_status='verified'`
- Reject: clears document, sets reason, resets status to 'none'

### Flag/report queue
- Paginated flag list with status filter
- Dismiss flag
- Action flag (remove associated listing)

### Activity logging
- All admin actions logged: role changes, bans, unbans, listing removals/approvals, KYC decisions, flag actions
- Paginated log viewer (50 per page)

## Swiss Legal Compliance

### Swiss Code of Obligations (OR)

SwapMart operates as an online marketplace facilitating transactions between private individuals and businesses in Switzerland. All commercial transactions are governed by the Swiss Code of Obligations (Obligationenrecht, OR, SR 220).

- **Contract formation**: Offers and acceptances follow standard Swiss contract law (Art. 1-10 OR)
- **Sale of goods**: Governed by Art. 184-236 OR
- **Warranty**: Seller liability for defects per Art. 197-210 OR

### Consumer Protection (UWG)

Swiss Federal Act on Unfair Competition (Bundesgesetz gegen den unlauteren Wettbewerb, UWG, SR 241):

- **Transparent pricing**: All fees and commissions clearly displayed on `/fees` page
- **No misleading descriptions**: Content moderation prevents deceptive listings
- **Clear terms**: FAQ page with detailed platform rules
- **Right of withdrawal**: Buyers can reject offers; pending offers can be cancelled

### KYC / Anti-Money Laundering (GwG/LBA)

Swiss Anti-Money Laundering Act (Geldwaschereigesetz, GwG, SR 955.0):

- **Identity verification**: KYC required for listings > CHF 500 and all auctions
- **Document types**: Passport, national ID card, driver's license
- **Admin verification**: Manual review and approval/rejection workflow
- **Transaction logging**: All transactions recorded with amounts, commissions, timestamps
- **Audit trail**: Complete admin_log of all administrative actions

### E-commerce Regulations

- **Clear seller identification**: Username, reputation score, member-since date displayed
- **Price transparency**: Commission rates displayed per plan tier
- **Dispute resolution**: Offer accept/reject flow with messaging
- **Delivery information**: Contact info exchanged after completed transaction

### Data Protection (DSG/FADP)

Swiss Federal Act on Data Protection (Datenschutzgesetz, DSG, SR 235.1):

- **Data minimization**: Only essential fields collected (email, username required; name, bio, address optional)
- **Password security**: bcrypt hashed, never stored in plaintext
- **KYC documents**: Stored in isolated directory, accessible only to admins
- **No unnecessary tracking**: Minimal cookies (auth JWT only)
- **Right to deletion**: Users can request account and data deletion

### Commission Transparency

All commission rates publicly documented:

| Plan        | < CHF 50 | CHF 50-1000 | CHF 1000-10000 | > CHF 10000 |
|-------------|----------|-------------|----------------|-------------|
| Free        | 5%       | 8%          | 6%             | 4%          |
| Seller Pro  | 3%       | 6%          | 4%             | 3%          |
| Business    | 2%       | 4%          | 3%             | 2%          |

Pure swaps (no cash component) are commission-free.

## Business Model

### Revenue streams
1. **Transaction commissions**: Tiered rates based on seller plan and transaction amount
2. **Seller plans**: Free / Seller Pro (CHF 9.90/mo) / Business (CHF 29.90/mo)
3. **Future**: Promoted listings, Swiss Post integration fees

### Commission calculation (`utils/commission.js`)
- Looks up seller's plan (free/seller_pro/business)
- Finds applicable tier based on transaction amount
- Returns commission amount and rate
- Commission recorded in `transactions` table
- Invoice auto-generated with 30-day payment term

### Pricing tiers
| Plan        | Price        | Key benefit         |
|-------------|-------------|---------------------|
| Free        | CHF 0       | 5 listings/month     |
| Seller Pro  | CHF 9.90/mo | 30 listings, lower fees |
| Business    | CHF 29.90/mo| Unlimited, lowest fees |

### Auction system
- Auction durations: 3, 5, 7, or 10 days
- Starting price required
- Optional buy-now price
- Minimum bid increment (default CHF 1.00)
- Lazy finalization: auctions finalized on next view after end time
- Winner gets auto-created accepted offer

## Deployment

### Docker container
- Runs via Docker on Mac Mini (Portainer)
- Caddy reverse proxy maps `.local` domain to port 4003
- Tailscale network for team access

### Environment variables
| Variable      | Description                    | Default                                          |
|--------------|--------------------------------|--------------------------------------------------|
| PORT         | Server port                     | 4003                                              |
| DATABASE_URL | PostgreSQL connection string    | postgresql://swapmart_app:swapmart_pass@localhost:5432/stz_swapmart |
| REDIS_URL    | Redis connection string         | redis://localhost:6379                             |
| JWT_SECRET   | JWT signing secret              | change-me                                         |
| COOKIE_SECRET| Cookie signing secret           | change-me                                         |
| UPLOAD_DIR   | File upload directory           | ../data/uploads                                    |
| NODE_ENV     | Environment                     | (not set)                                         |

### Health check
- `GET /health` returns `{ status: 'ok', service: 'swapmart', db: true/false, redis: true/false }`
- Checks both PostgreSQL and Redis connectivity

### Graceful shutdown
- Handles SIGTERM and SIGINT
- Closes Fastify server, PostgreSQL pool, Redis connection

## User Flows

### List Item -> Receive Offer -> Complete

```
  Seller creates listing
  (title, photos, price, category, condition, type)
      |
      +--- KYC check if price > CHF 500 or auction mode
      |
      +--- Content moderation scan
      |    (phone detected? -> BLOCKED)
      |
      v
  Listing ACTIVE on marketplace
      |
      v
  Buyer browses/searches -> Views listing
      |
      +---> Fixed price: Make offer (cash/swap/swap+cash)
      |
      +---> Auction: Place bid / Buy Now
      |
      v
  Offer received by seller
      |
      +---> Accept --> Chat unlocked --> Exchange details
      |                                       |
      |                                       v
      |                              Mark as COMPLETE
      |                              (commission calculated,
      |                               invoice created)
      |
      +---> Reject --> Buyer notified
```

### Auction Flow

```
  Seller creates AUCTION listing (KYC required)
  (starting price, buy-now price, duration, min increment)
      |
      v
  Auction ACTIVE for 3/5/7/10 days
      |
      +---> Bidder places bid (>= starting_price or current + increment)
      |     (KYC required for bidding)
      |
      +---> Bidder uses Buy Now (instant purchase at buy_now_price)
      |
      v
  Auction timer expires
      |
      v
  Lazy finalization on next page view:
      |
      +---> Has bids: highest bidder wins, auto-offer created, listing SOLD
      |
      +---> No bids: listing EXPIRED
```

## Monitoring & Logging

### Activity logs
- `admin_log` table records all admin actions
- Paginated log viewer in admin panel
- Logged: role changes, bans, unbans, listing removals/approvals, KYC decisions, flag actions

### Health check
- `GET /health` checks PostgreSQL and Redis connectivity
- Returns service name and component status

### Error handling
- Global Fastify error handler (sanitized in production)
- Per-route try/catch with fallback views
- Redis connection failure is non-fatal (warn + continue)

### Database indices
- `idx_flags_status`, `idx_flags_listing`, `idx_flags_created`
- `idx_admin_log_created`
- `idx_users_role`, `idx_users_banned`
- `idx_bids_listing`, `idx_bids_bidder`, `idx_bids_amount`
- `idx_listings_mode`, `idx_listings_auction_end`
