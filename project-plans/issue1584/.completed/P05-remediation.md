# Phase 05 Remediation Record

**Date**: 2026-06-03
**Trigger**: P05a verification identified three issues requiring documentation correction.

## Issue 1: .llxprt/LLXPRT.md in working tree

**Finding**: `git diff --name-only HEAD` shows `.llxprt/LLXPRT.md` as modified.

**Root cause**: Pre-existing change from P00a preflight (profile name updated from `synthetic` to `ollamakimi`, execution guidance added). P05 implementation did not modify this file.

**Resolution**: Added explicit P00a provenance note to P05.md `.llxprt Provenance` section documenting that `.llxprt/LLXPRT.md` was already modified before P05 began and P05 did not modify it.

**Production code impact**: None.

## Issue 2: Anti-shim scan scope overclaim

**Finding**: P05.md originally claimed "Anti-Shim Scans: PASS" with `rg "@vybestack/llxprt-code-providers" packages/core/src — no results (pass)`, implying a full-repo clean anti-shim scan. In reality, `packages/core/src/index.ts` still re-exports ~30 provider symbols, and other core production files still import provider paths.

**Root cause**: The anti-shim scan command in the original P05.md was scoped only to P05-created/modified contract files (which are clean), but presented as a general "pass" without distinguishing P05 scope from final migration scope.

**Resolution**: 
- Replaced "Anti-Shim Scans: PASS" section with "Anti-Shim Scans: P05-SCOPED PASS"
- Added explicit deferred anti-shim items table listing `packages/core/src/index.ts`, `geminiChat.hook-control.test.ts`, and other retained provider imports with target phases (P11/P14/P15)
- Replaced "No-Shim Assessment" heading with "No-Shim Assessment (P05-Scoped)" and added three additional bullet points confirming no providers scaffold, no provider moves, no CLI migration, no new shim files introduced by P05
- Added note that final anti-shim compliance requires P11, P14, and P15
- Updated verdict from "PASS" to "PASS (P05-SCOPED)" with explicit language about deferred full compliance

**Production code impact**: None. Documentation-only change.

## Issue 3: Forbidden-name scan false positive

**Finding**: Forbidden-name scan reports `packages/core/src/providers/openai/OpenAIProvider.mistralCompatibility.test.ts` containing "mistralCompatibility" in the filename.

**Root cause**: This is a pre-existing file with 6 commits on `main` (earliest: `dbc8d5c86`). P05 did not create, modify, or introduce this file.

**Resolution**: Added a "Forbidden-Name Exception" subsection to P05.md under the deferred anti-shim items, documenting the file as pre-existing and not introduced by P05, with a note that it should be tracked for renaming in a future provider-extraction phase.

**Production code impact**: None.

## Files Changed

| File | Change Type | Description |
|------|-------------|-------------|
| `project-plans/issue1584/.completed/P05.md` | Documentation | Anti-shim section scoped to P05, .llxprt provenance added, forbidden-name exception documented, verdict qualified |

## Production Code Impact

**None.** No files under `packages/**` were modified. No files under `.llxprt/` were modified. Only `project-plans/issue1584/.completed/P05.md` was updated.