# Phase 01: Domain/Dependency Analysis & File Classification

Plan ID: PLAN-20260608-ISSUE1586.P01

## Prerequisites
- Required: Phase P00a completed
- Verification: `test -f project-plans/issue1586/analysis/preflight-results.md`

## Phase Tasks

1. Complete auth file inventory: all .ts files under `packages/core/src/auth/` (15 production + 20 test = 35 files) and `packages/cli/src/auth/` (34 pure production + 3 test-helpers, test count preflight-derived) with line counts and external imports.
2. Classify every core auth production file: auth-domain (moves) vs already-moved vs stays-in-core.
3. Classify every core auth test file: auth test (moves) vs unrelated. Include proxy/__tests__ files.
4. Classify every CLI auth production file: stays-in-CLI, update-imports. Separate pure production (34) from test-helpers (3).
5. Audit providers package for auth-related imports from core/auth (plan-time expected count: 6 production + 3 test = 9 files; preflight must confirm actual count via `rg -n "from ['"]@vybestack/llxprt-code-core/auth" packages/providers/src --glob '*.ts'`).
6. Build dependency audit: for each core auth file, list all imports from outside `packages/core/src/auth/`.
7. Identify DI interface surfaces: list exact methods/types that core subsystems provide to auth.
8. Build move map: source→destination for every file (production + test, including proxy tests).
9. Document OAuth split boundary: OAuthManager interface moves to auth; OAuthProvider stays in CLI.
10. Document proxy split boundary: infrastructure (auth) vs orchestration (CLI).
11. Document packages/storage absence and interim DI interface design.

## Output Artifacts
- `analysis/auth-file-inventory.md` — 15 production + 20 test = 35 core auth files; 34+3 CLI non-test files (test count preflight-derived); providers auth imports: plan-time expected count (6 prod + 3 test = 9); preflight must confirm actual count
- `analysis/auth-file-classification.md` — classification with test-helpers and providers categories
- `analysis/dependency-audit.md` — 20 test files, providers audit, packages/storage absence
- `analysis/external-dependencies.md` — ISecureStore as interim for absent packages/storage

## Success Criteria
- 100% file classification coverage (35 core + 37 CLI non-test + providers auth imports)
- All external imports identified
- DI interface surfaces minimal and complete
- Proxy test destinations included in move map
- Providers auth import migration documented