# Cherry-pick Execution Plan: v0.7.0 to v0.8.2

**WARNING: DO NOT IMPLEMENT DECLARATIVE AGENT FRAMEWORK (DAF) WARNING:**
**Commit 794d92a79 is EXCLUDED from this merge cycle. See daf-findings.md for details.**
**DAF may be considered for Q1 2026 as a separate initiative.**

**Project:** llxprt-code upstream merge
**Date:** 2025-11-21
**Source Range:** v0.7.0 to v0.8.2 (gemini-cli)
**Total Commits to Pick:** 58 commits
**Strategy:** Chronological batching with verification between batches

## Overview

This plan executes cherry-picking of 58 commits from upstream gemini-cli into llxprt-code. Commits are organized into batches of 5 (chronologically ordered), with individual handling for commits requiring careful review. After each batch, we run full verification and commit the results.

### Key Principles

1. **Chronological Order:** Commits within batches maintain chronological order (oldest first)
2. **Batch Size:** Standard batches of 5 commits, special commits get individual batches
3. **Verification Between Batches:** Full test suite after each batch
4. **Commit After Batch:** Git commit and push after successful verification
5. **Final Merge Commit:** Create empty merge commit to v0.8.2 last picked commit

### Commits to Reimplement (Not Cherry-picked)

- **8abe7e151** - baseLlmClient extraction (2025-09-24)
  - **Action:** REIMPLEMENT with multi-provider support
  - **Rationale:** Upstream extracted utility LLM calls (generateJson, generateEmbedding) from client into separate baseLlmClient class. Our client.ts is 1,991-line god object mixing conversational and utility methods. We should implement the same pattern but with multi-provider support.
  - **Scope:** Create new `packages/core/src/core/baseLlmClient.ts` that extracts stateless utility methods from client.ts
  - **Key Differences from Upstream:**
    - Multi-provider support (not Gemini-only)
    - Integration with our existing providerManager
    - Support for all providers (Anthropic, OpenAI, Gemini, etc.)
  - **Timeline:** Separate implementation task after cherry-picking completes

### Excluded Commits

- **794d92a79** - Declarative Agent Framework (deferred to Q1 2026)
- All SKIP commits from analysis (CI, telemetry, docs-only, test-only, release infrastructure)

## Commit Batches

All batches are now strictly chronological so cross-batch dependencies are minimized. Special-case commits have their own micro-batches with explicit prep steps.

### Batch 1: Early Release/OAuth Foundations (5 commits)
Range: 2025-09-24

| Commit | Date | Description |
|--------|------|-------------|
| cc47e475a | 2025-09-24 | support standard GitHub release archives format |
| 4f49341ce | 2025-09-24 | relax JSON schema validation |
| ad59be0c8 | 2025-09-24 | fix(core): Fix unable to cancel edit tool |
| 22740ddce | 2025-09-24 | refactor(core): Extract thought parsing logic into a dedicated utility |
| e0ba7e4ff | 2025-09-24 | Use registration endpoint for dynamic client registration |

**Risk:** Low — touches release packaging, schema validation, and core cancellation plumbing.

### Batch 2: Remaining 9/24 Fixes + AbortSignal (5 commits)
Range: 2025-09-24 to 2025-09-25

| Commit | Date | Description |
|--------|------|-------------|
| 86e45c9aa | 2025-09-24 | Fix Windows extension install issue |
| 05c962af1 | 2025-09-24 | update edit tool error type during LLM judgements |
| 275a12fd4 | 2025-09-24 | set default maxAttempts in baseLLMClient |
| 66c2184fe | 2025-09-25 | AbortSignal support for retry logic/tool execution |
| c463d47fa | 2025-09-25 | Indicator for extension enable/disable |

