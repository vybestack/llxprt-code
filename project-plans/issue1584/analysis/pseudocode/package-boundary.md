# Pseudocode: Package Boundary

Plan ID: PLAN-20260603-ISSUE1584.P02

## Interface Contracts

**Inputs:** current repository files, dependency audit results (`analysis/dependency-audit.md`), provider source tree (`analysis/provider-file-inventory.txt`), provider file classification (`analysis/provider-file-classification.md`, `analysis/provider-file-classification-complete.md`), core import remediation (`analysis/core-import-remediation.md`), final architecture (`analysis/final-architecture.md`), package metadata constraints (`analysis/package-metadata-constraints.md`), anti-shim policy (`analysis/anti-shim-policy.md`).

**Outputs:** cycle-free package boundary; `packages/providers` scaffold with public exports; core production code with no `providers` production imports.

**Dependencies:** TypeScript compiler, existing npm workspace scripts, Vitest.

**Contracts:**
- **C-PB-01:** `packages/providers` public API exports `IProvider`, `IProviderManager`, `ITool`, `IModel`, `ProviderManager`, `ProviderContentGenerator`, concrete provider classes (`OpenAIProvider`, `AnthropicProvider`, `GeminiProvider`, `FakeProvider`, `LoadBalancingProvider`, etc.), tokenizers, provider errors, provider config types, and provider utilities — per P01 classification Rule 7 (provider public API) and Rule 8 (provider orchestration).
- **C-PB-02:** `packages/core` production code MUST NOT import from `@vybestack/llxprt-code-providers` or from `packages/core/src/providers/` after migration — enforced by P01 Blockers 1–10 and `core-import-remediation.md`.
- **C-PB-03:** Dependency direction: `providers → core` (deep modules), `cli → providers`, `cli → core`. No `core → providers` production dependency — per `analysis/package-metadata-constraints.md` and `analysis/final-architecture.md`.
- **C-PB-04:** No compatibility shims: `packages/core/src/index.ts` stops re-exporting provider internals; no `V2`, `Compat`, `New`, or wrapper files in core — per `analysis/anti-shim-policy.md`.
- **C-PB-05:** Core-owned shared utilities (e.g., `toolIdNormalization.ts`) move to non-provider core paths before provider files move — per P01 explicit exception table and Blocker 2.
- **C-PB-06:** Core-owned runtime contracts (`RuntimeProvider`, `RuntimeProviderManager`, `RuntimeTokenizer`, `RuntimeContentGeneratorFactory`, `MissingRuntimeProviderError`) live under `packages/core/src/runtime/contracts/` or `packages/core/src/runtime/errors/` — per `analysis/core-structural-contracts.md`.

## Numbered Pseudocode

10: READ `analysis/dependency-audit.md` for core-to-provider and provider-to-core production import counts (49 core→providers sites across 18 files; 144 provider→core subsystem imports).
11: READ `analysis/provider-file-classification.md` classifying each provider file into: provider implementation (~193 files via Rule 4), provider public API (12 files via Rules 7+12), provider orchestration (13 files via Rule 8), provider implementation support (28 files via Rules 9–11+13), core-owned shared utility (2 files via explicit exception), and test/fixture/doc categories.
12: FOR each core production file importing a provider-classified file (enumerated in `core-import-remediation.md` Blockers 1–10): CREATE a core-owned contract/utility migration task BEFORE moving that provider file, so no core production import is stranded.
13: CREATE `packages/providers` scaffold following existing workspace package conventions (package.json, tsconfig.json, vitest.config.ts, src/index.ts) — per `analysis/package-metadata-constraints.md` and specification Data Schemas section.
14: ADD workspace metadata for `packages/providers` to root `package.json` workspaces array and configure `@vybestack/llxprt-code-providers` name per naming convention — per `analysis/package-metadata-constraints.md` required checks.
15: MOVE implementation-classified provider files (Rules 4, 8, 9–11, 13) into `packages/providers/src/` preserving relative directory structure — per `analysis/provider-file-classification-complete.md` final-path column.
16: UPDATE provider internal imports to relative paths when target remains inside providers (e.g., `./IProvider.js` instead of `../providers/IProvider.js`).
17: UPDATE provider imports to core deep imports (`@vybestack/llxprt-code-core/...`) when target remains inside core per `analysis/provider-external-dependencies.md` direct dependency declaration rule.
18: DECLARE `@vybestack/llxprt-code-core` and all direct external SDK dependencies (openai, @anthropic-ai/sdk, @google/genai, @dqbd/tiktoken, zod, ai, @ai-sdk/openai, @ai-sdk/provider-utils) in `packages/providers/package.json` dependencies — NOT node built-ins — per `analysis/provider-external-dependencies.md`.
19: BUILD providers package (`npm run build --workspace @vybestack/llxprt-code-providers`).
20: IF providers package cannot build: FIX import classification, NOT by adding core re-export shims — per C-PB-04.
21: SCAN for package cycles: verify `packages/core/package.json` has no `@vybestack/llxprt-code-providers` dependency; verify `packages/core/tsconfig.json` has no providers reference — per `analysis/package-metadata-constraints.md` required checks.
22: SCAN for forbidden core → providers production imports using: `rg -n "from ['\"].*providers/|from ['\"]@vybestack/llxprt-code-core/providers|from ['\"]@vybestack/llxprt-code-providers" packages/core/src --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts'` — per `analysis/anti-shim-policy.md` required scans.
23: FAIL if any cycle or forbidden import remains — per C-PB-02, C-PB-03.

## Integration Points

- Line 12 protects HistoryService (Blocker 1), ToolIdStrategy (Blocker 2), runtime (Blocker 4), config (Blocker 5), models (Blocker 6), telemetry (Blocker 7), compression (Blockers 8–9), content generator (Blocker 3), and core index (Blocker 10) from accidental package cycles.
- Line 15 operates on P01-classified inventory (251 files, 100% classified) with explicit exceptions for core-owned utilities.
- Line 18 ensures providers package declares its own dependencies rather than relying on transitive deps through core — critical for correct npm workspace resolution.
- Line 20 forbids solving missing imports by adding compatibility shims per C-PB-04.
- Lines 21–23 enforce the no-cycle boundary per C-PB-03.

## Anti-Pattern Warnings

[ERROR] DO NOT: add provider package re-exports in core index.ts.
[ERROR] DO NOT: make both core and providers depend on each other in production.
[ERROR] DO NOT: create duplicate provider implementations or V2/Compat wrapper files.
[ERROR] DO NOT: rely on transitive dependencies through core for provider external SDK imports.
[OK] DO: re-home shared contracts and core-owned utilities before moving implementations.
[OK] DO: declare every direct external dependency in providers package.json.
[OK] DO: verify cycle-free direction with package metadata checks, not just import scans.
