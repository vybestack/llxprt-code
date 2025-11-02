# PlanExec: Stateless Runtime Remediation (STATELESS7)

Plan ID: PLAN-20251029-STATELESS7  
Generated: 2025-10-29  
Scope: Remediate residual Config dependencies in runtime context, GeminiChat, SubAgentScope, and provider adapters to fully realise STATELESS6 goals and unblock subagent rollout.

## Objectives

1. `AgentRuntimeContext` exposes only the data/functions supplied at construction time—no internal lookups, no Config fallbacks.
2. `GeminiChat` builds all dependencies (provider, telemetry, tool metadata) before instantiation and operates solely on those injected values.
3. `SubAgentScope` constructs runtime state, provider, telemetry, and tool metadata directly from the subagent profile; foreground Config is never touched.
4. Validation/testing utilities construct runtime contexts explicitly (provider, telemetry, tools) so tests never rely on implicit Config access.
5. Red/green TDD enforced: add failing tests or greps first, then implement, recording outputs in `.completed/` artifacts.

## Phase Overview

| Phase | Title | Summary |
|-------|-------|---------|
| P01 | Gap Verification | Capture current regressions via targeted failing tests/greps; document red state. |
| P02 | Runtime Context Refactor | Ensure factory accepts only explicit data/functions (provider, telemetry, tools) and never performs Config lookups. |
| P03 | GeminiChat Stateless Operation | Refactor GeminiChat to compute provider/telemetry/tool inputs before construction; remove `_providerContext` and Config reach-backs. |
| P04 | SubAgentScope Stateless Operation | Build subagent provider/telemetry/tool snapshots from profile data; eliminate foreground Config usage. |
| P05 | Hardening & Verification | Update tests/helpers, add greps ensuring no Config usage in runtime flow, run full lint/build/test suites. |

Each phase will use PlanExec best practices: failing test first, record results under `.completed/` with command output, then implement.

## Governance

- **Owner:** Codex (GPT-5)
- **Review cadence:** After each phase completion; no overlaps.
- **Exit criteria:** All new/updated tests green; verified absence of `config.` access in GeminiChat/SubAgentScope/runtime context/providers; existing suites still pass (`npm test`, `npm run test:ci`, `npm run lint`, `npm run build`).