**Risk:** Low.  
**Special handling:** `275a12fd4` assumes an upstream `baseLlmClient`. When cherry-picking, port the maxAttempts default into our existing retry helpers (`packages/core/src/core/client.ts` and related utilities) so behavior matches without introducing the upstream class. Document the interim hook so the later baseLlm reimplementation can delete the shim cleanly.

### Batch 3: Retry & Extension Safety (5 commits)
Range: 2025-09-25

| Commit | Date | Description |
|--------|------|-------------|
| 4caaa2a8e | 2025-09-25 | ensure retry sets defaults for nullish values |
| e20972478 | 2025-09-25 | Improve API error retry logic |
| a0c8e3bf2 | 2025-09-25 | Re-request consent when updating extensions |
| defda3a97 | 2025-09-25 | Fix duplicate info messages for extension updates |
| 2d76cdf2c | 2025-09-25 | Throw error for invalid extension names |

**Risk:** Low.

### Batch 4: Prompting + UI Harden (5 commits)
Range: 2025-09-25

| Commit | Date | Description |
|--------|------|-------------|
| c334f02d5 | 2025-09-25 | Escape ANSI control codes from model output |
| d2d9ae3f9 | 2025-09-25 | Truncate long loading text |
| 6535b71c3 | 2025-09-25 | Prevent model from reverting successful changes |
| 18e511375 | 2025-09-25 | Unset foreground in default themes |
| 53434d860 | 2025-09-25 | Update extension enablement behavior/info |

**Risk:** Low (security/UX).

### Batch 5: MCP + Dependency Prep (5 commits)
Range: 2025-09-25 to 2025-09-26

| Commit | Date | Description |
|--------|------|-------------|
| 11c995e9f | 2025-09-25 | Stop checking MCP tool schemas for type definitions |
| 8a16165a9 | 2025-09-26 | resolve ansi-regex dependency conflict |
| 3d7cb3fb8 | 2025-09-26 | Extract file filtering constants from Config |
| e909993dd | 2025-09-26 | Warn to avoid command substitution in shell tool |
| 0d22b22c8 | 2025-09-26 | Auto-correct file paths in smart edit |

**Risk:** Low.

### Batch 6: Allowed-tools Flag Integration (Single High-risk Commit)

| Commit | Date | Description |
|--------|------|-------------|
| e8a065cb9 | 2025-09-26 | Make `--allowed-tools` work in non-interactive mode |

**Risk:** Medium.  
**Handling:** Dedicated batch. Before cherry-picking, document the precedence rules between `--allowed-tools`, ephemerals, per-profile settings, and `/tools` runtime toggles. Add integration tests that cover these precedence cases plus non-interactive shell invocation. Do not proceed to Batch 7 until those rules and tests are in place.

### Batch 7: MCP Auth + Compression (5 commits)
Range: 2025-09-26 to 2025-09-27

| Commit | Date | Description |
|--------|------|-------------|
| db51e3f4c | 2025-09-26 | Add service-account impersonation provider to MCP |
| 93694c6a6 | 2025-09-27 | More aggressive compression algorithm |
| ffcd99636 | 2025-09-27 | Use `lastPromptTokenCount` for compression |
| 0b2d79a2e | 2025-09-27 | stop truncating `<static>` model output |
| 1bd75f060 | 2025-09-27 | Smart edit path auto-correct (cross-platform) |

**Risk:** Low.  
**Note:** Once db51e3f4c is merged and verified, Batch 10 will pick up the corresponding documentation commit `62e969137`.

### Batch 8: UI/UX Improvements (5 commits)
Range: 2025-09-28 to 2025-09-29

| Commit | Date | Description |
|--------|------|-------------|
| 331e2ce45 | 2025-09-28 | Show agent status in terminal title/taskbar |
| 62ba33061 | 2025-09-28 | Add radio button keys |
| ea061f52b | 2025-09-29 | Fix `-e <extension>` for disabled extensions |
| 8a2c2dc73 | 2025-09-29 | Enable tool output truncation by default |
| ac4a79223 | 2025-09-29 | Content-based retries for JSON generation |

