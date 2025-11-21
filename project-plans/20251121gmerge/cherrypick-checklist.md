# Cherry-pick Tracking Checklist: v0.7.0 to v0.8.2

**Project:** llxprt-code upstream merge
**Date Started:** 2025-11-21
**Total Commits:** 58 commits in 13 batches
**Current Status:** Not Started

## How to Use This File

This file tracks the progress of cherry-picking commits from upstream gemini-cli v0.7.0 to v0.8.2.

### Status Indicators
- `[ ]` - Not started
- `[P]` - Picked (cherry-pick successful)
- `[C]` - Conflict occurred (needs remediation)
- `[V]` - Verified (all checks passed)
- `[X]` - Completed (committed and pushed)
- `[S]` - Skipped (intentionally excluded)

### Update Protocol
1. Cherrypicking subagent marks commits as `[P]` or `[C]`
2. Verification subagent marks batches as `[V]` or documents failures
3. After commit/push, mark batch as `[X]`
4. Document all issues in the Issues column
5. Sign off verification in the Verified column

---

## Batch 1: Release & OAuth Improvements

**Status:** [ ] Not Started
**Date Started:** ___________
**Date Completed:** ___________

| Status | Commit | Description | Issues | Verified |
|--------|--------|-------------|--------|----------|
| [ ] | cc47e475a | support standard github release archives format | | |
| [ ] | 4f49341ce | relax JSON schema validation | | |
| [ ] | 66c2184fe | feat: Add AbortSignal support for retry logic | | |
| [ ] | ad59be0c8 | fix(core): Fix unable to cancel edit tool | | |
| [ ] | 22740ddce | refactor(core): Extract thought parsing logic | | |

**Verification Steps:**
- [ ] Tests pass (`npm run test:ci`)
- [ ] Lint passes (`npm run lint:ci`)
- [ ] Integration tests lint passes
- [ ] Integration tests format check passes
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] Format applied (`npm run format`)
- [ ] Build successful (`npm run build`)
- [ ] Bundle created (`npm run bundle`)
- [ ] Integration test passes (haiku generation)

**Batch Commit:**
- [ ] Changes committed with GPG signature
- [ ] Pushed to origin/main

**Notes:**
```


```

---

## Batch 2: OAuth & Extension Fixes

**Status:** [ ] Not Started
**Date Started:** ___________
**Date Completed:** ___________

| Status | Commit | Description | Issues | Verified |
|--------|--------|-------------|--------|----------|
| [ ] | e0ba7e4ff | Dynamic client registration endpoint usage | | |
| [ ] | 86e45c9aa | Fix windows extension install issue | | |
| [ ] | 05c962af1 | fix(core): update edit tool error type | | |
| [ ] | 275a12fd4 | fix(core): set default maxAttempts in baseLLMClient | | |
| [ ] | c463d47fa | chore: add indicator to extensions list | | |

**Verification Steps:**
- [ ] Tests pass
- [ ] Lint passes
- [ ] Integration tests lint passes
- [ ] Integration tests format check passes
- [ ] Typecheck passes
- [ ] Format applied
- [ ] Build successful
- [ ] Bundle created
- [ ] Integration test passes

**Batch Commit:**
- [ ] Changes committed with GPG signature
- [ ] Pushed to origin/main

**Notes:**
```


```

---

## Batch 3: Retry Logic & Extension Security

**Status:** [ ] Not Started
**Date Started:** ___________
**Date Completed:** ___________

| Status | Commit | Description | Issues | Verified |
|--------|--------|-------------|--------|----------|
| [ ] | 4caaa2a8e | fix(core): ensure retry sets defaults for nullish values | | |
| [ ] | e20972478 | fix(core): Improve API error retry logic | | |
| [ ] | a0c8e3bf2 | Re-request consent when updating extensions | | |
| [ ] | defda3a97 | Fix duplicate info messages for extension updates | | |
| [ ] | 2d76cdf2c | Throw error for invalid extension names | | |

**Verification Steps:**
- [ ] Tests pass
- [ ] Lint passes
- [ ] Integration tests lint passes
- [ ] Integration tests format check passes
- [ ] Typecheck passes
- [ ] Format applied
- [ ] Build successful
- [ ] Bundle created
- [ ] Integration test passes

**Batch Commit:**
- [ ] Changes committed with GPG signature
- [ ] Pushed to origin/main

**Notes:**
```


```

---

## Batch 4: Security & UI Improvements

**Status:** [ ] Not Started
**Date Started:** ___________
**Date Completed:** ___________

