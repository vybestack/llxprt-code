# Phase 00: Overview

Plan ID: PLAN-20260608-ISSUE1586

## Purpose

Extract `packages/auth` from core and CLI auth code with zero dependency on core/cli/providers/tools. AuthPrecedenceResolver is the public entry point. Provider-specific adapters are registered. OAuth manager is split between auth domain interface and CLI implementation. Direct vs proxy auth cleanly separated.

## Total Phases: 19 (+ verification phases)

## Design Decisions

1. **OAuthProvider interface stays in CLI** (`packages/cli/src/auth/types.ts`). Used only by CLI adapter classes; AuthPrecedenceResolver uses `OAuthManager` interface instead. Can move to auth later if cross-package need arises. This decision is consistent across all plan artifacts.

2. **packages/storage is absent** from the current repository. Auth defines `ISecureStore`/`IProviderKeyStorage` DI interfaces locally — they are authored in auth (not imported from a missing package) because auth owns the contract for what it needs from storage subsystems. When storage is extracted, interfaces can migrate without changing auth's public behavior. This is a deferred dependency, not a conflict. **This is an explicit repository-reality deviation from issue #1586's `packages/storage` dependency — issue #1586 states `packages/auth` should depend on `packages/storage`, but since `packages/storage` doesn't exist, the plan uses local DI interfaces as interim. Documented as an accepted deviation with preflight evidence and out-of-scope rationale in `analysis/final-architecture.md` and `analysis/integration-contract.md`.** **Interim design note (Blocker 6):** `KeyringTokenStore` in auth continues to use `@napi-rs/keyring` via the core `SecureStore` implementation and `node:fs`/`node:path` file-lock fallbacks in the existing `KeyringTokenStore` code. The plan explicitly accepts that `KeyringTokenStore`'s Node filesystem persistence (file locking for concurrent keyring access, homedir resolution fallbacks) remains in the implementation file in auth as-is during this extraction. These Node builtins (`node:fs/promises`, `node:path`, `node:os`) are production dependencies of auth's `KeyringTokenStore`, not DI boundary violations — `ISecureStore` defines the abstract storage contract, but `KeyringTokenStore` itself has legitimate file-lock/fallback logic using Node builtins. Core's `SecureStore` (`@napi-rs/keyring` native module) is NOT imported into auth — it stays in core and is injected via `ISecureStore`. This interim design is explicitly accepted and documented.

3. **CLI OAuthManager implementation stays in CLI.** Issue #1586 says oauth-manager.ts and CLI-specific auth logic should move. The plan interprets this as: the **interface** moves to auth (making auth domain independent), while the **implementation** (preflight-verified line count of CLI-specific orchestration) stays in CLI. Moving CLI implementation would create a cycle (auth depends on CLI types). Full decomposition of OAuthManager into smaller domain objects is deferred as a potential follow-up.

4. **Simplified refactoring-oriented phase template:** Not every PLAN-TEMPLATE section is used in each phase (e.g., "Example Data", "Data Schemas", "Performance Requirements" are omitted when not applicable). Essential sections — Prerequisites, Tasks, Verification Commands, and Success Criteria — are always present. **PLAN-TEMPLATE compliance:** Each phase that modifies production code MUST include: (1) per-phase executable verification command(s) or a reference to the shared verifier script (`node project-plans/issue1586/scripts/verify-auth-extraction-gate.js`); (2) Failure Recovery section: git revert of the individual phase commit is the standard recovery strategy; (3) Phase Completion Marker: tracked centrally in `execution-tracker.md` with executable verification commands as mechanically equivalent evidence. This compliance approach is noted here and applies across all phase files for traceability.

