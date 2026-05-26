# Source xlsx format

The application understands the spreadsheet structure used by the original "Portafoglio" template (Italian). It reads four sheets:

## `Securities`
| Column         | Type   | Used for                  |
|----------------|--------|---------------------------|
| Ticker Symbol  | string | Yahoo Finance lookup       |
| ISIN           | string | Cross-reference identifier |
| Security Name  | string | Display name               |
| Currency       | string | Native currency (EUR/USD/…)|

## `Transactions_Buy` / `Transaction_Sell`
| Column          | Type   | Notes                                          |
|-----------------|--------|------------------------------------------------|
| Ticker Symbol   | string | matched against the security catalogue          |
| ISIN            | string |                                                |
| Security Name   | string |                                                |
| Class           | string | A=Stock, O=Bond, ETF=ETF → mapped to category   |
| Currency Gross Amount | string | EUR/USD/…                                |
| Shares          | number | Units                                          |
| Value           | number | Gross amount in the security's currency        |
| Exchange rate   | number | Used to convert to EUR                         |
| fees            | number | Commissions in EUR                             |
| taxes           | number | Taxes withheld (sell side)                     |
| Date            | date   | Trade date                                     |
| Securities account | string | Broker                                      |

## `Dividends`
| Column         | Type   | Notes                                |
|----------------|--------|--------------------------------------|
| Security Name  | string | Matched to a security record         |
| Class          | string | Optional category hint               |
| Value          | number | Net dividend amount in EUR           |
| taxes          | number | Tax already withheld                 |
| Date           | date   | Pay date                             |

## Sample

A real anonymised example lives in `docs/assets/portafoglio_pamontag.xlsx`.

## Handling missing data

- Rows without a date or with `shares ≤ 0` are skipped and reported in the import warnings.
- Securities referenced from a transaction sheet but missing from `Securities` are auto-created using the best available identifier (ISIN > Ticker > Name).
- If the same xlsx is uploaded twice, no duplicates are created (deterministic IDs).