| Status | Commit | Description | Issues | Verified |
|--------|--------|-------------|--------|----------|
| [ ] | c334f02d5 | **SECURITY:** escape ansi ctrl codes from model output | | |
| [ ] | d2d9ae3f9 | fix(ui): Truncate long loading text | | |
| [ ] | 6535b71c3 | fix(prompt): Prevent model from reverting changes | | |
| [ ] | 18e511375 | Unset foreground in default themes | | |
| [ ] | 53434d860 | Update enablement behavior + info | | |

**Verification Steps:**
- [ ] Tests pass
- [ ] Lint passes
- [ ] Integration tests lint passes
- [ ] Integration tests format check passes
- [ ] Typecheck passes
- [ ] Format applied
- [ ] Build successful
- [ ] Bundle created
- [ ] Integration test passes

**Batch Commit:**
- [ ] Changes committed with GPG signature
- [ ] Pushed to origin/main

**Notes:**
```
IMPORTANT: c334f02d5 is critical security fix - verify ANSI escaping works
```

---

## Batch 5: MCP & Dependency Fixes

**Status:** [ ] Not Started
**Date Started:** ___________
**Date Completed:** ___________

| Status | Commit | Description | Issues | Verified |
|--------|--------|-------------|--------|----------|
| [ ] | 11c995e9f | Stop checking MCP tool schemas for type definitions | | |
| [ ] | 8a16165a9 | fix(deps): resolve ansi-regex dependency conflict | | |
| [ ] | e8a065cb9 | **CAREFUL:** Make --allowed-tools work in non-interactive | | |
| [ ] | 3d7cb3fb8 | refactor(core): Extract file filtering constants | | |
| [ ] | e909993dd | **SECURITY:** Warning about command substitution in shell | | |

**Verification Steps:**
- [ ] Tests pass
- [ ] Lint passes
- [ ] Integration tests lint passes
- [ ] Integration tests format check passes
- [ ] Typecheck passes
- [ ] Format applied
- [ ] Build successful
- [ ] Bundle created
- [ ] Integration test passes

**Batch Commit:**
- [ ] Changes committed with GPG signature
- [ ] Pushed to origin/main

**Notes:**
```
e8a065cb9 requires careful integration with ephemerals system
Test --allowed-tools flag interactions with:
- Model profiles
- /tools commands
- Ephemeral settings
```

---

## Batch 6: Smart Edit & MCP Auth

**Status:** [ ] Not Started
**Date Started:** ___________
**Date Completed:** ___________

| Status | Commit | Description | Issues | Verified |
|--------|--------|-------------|--------|----------|
| [ ] | 0d22b22c8 | fix(core): auto-correct file paths in smart edit | | |
| [ ] | db51e3f4c | feat(iap): Add service account impersonation to MCP | | |
| [ ] | 93694c6a6 | Make compression algo slightly more aggressive | | |
| [ ] | ffcd99636 | feat(core): Use lastPromptTokenCount for compression | | |
| [ ] | 0b2d79a2e | fix(ui): stop truncating output in <static> | | |

**Verification Steps:**
- [ ] Tests pass
- [ ] Lint passes
- [ ] Integration tests lint passes
- [ ] Integration tests format check passes
- [ ] Typecheck passes
- [ ] Format applied
- [ ] Build successful
- [ ] Bundle created
- [ ] Integration test passes

**Batch Commit:**
- [ ] Changes committed with GPG signature
- [ ] Pushed to origin/main

**Notes:**
```
db51e3f4c enables MCP SA impersonation (Google Cloud specific)
93694c6a6 + ffcd99636 work together for compression improvements
```

---

## Batch 7: UI Enhancements

**Status:** [ ] Not Started
**Date Started:** ___________
**Date Completed:** ___________

| Status | Commit | Description | Issues | Verified |
|--------|--------|-------------|--------|----------|
| [ ] | 331e2ce45 | feat(cli): Show status in terminal title | | |
| [ ] | 1bd75f060 | fix(core): auto-correct file paths (x-platform) | | |
| [ ] | 62ba33061 | Add radio button keys | | |
| [ ] | ea061f52b | Fix `-e <extension>` for disabled extensions | | |
| [ ] | 8a2c2dc73 | feat(core): Enable tool output truncation by default | | |

**Verification Steps:**
- [ ] Tests pass
- [ ] Lint passes
- [ ] Integration tests lint passes
- [ ] Integration tests format check passes
- [ ] Typecheck passes
- [ ] Format applied
- [ ] Build successful
- [ ] Bundle created
- [ ] Integration test passes

**Batch Commit:**
- [ ] Changes committed with GPG signature
- [ ] Pushed to origin/main

**Notes:**
```
331e2ce45 has "Gemini" references - may need adaptation for llxprt branding
```

---

## Batch 8: JSON & Cross-platform Fixes

**Status:** [ ] Not Started
**Date Started:** ___________
**Date Completed:** ___________

