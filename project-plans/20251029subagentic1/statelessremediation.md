# PLAN-20251029-STATELESS-REMEDIATION

## Objective
Retrofix the gaps left by **PLAN-20251028-STATELESS6** so that `SubAgentScope` and related subagent flows operate exclusively on injected runtime bundles with zero dependence on the foreground `Config`. This ensures the new Task/Subagent orchestration can rely on truly isolated state when launching subagents.

## Context
- Execution tracker for PLAN-20251028-STATELESS6 is marked ✅, but several “P10” TODOs remain in `packages/core/src/core/subagent.ts`.
- `SubAgentScope` still calls `executeToolCall` and `getToolRegistry` on the foreground `Config`, and uses `getEnvironmentContext(foregroundConfig)`.
- The orchestrator (`SubagentOrchestrator`) now provides isolated runtime bundles; we must finish the stateless migration so SubAgentScope consumes those bundles directly.
- Downstream consumers (Task tool, future multi-agent support) require these fixes before we wire Task→Subagent execution.

## Remediation Plan (Test-First)

### R01 – Audit & Requirements Reconciliation
- Re-open PLAN-20251028-STATELESS6 compliance: list each outstanding TODO / Config usage.
- Confirm remaining requirements from that plan (REQ-STAT6-001/2/3) and map them to concrete code deltas still pending.

### R02 – Red Tests: Stateless Tool/Env Usage
- Update or add tests in `packages/core/src/core/subagent.test.ts` to fail if:
  - `SubAgentScope.create` touches the foreground `Config` for tool registries.
  - `executeToolCall` is invoked with the foreground `Config`.
  - Environment context is not sourced via a runtime-supplied loader.
- Add regression guard ensuring runtime tool view (`runtimeContext.tools`) is used for filtering.

### R03 – Red Tests: Runtime View Wiring
- Extend stateless tests (`subagent.stateless.test.ts`) to assert that overrides injecting custom tool/telemetry/history providers are consumed, proving Config is out of the loop.
- Add coverage that `runtimeBundle` from `SubagentOrchestrator` threads through unchanged.

### R04 – Implementation (Green)
- Refactor `SubAgentScope` to:
  - Use `runtimeBundle.toolsView` (or injected tool registry) instead of `foregroundConfig`.
  - Route tool execution through a stateless executor that leverages the runtime’s provider runtime context & adapters.
  - Replace `getEnvironmentContext(foregroundConfig)` with an injected environment loader from overrides or runtime context.
  - Make `foregroundConfig` optional/removed once the refactor is complete.
- Ensure `executeToolCall` path accepts injected registries/history aligned with the runtime bundle.

### R05 – Integration Verifications
- Run targeted suites: `npm run test -- SubAgentScope AgentRuntimeLoader`.
- Re-run stateless regression guards (`subagent.stateless.test.ts`) and Task orchestration tests once updated.
- Execute full lint/typecheck/test/build.
- Update PLAN-20251028-STATELESS6 tracker with remediation notes.

### R06 – Documentation & Plan Closure
- Amend `dev-docs/runtime-loader.md` and stateless plan docs to reflect the completed migration.
- Record remediation outcome and new evidence in PLAN-20251028-STATELESS6 compliance artifacts (`COMPLIANCE-REVIEW.md`).
- Close this remediation plan only after tracker and documentation reflect the true state.

## Success Criteria
- `packages/core/src/core/subagent.ts` contains no direct calls to `Config` or foreground tool registries.
- All tool execution, environment loading, and telemetry operate on supplied runtime bundle components.
- Tests enforce stateless behaviour, preventing regressions.
- PLAN-20251028-STATELESS6 compliance report is corrected with the new evidence trail.
