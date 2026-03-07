# SwapMart

Switzerland's fairest marketplace — trade, swap, and sell with lower fees.

## Overview

SwapMart is a Swiss-focused marketplace that disrupts the traditional buy/sell model with a unique barter system. With only 3% commission (vs 8-12% on Ricardo.ch), Swap + Cash deals, and 5 free listings per month, SwapMart makes trading fair and flexible.

## Features

- **Low Fees** — Only 3% commission (capped at CHF 50) vs 8-12% elsewhere
- **Barter System** — Trade items directly with 0% fee on pure swaps
- **Swap + Cash** — Mix items and money in a single deal
- **8 Categories** — Trading Cards, Electronics, Cars, Apartments, Fashion, Furniture, Sports, Collectibles
- **Swiss Post Integration** — Tracked shipping with label generation
- **Verified Profiles** — ID verification, ratings, and trade history
- **Money Guard** — Free escrow protection on all transactions

## Tech Stack

**Frontend:** HTML5 + CSS3 (vanilla, BEM) — GitHub Pages
**Backend:** Node.js + Express + SQLite (better-sqlite3) — JWT auth

## Architecture

```
swapmart/
├── src/                     # Frontend (landing page)
│   ├── index.html
│   ├── css/style.css
│   └── robots.txt
├── api/                     # Backend REST API
│   ├── server.js            # Express API (auth, listings, swaps, messages)
│   ├── migrate.js           # Database migration runner
│   ├── package.json         # Dependencies
│   ├── openapi.yaml         # OpenAPI 3.0 spec
│   ├── .env.example         # Environment template
│   └── migrations/
│       └── 001_initial.sql  # PostgreSQL/SQLite schema
├── .github/workflows/
│   ├── deploy.yml
│   └── lint.yml
├── .gitignore
└── README.md
```

## Deployment

| Branch | Environment | URL |
|--------|------------|-----|
| `dev` | Preview | Auto-deployed on push |
| `main` | Production | [stuzzicadenti-ag.github.io/swapmart](https://stuzzicadenti-ag.github.io/swapmart/) |

## CI/CD Pipeline

```
Push to dev  ──→ Lint ──→ Deploy Preview
Push to main ──→ Lint ──→ Deploy Production
```

## Development

```bash
git clone https://github.com/stuzzicadenti-ag/swapmart.git
cd swapmart
open src/index.html
```

## Pricing Model

| Plan | Price | Commission | Listings |
|------|-------|-----------|----------|
| Free | CHF 0 | 3% | 5/month |
| Seller Pro | CHF 9.90/mo | 2% | 30/month |
| Business | CHF 29.90/mo | 1.5% | Unlimited |

## Competitive Advantage vs Ricardo.ch

| Feature | SwapMart | Ricardo.ch |
|---------|----------|-----------|
| Commission | 3% | 8-12% |
| Commission Cap | CHF 50 | CHF 290 |
| Barter/Swap | Yes (0% fee) | No |
| Swap + Cash | Yes | No |
| Money Guard | Free | Paid |
| Free Listings | 5/month | Varies |

## API Quick Start

```bash
cd api
cp .env.example .env
npm install
npm run migrate
npm run dev
# API running on http://localhost:3000
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /auth/register | - | Register user |
| POST | /auth/login | - | Login (JWT) |
| POST | /auth/refresh | - | Refresh token |
| GET | /users/me | Yes | My profile |
| PATCH | /users/me | Yes | Update profile |
| GET | /listings | - | Search listings |
| POST | /listings | Yes | Create listing |
| GET | /listings/:id | - | Get listing |
| PATCH | /listings/:id | Yes | Update listing |
| DELETE | /listings/:id | Yes | Remove listing |
| POST | /swaps | Yes | Propose swap |
| GET | /swaps | Yes | My swaps |
| POST | /swaps/:id/accept | Yes | Accept swap |
| POST | /swaps/:id/reject | Yes | Reject swap |
| GET | /messages/:swapId | Yes | Get messages |
| POST | /messages/:swapId | Yes | Send message |

## Roadmap

- [x] i18n support (DE, FR, IT, EN)
- [x] Backend API and database
- [x] User authentication (JWT)
- [ ] Real-time messaging (WebSocket)
- [ ] Swiss Post API integration
- [ ] Payment processing (Stripe/TWINT)
- [ ] Mobile app
- [ ] AI-powered pricing suggestions

## License

All rights reserved. Copyright 2026 Stuzzicadenti AG.