| Status | Commit | Description | Issues | Verified |
|--------|--------|-------------|--------|----------|
| [ ] | ac4a79223 | feat(core): Add content-based retries for JSON | | |
| [ ] | a49a09f13 | Update package-lock.json to match package.json | | |
| [ ] | 94f43c79d | Fix markdown rendering on Windows | | |
| [ ] | d6933c77b | fix(cli): IDE trust listener also listen to status | | |
| [ ] | cea1a867b | Extension update confirm dialog | | |

**Verification Steps:**
- [ ] Tests pass
- [ ] Lint passes
- [ ] Integration tests lint passes
- [ ] Integration tests format check passes
- [ ] Typecheck passes
- [ ] Format applied
- [ ] Build successful
- [ ] Bundle created
- [ ] Integration test passes

**Batch Commit:**
- [ ] Changes committed with GPG signature
- [ ] Pushed to origin/main

**Notes:**
```


```

---

## Batch 9: Terminal & UI Fixes

**Status:** [ ] Not Started
**Date Started:** ___________
**Date Completed:** ___________

| Status | Commit | Description | Issues | Verified |
|--------|--------|-------------|--------|----------|
| [ ] | d37fff7fd | Fix `/tool` and `/mcp` terminal escape codes | | |
| [ ] | 6f6e004f8 | feat: Add red threshold for getStatusColor util | | |
| [ ] | ae387b61a | Reduce margin on narrow screens, flow footer | | |
| [ ] | ae51bbdae | Add extension name auto-complete | | |
| [ ] | 1067df187 | Fix: A2A server - add liveOutput to result | | |

**Verification Steps:**
- [ ] Tests pass
- [ ] Lint passes
- [ ] Integration tests lint passes
- [ ] Integration tests format check passes
- [ ] Typecheck passes
- [ ] Format applied
- [ ] Build successful
- [ ] Bundle created
- [ ] Integration test passes

**Batch Commit:**
- [ ] Changes committed with GPG signature
- [ ] Pushed to origin/main

**Notes:**
```
d37fff7fd refactors command output to structured data types
```

---

## Batch 10: Extension & Cache Fixes

**Status:** [ ] Not Started
**Date Started:** ___________
**Date Completed:** ___________

| Status | Commit | Description | Issues | Verified |
|--------|--------|-------------|--------|----------|
| [ ] | 42436d2ed | Don't log error with "-e none" | | |
| [ ] | 6c54746e2 | Restore case insensitivity for extension enablement | | |
| [ ] | 953935d67 | Fix cache collision bug in llm edit fixer | | |
| [ ] | 0fec673bf | Fix installing extensions from zip files | | |
| [ ] | 6695c32aa | fix(shell): improve shell output presentation | | |

**Verification Steps:**
- [ ] Tests pass
- [ ] Lint passes
- [ ] Integration tests lint passes
- [ ] Integration tests format check passes
- [ ] Typecheck passes
- [ ] Format applied
- [ ] Build successful
- [ ] Bundle created
- [ ] Integration test passes

**Batch Commit:**
- [ ] Changes committed with GPG signature
- [ ] Pushed to origin/main

**Notes:**
```


```

---

## Batch 11: Final Core Improvements

**Status:** [ ] Not Started
**Date Started:** ___________
**Date Completed:** ___________

| Status | Commit | Description | Issues | Verified |
|--------|--------|-------------|--------|----------|
| [ ] | c913ce3c0 | fix(cli): honor argv @path in interactive sessions | | |
| [ ] | f207ea94d | fix(memory): ignore @ inside code blocks | | |
| [ ] | ed1b5fe5e | fix(settings): Ensure InferSettings infers enums | | |
| [ ] | 65e7ccd1d | docs: document custom witty loading phrases | | |
| [ ] | 62e969137 | chore(docs): Add MCP SA Impersonation docs | | |

**Verification Steps:**
- [ ] Tests pass
- [ ] Lint passes
- [ ] Integration tests lint passes
- [ ] Integration tests format check passes
- [ ] Typecheck passes
- [ ] Format applied
- [ ] Build successful
- [ ] Bundle created
- [ ] Integration test passes

**Batch Commit:**
- [ ] Changes committed with GPG signature
- [ ] Pushed to origin/main

**Notes:**
```
65e7ccd1d documents existing customWittyPhrases feature
62e969137 documents db51e3f4c (SA impersonation) from Batch 6
```

---

## Batch 12: Regex Smart Edit (CAREFUL)

**Status:** [ ] Not Started
**Date Started:** ___________
**Date Completed:** ___________

| Status | Commit | Description | Issues | Verified |
|--------|--------|-------------|--------|----------|
| [ ] | ec08129fb | **CAREFUL:** Regex Search/Replace for Smart Edit | | |

**Pre-flight Checks:**
- [ ] Verified smart-edit is enabled in llxprt
- [ ] Checked for llxprt-specific smart-edit customizations
- [ ] Reviewed regex matching logic for compatibility
- [ ] Prepared test cases with whitespace variations

