# Plan Review Feedback 02

Required corrections:

- `project-plans/issue1591/plan/` contains only `00-overview.md`. The plan is not executable under `dev-docs/PLAN.md` / `PLAN-TEMPLATE.md`: it lacks concrete per-phase files for P00–P12/P03a–P11a with prerequisites, expanded requirements, exact file tasks, verification commands, success criteria, and failure recovery.
- Analysis artifacts contradict the overview/specification on critical dependency boundaries:
  - `analysis/dependency-audit.md` still says `packages/policy → @vybestack/llxprt-code-core`.
  - `analysis/integration-contract.md` still allows policy deep imports from core and says core production imports from policy should be zero except index, conflicting with the issue and overview.
  - Pseudocode still includes `@google/genai` and `@vybestack/llxprt-code-telemetry` dependencies for policy.
- Plan IDs are inconsistent: specification/overview use `PLAN-20260609-ISSUE1591`, but multiple analysis/pseudocode files use `PLAN-20260608-ISSUE1591`.
- Phase structure is incomplete for TDD-first execution. Policy source and confirmation bus have RED/GREEN phases but no separate stub phases as required by the template’s stub → TDD → implementation cycle. Test migration/cleanup is bundled into one implementation phase without a preceding TDD or clear worker/verification decomposition.
- P00 preflight is only represented by a template artifact, not an actual phase with required commands/results/gates. It must specifically verify that `packages/settings` does not exist and document the safe handling strategy before implementation proceeds.
- The plan does not provide enough concrete file-path-level integration steps. It lists broad areas like “All25+ tool files” instead of exact files/import rewrites and exact commands.
- Confirmation bus type design is not consistently fixed across artifacts. Some pseudocode still keeps `FunctionCall` from `@google/genai`; it must consistently use `PolicyFunctionCall`, `PolicyToolCallState`, generic `ToolCallsUpdateMessage<T>`, and injected `PolicyLogger`.
- Public API/backward compatibility is under-specified at the phase level. Core re-export shims and consumer migration need exact files, exact exports, and import update lists.
- Policy config handling is contradictory: the overview correctly says no `packages/settings` exists and config orchestration stays in core, but analysis/integration-contract still describes `createPolicyEngineConfig` as part of policy in places.
- Verification must include exact package-specific commands for the new policy package’s tests/build plus the required full suite:
  - `npm run test`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"`