**Risk:** Low.

### Batch 9: Cross-platform & IDE polish (5 commits)
Range: 2025-09-29

| Commit | Date | Description |
|--------|------|-------------|
| a49a09f13 | 2025-09-29 | Sync package-lock.json |
| 94f43c79d | 2025-09-29 | Fix markdown rendering on Windows |
| d6933c77b | 2025-09-29 | IDE trust listener listens to status changes |
| cea1a867b | 2025-09-29 | Extension update confirmation dialog |
| d37fff7fd | 2025-09-29 | `/tool` and `/mcp` output uses structured data |

**Risk:** Low.

### Batch 10: Terminal/UI Refinement (5 commits)
Range: 2025-09-29 to 2025-09-30

| Commit | Date | Description |
|--------|------|-------------|
| 6f6e004f8 | 2025-09-29 | Add red threshold for `getStatusColor` util |
| ae387b61a | 2025-09-29 | Reduce margin on narrow screens |
| ae51bbdae | 2025-09-29 | `/extensions update` auto-complete |
| 1067df187 | 2025-09-30 | A2A server liveOutput/resultsDisplay |
| 42436d2ed | 2025-09-30 | Don’t log invalid extension error for `-e none` |

**Risk:** Low.

### Batch 11: Extension + Shell Hardening (5 commits)
Range: 2025-09-30

| Commit | Date | Description |
|--------|------|-------------|
| 6c54746e2 | 2025-09-30 | Restore case-insensitive extension enablement |
| 953935d67 | 2025-09-30 | Fix cache collision in LLM edit fixer |
| 0fec673bf | 2025-09-30 | Fix installing extensions from zip files |
| 6695c32aa | 2025-09-30 | Improve shell output presentation/usability |
| c913ce3c0 | 2025-09-30 | Honor `argv @path` in interactive sessions |

**Risk:** Low.

### Batch 12: Memory/Settings/Docs (3 commits)
Range: 2025-09-30 to 2025-10-01

| Commit | Date | Description |
|--------|------|-------------|
| f207ea94d | 2025-09-30 | Ignore `@` mentions inside code blocks (memory fix) |
| ed1b5fe5e | 2025-10-01 | Ensure `InferSettings` handles enum combinations |
| 65e7ccd1d | 2025-10-01 | Document custom witty loading phrases |

**Risk:** Low.

### Batch 13: MCP Documentation Follow-up (1 commit)

| Commit | Date | Description |
|--------|------|-------------|
| 62e969137 | 2025-09-30 | Document MCP SA impersonation |

**Risk:** Low.  
**Prerequisite:** Only run this batch after db51e3f4c (Batch 7) is verified so the docs match behavior. Treat as its own verification cycle to keep user-facing docs tightly coupled with the new auth provider.

### Batch 14: Regex Smart Edit (1 commit – CAREFUL)

| Commit | Date | Description |
|--------|------|-------------|
| ec08129fb | 2025-09-30 | Regex Search/Replace for Smart Edit Tool |

**Risk:** Medium (smart-edit behavior changes).  
**Pre-flight:**  
1. Confirm smart-edit is enabled and not replaced by fuzzy/range edit.  
2. Capture any llxprt-local patches to smart-edit before cherry-picking.  
3. After cherry-pick, expand tests to cover regex matching/indentation across platforms.

### Batch 15: Final Bug Fix (1 commit)

| Commit | Date | Description |
|--------|------|-------------|
| 11f7a6a2d | 2025-10-07 | retain user message in history on stream failure |

**Risk:** Low — end-of-range fix.

## Verification Procedure

After each batch, execute the following verification steps in this exact order:

### 1. Run Tests
```bash
npm run test:ci
```
**Success Criteria:** All tests pass, no failures

### 2. Run Linting
```bash
npm run lint:ci
npx eslint integration-tests --max-warnings 0
npx prettier --check integration-tests
```
**Success Criteria:** Zero linting errors, zero warnings

