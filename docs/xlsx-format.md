# Source xlsx format

The application understands the spreadsheet structure used by the original "Portafoglio" template (Italian). It reads up to **five sheets** — sheet and column names are case-sensitive.

A working anonymised example lives in [`docs/assets/portafoglio_pamontag.xlsx`](./assets/portafoglio_pamontag.xlsx).

## `Securities`
Catalogue of every instrument that appears in the portfolio. If a transaction references a security missing from this sheet the importer auto-creates a stub using whichever identifier is available (ISIN > Ticker > Name), but providing this sheet gives you full control over naming and currency.

| Column         | Required | Used for                                                                                |
|----------------|----------|-----------------------------------------------------------------------------------------|
| Ticker Symbol  | one of   | Yahoo Finance lookup (`AAPL`, `VWCE.DE`, `BTC-USD`…)                                    |
| ISIN           | one of   | 12-char ISIN — required for bonds (drives the Italian bond archive price lookup)        |
| Security Name  | ✅       | Display name across the UI                                                              |
| Currency       | optional | Native trading currency. Defaults to `EUR`. Also accepts the Italian header `Valuta`.   |
| Class          | optional | Free text mapped to a category — see [Category mapping](#category-mapping) below        |

> At least one of **Ticker Symbol** or **ISIN** must be present so prices can be fetched.

## `Transactions_Buy` / `Transaction_Sell`
> Note the **sell** sheet name is singular: `Transaction_Sell`, not `Transactions_Sell`.

One row per purchase / sale. Identical columns on both sheets.

| Column                  | Required | Notes                                                                                |
|-------------------------|----------|--------------------------------------------------------------------------------------|
| Ticker Symbol           | one of   | Matched against the `Securities` catalogue                                            |
| ISIN                    | one of   | Alternative match key                                                                |
| Security Name           | one of   | Fallback match key                                                                   |
| Class                   | optional | Helps when the importer must auto-create the security; mapped to category            |
| Currency Gross Amount   | optional | Currency of the **`Value`** column. Defaults to `EUR`. Accepts `Currency` as an alias.|
| Shares                  | ✅       | Quantity bought / sold. For **bonds**, use the nominal value (e.g. `1000`, `5000`). Must be > 0. |
| Value                   | ✅       | Gross amount in the security's currency, **excluding** fees. Must be > 0. For bonds this is `nominal × clean_price%`. |
| Exchange rate           | optional | FX rate applied at trade time (security currency → EUR). Defaults to `1`.            |
| fees                    | optional | Commissions in EUR                                                                   |
| taxes                   | optional | Capital-gains tax in EUR (sell side); usually empty on buys                          |
| Date                    | ✅       | Trade date (any Excel date format)                                                   |
| Securities account      | optional | Broker / account name (free text)                                                    |

## `Dividends`
| Column         | Required | Notes                                                                                  |
|----------------|----------|----------------------------------------------------------------------------------------|
| Security Name  | ✅       | Matched against `Securities`                                                           |
| Class          | optional | Hint for category when the importer must auto-create the security                      |
| Value          | ✅       | **Net** dividend amount in EUR                                                         |
| taxes          | optional | Withholding tax — stored as a **negative** number in the source spreadsheet. The importer takes the absolute value so *gross = net + |taxes|* always holds.|
| Date           | ✅       | Pay date                                                                               |

## `Stato patrimoniale` (optional)

Additional metadata that gets merged onto matching securities (does not create rows on its own).

| Column     | Notes                          |
|------------|--------------------------------|
| Tipo       | Free text                      |
| Classe     | Free text                      |
| ISIN       | Match key                      |
| Ticker     | Match key                      |
| Nome / Name| Match key                      |
| Area       | Geographic area                |
| Settore    | Industry sector                |
| Emittente  | Issuer                         |

## Category mapping

The free-text `Class` column is normalised to one of: `Stock`, `Bond`, `ETF`, `MutualFund`, `Commodities`, `Crypto`, `Other`.

| If `Class` contains…                                | Mapped to    |
|-----------------------------------------------------|--------------|
| `etf`                                               | ETF          |
| `obblig`, `bond`, or the single letter `o`          | Bond         |
| `oro`, `gold`, `commod`                             | Commodities  |
| `fund`, `fondo`, `mutual`                           | MutualFund   |
| `crypto`, `bitcoin`, `btc`, `eth`                   | Crypto       |
| `azion`, `stock`, or the single letter `a`          | Stock        |
| anything else                                       | Other        |

Matching is case-insensitive.

## Sample

A real anonymised example lives in [`docs/assets/portafoglio_pamontag.xlsx`](./assets/portafoglio_pamontag.xlsx).

## Handling missing data

- Rows without a date, with `shares ≤ 0`, or with `value ≤ 0` are skipped and reported in the import warnings.
- Securities referenced from a transaction sheet but missing from `Securities` are auto-created using the best available identifier (ISIN > Ticker > Name).
- If the same xlsx is uploaded twice, no duplicates are created. Each record gets a **deterministic ID** derived from `(user, security, type, date, shares, value)`, so re-importing simply replaces existing rows in place.
- Rows that were removed from the spreadsheet are *not* automatically deleted from the database — remove them manually from the **Transactions** page if needed.

