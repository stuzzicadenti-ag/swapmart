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

- HTML5 + CSS3 (vanilla, no frameworks)
- BEM methodology for CSS architecture
- GitHub Pages (static hosting)
- GitHub Actions CI/CD

## Architecture

```
swapmart/
├── src/
│   ├── index.html          # Landing page
│   ├── css/
│   │   └── style.css       # Styles (BEM)
│   └── robots.txt          # Search engine directives
├── .github/
│   └── workflows/
│       ├── deploy.yml       # GitHub Pages deployment
│       └── lint.yml         # HTML validation + secret detection
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

## Roadmap

- [ ] i18n support (DE, FR, IT, EN)
- [ ] Backend API and database
- [ ] User authentication and profiles
- [ ] Real-time messaging
- [ ] Swiss Post API integration
- [ ] Payment processing (Stripe/TWINT)
- [ ] Mobile app
- [ ] AI-powered pricing suggestions

## License

All rights reserved. Copyright 2026 Stuzzicadenti AG.
