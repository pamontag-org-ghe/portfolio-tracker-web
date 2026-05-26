# Architecture

## High-level

```
┌──────────────────┐       ┌──────────────────┐       ┌─────────────────┐
│  React frontend  │ ───▶  │  Express API     │ ───▶  │  Cosmos DB      │
│  (Static Web App)│       │  (App Service)   │       │  (NoSQL, serverless)
└──────────────────┘       └──────────────────┘       └─────────────────┘
                                    │
                                    ▼
                           ┌──────────────────┐
                           │ Yahoo Finance    │
                           │ (free API, cached)│
                           └──────────────────┘
```

## Backend modules

| Folder                    | Responsibility                                                |
|---------------------------|---------------------------------------------------------------|
| `src/auth/`               | JWT signing/verification, bcrypt password hashing             |
| `src/data/`               | Repository pattern. `local.ts` (JSON files) and `cosmos.ts` (Azure Cosmos DB). Same `Repository` interface. |
| `src/importers/xlsxImporter.ts` | Parses the user-provided xlsx with `exceljs`. Generates **deterministic** transaction IDs for idempotency. |
| `src/market/marketData.ts`| Fetches OHLC data from Yahoo Finance with a sequential queue (avoids rate-limiting). Caches in the price cache repository. |
| `src/market/bondData.ts`  | Downloads the bond historical-price archive from [simpletoolsforinvestors.eu](https://www.simpletoolsforinvestors.eu/documentivari.php), parses semicolon-separated CSV with Italian decimal formatting, and serves prices keyed by ISIN. Used for assets that aren't on Yahoo Finance. |
| `src/portfolio/performanceEngine.ts` | Replays the user's transaction history day-by-day, marks-to-market against cached prices, converts to EUR, and computes a synthetic S&P 500 benchmark by buying equivalent EUR amounts on each net inflow. |
| `src/routes/`             | REST endpoints (`auth`, `portfolio`, `securities`)            |

## Idempotent imports

Every imported entity (security, transaction, dividend) gets an id of:

```
sha256(prefix + userId + securityId + type + date + shares + value).slice(0, 32)
```

Therefore re-uploading the same file always upserts to the same documents — no duplicates are created.

## Price conventions

Securities carry a `priceConvention` field that controls how prices are interpreted:

- `unit` (default) — `price × shares = total in security currency` (stocks, ETFs, gold, etc.).
- `percent` — `price` is the clean price as % of nominal, used for bonds. The value math
  becomes `total = nominal × price / 100`. The frontend displays bond holdings with a
  `%` suffix instead of a currency code.

The xlsx importer flips the convention to `percent` automatically for any security
classified as `Bond` (sheet `Class` value `O` or category text containing "obblig").
It also normalises a known inconsistency in the original spreadsheet template where
the Sell sheet stores bond `Value` as `nominal × clean_price` (no `/100`): when
`value/shares > 10` for a bond, the importer divides by 100 to recover the actual
cash flow.

## Performance & S&P 500 comparison

For each day in the user's history the engine:

1. Applies any transactions ≤ that day (BUY adds to cost basis, SELL realises P&L).
2. Marks the portfolio to market using cached close prices (FX-converted to EUR).
3. Tracks a synthetic S&P 500 position: whenever there's a net cash inflow, the engine "buys" the equivalent EUR amount in `^GSPC` (converted via the USD→EUR FX series).
4. Emits one `PerformancePoint` per calendar day.

Time ranges (`1D / 1W / 1M / YTD / 1Y / 3Y / 5Y / ALL`) reuse this series to compute returns, comparison spreads, etc.

## Data storage

| Container       | Partition key | Sample document                                                             |
|-----------------|---------------|------------------------------------------------------------------------------|
| `users`         | `/id`         | `{ id, email, passwordHash, displayName, createdAt }`                       |
| `securities`    | `/id`         | `{ id, ticker, isin, name, category, currency }`                            |
| `transactions`  | `/userId`     | `{ id, userId, securityId, type, shares, grossAmount, fees, taxes, date }`  |
| `dividends`     | `/userId`     | `{ id, userId, securityId, amount, taxes, date }`                           |
| `priceCache`    | `/symbol`     | `{ symbol, currency, updatedAt, points: [{ date, close }] }`                |

## Frontend

- React 18 + TypeScript + Vite
- Tailwind CSS (dark-mode ready)
- Recharts for the value chart and donuts
- A bespoke SVG heatmap for daily returns
- Auth state cached in `localStorage`
