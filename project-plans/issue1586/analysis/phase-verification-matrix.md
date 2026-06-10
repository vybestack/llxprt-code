# Phase Verification Matrix

Plan ID: PLAN-20260608-ISSUE1586

## Reordered Phase Sequence

The phases have been reordered so that package scaffold (P03–P05) happens before auth DI interfaces (P06–P08), then auth move (P09–P11), OAuth split (P12–P14), consumer migration (P15–P17), cleanup (P18), and full verification (P19). This ensures packages/auth exists before any source or test files are created in it.

**Note on Old Phase mapping:** The "Old Phase" column shows the original phase numbering from an earlier plan iteration. During detailed planning, phases were reorganized to ensure correct ordering (scaffold → interfaces → auth move → OAuth → migration → cleanup). The "Old Phase" column is retained for traceability but may cause confusion during execution. **Focus on the "New Phase" column for sequencing.** The old phase columns have been removed from the main verification matrix to avoid confusion; only the new phase numbers are used throughout the plan.</think>

| New Phase | Title | Required Commands |
|-----------|-----------|-------|-------------------|
| P00a | Preflight verification | See preflight-results-template.md |
| P01 | Domain/dependency analysis | Verify analysis artifacts exist and are consistent |
| P01a | Analysis verification | Verify artifacts match codebase |
| P02 | Contract-first pseudocode | Verify pseudocode compliance |
| P02a | Pseudocode verification | Verify numbered pseudocode |
| P02b | Integration contract definition | Verify IC contracts |
| P02c | Integration contract verification | Verify IC-01 through IC-09 |
| P03 | Package scaffold stub | `npm install`; `npm run typecheck --workspace @vybestack/llxprt-code-auth`; auth package typecheck + build + metadata checks (full workspace build deferred to P05a/P19) |
| P03a | Scaffold stub verification | Verify scaffold compiles |
| P04 | Package scaffold TDD/boundary | `npm run test --workspace @vybestack/llxprt-code-auth` |
| P04a | Scaffold test verification | Verify boundary tests |
| P05 | Package scaffold implementation | `npm run build --workspace @vybestack/llxprt-code-auth` |
| P05a | Scaffold implementation verification | Verify build produces dist/ |
| P06 | Interfaces stub | `npm run typecheck --workspace @vybestack/llxprt-code-auth`; forbidden import scan |
| P06a | Interface stub verification | Verify interfaces compile |
| P07 | Interfaces TDD | `npm run test --workspace @vybestack/llxprt-code-auth`; natural-fail expected; auth-package-local tests only |
| P07a | Interface test verification | Verify TDD pass/fail expectations |
| P08 | Interfaces implementation (wires core→auth dependency; factory functions deferred to P17) | `npm run test --workspace @vybestack/llxprt-code-auth`; core structural compat type tests in core |
| P08a | Interface implementation verification | Verify interfaces work with core impls |
| P09 | Auth code move stubs (stub/move scaffolding only; P10 creates new behavioral tests) | `npm run typecheck --workspace @vybestack/llxprt-code-auth`; `node project-plans/issue1586/scripts/verify-auth-extraction-gate.js` |
| P09a | Move stub verification | Verify all 15+20 files exist in auth |
| P10 | Auth code move TDD (creates/adapts behavioral tests with precise pass/fail criteria; compile/public import tests for AuthPrecedenceResolver, flushRuntimeAuthScope, core factory exports) | `npm run test --workspace @vybestack/llxprt-code-auth` |
| P10a | Move test verification | Verify TDD pass/fail expectations |
| P11 | Auth code move implementation | `npm run test --workspace @vybestack/llxprt-code-auth` |
| P11a | Move implementation verification | Verify DI refactoring complete |
| P12 | OAuth split stub | `npm run typecheck --workspace @vybestack/llxprt-code-auth` |
| P12a | OAuth split stub verification | Verify OAuthManager in auth |
| P13 | OAuth split TDD/contract tests | `npm run test --workspace @vybestack/llxprt-code-auth` |
| P13a | OAuth split TDD/contract test verification | Verify OAuthManager split |
| P14 | OAuth split implementation | `npm run test --workspace @vybestack/llxprt-code-auth` |
| P14a | OAuth split implementation verification | Verify split works |
| P15 | Consumer migration scaffolding | `npm run typecheck` |
| P15a | Consumer migration scaffolding verification | Verify import migration |
| P16 | Consumer migration integration tests | `npm run test` |
| P16a | Consumer migration test verification | Verify integration pass |
| P17 | Consumer migration implementation | `npm run test` |
| P17a | Consumer migration implementation verification | Verify all imports migrated |
| P18 | Deprecation cleanup | Anti-shim scans |
| P18a | Cleanup verification | Verify core/src/auth empty |
| P19 | Full verification suite | Full project verification commands |
| P19a | Final semantic review | Behavioral verification |

