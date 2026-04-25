# AutoHedge — Integration Reference

**Source repository**: https://github.com/The-Swarm-Corporation/AutoHedge  
**Integration type**: Read-only reference (git submodule)  
**Status**: Prompt distillation complete; production A/B test pending

---

## What is AutoHedge?

AutoHedge is an open-source agentic hedge fund simulation built on the Swarm framework. It uses 4 specialized agents in a flat topology:

| AutoHedge Agent | Wealth OS Equivalent |
|---|---|
| Director | CIODecisionEngine (synthesis + veto) |
| Quant Analyst | QuantScreeningAgent |
| Risk Manager | RiskManagementAgent |
| Execution Trader | ExecutionTraderAgent (new, wired to broker routing) |

## Distilled prompts

The 4 AutoHedge agent prompts have been rewritten in Wealth OS voice and stored at:

```
lib/integrations/autohedge-distilled/
  director-cio-prompt.ts        — CIO synthesis + veto logic
  quant-analyst-prompt.ts       — Factor analysis + edge validation
  risk-manager-cro-prompt.ts    — Kelly sizing + veto conditions
  execution-trader-prompt.ts    — Order type + timing + broker routing
```

Key improvements over vanilla AutoHedge patterns:
- **Explicit conviction scale (1–10)** with sizing rules tied to each tier
- **Bear case required** — every decision must articulate the downside scenario
- **Counterfactual stress test** — "what would make this the worst trade of the year?"
- **Quarter-Kelly safety multiplier** (AutoHedge uses full Kelly; Wealth OS retail clients need 0.25×)
- **Broker routing awareness** — execution prompt references Alpaca, Coinbase, OANDA, Polymarket

## A/B test configuration

Set `USE_AUTOHEDGE_DISTILLED_PROMPTS=true` in environment to activate the distilled CIO prompt variant. Both variants log to `agent_performance_logs` with `prompt_variant` tag.

```env
USE_AUTOHEDGE_DISTILLED_PROMPTS=false  # default: use native Wealth OS prompts
```

Compare results in **Settings → Calibration → Prompt Variants** after ≥50 decisions.

## How to update

The AutoHedge submodule is read-only:

```bash
# Pull latest AutoHedge changes for review (never merge)
git submodule update --remote docs/external/autohedge

# Review changes
git -C docs/external/autohedge log --oneline -20

# If their prompts have improved, manually port insights to
# lib/integrations/autohedge-distilled/ and update DISTILLED_AT metadata
```

## Licence note

AutoHedge is MIT licensed. We do not ship their code — only our distilled
adaptations. Our distillations are original work inspired by their patterns.
