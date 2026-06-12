# Phase 04: Consumer Audit + Integration Hardening (CLI, a2a-server, bundle)

## Phase ID

`PLAN-20260610-ISSUE1592.P04`

## Prerequisites

- P03a PASS (consumer imports were already flipped in atomic P03; this phase audits and hardens).

## Requirements Implemented

### REQ-INV-001.3 / REQ-INV-002.3 / REQ-INV-003.3: composition-root wiring uses agents package
### REQ-TEST-001.3: full verification + smoke test
### REQ-DEP-001: final dependency direction

## Implementation Tasks

1. **CLI audit**: systematically audit every CLI file flagged in reverse-dep map §5 plus a fresh grep sweep; produce a table (file → symbols → final import source). Verify: concrete classes (`AgentClient` in `autoPromptGenerator.ts`, factory registrations, `executeToolCall`, ChatSession references) come from `@vybestack/llxprt-code-agents`; type-only imports of staying modules (turn event types, contracts, `Config`) come from `@vybestack/llxprt-code-core`. Fix any miss.
1b. **CLI/a2a TEST surface inventory (mandatory, generated)**: the audit table in tasks 1-2 MUST cover test files, not just production paths. Generate the complete inventory of every CLI and a2a-server source AND test reference to moved symbols/paths across ALL reference forms — static imports (single/double quotes), `export ... from`, dynamic `import()`, `require()`, `vi.mock()` path literals, and mock helper types (e.g. `useTodoContinuation.spec.ts` mocks `AgentClient`):
   ```bash
   grep -rnE "(AgentClient|CoreToolScheduler|ChatSession|SubAgentScope|SubagentOrchestrator|SubagentScheduler|TaskTool|executeToolCall|nonInteractiveToolExecutor)" packages/cli/src packages/a2a-server/src --include="*.ts" --include="*.tsx" | grep -vE "AgentClientContract|ToolSchedulerContract"
   ```
   Every hit gets a disposition row (import flip to agents / contract retarget to core / structural fake / unaffected). vi.mock string literals referencing core module paths that moved MUST be updated to the agents paths or replaced with structural fakes — a vi.mock of a stale path silently no-ops and is a verification fraud vector. Paste the completed table in the completion marker.
2. **a2a-server audit**: same. MANDATORY items: `agent/task.ts:154` `new AgentClient(...)` imports concrete class from `@vybestack/llxprt-code-agents`; `agent/task.ts` `CoreToolScheduler` type usage → contract type from core or concrete from agents (match actual need); verify a2a passes `taskToolRegistration` in its ConfigParameters (a2a-server/src/config/config.ts `createConfigParameters` ~48) — a2a DOES initialize Config (config.ts:44 → initialize at :135-145) and `resolveManagers` auto-creates the managers (toolRegistryFactory.ts:207-226), so TaskTool registers concretely in a2a today; the audit must prove the registered ToolRecord is identical to pre-extraction behavior (REQ-INV-003.3 row a).
3. **Bundle**: run `npm run bundle`; verify esbuild resolves agents workspace; run bundled smoke if that's the normal flow (`node scripts/start.js` path uses bundle or source — verify and document).
4. **Integration test sweep**: `packages/cli/src/integration-tests/**` and root `integration-tests/**` — fix imports/mocks referencing moved paths.
5. Remove any temporarily retained scaffolding from earlier phases (transitional re-exports are forbidden — verify none exist).
6. **`scripts/check-settings-boundary.js` path update**: this standalone boundary script (NOT wired into CI/package.json — verified by grep) hard-codes scan paths including `packages/core/src/agents`, `packages/core/src/core` (line ~470-479) and `packages/providers/src` (also ~508, ~757). After the move those core paths are empty/stale. Update every scanPaths/productionPaths list to add `packages/agents/src` (and keep the now-reduced core paths only if they still contain staying code). Run `node scripts/check-settings-boundary.js` afterward and paste the output. If a check cannot meaningfully apply to agents, document the waiver in the completion marker instead of silently skipping.

## Verification Commands

```bash
# FULL BATTERY (authoritative definition in 00-overview.md — all six items, no subsets)
npm run format && git diff --exit-code && npm run typecheck && npm run build && npm run test && npm run lint
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
grep -rn "llxprt-code-agents" packages/core/src && echo FAIL || echo OK
grep -rn "from '@vybestack/llxprt-code-core'" packages/cli/src --include="*.ts" | grep -E "AgentClient[^C]|CoreToolScheduler[^C]|TaskTool|SubAgentScope|SubagentOrchestrator" && echo "audit these" || echo OK
```

## Success Criteria

Full battery + smoke test green; an interactive-path test (existing integration tests) proves chat + tool call + subagent flows work through the package boundary.

## Completion Marker

`.completed/P04.md` with the consumer audit table and verification outputs.