5. **`flushRuntimeAuthScope` moves to `packages/auth`:** This function is auth-domain logic (flushing runtime-scoped auth credentials) defined in `precedence.ts`. It moves with `precedence.ts` to `packages/auth/src/precedence.ts` and is exported from the auth package main entry (REQ-API-001). Core may re-export for consumer convenience via main index (not deep-path shim). Current consumers: `packages/core/src/core/StreamProcessor.ts` (relative import), `packages/providers/src/openai/openai-oauth.spec.ts` (deep-path import), `packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts` (type import via `types.js`), `packages/cli/src/auth/BucketFailoverHandlerImpl.ts` and `auth-status-service.ts` and `packages/cli/src/runtime/runtimeContextFactory.ts` (via core main-index).

6. **Core re-export policy:** Direct main-index re-exports for convenience are allowed (`export { X } from '@vybestack/llxprt-code-auth'`); wrapper/deep-path compatibility shims are forbidden. Core's existing `./auth/precedence.js` and `./auth/types.js` subpath exports in `exports` field must be removed after migration.

7. **`precedence.ts` vs `auth-precedence-resolver.ts` responsibility:** `precedence.ts` currently imports `SettingsService` (type-only) from `../settings/SettingsService.js`, `ProviderRuntimeContext` (type-only) from `../runtime/providerRuntimeContext.js`, and `debugLogger` (value import) from `../utils/debugLogger.js`. When moving to `packages/auth`, these MUST be refactored: (1) type-only imports are replaced with `ISettingsService`/`IProviderRuntimeContext` interfaces; (2) the `debugLogger` value import is replaced with an injected `IDebugLogger` boundary. After refactoring, `precedence.ts` has zero DI dependencies — self-contained types, cache logic, and `OAuthManager` interface only. `auth-precedence-resolver.ts` defines the `AuthPrecedenceResolver` class that composes those primitives with injected DI interfaces (`ISettingsService`, `IProviderKeyStorage`, `IDebugLogger`, `IProviderRuntimeContext`). Both move to `packages/auth`. The class depends on `precedence.ts`, not vice versa.

8. **P07/P08 pass/fail coherence:** P07 interface TDD tests and P08 interface implementation are auth-package-local only. Core structural compatibility tests live in `packages/core/src/__tests__/`, NOT in `packages/auth/`. P07 creates core structural compatibility tests that are **type-level only** — they verify TypeScript structural typing (e.g., `SettingsService` satisfies `ISettingsService`), not runtime instantiation. These tests fail in P07 because core cannot import from `@vybestack/llxprt-code-auth` until P08 wires the dependency (import resolution failure). P08 wires the core→auth dependency, enabling imports to resolve, at which point the type compatibility tests pass. **Factory functions are not created or verified in P07/P08.** Core factory functions (`createKeyringTokenStore`, `createAuthPrecedenceResolver`) are deferred to P17 because they construct `KeyringTokenStore` and `AuthPrecedenceResolver` classes that do not exist in `packages/auth` until P09-P11. P07/P08a only verify type-level structural compatibility and auth-package-local interface contract tests.

9. **Test migration policy for auth-package tests:** Core auth tests that import `@vybestack/llxprt-code-core` or `@vybestack/llxprt-code-providers` MUST be refactored with local DI test doubles before moving to `packages/auth`. All 20 test files move to `packages/auth` (7 require DI refactoring, 13 move as-is). Known cross-package dependencies: `precedence.adapter.test.ts` imports providers; `invalidateProviderCache.test.ts` and `precedence.test.ts` import core `SettingsService`; `keyring-token-store` tests import core `SecureStore`/`KeyringAdapter`; `auth-integration.spec.ts` and `oauth-logout-cache-invalidation.spec.ts` import core symbols. All are refactorable with DI test doubles. Zero tests relocated to owning packages. **P09/P10 TDD ordering:** P09 is stub/move scaffolding only. Relocating existing tests as part of P09 is a refactoring exception (tests already exist; relocation is not new TDD). P10 creates or adapts behavioral tests with precise expected pass/fail criteria. The expected outcome of P09's test relocation is that all relocated tests compile in `packages/auth` and that the 13 as-is tests pass, while the 7 DI-refactored tests depend on stub wiring status. P10 creates additional behavioral tests with explicit pass/fail criteria.

