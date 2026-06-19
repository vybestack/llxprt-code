# Phase 27: Impl — App-service Subpath Contracts + command→API map [GREEN: T23, T24]

## Phase ID

`PLAN-20260617-COREAPI.P27`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 26a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P26a.md`

## Requirements Implemented (Expanded)

### REQ-021: runtime-vs-app-service boundary + command→API map

**Full Text**: Durable/config/app concerns (settings mutation, MCP server config add/remove, extension/skill config, memory-file edits, diagnostics/about, sandbox persistence, and completion/command-boundary data) are exposed as stable public subpaths or explicitly classified CLI-local. They are not crammed onto the live `Agent` runtime facade. The command→API map assigns every CLI touchpoint to exactly one of {Agent method | app-service subpath | CLI-local} with no orphan.

**Behavior**:
- GIVEN: the command→API map from the boundary harness
- WHEN: every durable command target is imported
- THEN: each target resolves to a concrete public subpath and the live `Agent` surface remains runtime-only

**Why This Matters**: #1595 can be a thin UI without deep imports, but `Agent` does not become a CLI-shaped god object.

## Implementation Tasks

This phase creates **behavior-real app-service entry points** with concrete exported functions and typed inputs/outputs. Required T23/T24 commands must wrap existing backing services or be explicitly classified CLI-local by the command map. Unsupported/deferred `Result` values are forbidden for required app-service commands; if no backing service exists for a required durable behavior, this phase FAILS and the coordinator stops for maintainer scope clarification. Do not leave package placement or behavior undecided.

### Files to Create/Modify

- `packages/agents/src/app-services/index.ts`
  - Re-export all app-service modules below.
  - `@plan:PLAN-20260617-COREAPI.P27` `@requirement:REQ-021`
- `packages/agents/src/app-services/mcp-config.ts`
  - Durable MCP server config add/remove/list/import/export backed by existing settings/config persistence; no unsupported/deferred Result for required commands.
- `packages/agents/src/app-services/extensions-skills.ts`
  - Extension and skill enable/disable/list config backed by existing extension/skill settings services.
- `packages/agents/src/app-services/memory.ts`
  - Memory/context-file read/write/refresh operations backed by existing memory/context-file services, or classified CLI-local if purely UI-loader state.
- `packages/agents/src/app-services/diagnostics.ts`
  - About/diagnostics data backed by existing config/runtime diagnostics, including active sandbox preference/status source.
- `packages/agents/src/app-services/completions.ts`
  - Prompt/command/at-command/MCP-prompt completion boundaries backed by existing completion data sources, or explicit typed `CliLocalCompletion` entries where data is intentionally CLI-local.
- `packages/agents/src/app-services/command-api-map.ts`
  - The canonical slash command → `{ kind: 'agent' | 'app-service' | 'cli-local', target }` map used by T23/T24.
- `packages/agents/package.json`
  - Add public subpath export: `./app-services.js` → app-services index (and types).
- `packages/agents/src/api/__tests__/helpers/command-api-map.ts`
  - Replace duplicate harness map with import/re-export from `@vybestack/llxprt-code-agents/app-services.js` so P09 boundary specs exercise the real public map.

### Required command classifications

- Agent runtime methods: `/provider`, `/model`, `/profile load/apply`, `/compress`, `/restore`, `/chat clear/resume`, `/tools`, `/directory`, `/auth`, `/key`, `/keyfile`, `/stats`, live `/mcp status/tools/auth`, `/ide` runtime status.
- App-service subpaths: `/mcp add/remove`, extension config, skills config, memory file edits, settings mutation, diagnostics/about, sandbox preference/profile persistence, completions data that is not CLI-local.
- CLI-local: pure rendering/keyboard/dialog commands and command-loader UI mechanics.

### Implementation Rules

- Do not put durable app mutations on `Agent`.
- Do not deep import `src`/`dist` internals from tests; use the public `./app-services.js` subpath.
- Required app-service commands must not return unsupported/deferred results. If a command has no real backing service, classify it CLI-local with rationale or fail the phase for maintainer clarification. Tests assert real data transformations (e.g. add/list/remove round-trips) rather than importability alone.

## Verification Commands

```bash
missing=0
npm test -- --testNamePattern "@plan:.*P27" || missing=1
npm test -- --testNamePattern "T23\b\|T24\b" || missing=1
node -e "const p=require('./packages/agents/package.json'); if(!p.exports['./app-services.js']) { console.error('FAIL no app-services subpath'); process.exit(1) }"
for f in index mcp-config extensions-skills memory diagnostics completions command-api-map; do
  test -f packages/agents/src/app-services/$f.ts || { echo "MISSING app-service $f"; missing=1; }
done
# Boundary: no durable app-service function on Agent runtime surface
grep -rn "mcpAdd\|extensionEnable\|memoryWrite\|sandboxProfileSave" packages/agents/src/api/agent.ts packages/agents/src/api/types.ts && { echo "FAIL durable app op on Agent"; missing=1; }
exit $missing
```

### Deferred Implementation Detection (MANDATORY)

```bash
missing=0
grep -rnE "(TODO|FIXME|HACK|STUB|XXX|WIP|NotYetImplemented|unsupported|deferred)" packages/agents/src/app-services | grep -v ".spec.ts" && { echo FAIL; missing=1; }
grep -rnE "(in a real|for now|placeholder|not yet|will be)" packages/agents/src/app-services | grep -v ".spec.ts" && { echo FAIL; missing=1; }
exit $missing
```

### Semantic Verification Checklist

- [ ] Every durable command in the command→API map resolves to an importable public app-service subpath with behavior-real backing (add/list/remove or read/write round-trip where applicable).
- [ ] Commands that remain CLI-local are explicitly classified with rationale.
- [ ] Durable ops are not added to the live `Agent` runtime surface.
- [ ] Completion boundary has a behavior-real app-service data source or explicit CLI-local classification.
- [ ] P09 T23/T24 boundary specs now pass through public imports.

## Success Criteria

- App-service subpaths and command→API map are concrete, importable, behavior-real, and testable.
- T23/T24 green.
- No deferred implementation markers or NotYetImplemented behavior.

## Failure Recovery

- `git checkout -- packages/agents/src/app-services packages/agents/package.json packages/agents/src/api/__tests__/helpers/command-api-map.ts`; redo.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P27.md`
