# Phase 06 Remediation — P06a Verification Failures

**Date**: 2026-06-05
**Trigger**: P06a verifier flagged two issues in the Phase 06 deliverable

## Issue 1: Core → Providers Boundary Violation in Test Import

**File**: `packages/core/src/core/geminiChat.hook-control.test.ts`
**Line**: 11 (original)
**Problem**: `import type { IProvider } from '@vybestack/llxprt-code-providers'` — core test source importing from the providers package, violating the boundary rule that core must not depend on providers.

**Analysis**: The `IProvider` interface is defined in `packages/core/src/providers/IProvider.ts` and is the canonical core-owned runtime contract type. The test only uses `IProvider` as a type annotation for mock objects; the import from `@vybestack/llxprt-code-providers` was likely a pre-existing mistake that only became a real boundary violation once the providers scaffold package was created.

**Remediation**: Changed the import to use the core-owned type:
```diff
- import type { IProvider } from '@vybestack/llxprt-code-providers';
+ import type { IProvider } from '../providers/IProvider.js';
```

This preserves the exact same `IProvider` interface (same symbol, same shape) since the providers package re-export is not yet wired. The test behavior is unchanged — the mock object still satisfies the same structural contract.

**Safety Assessment**: Safe. The `IProvider` interface is defined in core at `packages/core/src/providers/IProvider.ts` and is the authoritative source. The providers package is a scaffold with no implementations yet. No runtime behavior changed.

## Issue 2: Generated Build/Test Artifacts in packages/providers

**Problem**: P06a verifier found generated artifacts beyond scaffold files in `packages/providers/`:
- `.tsbuildinfo` — TypeScript incremental build cache
- `dist/` — Build output directory
- `coverage/` — Vitest coverage reports
- `junit.xml` — Vitest JUnit test report

**Analysis**: All four are standard build/test outputs covered by `.gitignore` (`*.tsbuildinfo`, `packages/*/coverage/`, `junit.xml`) and are not tracked by git (`git ls-files` returned empty for all). They were generated during the Phase 06 verification cycle (typecheck → build → test).

**Remediation**: Removed via targeted `rm -rf`:
```
rm -rf packages/providers/.tsbuildinfo
rm -rf packages/providers/dist
rm -rf packages/providers/coverage
rm -rf packages/providers/junit.xml
```

Only scaffold source/config files remain:
- `index.ts`, `src/index.ts` — Entry points
- `package.json`, `tsconfig.json`, `vitest.config.ts`, `test-setup.ts` — Config

## Verification

### After Remediation
- `packages/providers/` contains only scaffold files (no build artifacts)
- `packages/core/src/core/geminiChat.hook-control.test.ts` imports `IProvider` from core-owned `../providers/IProvider.js`
- Core typecheck: passes (unchanged, same `IProvider` type)
- Hook-control test: preserved behavior (same interface, same mock shape)

### .gitignore Coverage Confirmed
- `*.tsbuildinfo` → gitignored
- `junit.xml`, `junit.*.xml` → gitignored
- `packages/*/coverage/` → gitignored
- `dist/` implicitly excluded by build tooling conventions

## .llxprt Provenance

- Remediation executed by LLxprt Code (glm-5.1) in accordance with `dev-docs/COORDINATING.md` Phase 06a remediation protocol
- No `.llxprt/` directory was modified or deleted
## Additional P06a Remediation

Removed regenerated generated artifact `packages/providers/.tsbuildinfo` after P06a verification identified it. This is a TypeScript build artifact, not a source/scaffold file. No .llxprt files were touched.

## Generated Artifact Policy

Added `packages/providers/.gitignore` for package-local generated outputs (`dist/`, `coverage/`, `junit.xml`, `.tsbuildinfo`) and removed generated outputs after verification. These files are reproducible build/test artifacts and are not scaffold source/config. No `.llxprt/` files were touched.