10. **Build order and workspace registration:** `packages/auth` MUST appear before `packages/core` in root `package.json` workspaces so `npm run build --workspaces` builds auth first. Consumer tsconfigs (core, cli, providers) MUST include path aliases for `@vybestack/llxprt-code-auth`. `npm install` MUST run after workspace/dependency changes to update `package-lock.json`. Fresh checkout test must pass.

11. **Providers dependency model (acyclic DAG):** `packages/providers` depends on `@vybestack/llxprt-code-auth` for auth symbols (AuthPrecedenceResolver, OAuthManager, token types) AND on `@vybestack/llxprt-code-core` for non-auth utilities (SettingsService). This is an acyclic dependency: auth→⊥, core→auth, providers→auth+core, cli→auth+core. No reverse edges exist. Providers consumes auth symbols directly from `@vybestack/llxprt-code-auth`, not transitively via core re-exports.

12. **AuthPrecedenceResolver constructor migration for providers:** `BaseProvider.ts` currently constructs `AuthPrecedenceResolver` directly with `SettingsService` from core. After DI refactoring, the constructor accepts `ISettingsService`. `SettingsService` satisfies `ISettingsService` by structural typing — no adapter needed at the providers layer. The constructor call remains identical; only import paths change.

13. **BaseTokenStore reconciliation:** Issue #1586 mentions `BaseTokenStore` as a candidate for extraction. `BaseTokenStore` exists in `packages/core/src/mcp/token-store.ts` — it is an MCP subsystem base class, not auth domain. Its consumers are all MCP files. It is unrelated to the auth token store hierarchy (`TokenStore` → `KeyringTokenStore`/`ProxyTokenStore`). **No move required.** Documented as preflight check in P00a and in the specification.