### 3. Type Check
```bash
npm run typecheck
```
**Success Criteria:** No type errors

### 4. Format Code
```bash
npm run format
```
**Success Criteria:** Code formatted successfully

### 5. Build All Packages
```bash
npm run build
```
**Success Criteria:** All packages build without errors

### 6. Create Bundle
```bash
npm run bundle
```
**Success Criteria:** Bundle created successfully

### 7. Integration Test
```bash
node bundle/llxprt.js --profile synthetic "write me a haiku"

# AGENTS completion sequence
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
node scripts/start.js --profile-load synthetic --prompt "just say hi"
```
**Success Criteria:** CLI runs successfully, generates haiku

### 8. AGENTS Completion Checklist
Run the repository-required sequence after the bundle smoke test to stay compliant with `AGENTS.md`:
```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
node scripts/start.js --profile-load synthetic --prompt "just say hi"
```
All commands must succeed (exit code 0) before proceeding.

### 9. Commit Batch
```bash
git add -A
git commit -S -m "chore: cherry-pick batch N from upstream v0.7.0-v0.8.2

Includes commits:
- commit1: description
- commit2: description
...

All tests, lint, typecheck, and build passing."
```

### 10. Push Batch
```bash
git push origin 20251121gmerge
```

**Important:** Do NOT proceed to next batch if any verification step fails. Fix issues first.

## Final Merge Commit

After all batches are successfully cherry-picked and verified:

```bash
# Create empty merge commit to v0.8.2 last picked commit
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
- Declarative Agent Framework (deferred to Q1 2026)

To be reimplemented separately:
- baseLlmClient extraction (8abe7e151) - will reimplement with multi-provider support

Last cherry-picked commit: 11f7a6a2d"

git push origin 20251121gmerge
```

## Subagent Instructions

### For Cherrypicking Subagent

**Role:** Execute cherry-picking batches

**Process:**
1. Read the batch from this plan
2. For each commit in the batch (in order):
   - Execute: `git cherry-pick <commit-sha>`
   - If conflicts occur:
     - STOP immediately
     - Document conflicts in cherrypick-checklist.md
     - Report to remediation subagent
     - Do NOT attempt to resolve (hand off to remediation)
   - If successful: Mark in checklist as "Picked"
3. After batch completes without conflicts:
   - Report to verification subagent
   - Wait for verification approval
4. If verification passes:
   - Mark batch as "Verified" in checklist
   - Proceed to next batch
5. If verification fails:
   - Mark as "Failed Verification" in checklist
   - Report to remediation subagent

**Commands to Run:**
```bash
# Navigate to repo
cd /Users/acoliver/projects/llxprt-code-branches/llxprt-code-3

# For each commit in batch
git cherry-pick <commit-sha>

# After batch, hand off to verification subagent
```

**Do NOT:**
- Skip commits
- Resolve conflicts without explicit instruction
- Continue after conflict without remediation approval
- Modify commit messages (keep upstream messages)

### For Verification Subagent

**Role:** Execute verification procedure after each batch

**Process:**
1. Receive notification from cherrypicking subagent
2. Execute verification steps 1-8 (see Verification Procedure above)
3. Document results in cherrypick-checklist.md
4. If all steps pass:
   - Mark batch as "Verified" in checklist
   - Approve continuation to commit step
5. If any step fails:
   - Mark which step failed in checklist
   - Document error messages
   - Report to remediation subagent
   - Do NOT proceed

**Commands to Run:**
```bash
# From main project directory
cd /Users/acoliver/projects/llxprt-code-branches/llxprt-code-3

# Run verification sequence
npm run test:ci
npm run lint:ci
npx eslint integration-tests --max-warnings 0
npx prettier --check integration-tests
npm run typecheck
npm run format
git add -A  # Stage formatted changes
npm run build
npm run bundle
node bundle/llxprt.js --profile synthetic "write me a haiku"
```

