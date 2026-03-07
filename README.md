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

## Tech Stack

- **Runtime**: Node.js (ESM)
- **Framework**: Fastify 5
- **Template Engine**: EJS
- **Database**: PostgreSQL (raw pg Pool)
- **Cache**: Redis (ioredis)
- **Auth**: JWT cookies + bcryptjs (10 rounds)
- **Image Processing**: sharp
- **File Uploads**: @fastify/multipart
- **WebSocket**: @fastify/websocket

## License

Proprietary -- Stuzzicadenti AG