14. **ISecureStore full contract:** `ISecureStore` includes `get`, `set`, `delete`, `list`, and `has` methods (matching core's `SecureStore`). `keyring-token-store.ts` uses `secureStore.list()` for `listProviders()`/`listBuckets()`. Error types (`ISecureStoreError`, `SecureStoreErrorCode`) are explicitly defined in auth to support `catch (error instanceof SecureStoreError && error.code === 'CORRUPT')` patterns in auth code.

15. **precedence.ts refactoring requirement:** `precedence.ts` currently imports `SettingsService` (type-only) from `../settings/SettingsService.js`, `ProviderRuntimeContext` (type-only) from `../runtime/providerRuntimeContext.js`, and `debugLogger` (value import) from `../utils/debugLogger.js`. These MUST be refactored when moving to `packages/auth`: type-only imports are replaced with `ISettingsService`/`IProviderRuntimeContext` interfaces; `debugLogger` value import is replaced with an injected `IDebugLogger` boundary. After refactoring, `precedence.ts` has zero core imports. This is tracked in P11 and the execution tracker. `precedence.ts`, `auth-precedence-resolver.ts`, `keyring-token-store.ts`, and `codex-device-flow.ts` all receive DI refactoring in P11.

16. **AuthPrecedenceResolver ownership and file requirements:** `AuthPrecedenceResolver` is the primary public entry point of `packages/auth` (REQ-AUTH-001.4). It is **defined** in `auth-precedence-resolver.ts` and MUST be **exported** from `packages/auth/src/index.ts` as a main-entry re-export. The naming is unambiguous: the class lives in `auth-precedence-resolver.ts` (not `precedence.ts`), and `precedence.ts` contains low-level cache primitives and the `OAuthManager` interface. Consumers import `AuthPrecedenceResolver` from `@vybestack/llxprt-code-auth` (the main entry), not from `@vybestack/llxprt-code-auth/auth-precedence-resolver.js`. Old consumers importing from `@vybestack/llxprt-code-core/auth/precedence.js` must migrate to the auth package main entry. Verification: P18/P19 include explicit checks that (1) `auth-precedence-resolver.ts` exists in `packages/auth/src/` and exports the class, (2) `packages/auth/src/index.ts` re-exports `AuthPrecedenceResolver`, and (3) no old `precedence.js` deep-path consumers remain.

17. **README and public API documentation:** Updating `packages/auth/README.md` or root-level documentation to reflect the new auth package is declared **out of scope** for this plan. The plan produces code changes and verification gates, not user-facing documentation. A README task should be tracked as a separate follow-up issue once the auth package is stabilized.

18. **Package manager gate (P00a/P03):** The root `package.json` declares `"packageManager": "pnpm@10.17.0+sha512..."` while both `package-lock.json` and `pnpm-lock.yaml` exist. All project scripts and CI use npm commands. P00a and P03 Step 0 include a mandatory **executable** package manager verification gate that inspects CI workflow files and exits non-zero on inconsistency. **If the gate exits non-zero (CI/lockfile strategy inconsistent), the phase MUST STOP — do not allow both npm and pnpm paths to execute.** The same gate script is used in both P00a and P03 Step 0; it must exit 0 before any install/lockfile commands run. If CI uses npm, `npm install`/`package-lock.json` is authoritative. If CI uses pnpm, all plan npm commands must be replaced with pnpm equivalents. **Do NOT remove `package-lock.json`** — instead, stop and require a package-manager strategy update decision. Lockfile removal is out of scope and potentially destructive. Both lockfiles exist; the gate resolves which is authoritative.

19. **Phase naming alignment (P15–P18):** P15 is scaffolding only — type-import stubs, import rewrites, and subpath export removal. No implementation logic, no factory function bodies, no directory removal. P16 is integration tests. P17 is implementation (factory function bodies, consumer final wiring). P18 is cleanup (directory removal, anti-shim scans). This naming ensures P15 is true scaffolding, P16 is true testing, P17 is true implementation, and P18 is true cleanup.

20. **Simplified refactoring-oriented phase template — PLAN-TEMPLATE compliance:** Not every PLAN-TEMPLATE section is used in each phase (e.g., "Example Data", "Data Schemas", "Performance Requirements" are omitted when not applicable). Essential sections — Prerequisites, Tasks, Verification Commands, and Success Criteria — are always present. **Compliance approach:** Each phase that modifies production code MUST include: (1) per-phase executable verification command(s) or a reference to the shared verifier script (`node project-plans/issue1586/scripts/verify-auth-extraction-gate.js`); (2) Failure Recovery section: git revert of the individual phase commit is the standard recovery strategy; (3) Phase Completion Marker: tracked centrally in `execution-tracker.md` with executable verification commands as mechanically equivalent evidence. This approach is documented here and applies across all phase files for traceability.


## Phase Sequence (Scaffold → Interfaces → Auth Move → OAuth → Migration → Cleanup)

| Phase | Title | Purpose |
|-------|-------|---------|
| P00a | Preflight verification | Verify assumptions before implementation |
| P01 | Domain/dependency analysis | File inventory (35 core + 37 CLI + provider auth imports: plan-time expected count 6 prod + 3 test = 9; P00a preflight must confirm actual count via rg and record exact file list), classification, dependency audit |
| P01a | Analysis verification | Verify analysis artifacts match codebase |
| P02 | Contract-first pseudocode | Numbered pseudocode with DI interface contracts |
| P02a | Pseudocode verification | Verify pseudocode compliance |
| P02b | Integration contract definition | Explicit IC-01 through IC-09 contracts |
| P02c | Integration contract verification | Verify IC contracts |
| P03 | Package scaffold stub | Create packages/auth skeleton, workspace metadata, package.json |
| P03a | Scaffold stub verification | Verify scaffold compiles and builds |
| P04 | Package scaffold TDD/boundary | Package boundary tests |
| P04a | Scaffold test verification | Verify boundary tests |
| P05 | Package scaffold implementation | Full working scaffold, exports, build |
| P05a | Scaffold implementation verification | Verify build produces dist/ |
| P06 | Interfaces stub | Create DI interfaces in packages/auth/src/interfaces/ |
| P06a | Interface stub verification | Verify interfaces compile |
| P07 | Interfaces TDD | Write behavioral tests; auth-package-local tests PASS; core structural compat type tests in `packages/core/src/__tests__/auth-interface-compat.test.ts` FAIL until P08 wires dependency (import resolution) |
| P07a | Interface test verification | Verify TDD pass/fail expectations |
| P08 | Interfaces implementation | Wire core→auth dependency (export DI interfaces; enable P07 core compat tests to pass); factory functions deferred to P17 |
| P08a | Interface implementation verification | Verify DI interfaces exported and core compat type tests pass (no factory function verification) |
| P09 | Auth code move stubs | Create 15 production + 20 test file stubs/moves in packages/auth (spec filename: 09-auth-move-stub.md, not 09a) |
| P09a | Move stub verification | Verify all 35 files exist in auth |
| P10 | Auth code move TDD | Behavioral tests for DI-refactored components (mixed pass/fail) |
| P10a | Move test verification | Verify TDD pass/fail expectations |
| P11 | Auth code move implementation | Move all auth code with DI refactoring |
| P11a | Move implementation verification | Verify moved code works |
| P12 | OAuth split stub | OAuthManager interface confirmed in auth, CLI implements; BaseProvider constructs AuthPrecedenceResolver directly (not via factory); OAuthProvider stays in CLI |
| P12a | OAuth split stub verification | Verify split stubs |
| P13 | OAuth split TDD/contract tests | OAuth interface compatibility tests (interface already exists); creates TDD contract tests |
| P13a | OAuth split TDD/contract test verification | Verify OAuth contract tests pass |
| P14 | OAuth split implementation | Finalize OAuth interface/impl split |
| P14a | OAuth split implementation verification | Verify split works |
| P15 | Consumer migration scaffolding | Create auth-factories.ts type-import stub; update all consumer imports (CLI, providers, core) from old paths to @vybestack/llxprt-code-auth; remove core auth subpath exports. Scaffolding only — no factory function bodies, no directory removal |
| P15a | Consumer migration scaffolding verification | Verify import rewrites and subpath export removal |
| P16 | Consumer migration integration tests | Integration test CLI→auth→core paths |
| P16a | Consumer migration test verification | Verify tests |
| P17 | Consumer migration implementation | Implement factory function bodies in auth-factories.ts (KeyringTokenStore, AuthPrecedenceResolver) now that auth classes exist; finalize consumer wiring |
| P17a | Consumer migration implementation verification | Verify migration |
| P18 | Deprecation cleanup & no shims | Remove core/src/auth/ directory; anti-shim scans via shared verifier (canonical import/export specifier parsing). Cleanup only — no new implementation |
| P18a | Cleanup verification | Anti-shim scans |
| P19 | Full verification suite | All project verification commands; uses shared verifier script with canonical import/export specifier parsing |
| P19a | Final semantic review | Behavioral verification |

- REQ-AUTH-001: Auth Package Boundary (P03–P05, P09–P11)
- REQ-DEP-001: Dependency Direction (P06–P08, P09–P11, P18)
- REQ-INTF-001: DI Interfaces (P06–P08)
- REQ-OAUTH-001: OAuth Manager Split (P12–P14)
- REQ-PROXY-001: Direct vs Proxy Auth Split (P09–P11)
- REQ-API-001: Public API Migration (P15–P18)
- REQ-API-001.4 has been folded into REQ-API-001
- REQ-TEST-001: Behavioral Verification (P07, P10, P13, P16, P19)
- REQ-CLEAN-001: Cleanup No Shims (P18)
- REQ-ADAPTER-001: Registered Providers (P12–P14)