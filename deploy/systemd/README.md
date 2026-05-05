# Systemd Deployment

## Install (on Hetzner VPS as root)

```bash
cp wealth-os-position-monitor.service /etc/systemd/system/
cp wealth-os-scan.service /etc/systemd/system/
cp wealth-os-scan.timer /etc/systemd/system/

systemctl daemon-reload

systemctl enable --now wealth-os-position-monitor
systemctl enable --now wealth-os-scan.timer
```

## Required env in /opt/wealth-os/.env

```
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
WEALTH_OS_API_KEY=...
NEXT_PUBLIC_SITE_URL=https://your-app.vercel.app
```

## Check status

```bash
systemctl status wealth-os-position-monitor
journalctl -u wealth-os-position-monitor -f
journalctl -u wealth-os-scan -f
```