## Phase-by-Phase Verification Commands

### Analysis Phases (P01–P02c)

```bash
# No production code tests required unless analysis scripts added.
```

### Package Scaffold (P03–P05) — Scaffold BEFORE any source

```bash
# P03: scaffold stub
npm install
npm run build --workspaces
npm run typecheck --workspace @vybestack/llxprt-code-auth
npm run build --workspace @vybestack/llxprt-code-auth
node -e "const p=require('./packages/auth/package.json'); const deps=Object.keys(p.dependencies||{}); if(deps.some(d=>d.includes('vybestack'))) { console.error('FORBIDDEN'); process.exit(1) }"

# P05: scaffold impl
npm run lint --workspace @vybestack/llxprt-code-auth
npm run format --workspace @vybestack/llxprt-code-auth
npm run typecheck --workspace @vybestack/llxprt-code-auth
npm run build --workspace @vybestack/llxprt-code-auth
npm run test --workspace @vybestack/llxprt-code-auth
```

### DI Interfaces (P06–P08) — Interfaces in auth package

```bash
# P06: interface stubs
npm run typecheck --workspace @vybestack/llxprt-code-auth
if rg -n "@vybestack/llxprt-code-core" packages/auth/src --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts' 2>/dev/null; then
  echo "FAIL: forbidden core imports in auth"; exit 1
fi

# P07: interface TDD — auth-package-local PASS; core structural compat FAIL expected (import resolution)
npm run test --workspace @vybestack/llxprt-code-auth
# Auth-package-local tests should PASS (use local DI test doubles)
# Core structural compatibility tests run separately:
npm run test --workspace @vybestack/llxprt-code-core -- src/__tests__/auth-interface-compat.test.ts
# ^ Expected to FAIL until P08 wires core→auth dependency (import resolution).
# These are type-level structural compatibility tests, NOT factory-dependent.

# P08: interface implementation — auth-package-local tests pass; core compat tests now pass (type-level only, NO factory functions)
npm run test --workspace @vybestack/llxprt-code-auth
npm run test --workspace @vybestack/llxprt-code-core -- src/__tests__/auth-interface-compat.test.ts
npm run typecheck --workspace @vybestack/llxprt-code-auth
# Auth-package-local tests pass (unchanged); core structural compat tests now pass (type-level checks only)
# P08 does NOT create or verify factory functions — it wires core→auth dependency and exports DI interfaces.
# Factory functions (createKeyringTokenStore, createAuthPrecedenceResolver) are deferred to P17
```

### Auth Move (P09–P11)

```bash
# P09: move stubs
npm run typecheck --workspace @vybestack/llxprt-code-auth
npm run build --workspace @vybestack/llxprt-code-auth
if rg -n "@vybestack/llxprt-code-core|from ['\"].*\.\./\.\./" packages/auth/src --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts' 2>/dev/null; then
  echo "FAIL: forbidden imports in auth"; exit 1
fi

# P10: move TDD — NATURAL FAIL expected for stub tests; PASS for moved-as-is files
npm run test --workspace @vybestack/llxprt-code-auth

# P11: move implementation — ALL PASS expected
npm run test --workspace @vybestack/llxprt-code-auth
npm run typecheck --workspace @vybestack/llxprt-code-auth
npm run build --workspace @vybestack/llxprt-code-auth
```

### OAuth Split (P12–P14)

```bash
npm run test --workspace @vybestack/llxprt-code-auth
npm run test --workspace @vybestack/llxprt-code
npm run typecheck --workspace @vybestack/llxprt-code-auth
npm run typecheck --workspace @vybestack/llxprt-code
```

### Consumer Migration (P15–P17)

```bash
# P15: migration stubs
npm run typecheck --workspace @vybestack/llxprt-code-auth
npm run typecheck --workspace @vybestack/llxprt-code-core
npm run typecheck --workspace @vybestack/llxprt-code

# P17: migration implementation
npm run test --workspace @vybestack/llxprt-code-auth
npm run test --workspace @vybestack/llxprt-code-core
npm run test --workspace @vybestack/llxprt-code
npm run typecheck --workspace @vybestack/llxprt-code-auth
npm run typecheck --workspace @vybestack/llxprt-code-core
npm run typecheck --workspace @vybestack/llxprt-code
# Verify no CLI/providers auth imports from core/auth
if rg -n "from ['\"]@vybestack/llxprt-code-core/auth" packages/cli/src packages/providers/src --glob '*.ts' 2>/dev/null; then
  echo "FAIL: old core/auth imports remain"; exit 1
fi
```

### Cleanup (P18)

```bash
if find packages/core/src/auth -type f 2>/dev/null | grep -q .; then
  echo "FAIL: files remain under packages/core/src/auth/"; exit 1
fi
npm run typecheck
npm run build
```

