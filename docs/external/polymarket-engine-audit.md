# External Dependency Audit: KaustubhPatange/polymarket-trade-engine

**Audit date:** 2026-04-27  
**Auditor:** Automated review (Wealth OS integration process)  
**Repo:** https://github.com/KaustubhPatange/polymarket-trade-engine  
**Integration file:** `lib/integrations/polymarket-engine/PolymarketEngineClient.ts`

---

## Checklist

### Scope and purpose
- [x] Repo is clearly scoped: Python REST wrapper around Polymarket CLOB API (order placement, order book, fills, PnL)
- [x] No broad system access beyond Polymarket CLOB endpoints
- [x] No telemetry or data exfiltration observed in codebase

### Dependency hygiene
- [x] Dependencies listed in `requirements.txt` — pinned to specific versions
- [x] No dependencies with known CVEs at audit date (checked via `pip-audit` output in README)
- [x] No `setup.py` install-time code execution
- [ ] **Unpinned transitive deps**: `py-clob-client` pulls in `httpx` without upper bound — monitor for breaking changes

### Authentication / secrets
- [x] Private key never logged — passed only to `py-clob-client` in-process
- [x] No secrets written to disk by the engine process
- [x] Wealth OS wraps the engine behind `FeatureFlagService.canSpend()` — no direct key exposure from monorepo side
- [x] `POLYMARKET_ENGINE_URL` defaults to localhost only — not exposed to external networks by default

### Network surface
- [x] Engine process runs on `localhost:7432` (configurable via `--port`)
- [x] Only outbound connections: `clob.polymarket.com` (HTTPS) and `polygon-rpc.com` (WebSocket for on-chain fills)
- [x] No inbound listener beyond the REST port — no WebSocket server
- [x] `POLYMARKET_ENGINE_URL` should be added to firewall allowlist for production deployments

### Code quality / attack surface
- [x] Input validation on all REST endpoints (Pydantic models)
- [x] No SQL — uses Polymarket SDK, no local DB
- [x] No shell execution / subprocess calls
- [x] No `eval()` or dynamic code execution
- [ ] **Error messages may leak internal paths** in 500 responses — set `debug=False` in production (FastAPI default)

### Operational risk
- [x] Engine is stateless per request — crash does not corrupt local state
- [x] `PolymarketEngineClient.ping()` used as liveness check before order placement
- [x] All order calls wrapped in `try/catch` with `skipped: true` fallback — no uncaught exceptions surface to users
- [x] Hard exit timer (15s before window close) is managed by Wealth OS, not by the engine — reduces blast radius of engine restarts

### Data integrity
- [x] Fill detection uses `orderId` matching — not price-level matching — resistant to fill spoofing
- [x] `hardExitAt` computed from on-chain `endTime` fetched at opportunity detection, not from engine clock
- [x] Quarter-Kelly sizing computed in Wealth OS, not delegated to engine — engine only receives `size` and `limitPrice`

---

## Risk rating

| Category | Rating | Notes |
|---|---|---|
| Supply-chain | **Low** | Small, well-scoped Python package; no install-time execution |
| Runtime secrets | **Low** | Private key stays in engine process; Wealth OS never holds it |
| Network | **Low** | Localhost only by default |
| Availability | **Medium** | Python process must be running; health check gates order placement |
| Order integrity | **Low** | Fill detection + hard exit managed by Wealth OS layer |

**Overall: LOW risk** — suitable for paper trading and production with the mitigations below.

---

## Required mitigations before production use

1. **Pin transitive deps**: add `httpx>=0.27,<0.28` to `requirements.txt` to prevent silent breakage
2. **Set `debug=False`**: ensure `uvicorn` / FastAPI run with `--no-access-log` and `debug=False` in prod
3. **Firewall**: block port 7432 externally; only allow `localhost` or internal VPC traffic
4. **Rotate private key**: use a dedicated Polymarket wallet for Wealth OS — never share with manual trading wallet
5. **Monitor fill latency**: alert if `PolymarketEngineClient.ping()` latency exceeds 200ms — indicates congestion before hard exit window

---

## Re-audit triggers

Re-audit required if any of the following occur:
- `py-clob-client` major version bump
- Polymarket CLOB API breaking changes
- Any `requirements.txt` dependency updated beyond a minor version
