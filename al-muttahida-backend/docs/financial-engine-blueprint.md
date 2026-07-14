# Financial Engine Audit Blueprint

## 1. Accounting Engine

The backend is the only authority for CEO/dashboard financial metrics. Frontend screens may display returned values, but must not invent capital, equity, variance, or monthly averages.

Core formulas:

- Total Assets = Cash in Safe + Inventory Value at Cost + Outstanding Receivables.
- Cash in Safe = posted incoming payments - posted outgoing payments.
- Inventory Value at Cost = SUM(products.quantity * products.purchase_price).
- Outstanding Receivables = SUM(sales.remaining) for non-cancelled sales with remaining > 0.
- Total Liabilities = Outstanding Payables = SUM(purchases.remaining) for non-cancelled purchases with remaining > 0.
- Paid-in Capital = subscribed shareholder capital if > 0; otherwise posted capital deposits minus capital withdrawals if > 0; otherwise settings.baseline_capital.
- Retained Earnings = all-time sales - all-time COGS - all-time expenses.
- Total Equity = Paid-in Capital + Retained Earnings.
- Variance = Total Assets - (Total Liabilities + Total Equity).

Strict verification rule:

- If ABS(Variance) <= 0.01 EGP, the balance sheet is accepted as balanced.
- If ABS(Variance) > 0.01 EGP, the response must return `isBalanced=false`, the signed `accountingVariance`, and `trace[]` showing every account bucket and its data driver.
- No forced floors are allowed in the engine. Negative cash, negative retained earnings, and negative variance are valid audit signals.

Future ledger hardening:

- Add `journal_entries` and `journal_lines` tables with debit/credit line totals.
- Every sale, purchase, payment, expense, capital deposit, capital withdrawal, profit distribution, and profit withdrawal posts a balanced journal entry in the same transaction as the source document.
- A nightly audit reconciles operational source tables to journal balances and emits an exception report by source document id.

## 2. Shareholders And Capital

Data flow:

- Shareholders screen writes to `shareholders.capital` and `shareholder_transactions`.
- CEO metrics endpoint reads those tables directly.
- The dashboard receives `capital`, `capitalSource`, `baselineCapital`, `retainedEarnings`, and `shareholdersEquity` from `/reports/dashboard/metrics`.

Fallback rule:

- If subscribed capital in `shareholders` is 0 and net posted capital transactions are 0, use `settings.baseline_capital`.
- Default baseline is 8,500,000 EGP.
- The response marks `capitalSource='system_baseline'` so the UI can clearly label it as an initial configuration value.

Equity card rule:

- Capital is not the same as total equity.
- Display paid-in capital separately.
- Display shareholders/equity as Paid-in Capital + Retained Earnings.
- Show retained earnings as its own explanatory subvalue to avoid double counting the live net profit value.

## 3. Expenses And Time Filters

Query contract:

```sql
SELECT COALESCE(SUM(amount), 0) AS periodExpenses
FROM expenses
WHERE (@startDate IS NULL OR date >= @startDate)
  AND (@endDate IS NULL OR date <= @endDate);
```

Monthly average:

- If both dates are present: monthSpan = max(1, inclusiveDays / 30.44).
- If no full range is present: monthSpan = 12.
- Monthly Average Expenses = periodExpenses / monthSpan.

This value must be returned by the backend as `monthlyAverageExpenses`.

## 4. UI Scroll Guardrails

Layout rules:

- `html`, `body`, and `#root` must provide height foundation: `min-height: 100%` or `min-height: 100vh`.
- Never apply global `overflow: hidden` to `body`, app root, layout root, or page wrappers.
- Header/sidebar may be fixed, but the content surface must remain scrollable.
- Main layout shell owns page padding and uses `min-h-screen min-w-0 overflow-y-auto`.
- Individual pages should avoid their own `min-h-screen overflow-y-auto` unless they are deliberate inner panes.
- Tables and grids should use `min-w-0`, responsive wrapping, and local horizontal overflow where needed.

Implemented entry points:

- Backend financial source of truth: `GET /reports/dashboard/metrics`.
- Baseline capital storage: `settings.baseline_capital`.
- Frontend CEO report now consumes backend totals for capital, equity, assets, liabilities, variance, and average expenses.
