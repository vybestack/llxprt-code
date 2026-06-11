# Phase P05: Policy Source — GREEN Implementation

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Implementation
Prerequisites: P04a (RED tests verified)

## Purpose

Replace P03b skeleton stubs with real policy source files copied from core. Update all imports to be local (within package). Core originals remain untouched — they are not modified or deleted in this phase. All P04 RED tests must now pass (GREEN state).

## Worker / Verifier Assignment

- **Worker**: typescriptexpert (copies source files, updates imports within policy package)
- **Verifier**: typescriptreviewer (verifies GREEN state in P05a)

## Expanded Requirements

- **COPY** (not move) types.ts, policy-engine.ts, stable-stringify.ts, utils.ts, toml-loader.ts from core to policy, **replacing P03b skeleton stubs**. Core originals remain intact until P10d.
- Copy (not move) shell-utils subset (SHELL_TOOL_NAMES, splitCommands, hasRedirection)
- Copy (not move) TOML policy files to policy/src/policies/
- Split config.ts: pure utilities copy to policy, orchestration stays in core
- All imports within policy package use relative paths only
- Zero imports from `@vybestack/llxprt-code-core`, `@google/genai`, `@vybestack/llxprt-code-telemetry`
- All P04 tests pass (GREEN)
- **No changes to any core source files in this phase.** Core originals are read-only at this point.

## @plan / @requirement Marker Requirements

Every function/class/module created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20260609-ISSUE1591.P05
 * @requirement REQ-002.1
 */
```

Marker mapping:
- `types.ts`: `@requirement REQ-002.1`
- `policy-engine.ts`: `@requirement REQ-002.2`
- `stable-stringify.ts`: `@requirement REQ-002.3`
- `utils.ts`: `@requirement REQ-002.4`
- `toml-loader.ts`: `@requirement REQ-002.5`
- `config.ts`: `@requirement REQ-004.1`
- `src/index.ts` barrel: `@requirement REQ-005.1`
- `utils/shell-utils.ts`: `@requirement REQ-002.7`
- `policies/*.toml`: `@requirement REQ-002.6`

**Note**: `@plan`/`@requirement` markers go in TypeScript source files and test files only. JSON files (`package.json`, `tsconfig.json`) cannot contain comments. Do not add markers to JSON or other non-commentable formats. Markers for TOML files may be placed in the TOML-loader TS file or in the phase completion doc instead.

## Exact File Tasks

| File | Action | Description |
|------|--------|-------------|
| `packages/policy/src/types.ts` | COPY from `core/src/policy/types.ts` | No content changes (self-contained). Core original untouched. |
| `packages/policy/src/stable-stringify.ts` | COPY from `core/src/policy/stable-stringify.ts` | No content changes. Core original untouched. |
| `packages/policy/src/utils.ts` | COPY from `core/src/policy/utils.ts` | No content changes. Core original untouched. |
| `packages/policy/src/utils/shell-utils.ts` | CREATE (copy subset) | Copy SHELL_TOOL_NAMES, splitCommands, hasRedirection only |
| `packages/policy/src/policy-engine.ts` | COPY from `core/src/policy/policy-engine.ts` | Update import: `'../utils/shell-utils.js'` → `'./utils/shell-utils.js'`. Core original untouched. |
| `packages/policy/src/toml-loader.ts` | COPY from `core/src/policy/toml-loader.ts` | No import changes needed (already relative). Core original untouched. |
| `packages/policy/src/config.ts` | CREATE (split from core) | Pure utilities: getPolicyDirectories, getPolicyTier, formatPolicyError, migrateLegacyApprovalMode, constants |
| `packages/policy/src/policies/*.toml` | COPY from `core/src/policy/policies/` | read-only.toml, write.toml, discovered.toml, yolo.toml. Core originals untouched. |
| `packages/policy/src/index.ts` | UPDATE | Add exports for all copied types, classes, utilities |

### Import Updates for Copied Files

**policy-engine.ts:**
```
OLD: import { SHELL_TOOL_NAMES, splitCommands, hasRedirection } from '../utils/shell-utils.js'
NEW: import { SHELL_TOOL_NAMES, splitCommands, hasRedirection } from './utils/shell-utils.js'
```

**config.ts (pure utilities moved):**
```
REMOVE: import { Storage } from '../config/storage.js'
REMOVE: import { ApprovalMode as ApprovalModeEnum } from '../config/config.js'
REMOVE: import { coreEvents } from '../utils/events.js'
REMOVE: import { debugLogger } from '../utils/debugLogger.js'
USE: own ApprovalMode from './types.js
USE: storage paths as function parameters instead of Storage.*
```

## Verification Commands

```bash
# 1. All P04 tests must now PASS (GREEN state)
npm run test --workspace @vybestack/llxprt-code-policy
# Expected: ALL tests pass

# 2. Verify zero forbidden imports in production code (using rg --glob)
rg "from.*@vybestack/llxprt-code-core|from.*@google/genai|from.*@vybestack/llxprt-code-telemetry" packages/policy/src --type ts -g '!*.test.ts'
# Expected: zero matches

# 3. Verify zero forbidden imports in test code
rg "from.*@vybestack/llxprt-code-core|from.*@google/genai|from.*@vybestack/llxprt-code-telemetry" packages/policy/src -g '*.test.ts'
# Expected: zero matches

# 4. Verify package builds
npm run build --workspace @vybestack/llxprt-code-policy
npm run typecheck --workspace @vybestack/llxprt-code-policy

# 5. Verify TOML files copied
ls packages/policy/src/policies/
# Expected: read-only.toml, write.toml, discovered.toml, yolo.toml

# 6. Verify @plan markers
rg "@plan.*PLAN-20260609-ISSUE1591\.P05" packages/policy/src --type ts -g '!*.test.ts' --count
# Expected: 7+ files with markers

# 7. Verify @requirement markers
rg "@requirement:REQ-002" packages/policy/src --type ts -g '!*.test.ts' --count
# Expected: 5+ files
```

## Success Criteria

- [ ] All P04 tests pass (GREEN state achieved)
- [ ] Zero forbidden imports in policy production code AND tests
- [ ] Policy package builds and typechecks
- [ ] TOML policy files present in policy/src/policies/
- [ ] Shell utils subset copied (only SHELL_TOOL_NAMES, splitCommands, hasRedirection)
- [ ] Config split correct: pure utilities in policy, orchestration NOT copied
- [ ] `packages/policy/src/index.ts` exports all public API types
- [ ] **Core source files untouched** — no core files modified or deleted in this phase
- [ ] @plan markers present in all policy TypeScript production files
- [ ] @requirement markers mapping to REQ-002, REQ-004, REQ-005

## Failure Recovery

1. If tests still fail — identify which test, read the error, fix the source (not the test)
2. If forbidden import found — replace with local type or injected interface
3. If build fails — check import paths, verify all moved files have correct relative paths
4. Targeted revert: `git checkout -- packages/policy/src/<specific-file>` to revert only the failing file
5. Do NOT use `rm -rf packages/policy` or broad `git checkout -- packages/`
