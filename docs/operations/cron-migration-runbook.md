# Cron Migration Runbook — Vercel → GitHub Actions

**Migrated:** 2026-05-09  
**Previous scheduler:** Vercel Crons (`vercel.json`)  
**New scheduler:** GitHub Actions (`scheduled-scan.yml`) + Hetzner systemd timer  
**Status:** Active — `vercel.json` crons array is intentionally empty

---

## Why we migrated

Vercel Crons do not provide run logs, retry semantics, or a per-job status page.
GitHub Actions gives us: green/red badges per run, full stdout, automatic retry on
runner failure, and no charge against Vercel's serverless invocation quota.

---

## What runs where

| Task | Old (Vercel) | New |
|---|---|---|
| Strategy scan (market hours) | `/api/cron?task=paper-trading` every 30 min | GitHub Actions `*/15 13-21 * * 1-5` |
| Strategy scan (off-hours) | `/api/cron?task=paper-trading` twice daily | GitHub Actions `0,30 0-12,22-23 * * *` |
| Daily digest | `/api/cron?task=daily` 9am | GitHub Actions (merge into above) |
| Learning loop | `/api/cron?task=learning` 3am | GitHub Actions (merge into above) |
| Position monitor | N/A | Hetzner VPS systemd 24/7 |

---

## User actions required after PR merges

### Step 1 — Generate WEALTH_OS_API_KEY
```bash
openssl rand -hex 32
```
Save the output — you'll need it in steps 2 and 3.

### Step 2 — Add to Vercel environment variables
1. Open Vercel dashboard → your project → **Settings → Environment Variables**
2. Add:
   - Name: `WEALTH_OS_API_KEY`
   - Value: `<output from step 1>`
   - Environments: Production, Preview
3. Click **Save**, then **Redeploy** the latest deployment

### Step 3 — Add to GitHub repository secrets
1. Open GitHub → your repo → **Settings → Secrets and variables → Actions**
2. Add two secrets:
   - `WEALTH_OS_API_KEY` = same value as step 1
   - `NEXT_PUBLIC_SITE_URL` = your production domain, e.g. `https://wealth-os.vercel.app`

### Step 4 — Push the branch
```bash
git push origin claude/build-new-app-FQ6Kx
```

### Step 5 — Verify GitHub Actions ran
- Open GitHub → **Actions** tab
- Look for **"Scheduled Strategy Scan"** workflow
- First run triggers within 16 minutes after push (next cron tick)
- Confirm the job shows a green check

### Step 6 — Verify Supabase has new rows
```sql
SELECT strategy_key, count(*), max(opened_at)
FROM paper_positions
WHERE opened_at > now() - interval '30 minutes'
GROUP BY strategy_key;
```
If rows appear, the pipeline is running end-to-end.

---

## Rollback plan
If GitHub Actions is unavailable, re-enable Vercel crons by restoring `vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron?task=paper-trading", "schedule": "30 14 * * 1-5" },
    { "path": "/api/cron?task=learning",      "schedule": "0 3 * * *" }
  ]
}
```
Note: Vercel's free tier allows max 2 crons at 1-hour granularity; Pro allows daily at any time.

---

## Secrets reference
| Secret | Where set | Purpose |
|---|---|---|
| `WEALTH_OS_API_KEY` | Vercel + GitHub | Authenticates scan-all API calls |
| `NEXT_PUBLIC_SITE_URL` | GitHub only | Production URL for curl target |
