# SwapMart

Swiss marketplace for buying, selling, and swapping items with lower fees than traditional platforms. Combines fixed-price listings with an auction system and a unique barter/swap feature. Supports tiered seller plans, KYC verification, real-time messaging, and a comprehensive admin panel with content moderation.

## Quick Start

```bash
cd app
npm install
# Set environment variables (see below)
npm run migrate
npm run seed
npm start
```

### Environment Variables

| Variable      | Description                 | Default |
|--------------|-----------------------------|---------|
| PORT         | Server port                  | 4003    |
| DATABASE_URL | PostgreSQL connection string | postgresql://swapmart_app:swapmart_pass@localhost:5432/stz_swapmart |
| REDIS_URL    | Redis connection string      | redis://localhost:6379 |
| JWT_SECRET   | JWT signing secret           | change-me |
| COOKIE_SECRET| Cookie signing secret        | change-me |
| UPLOAD_DIR   | Image upload directory       | ../data/uploads |

## Documentation

See [DOCS.md](DOCS.md) for full technical documentation, architecture, database schema, API routes, legal compliance, and deployment details.

## Features

- **Listing modes**: Fixed-price, auction (3/5/7/10 days), swap/barter
- **SEO-friendly slug URLs**: Ricardo-style `/listings/{title-slug}-{random-hex}` (prevents enumeration)
- **Tiered seller plans**: Starter (free, 4%), Plus (CHF 9.90/mo, 2.5%), Pro (CHF 24.90/mo, 1%)
- **KYC verification**: Required for auctions and offers > CHF 50
- **Real-time messaging**: WebSocket-based chat between buyer/seller
- **Content moderation**: Auto-scan for phone numbers, emails, URLs at listing creation
- **Commission system**: Tiered rates based on seller plan
- **Invoice generation**: Automatic invoices for completed transactions
- **Review system**: 1-5 stars + comments after transactions
- **Warning system**: 3 active warnings = auto-ban, 6-month expiry
- **Admin panel**: Dashboard, user/listing/flag/KYC/warning management, audit logs
- **i18n**: English, Italian, German, French with language dropdown
- **Responsive nav**: Profile dropdown, language dropdown, logged-in vs logged-out states

## Tech Stack

- **Runtime**: Node.js (ESM)
- **Framework**: Fastify 5
- **Template Engine**: EJS
- **Database**: PostgreSQL (raw pg Pool, parameterized queries)
- **Cache**: Redis (ioredis)
- **Auth**: JWT cookies + bcryptjs (10 rounds)
- **Image Processing**: sharp
- **File Uploads**: @fastify/multipart
- **WebSocket**: @fastify/websocket
- **i18n**: Flat JSON locale files (en, it, de, fr)

## Security & Performance

- **CSRF protection**: Double Submit Cookie pattern on all state-changing forms
- **Compression**: @fastify/compress with gzip and Brotli support
- **OG meta tags**: Open Graph tags for rich social media previews
- **Accessibility**: aria-labels on interactive elements, proper form labels, sr-only class for screen readers
- **Lazy loading**: `loading="lazy"` on images for faster initial page loads
- **Descriptive alt text**: Meaningful alt attributes on all images
- **Input constraints**: maxlength attributes on all text inputs
- **Validation tests**: 94 tests covering input validation, auth flows, and edge cases

## License

Proprietary -- Stuzzicadenti AG