**Verification Steps:**
- [ ] Tests pass
- [ ] Lint passes
- [ ] Integration tests lint passes
- [ ] Integration tests format check passes
- [ ] Typecheck passes
- [ ] Format applied
- [ ] Build successful
- [ ] Bundle created
- [ ] Integration test passes
- [ ] **Additional:** Test smart-edit with various whitespace scenarios

**Batch Commit:**
- [ ] Changes committed with GPG signature
- [ ] Pushed to origin/main

**Notes:**
```
SINGLE COMMIT BATCH - REQUIRES CAREFUL REVIEW
Adds regex-based flexible matching as third fallback in smart-edit
Test scenarios:
1. Exact match (should still work)
2. Flexible whitespace match (should still work)
3. Regex match with different indentation
4. Regex match with extra whitespace
5. Match failure cases
```

---

## Batch 13: Final Bug Fix

**Status:** [ ] Not Started
**Date Started:** ___________
**Date Completed:** ___________

| Status | Commit | Description | Issues | Verified |
|--------|--------|-------------|--------|----------|
| [ ] | 11f7a6a2d | fix(core): retain user message on stream failure | | |

**Verification Steps:**
- [ ] Tests pass
- [ ] Lint passes
- [ ] Integration tests lint passes
- [ ] Integration tests format check passes
- [ ] Typecheck passes
- [ ] Format applied
- [ ] Build successful
- [ ] Bundle created
- [ ] Integration test passes

**Batch Commit:**
- [ ] Changes committed with GPG signature
- [ ] Pushed to origin/main

**Notes:**
```
FINAL COMMIT TO CHERRY-PICK
This is the last commit before creating the merge commit
```

---

## Final Merge Commit

**Status:** [ ] Not Started
**Date Completed:** ___________

**Command:**
```bash
git merge -s ours --no-ff 11f7a6a2d -m "chore: complete upstream merge from v0.7.0 to v0.8.2

This merge commit marks the completion of cherry-picking 58 commits
from upstream gemini-cli between tags v0.7.0 and v0.8.2.

All commits have been successfully integrated, tested, and verified.

Cherry-picked commits include:
- Security fixes (ANSI escape codes, shell injection warnings)
- Core improvements (retry logic, compression, abort signals)
- Extension system enhancements
- MCP improvements (SA impersonation support)
- Smart edit improvements (auto-correct paths, regex matching)
- UI/UX improvements
- Cross-platform bug fixes

Excluded commits:
- Gemini-specific infrastructure (CI, release, telemetry)
- Test-only commits
- Docs-only commits (picked relevant docs with features)
- baseLLMClient refactoring (architecture not applicable)
- Declarative Agent Framework (deferred to Q1 2026)

Last cherry-picked commit: 11f7a6a2d"
```

**Checklist:**
- [ ] All 13 batches successfully completed
- [ ] All verification steps passed for all batches
- [ ] All batches committed and pushed
- [ ] Merge commit created
- [ ] Merge commit pushed

---

## Summary Statistics

**Total Commits in Plan:** 58
**Commits Successfully Picked:** ___ / 58
**Commits with Conflicts:** ___
**Commits Skipped:** ___
**Batches Completed:** ___ / 13
**Total Time Elapsed:** ___ hours

---

## Conflict Resolution Log

Use this section to document any conflicts encountered and how they were resolved.

### Conflict 1
**Commit:** ___________
**File(s):** ___________
**Issue:**
```


```
**Resolution:**
```


```
**Resolved By:** ___________
**Date:** ___________

---

### Conflict 2
**Commit:** ___________
**File(s):** ___________
**Issue:**
```


```
**Resolution:**
```


```
**Resolved By:** ___________
**Date:** ___________

---

## Verification Failures Log

Use this section to document any verification failures and fixes.

### Failure 1
**Batch:** ___________
**Step Failed:** ___________
**Error Message:**
```


```
**Fix Applied:**
```


```
**Fixed By:** ___________
**Date:** ___________

---

### Failure 2
**Batch:** ___________
**Step Failed:** ___________
**Error Message:**
```


```
**Fix Applied:**
```


```
**Fixed By:** ___________
**Date:** ___________

---

## Notes & Observations

Use this section for general notes, observations, or lessons learned during the cherry-picking process.

```






```

---

## Sign-Off

**Cherrypicking Subagent:** ___________________________ Date: ___________

**Verification Subagent:** ___________________________ Date: ___________

**Remediation Subagent (if needed):** ___________________________ Date: ___________

**Project Lead Approval:** ___________________________ Date: ___________

---

**Document Version:** 1.0
**Last Updated:** 2025-11-21
**Next Review:** After completion