### Full Verification (P19)

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load ollamaglm51 "write me a haiku and nothing else"
```

## TDD Pass/Fail Expectations

| Phase | TDD Stage | Expected Test Result | Rationale |
|-------|-----------|---------------------|-----------|
| P07 | DI interface TDD | **Auth-package-local: PASS. Core compat: FAIL** | Auth-package-local tests use local DI test doubles (no external deps) — should all pass. Core structural compatibility tests (in `packages/core/src/__tests__/`) fail until P08 wires core→auth dependency (enabling import resolution). These are type-level structural compatibility tests, not factory-dependent. They verify TypeScript structural typing (SecureStore satisfies ISecureStore, etc.), not runtime construction. |
| P08 | DI interface impl | **Auth-package-local: PASS. Core compat: PASS** | Core→auth dependency established. Core structural compatibility tests now pass (type-level: SecureStore satisfies ISecureStore, SettingsService satisfies ISettingsService, DebugLogger satisfies IDebugLogger). These are type-level checks only — they do NOT construct auth instances or call factory functions. Factory functions (`createKeyringTokenStore`, `createAuthPrecedenceResolver`) are deferred to P17 because they construct classes that don't exist in `@vybestack/llxprt-code-auth` yet. |
| P10 | Auth move TDD | **Mixed: PASS + FAIL** | Moved-as-is files (types, token-merge, token-sanitization, proxy/framing) should pass; **precedence.ts** requires refactoring (replace SettingsService/ProviderRuntimeContext type imports with ISettingsService/IProviderRuntimeContext; replace debugLogger value import with injected IDebugLogger boundary) — after refactoring its tests should pass; DI-refactored stubs (keyring-token-store, auth-precedence-resolver, codex-device-flow) still throw NotYetImplemented. P10 creates/adapts behavioral tests with precise pass/fail criteria per component (see P10 plan). Compile/public import tests verify AuthPrecedenceResolver and flushRuntimeAuthScope are exported from auth main entry. |
| P11 | Auth move impl | **PASS** | All DI refactoring complete; all tests should pass. DI-refactored: keyring-token-store, auth-precedence-resolver, codex-device-flow, and **precedence.ts** (SettingsService/ProviderRuntimeContext type imports → ISettingsService/IProviderRuntimeContext; debugLogger → injected IDebugLogger). |
| P13 | OAuth split TDD/contract tests | **PASS** (interface already exists) | OAuthManager interface defined in precedence.ts moves with it; structural compatibility tests should pass. |
| P16 | Consumer migration TDD | **Mixed: PASS + FAIL** | Some consumer paths may fail if import migration stubs not yet complete |

## Marker Commands

```bash
# Marker verification — use inverted pattern to avoid rg exit-1 on no matches under set -e
if rg -n "@plan:PLAN-20260608-ISSUE1586\.P[0-9A-Za-z]+" packages 2>/dev/null; then echo "OK: plan markers found"; else echo "WARN: no plan markers found yet"; fi
if rg -n "@requirement:REQ-AUTH-" packages 2>/dev/null; then echo "OK: REQ-AUTH markers found"; else echo "WARN: no REQ-AUTH markers found yet"; fi
if rg -n "@requirement:REQ-DEP-" packages 2>/dev/null; then echo "OK: REQ-DEP markers found"; else echo "WARN: no REQ-DEP markers found yet"; fi
if rg -n "@requirement:REQ-INTF-" packages 2>/dev/null; then echo "OK: REQ-INTF markers found"; else echo "WARN: no REQ-INTF markers found yet"; fi
if rg -n "@requirement:REQ-OAUTH-" packages 2>/dev/null; then echo "OK: REQ-OAUTH markers found"; else echo "WARN: no REQ-OAUTH markers found yet"; fi
```

Analysis-only phases (P01–P02c) do not require production code markers unless they modify code.

## Phase Template Note

This plan uses a simplified refactoring-oriented phase template. Not every section from the full PLAN-TEMPLATE is used in each phase (e.g., "Example Data", "Data Schemas", "Performance Requirements" are omitted when not applicable to a pure refactoring phase). The essential sections — Prerequisites, Tasks, Verification Commands, and Success Criteria — are present in every phase. **PLAN-TEMPLATE compliance:** Each phase that modifies production code MUST include:
1. **Per-phase executable verification command(s):** Either explicit per-phase commands or a reference to the shared verifier script (`node project-plans/issue1586/scripts/verify-auth-extraction-gate.js`) that constitutes equivalent evidence of phase completion.
2. **Failure Recovery:** Git revert of the individual phase commit is the standard recovery strategy (documented here and in `execution-tracker.md`).
3. **Phase Completion Marker:** Completion is tracked centrally in `execution-tracker.md` rather than per-phase `.completed/` files. Each phase that modifies production code MUST have at least one executable verification command set that constitutes evidence of completion.

This exception is documented here and applies across all phase files for traceability.