**Success Criteria:**
- All commands exit with code 0
- No error messages
- Integration test produces haiku

**Failure Response:**
- Capture full error output
- Identify which file(s) caused failure
- Report to remediation subagent with details
- Do NOT attempt fixes

### For Remediation Subagent

**Role:** Resolve conflicts and fix verification failures

**Process:**
1. Receive failure report (conflict or verification failure)
2. Analyze the issue:
   - For conflicts: Review conflicting files, understand changes
   - For verification: Analyze error messages, identify root cause
3. Develop fix strategy:
   - For conflicts: Resolve preserving both llxprt customizations and upstream improvements
   - For verification: Fix code/tests/types to pass checks
4. Implement fix
5. Re-run verification steps
6. If successful:
   - Mark as "Remediated" in checklist
   - Hand back to cherrypicking subagent to continue
7. If still failing:
   - Escalate to human with detailed analysis

**Commands to Run:**
```bash
# For conflicts
git status  # See conflicting files
# Edit files to resolve
git add <resolved-files>
git cherry-pick --continue

# For verification failures
# Fix identified issues
# Re-run verification
npm run test:ci
npm run lint:ci
# ... full verification sequence
```

**Conflict Resolution Guidelines:**
1. Preserve llxprt-specific code (multi-provider, ephemerals, etc.)
2. Integrate upstream improvements where compatible
3. If incompatible: Document why, propose adaptation
4. Never blindly accept upstream or ours - manual merge required
5. Test thoroughly after resolution

**Do NOT:**
- Skip or ignore conflicts
- Accept all upstream changes without review
- Remove llxprt-specific features
- Proceed without verification passing

## Progress Tracking

Track progress in `cherrypick-checklist.md` with updates after each step:
- [ ] Batch picked
- [ ] Tests passing
- [ ] Lint passing
- [ ] Typecheck passing
- [ ] Format applied
- [ ] Build successful
- [ ] Bundle created
- [ ] Integration test passed
- [ ] Committed
- [ ] Pushed

## Rollback Procedure

If a batch causes unfixable issues:

```bash
# Reset to last known good state
git reset --hard origin/20251121gmerge

# Document in checklist which batch failed
# Skip problematic commits
# Continue with next batch
```

## Post-Merge Actions

After all batches complete:

1. **Create PR Summary:**
   - List all 58 commits picked
   - Summarize major improvements
   - Note any adaptations made
   - Document any skipped commits from batch

2. **Update Documentation:**
   - CHANGELOG.md entry
   - Update upstream tracking notes

3. **Notify Team:**
   - Announce completion
   - Highlight breaking changes (if any)
   - Note new features available

4. **Implement baseLlmClient (Separate Task):**
   - Create `packages/core/src/core/baseLlmClient.ts`
   - Extract stateless utility methods from client.ts (generateJson, generateEmbedding)
   - Implement multi-provider support (Anthropic, OpenAI, Gemini, etc.)
   - Refactor client.ts to use baseLlmClient for utility calls
   - Update all call sites (llm-edit-fixer.ts, etc.)
   - Add comprehensive tests
   - Document the separation of concerns

## Notes

- **Working Directory:** All commands run from `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-3`
- **Branch:** `20251121gmerge`
- **No User Intervention Required:** Subagents should execute autonomously
- **Stop on Failure:** Do not continue if verification fails
- **Commit Messages:** Keep upstream commit messages, add batch summary in final commit
- **GPG Signing:** All commits must be signed with `-S` flag

## Timeline Estimate

- **Per Batch:** ~10-15 minutes (pick + verify)
- **Total Batches:** 15 batches (including the two single-commit batches and the doc follow-up)
- **Estimated Total Time:** 2.5-3.5 hours (assuming no conflicts)
- **With Conflicts:** Add 15-30 minutes per conflict resolution
