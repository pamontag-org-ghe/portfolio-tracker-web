# Portfolio Tracker Web

Full-stack portfolio tracker that lets users upload an xlsx of their investments and visualise performance over time (daily, weekly, monthly, YTD, 1y, 3y, 5y, all-time), compared against the S&P 500.

- **Backend**: Node.js + Express + TypeScript
- **Frontend**: React + Vite + TypeScript + Tailwind + Recharts
- **Database**: NoSQL — Azure Cosmos DB in production, JSON file store for local dev (same `IRepository` interface)
- **Market data**: Yahoo Finance (stocks, ETFs, FX) + [simpletoolsforinvestors.eu](https://www.simpletoolsforinvestors.eu) (bond historical prices)
- **Hosting**: Azure App Service (backend), Azure Static Web Apps (frontend), Cosmos DB serverless

## Features

- 👤 Email/password auth (bcrypt + JWT)
- 📤 Drag-and-drop xlsx import — **idempotent**, no duplicates on re-upload
- ✏️ Manual add / edit / delete of transactions
- 📊 Dashboard with KPI cards (value, invested, unrealized P/L, realized + dividends)
- 🧾 **Bond-aware** pricing: clean prices quoted as % of nominal, automatic mark-to-market from the Italian bond archive (BTPs, government bonds, EuroTLX)
- 📈 Line chart of portfolio value vs synthetic S&P 500 over any range
- 🟦 Calendar heatmap of daily returns (last year)
- 🍩 Allocation donuts by category and currency
- 🌐 FX-aware: USD/EUR (and any other currency) is converted via Yahoo's FX series
- 📱 Mobile-friendly responsive layout, dark-mode ready

## Repository layout

```
backend/    Express API, repository pattern, importer, market data, performance engine
frontend/   React SPA: auth, dashboard, charts, file upload
infra/      Azure Bicep templates + deploy scripts
docs/       xlsx samples + architecture + import-format docs
```

## Quick start (local)

Requires **Node.js ≥ 22** and **npm ≥ 10**.

```bash
# 1. Install all workspaces
npm run install:all

# 2. Configure environment (defaults work out of the box)
cp .env.example backend/.env
cp .env.example frontend/.env

# 3. Run backend (http://localhost:4000) + frontend (http://localhost:5173) together
npm run dev
```

Open <http://localhost:5173> → **Register** → **Import** → upload `docs/assets/portafoglio_pamontag.xlsx` → **Dashboard** 🎉

The local backend uses a JSON file store under `backend/.data/` — delete that folder to reset.

## Production build

```bash
npm run build
npm start          # serves the backend on $PORT (defaults to 4000)
```

The frontend output goes to `frontend/dist/` and is intended for Azure Static Web Apps (or any static host).

## Deploy to Azure

See [`infra/README.md`](./infra/README.md) for full instructions. TL;DR:

```powershell
cd infra
./deploy.ps1 -ResourceGroup portfolio-tracker -BaseName myportfolio01
```

This provisions Cosmos DB (serverless), App Service B1, and a Free-tier Static Web App, then deploys both halves.

## API summary

| Method | Path                                | Auth | Purpose                                  |
|--------|-------------------------------------|------|------------------------------------------|
| GET    | `/api/health`                       | no   | Liveness probe                            |
| POST   | `/api/auth/register`                | no   | Create user                               |
| POST   | `/api/auth/login`                   | no   | Issue JWT                                 |
| GET    | `/api/auth/me`                      | yes  | Current user                              |
| POST   | `/api/portfolio/import`             | yes  | Upload xlsx (multipart `file`)            |
| GET    | `/api/portfolio/holdings`           | yes  | Current holdings (aggregated)             |
| GET    | `/api/portfolio/transactions`       | yes  | All transactions                          |
| POST   | `/api/portfolio/transactions`       | yes  | Add transaction                           |
| PUT    | `/api/portfolio/transactions/:id`   | yes  | Update transaction                        |
| DELETE | `/api/portfolio/transactions/:id`   | yes  | Delete transaction                        |
| GET    | `/api/portfolio/dividends`          | yes  | All dividends                             |
| GET    | `/api/portfolio/performance`        | yes  | Series + metrics vs S&P 500 for every range|
| GET    | `/api/portfolio/allocation`         | yes  | Allocation by category and currency       |
| GET    | `/api/securities`                   | yes  | List of known securities                  |
| GET    | `/api/securities/:symbol/history`   | yes  | Historical daily closes (cached)          |

## Configuration

See [`.env.example`](./.env.example). Key variables:

- `STORAGE_DRIVER=local|cosmos` — switch between local JSON storage and Azure Cosmos DB
- `JWT_SECRET` — see [Authentication & the JWT secret](#authentication--the-jwt-secret) below
- `CORS_ORIGINS` — comma-separated allow-list (use `*` to disable)
- `VITE_API_BASE_URL` — used by the frontend at build time

### Authentication & the JWT secret

The backend uses [JSON Web Tokens (JWT)](https://jwt.io) for stateless authentication.
When you log in successfully:

1. The server creates a small signed payload — *"this token belongs to user `xyz`, expires in 7 days"*.
2. That payload is **signed** with `JWT_SECRET` using HMAC-SHA256, producing the bearer token sent back to the browser.
3. On every subsequent API call the browser sends the token in the `Authorization: Bearer …` header.
4. The server **verifies the signature** with the same `JWT_SECRET`; if it matches, the request is trusted.

So `JWT_SECRET` is essentially the master key that proves a token came from your server.

| Topic | Why it matters |
|---|---|
| 🔑 **Strength** | Use a long random string (≥ 32 bytes). A weak secret can be brute-forced offline and an attacker could forge tokens for any user. The deploy script generates a cryptographically-random 48-byte URL-safe string by default. |
| 🤫 **Confidentiality** | Treat it like a database password. **Never commit it to git** and never expose it client-side. In Azure it lives in App Service "Application settings" only. |
| 🔄 **Rotation** | If you change `JWT_SECRET`, every existing token becomes invalid — all users have to log in again. That's a feature, not a bug: rotate after any suspected leak. |
| ⏱️ **Same value across replicas** | If you scale the backend horizontally, every instance must share the same secret, otherwise tokens issued by one server are rejected by another. |
| 🧪 **Local dev** | The default `dev-only-change-me` in `.env.example` is fine for `npm run dev`. The backend logs a warning and refuses to call it secure when `NODE_ENV=production`. |

Generate a strong secret on demand:

```powershell
# PowerShell (Windows / cross-platform)
$bytes = New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
```

```bash
# macOS / Linux
openssl rand -base64 48 | tr '+/' '-_' | tr -d '='
```

The `infra/deploy.ps1` and `infra/deploy.sh` scripts do this for you automatically when `-JwtSecret` / `JWT_SECRET` is not provided, and print the generated value so you can save it.

## Documentation

- 🏛️ [Architecture overview](./docs/architecture.md)
- 📑 [xlsx file format](./docs/xlsx-format.md)
- ☁️ [Deployment guide](./infra/README.md)

## License

MIT
