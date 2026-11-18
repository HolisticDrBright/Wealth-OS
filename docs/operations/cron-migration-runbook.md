# Scheduler Runbook — Vercel Crons + optional GitHub Actions scan

**Updated:** 2026-11-17 (Phase 1.7 — brought in line with `vercel.json`)
**Primary scheduler:** Vercel Crons (`vercel.json`) — ACTIVE
**Optional booster:** GitHub Actions `scheduled-scan.yml` — present but NOT armed until secrets are set

---

## What actually runs today

`vercel.json` registers exactly two crons (Vercel Hobby allows 2):

| Cron | Schedule (UTC) | What it does |
|---|---|---|
| `/api/cron?task=daily` | `0 13 * * *` (13:00 daily) | crypto/forex price sync → news sentiment → paper-trading pass → auto-scoring |
| `/api/cron?task=daily-ops` | `30 4 * * *` (04:30 daily) | tipp-floors, sweep, ops-watchdog, regime-allocator, ledger, advisory-staleness; + lifecycle & agent-calibration on Mondays; + behavior-gap on the 1st |

Both authenticate with `Authorization: Bearer $CRON_SECRET` (Vercel injects it).
Since Phase 1.2, every task body is a **direct function call** in
`lib/cron/tasks.ts` — there are no HTTP self-calls and no dependency on
`NEXT_PUBLIC_SITE_URL` inside the cron path.

### Tasks that exist but are NOT scheduled

`sync`, `copy`, `simulate`, `score`, `rebalance`, `harvest-scan`,
`sync-crypto`, `sync-forex`, `paper-trading`, `promote`, `learning`,
`strategy-scientist`, and the individual ops tasks can all be fired manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://<your-deployment>/api/cron?task=strategy-scientist"
```

(Or use the **Run** button on the Vercel → Settings → Cron Jobs page, which
bypasses deployment protection.)

---

## Optional: higher-frequency scanning via GitHub Actions

`.github/workflows/scheduled-scan.yml` hits `/api/internal/scan-all` every
15 min during US market hours and every 30 min off-hours. It is **inert until
you set two GitHub repository secrets** — without them the workflow fails
silently and nothing scans.

Why you'd want it: the once-daily 13:00 UTC cron misses every session-gated
strategy window (options Sunday/Monday windows, forex session opens, crypto
day-of-week gates). The 15-minute scan samples all of them.

### Arming steps

1. Generate a key: `openssl rand -hex 32`
2. Vercel dashboard → project → **Settings → Environment Variables**:
   - `WEALTH_OS_API_KEY` = the key (Production + Preview), then redeploy.
3. GitHub → repo → **Settings → Secrets and variables → Actions**:
   - `WEALTH_OS_API_KEY` = same key
   - `NEXT_PUBLIC_SITE_URL` = your production URL (e.g. `https://wealth-os-brown.vercel.app`)
4. Verify: GitHub **Actions** tab → "Scheduled Strategy Scan" goes green within
   ~16 minutes, and new rows appear:

```sql
SELECT strategy_key, count(*), max(opened_at)
FROM paper_positions
WHERE opened_at > now() - interval '30 minutes'
GROUP BY strategy_key;
```

---

## Secrets reference

| Secret | Where set | Purpose |
|---|---|---|
| `CRON_SECRET` | Vercel env | Authenticates `/api/cron` + `/api/sync` + `/api/execute-copy-trades` (fails closed if unset) |
| `WEALTH_OS_API_KEY` | Vercel env + GitHub secret | Authenticates `/api/internal/scan-all` |
| `NEXT_PUBLIC_SITE_URL` | GitHub secret | curl target for the Actions scan only (the cron path no longer uses it) |

---

## Rollback / changes

- To change schedules, edit `vercel.json` and redeploy. Hobby tier: max 2
  crons, daily granularity.
- To stop the Actions scan, delete the two GitHub secrets or disable the
  workflow in the Actions tab; Vercel crons are unaffected.
