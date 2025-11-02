# Phase P11: Integration Hardening

## Phase ID
`PLAN-20251028-STATELESS6.P11`

## Prerequisites
- P10/P10a complete

## Objectives
- Ensure no residual Config access remains in GeminiChat/SubAgentScope or supporting modules.
- Update integration documents to reflect final architecture.

## Tasks
1. Run repository-wide searches:
   ```bash
   rg "this\.config" packages/core/src/core/geminiChat.ts
   rg "runtimeContext" packages/core/src/core/subagent.ts
   rg "getEphemeralSetting" packages/core/src
   ```
2. Replace any remaining Config usage with runtime view APIs or log TODO for subsequent plan.
3. Update `analysis/integration-map.md` and `plan/specification.md` integration sections with post-implementation state (`@plan PLAN-20251028-STATELESS6.P11`).

## Completion Criteria
- Grep results confirm only allowed references remain (e.g., temporary Config adapter).
- Documentation updated to reflect removal of legacy dependencies.
