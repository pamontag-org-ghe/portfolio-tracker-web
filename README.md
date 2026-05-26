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

Requires **Node.js ≥ 20** and **npm ≥ 10**.

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
- `JWT_SECRET` — always change in production
- `CORS_ORIGINS` — comma-separated allow-list (use `*` to disable)
- `VITE_API_BASE_URL` — used by the frontend at build time

## Documentation

- 🏛️ [Architecture overview](./docs/architecture.md)
- 📑 [xlsx file format](./docs/xlsx-format.md)
- ☁️ [Deployment guide](./infra/README.md)

## License

MIT
