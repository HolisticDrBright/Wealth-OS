# Wealth OS — Position Monitor on Hetzner

Single-page runbook for deploying the 24/7 position monitor to a Hetzner CX22.

**Cost:** ~$5 USD/month (CX22, Helsinki or Ashburn)  
**Why Hetzner:** Persistent long-running process; not suitable for serverless functions.

---

## 1. Provision the server

In the [Hetzner Cloud Console](https://console.hetzner.cloud):
1. **New Server** → Location: Helsinki (`hel1`) or Ashburn (`ash`)
2. Type: **CX22** (2 vCPU, 4 GB RAM)
3. Image: **Ubuntu 24.04 LTS**
4. SSH keys: paste your public key
5. User data: paste the contents of `deploy/hetzner/cloud-init.yml`
6. Click **Create**

The cloud-init script handles all software installation automatically.
Skip to **Step 5** if you used cloud-init.

---

## 2. Manual software setup (if not using cloud-init)

```bash
# Connect
ssh root@<hetzner-ip>

# Firewall
ufw default deny incoming
ufw allow 22/tcp
ufw enable

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git

# PM2 process manager
npm install -g pm2

# Create service user
useradd -m -s /bin/bash wealthos
```

---

## 3. Deploy the application

```bash
# Clone repo
mkdir -p /opt/wealth-os
git clone https://github.com/HolisticDrBright/Wealth-OS /opt/wealth-os
cd /opt/wealth-os

# Install production dependencies only
npm ci --omit=dev

# Create env file
cp deploy/hetzner/.env.example /opt/wealth-os/.env
# Edit .env and fill in all REQUIRED values
nano /opt/wealth-os/.env

chown -R wealthos:wealthos /opt/wealth-os
```

---

## 4. Install systemd service

```bash
cp deploy/systemd/wealth-os-position-monitor.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now wealth-os-position-monitor
```

---

## 5. Verify it's running

```bash
# Live logs
journalctl -u wealth-os-position-monitor -f

# Should see:
# Position Monitor started, connecting to Supabase + brokers...
# [PositionMonitor] /health endpoint on port 3001

# Health check
curl http://localhost:3001/health
# {"status":"ok","uptime":42,"positionsTracked":3}

# Or use the bundled health script
bash /opt/wealth-os/deploy/hetzner/healthcheck.sh

# Systemd status
systemctl status wealth-os-position-monitor
```

---

## 6. Updates

```bash
cd /opt/wealth-os
git pull origin main
npm ci --omit=dev
systemctl restart wealth-os-position-monitor
journalctl -u wealth-os-position-monitor -f
```

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Service won't start | `journalctl -u wealth-os-position-monitor -n 50` — usually missing env var |
| Health returns 503 | Supabase unreachable; check `SUPABASE_URL` in `.env` |
| No new positions closing | Run `SELECT * FROM worker_heartbeats;` in Supabase — confirm `last_seen` is recent |
| High CPU | Check `pm2 monit` or `top`; a backoff loop may be spinning |
