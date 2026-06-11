# Plan Remediation After Review 09

Verdict: ADDRESSED — all 8 blockers remediated with concrete plan edits.

Summary: Addressed all review 09 blockers by: (1) adding explicit tsconfig paths entries for every deep export and a deferred verification command importing every deep path, (2) adding explicit `--check-root-imports` boundary command with all moved symbols to P06 and P07, (3) making all four consumer package.json dependency edits exact with line numbers, JSON snippets, and per-package verification commands, (4) specifying exact fake IProvider, Config stub, runtime/resolved fields, and GenerateChatOptions shape for the LoggingProviderWrapper test, (5) adding explicit core git-utils preservation verification commands and semantic checklist items to P05, (6) adding exact core root export identity verification command and export-statement table to P05, (7) making P00a hard-gate inventory write-back explicit with reconciliation.status field, moved-symbol coverage requirements, and BLOCKED remediation procedure, (8) verifying `npm run format:check` exists as `prettier --check .` and documenting the exact precondition in P07.

## Modified Plan Files

| File | Blocker(s) | Changes |
|---|---|---|
| `plan/01-storage-package-scaffold.md` | 1 | Added 9 explicit tsconfig paths entries for deep exports; added deferred deep-export verification command |
| `plan/05-core-compatibility-public-api.md` | 3, 5, 6 | Added exact core package.json dependency placement with verification; added gitIgnoreParser/gitUtils preservation verification commands and semantic checklist; added core root export identity verification command with strict equality check; added exact export-statement table |
| `plan/06-consumer-integration-dependency-graph.md` | 2, 3, 4 | Added explicit `--check-root-imports` boundary command with all moved symbols; made all 4 consumer package.json edits exact with line numbers and JSON snippets; replaced LoggingProviderWrapper test spec with exact fake provider, config stub, runtime fields, GenerateChatOptions shape |
| `plan/07-full-verification.md` | 8 | Added verified format:check precondition (prettier --check .); expanded `--check-root-imports` command with full moved-symbols list |
| `plan/00a-preflight-verification.md` | 7 | Added hard-gate inventory write-back procedure; added reconciliation.status requirements; updated success criteria; updated failure recovery |
| `plan/00-overview.md` | 8 | Updated format verification note with verified precondition |
| `reviews/review-09-remediation.md` | — | This file |

## Blocker-by-Blocker Details

### Blocker 1: TypeScript deep-export path mapping (P01)

**Problem**: Planned deep imports use export paths like `@vybestack/llxprt-code-storage/config/storage.js` but tsconfig paths only had wildcard `@vybestack/llxprt-code-storage/*` → `./src/*`. Review wanted exact entries and verification.

**Fix**: Added 9 explicit `tsconfig` paths entries mapping every deep export to its exact source file (e.g., `@vybestack/llxprt-code-storage/config/storage.js` → `./src/config/storage.ts`). Added a deferred verification command that imports every deep path and checks every expected symbol resolves, to be run after P04d completes.

### Blocker 2: P06 root-import stale check (P06)

**Problem**: P06 did not explicitly verify root imports of moved symbols from `@vybestack/llxprt-code-core`.

**Fix**: Added explicit `node scripts/check-storage-import-boundary.mjs --exclude-core-compat-tests --check-root-imports` command with full `--moved-symbols` list (all 27 moved symbols), `--from-package`, `--scan-dir`, and `--exclude-glob` arguments. Also updated P07 to use the same expanded command.

### Blocker 3: Exact package dependency updates (P06, P05)

**Problem**: Consumer package.json dependency edits were not specific enough — no exact field placement, no verification commands.

**Fix**: For each of the 4 consumer packages (cli, mcp, providers, a2a-server), specified exact line number where `"dependencies": {` appears, exact JSON snippet to insert, alphabetical placement rule, and per-package `node -e` verification command. Added batch verification command. For core (P05), specified exact insertion point before `"@vybestack/llxprt-code-mcp"` with verification command.

### Blocker 4: LoggingProviderWrapper test exactness (P06)

**Problem**: Test setup left too much guesswork — no exact IProvider members, config shape, runtime/resolved fields.

**Fix**: Specified exact `FakeProvider` class with all required `IProvider` members (name, isDefault, getModels, getDefaultModel, getServerTools, invokeServerTool, generateChatCompletion with both overload forms). Specified exact `configStub` object with all methods called by LoggingProviderWrapper (getConversationLoggingEnabled, getConversationLogPath, getRedactionConfig, getProviderManager). Specified exact runtime context with SettingsService and config. Specified exact GenerateChatOptions call shape with contents, settings, runtime, and config fields.

### Blocker 5: gitIgnoreParser/gitUtils copy vs move (P05)

**Problem**: Plan needed firmer commands proving core originals survive P05.

**Fix**: Added explicit "CRITICAL" note at top of P05 Files to Modify section stating these are copies, not moves. Added 3-command verification block: `test -f` for both files + `rg` proving no `@vybestack/llxprt-code-storage` reference in core git utils. Added semantic checklist item for git-utils preservation.

### Blocker 6: Core root export verification (P05)

**Problem**: No exact command or expected export statements for moved symbols.

**Fix**: Added exact root export identity verification command that imports all moved symbols from both `@vybestack/llxprt-code-core` root and `@vybestack/llxprt-code-storage` root, checks strict equality (`===`). Added table of all 7 relevant export lines in `packages/core/src/index.ts` with line numbers and resolution targets.

### Blocker 7: P00a hard-gate inventory write-back (P00a)

**Problem**: P00a inventory must write final results and block if they differ from plan.

**Fix**: Added explicit "P00a Hard-Gate Inventory Write-Back" subsection with: (1) exhaustive list of what the inventory must capture (runtime, type-only, vi.mock factory, vi.mock local class), (2) 6-step write-back procedure with BLOCKED condition, (3) required remediation steps (update P06, specification.md, domain-model.md), (4) `reconciliation.status` field requirements (must be `"pass"`, not `"pending"` or `"blocked"`), (5) updated success criteria and failure recovery.

### Blocker 8: `npm run format:check` verification (P07)

**Problem**: Plan assumed `npm run format:check` exists but didn't verify.

**Fix**: Verified the script exists in root `package.json` as `"format:check": "prettier --check ."`. Added verified precondition documentation to P07 and P00-overview with exact script content.
