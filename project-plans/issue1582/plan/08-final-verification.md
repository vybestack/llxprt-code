# Phase 8: Final Verification

**Subagent:** None — run by coordinator directly
**Prerequisite:** Phase 7 per-module tests pass verification

## Goal

Final validation that all acceptance criteria are met. No code changes — just verification and metrics.

## Task 8.1: Run all existing tests
```bash
npm run test
```

## Task 8.2: Run lint/typecheck/format/build
```bash
npm run lint && npm run typecheck && npm run format && npm run build
```

## Task 8.3: Coverage comparison
```bash
# Before starting refactor (baseline — should have been captured before Phase 1):
npx vitest run packages/cli/src/config/ --coverage 2>/dev/null | tail -20

# After refactor: same command, compare percentages
# Coverage must not decrease
```

## Task 8.4: Smoke test
```bash
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

## Task 8.5: Validate line counts

Run `wc -l` on all files in `packages/cli/src/config/`:
```bash
wc -l packages/cli/src/config/*.ts | sort -n
```

Expected targets:
| File | Max Lines |
|------|-----------|
| `config.ts` (orchestrator) | ≤180 |
| `cliArgParser.ts` | ≤150 |
| `yargsOptions.ts` | ≤500 |
| `environmentLoader.ts` | ≤150 |
| `toolGovernance.ts` | ≤250 |
| `mcpServerConfig.ts` | ≤150 |
| `approvalModeResolver.ts` | ≤100 |
| `providerModelResolver.ts` | ≤120 |
| `profileResolution.ts` | ≤250 |
| `profileRuntimeApplication.ts` | ≤150 |
| `interactiveContext.ts` | ≤250 |
| `configBuilder.ts` | ≤250 |
| `postConfigRuntime.ts` | ≤350 |
| `*Contracts.ts` | ≤80 each |

**Hard gate: NO file exceeds 800 lines.**

## Task 8.6: Validate function sizes

```bash
# Quick check for large functions (this is approximate — manual review needed for accuracy)
grep -n "^export function\|^export async function\|^function\|^async function" packages/cli/src/config/config.ts packages/cli/src/config/cliArgParser.ts packages/cli/src/config/configBuilder.ts packages/cli/src/config/postConfigRuntime.ts packages/cli/src/config/interactiveContext.ts
```

**Hard gate: NO function body exceeds 80 lines.**

Key risk areas:
- `loadCliConfig` orchestrator → if >80 lines, split into `loadCliConfig` (entry) + `resolvePreConfigState` (helper)
- `buildConfig` → split into sub-builders if >80 lines
- `finalizeConfig` → split into sub-functions if >80 lines

## Task 8.7: Mechanical verification (no stale imports)

```bash
# 1. Verify ALL imports from config/config.js — should only have loadCliConfig
grep -rn "from.*config/config" packages/cli/src/ --include="*.ts" --include="*.tsx" | grep -v "\.test\." | grep -v "__tests__"

# 2. Verify no moved symbols imported from config.ts
grep -rn "from.*config/config" packages/cli/src/ --include="*.ts" --include="*.tsx" | grep -E "parseArguments|CliArgs|READ_ONLY_TOOL_NAMES|loadHierarchicalLlxprtMemory|isDebugMode|loadEnvironment"
# Expected: ZERO hits

# 3. Verify no runtime accessor re-exports remain in config.ts
grep -rn "getCliRuntimeConfig\|getCliRuntimeServices\|getCliProviderManager\|getActiveProviderStatus\|listRuntimeProviders" packages/cli/src/config/config.ts
# Expected: ZERO hits
```

## Acceptance Criteria Checklist

- [ ] No single file exceeds 800 lines
- [ ] No single function exceeds 80 lines
- [ ] All existing tests pass (`npm run test`)
- [ ] Test coverage does not decrease
- [ ] No backward compatibility re-exports — callers import from canonical sources
- [ ] Clean architecture with typed interfaces between modules
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run format` passes (no unformatted code)
- [ ] `npm run build` succeeds
- [ ] Smoke test passes
- [ ] No stale imports (mechanical verification)
