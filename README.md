# Snakiox Backend

Node.js backend for the Snakiox game flow. Local development can use
`.data/snakiox.json`; production should use PostgreSQL so multiple API instances
can serve traffic safely.

1. Wallet signs a registration message.
2. Backend registers the wallet.
3. Backend creates one active game session at a time.
4. Player submits the loss result.
5. Backend locks the result and signs the mint payload.
6. Contract can verify the backend signature before minting.
7. Wallet can repeat the flow until it has minted 3 total Snakiox NFTs.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Set `GAME_SIGNER_PRIVATE_KEY` to the private key for the backend signer wallet that your contract trusts.

The server starts on `http://localhost:3000` by default.

## Production storage

Create a managed PostgreSQL database, then configure:

```env
NODE_ENV=production
STORAGE_DRIVER=postgres
DATABASE_URL=postgresql://user:password@host:5432/snakiox
DATABASE_POOL_MAX=30
APP_ORIGIN=https://your-frontend.example
TRUST_PROXY=1
```

Initialize the tables once:

```bash
npm run db:init
```

Do not run production with `STORAGE_DRIVER=json`. JSON storage is intentionally
single-instance and is only suitable for local development.

For a busy mint, run multiple backend instances behind a load balancer and cap
the total database connections across all instances. For example, four
instances with `DATABASE_POOL_MAX=20` can use up to 80 PostgreSQL connections.
The `/health` route is a liveness check and `/ready` verifies storage access.

The API includes compression, per-IP request limits, request timeouts,
transactional mint recording, and graceful shutdown. Put an edge service or
load balancer in front for DDoS protection and shared rate limiting.

## Routes

- `GET /health`
- `GET /ready`
- `POST /auth/register`
- `GET /game/status/:wallet`
- `POST /game/start`
- `POST /game/complete`
- `GET /game/result/:wallet`
- `POST /game/mint-record`
- `POST /replay/save`
