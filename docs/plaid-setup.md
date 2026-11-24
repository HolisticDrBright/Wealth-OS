# Plaid setup (read-only account linking)

Wealth OS links bank, card, loan, investment and retirement accounts through
Plaid **read-only**: it sees balances and interest rates, never account
numbers, and it cannot move money (no Auth, Transfer or Payment products are
requested).

## 1. Plaid account
1. Sign up at https://dashboard.plaid.com/signup (new US teams start on the
   free Trial plan: up to 10 real linked logins).
2. Dashboard → Developers → Keys: copy the **client_id** and the **Sandbox
   secret**.

## 2. Server environment (Vercel → Project → Settings → Environment Variables)
| Variable | Value |
|---|---|
| `PLAID_ENV` | `sandbox` (later `production`) |
| `PLAID_CLIENT_ID` | your client_id |
| `PLAID_SECRET` | the secret for that environment |
| `PLAID_TOKEN_KEY` | output of `openssl rand -base64 32` |
| `SUPABASE_SERVICE_ROLE_KEY` | already required — the token table is service-role only |

Linking stays switched off (the page says so) until all of `PLAID_CLIENT_ID`,
`PLAID_SECRET` and `PLAID_TOKEN_KEY` are set.

## 3. Database
Apply `supabase/migrations/20260704p_plaid.sql` (and `20260704o_next_dollar.sql`
if not yet applied).

## 4. Try it (sandbox)
Goals page → **Linked accounts** → *Link a bank or credit card* → pick any
bank → username `user_good`, password `pass_good`. Balances appear in the
ladder, debts with APRs feed "best next dollar".

## 5. Going live
Apply for production access in the Plaid dashboard, then set `PLAID_ENV=production`
and the production `PLAID_SECRET`. Request only Transactions, Liabilities and
Investments.

## What happens to the data
| Plaid account | Becomes |
|---|---|
| checking / savings / money market / CD | an `assets` row, category `cash` (counts toward the Safety cushion) |
| brokerage / IRA / Roth / 401(k) / HSA | an `assets` row, category `stock` (crypto exchanges → `crypto`, 529 → `other`) |
| credit card / loan / mortgage | a `debt_accounts` row with its APR (mortgages are left out of the "high-interest debt" step) |
| every account | a `connected_account_profiles` row (provider `plaid`, `synced`) |

Balances refresh daily (the `daily` cron) and on **Refresh**. **Disconnect**
revokes the link at Plaid and deletes every row it created. Access tokens are
encrypted with `PLAID_TOKEN_KEY` (AES-256-GCM) and stored in a table no user
session can read.
