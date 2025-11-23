# Cherry-Pick Implementation Plan: gemini-cli v0.8.2 → v0.9.0

**Created:** 2025-11-23
**Branch:** 20251123gmerge
**Total Commits:** 36 (34 PICK + 2 PICK CAREFULLY)

## Overview

This plan details the step-by-step process for cherry-picking 36 commits from gemini-cli v0.8.2 to v0.9.0 into llxprt-code. Commits are organized in **chronological order** (oldest first) and processed in **batches of 5**, with **PICK CAREFULLY** commits in their own batches.

## Pre-Execution Checklist

- [ ] Create branch: `git checkout -b 20251123gmerge`
- [ ] Verify upstream remote: `git remote -v | grep upstream`
- [ ] Fetch latest: `git fetch upstream`
- [ ] Confirm starting point: `git log --oneline -1`

**CRITICAL: ALL WORK MUST BE DONE ON THE `20251123gmerge` BRANCH**
- ⚠️ **NEVER switch branches during this process**
- ⚠️ All cherry-picks, commits, and merges must be on `20251123gmerge`
- ⚠️ Verify branch before each batch: `git branch --show-current`
- ⚠️ If you accidentally switch branches, immediately switch back: `git checkout 20251123gmerge`

## Execution Strategy

### Batch Processing Rules

1. **Branch requirement:** ALL work on `20251123gmerge` branch (never switch!)
2. **Regular batches:** Cherry-pick 5 commits at once
3. **PICK CAREFULLY batches:** Single commit per batch (for careful testing)
4. **Verification frequency:** After every **second** batch (or after PICK CAREFULLY)
5. **Conflict resolution:** Use dedicated subagent after each batch

### Subagent Workflow

For each batch:
1. **Cherry-picker subagent** - Performs the git cherry-picks
2. **Conflict-resolver subagent** - Resolves any conflicts and issues
3. **Verification** (after every 2nd batch) - Full quality checks

## Full Verification Procedure

Run after every second batch (or after PICK CAREFULLY commits):

```bash
# Kill any running vitest instances first
ps -ef | grep -i vitest | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true

# Full verification suite
npm run lint
npm run typecheck
npm run build
npm test
npm run format
git add -A  # Stage any formatting changes

# Smoke test
node scripts/start.js --profile-load synthetic "write me a haiku"

# Clean up vitest again
ps -ef | grep -i vitest | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true

# Commit the verified batches
git commit -S -m "$(cat <<'EOF'
chore: cherry-pick batch [N] from gemini-cli v0.8.2→v0.9.0

Commits included:
- [list commit SHAs and descriptions]

All tests passing, verified with smoke test.
EOF
)"
```

**Note:** Replace `[N]` with the batch numbers (e.g., "1-2" for checkpoint 1) and list the actual commit SHAs.

---

## Batch 1: UI Fixes (Oct 1) - 5 commits

**⚠️ VERIFY BRANCH:** `git branch --show-current` should show `20251123gmerge`

**Commits (chronological order):**
1. `6eca199c` - Cleanup useSelectionList and fix infinite loop
2. `a404fb8d` - Switch to reducer for update state (fix flicker)
3. `6553e644` - Fix paste timeout protection (less invasive)
4. `ef76a801` - Revert reducing margin on narrow screens
5. `33269bdb` - Increase padding of settings dialog

**Cherry-picker subagent instructions:**
```bash
git cherry-pick 6eca199c a404fb8d 6553e644 ef76a801 33269bdb
```

**Conflict-resolver subagent:**
- Review any conflicts in UI components
- Ensure llxprt-specific UI changes are preserved
- Verify no import path issues (@vybestack/llxprt-code-core vs @google/gemini-cli-core)

**Expected issues:**
- Potential conflicts in Footer.tsx, App.tsx if llxprt has UI customizations
- May need to adapt settings dialog padding for llxprt theme

---

## Batch 2: Oct 2 Fixes Part 1 - 5 commits

**Commits:**
1. `ebbfcda7` - Support GitHub repo URL with trailing slash
2. `332e392a` - Add shell specification for winpty (Windows)
3. `eae8b8b1` - Use constant for tool_output_truncated event name
4. `e7a13aa0` - Fix stream parsing for Windows Zed integration
5. `12d4ec2e` - Introduce debug logging in IDE extension

**Cherry-picker subagent instructions:**
```bash
git cherry-pick ebbfcda7 332e392a eae8b8b1 e7a13aa0 12d4ec2e
```

**Conflict-resolver subagent:**
- Windows compatibility changes should apply cleanly
- IDE integration fixes are important (llxprt has full IDE support)
- Check constant naming matches llxprt conventions

**Expected issues:**
- IDE extension changes may need path adaptations
- Verify Zed integration works with llxprt's multi-provider setup

### ✅ VERIFICATION CHECKPOINT 1 (After Batch 2)
Run full verification procedure (see above)

**Commit message example:**
```
chore: cherry-pick batches 1-2 from gemini-cli v0.8.2→v0.9.0

Commits included:
- 6eca199c: Cleanup useSelectionList and fix infinite loop
- a404fb8d: Switch to reducer for update state (fix flicker)
- 6553e644: Fix paste timeout protection (less invasive)
- ef76a801: Revert reducing margin on narrow screens
- 33269bdb: Increase padding of settings dialog
- ebbfcda7: Support GitHub repo URL with trailing slash
- 332e392a: Add shell specification for winpty (Windows)
- eae8b8b1: Use constant for tool_output_truncated event
- e7a13aa0: Fix stream parsing for Windows Zed integration
- 12d4ec2e: Introduce debug logging in IDE extension

All tests passing, verified with smoke test.
```

---

## Batch 3: Oct 2 Fixes Part 2 - 5 commits

**Commits:**
1. `4a70d6f2` - Suppress update messages in managed IDEs
2. `a6af7bbb` - Implement submit_final_output tool for agents
3. `43bac6a0` - Add /memory list subcommand
4. `0c6f9d28` - Prevent tools discovery error for prompt-only MCP servers
5. `16d47018` - Fix /chat list terminal escape codes

**Cherry-picker subagent instructions:**
```bash
git cherry-pick 4a70d6f2 a6af7bbb 43bac6a0 0c6f9d28 16d47018
```

**Conflict-resolver subagent:**
- **CRITICAL**: For `43bac6a0`, adapt ALL references from GEMINI.md → LLXPRT.md
- Check config.getGeminiMdFilePaths() → config.getLlxprtMdFilePaths() or similar
- Agent framework changes should be compatible
- MCP improvements are valuable for llxprt

**Expected issues:**
- `43bac6a0` requires name adaptations (GEMINI.md → LLXPRT.md)
- Memory command may reference gemini-specific paths
- Test files may need updates for LLXPRT.md naming

---

## Batch 4: Oct 2-3 Improvements - 5 commits

**Commits:**
1. `93c7378d` - Fix formatting on main
2. `f76adec8` - Add basic smoke testing to CI
3. `3f79d7e5` - Fix OAuth support for MCP servers
4. `ee3e4017` - Add processOutput to AgentDefinition
5. `8149a454` - Add sensitive keyword linter

**Cherry-picker subagent instructions:**
```bash
git cherry-pick 93c7378d f76adec8 3f79d7e5 ee3e4017 8149a454
```

**Conflict-resolver subagent:**
- Formatting fixes should apply cleanly
- MCP OAuth fix is important for llxprt
- Agent typing improvements are valuable
- Security linter is important addition

**Expected issues:**
- CI smoke testing may reference gemini-specific commands (adapt or skip)
- OAuth changes should work with llxprt's multi-provider auth

### ✅ VERIFICATION CHECKPOINT 2 (After Batch 4)
Run full verification procedure (see above)

**Commit message example:**
```
chore: cherry-pick batches 3-4 from gemini-cli v0.8.2→v0.9.0

Commits included:
- 4a70d6f2: Suppress update messages in managed IDEs
- a6af7bbb: Implement submit_final_output tool for agents
- 43bac6a0: Add /memory list subcommand (adapted for LLXPRT.md)
- 0c6f9d28: Prevent tools discovery error for prompt-only MCP
- 16d47018: Fix /chat list terminal escape codes
- 93c7378d: Fix formatting on main
- f76adec8: Add basic smoke testing to CI
- 3f79d7e5: Fix OAuth support for MCP servers
- ee3e4017: Add processOutput to AgentDefinition
- 8149a454: Add sensitive keyword linter

All tests passing, verified with smoke test.
```

---

## Batch 5: Oct 3 Security & Tests - 4 commits

**Commits:**
1. `43b3f79d` - Update dependency versions (fix vulnerabilities)
2. `f2308dba` - Fix flaky integration tests for compress command
3. `1a062820` - Fix silent pass for formatting mistakes in CI
4. `7f8537a1` - Cleanup extension update logic

**Cherry-picker subagent instructions:**
```bash
git cherry-pick 43b3f79d f2308dba 1a062820 7f8537a1
```

**Conflict-resolver subagent:**
- Dependency updates may cause package.json conflicts
- Test fixes should apply cleanly
- CI formatting checks are important for llxprt
- Extension logic may need adaptation

**Expected issues:**
- package.json/package-lock.json conflicts likely
- May need to run `npm install` after dependency updates
- Verify extension system compatibility

---

## Batch 6: PICK CAREFULLY - Retry Logic Unification - 1 commit

**Commit:**
- `3b92f127` (Oct 3) - Unify retry logic and remove schema depth check

**Cherry-picker subagent instructions:**
```bash
git cherry-pick 3b92f127
```

**Conflict-resolver subagent - CRITICAL REVIEW:**
- **VERIFY**: Does NOT include automatic model fallback behavior
- **VERIFY**: Compatible with llxprt's multi-provider retry logic
- **VERIFY**: Removes schema depth check doesn't break error handling
- **VERIFY**: No Google-specific error handling introduced
- Test thoroughly with all providers (OpenAI, Anthropic, Google, etc.)

**Expected issues:**
- May conflict with llxprt's existing retry.ts if heavily customized
- Removing schema depth check may affect validation
- Must ensure multi-provider compatibility

**Testing requirements:**
- Test retry behavior with each provider
- Test quota errors (don't auto-fallback)
- Test network failures
- Test timeout scenarios

### ✅ VERIFICATION CHECKPOINT 3 (After Batch 6 - PICK CAREFULLY)
Run full verification procedure (see above) + extended retry testing

**Commit message example:**
```
chore: cherry-pick batches 5-6 from gemini-cli v0.8.2→v0.9.0

Commits included:
- 43b3f79d: Update dependency versions (fix vulnerabilities)
- f2308dba: Fix flaky integration tests for compress
- 1a062820: Fix silent pass for formatting mistakes in CI
- 7f8537a1: Cleanup extension update logic
- 3b92f127: Unify retry logic (PICK CAREFULLY - verified multi-provider)

All tests passing, retry logic verified with multi-provider testing.
Smoke test successful.
```

---

## Batch 7: Oct 6 Features - 3 commits

**Commits:**
1. `d9fdff33` - Make --allowed-tools work in non-interactive mode
2. `e705f45c` - Retain user message in history on stream failure
3. `4f53919a` - Update extensions docs

**Cherry-picker subagent instructions:**
```bash
git cherry-pick d9fdff33 e705f45c 4f53919a
```

**Conflict-resolver subagent:**
- Tool filtering enhancement is valuable for llxprt
- Stream failure fix is critical bug fix
- **ADAPT**: Documentation for llxprt branding (gemini → llxprt)

**Expected issues:**
- `4f53919a` is just docs reorganization - adapt gemini references
- Stream failure fix should apply cleanly
- Tool filtering may need testing with llxprt's tool system

---

## Batch 8: PICK CAREFULLY - Session Cleanup - 1 commit

**Commit:**
- `974ab66b` (Oct 6) - Add automatic session cleanup and retention policy

**Cherry-picker subagent instructions:**
```bash
git cherry-pick 974ab66b
```

**Conflict-resolver subagent - CRITICAL REVIEW:**
- **MAJOR FEATURE**: ~2500 lines added
- **VERIFY**: Session cleanup logic compatible with llxprt's chat management
- **VERIFY**: Settings schema changes don't conflict
- **VERIFY**: Path handling works (chats/ directory structure)
- Test age-based and count-based retention policies
- Verify safety minimum works correctly

**Expected issues:**
- Settings schema conflicts likely (settingsSchema.ts)
- May need to adapt config paths
- Extensive test suite added - may have test conflicts
- Integration tests may reference gemini-specific paths

**Testing requirements:**
- Create test chat files
- Test age-based cleanup (maxAge)
- Test count-based cleanup (maxCount)
- Test minimum retention safety (minRetention)
- Verify corrupted session file handling
- Test with debug mode enabled/disabled

### ✅ VERIFICATION CHECKPOINT 4 (After Batch 8 - PICK CAREFULLY)
Run full verification procedure (see above) + extended session cleanup testing

**Commit message example:**
```
chore: cherry-pick batches 7-8 from gemini-cli v0.8.2→v0.9.0

Commits included:
- d9fdff33: Make --allowed-tools work in non-interactive mode
- e705f45c: Retain user message in history on stream failure
- 4f53919a: Update extensions docs (adapted for llxprt)
- 974ab66b: Add session cleanup feature (PICK CAREFULLY - ~2500 lines)

All tests passing, session cleanup thoroughly tested.
Age-based and count-based retention policies verified.
Smoke test successful.
```

---

## Batch 9: Oct 7 Polish - 5 commits

**Commits:**
1. `5a0b21b1` - Fix link to Extension Releasing Guide
2. `c4656fb0` - Fix folder trust tests
3. `343be47f` - Use extract-zip and tar libraries for archives
4. `6bb99806` - Fix quoting when echoing workflow JSON
5. `34ba8be8` - Enhance debug profiler (framerate, dispatch errors)

**Cherry-picker subagent instructions:**
```bash
git cherry-pick 5a0b21b1 c4656fb0 343be47f 6bb99806 34ba8be8
```

**Conflict-resolver subagent:**
- Documentation link fix - adapt for llxprt docs
- Test fixes should apply cleanly
- Archive extraction improvement is good
- Workflow JSON fix may need adaptation
- Debug profiler enhancements useful

**Expected issues:**
- Documentation paths may need llxprt adaptation
- Archive libraries may add dependencies
- Debug profiler may reference gemini-specific metrics

---

## Batch 10: IDE & Accessibility Finals - 2 commits

**Commits:**
1. `c195a9aa` (Oct 7) - Use 127.0.0.1 for IDE client connection
2. `9defae42` (Oct 14) - Screen reader accessibility improvements

**Cherry-picker subagent instructions:**
```bash
git cherry-pick c195a9aa 9defae42
```

**Conflict-resolver subagent:**
- IDE localhost → 127.0.0.1 fix is critical
- Accessibility improvements important for compliance
- Screen reader notification may reference gemini paths

**Expected issues:**
- IDE connection change should apply cleanly
- Settings dialog paths may reference .gemini → .llxprt

### ✅ VERIFICATION CHECKPOINT 5 (After Batch 10 - Final)
Run full verification procedure (see above) + IDE connection testing

**Commit message example:**
```
chore: cherry-pick batches 9-10 from gemini-cli v0.8.2→v0.9.0

Commits included:
- 5a0b21b1: Fix link to Extension Releasing Guide
- c4656fb0: Fix folder trust tests
- 343be47f: Use extract-zip and tar libraries for archives
- 6bb99806: Fix quoting when echoing workflow JSON
- 34ba8be8: Enhance debug profiler (framerate, dispatch errors)
- c195a9aa: Use 127.0.0.1 for IDE client connection
- 9defae42: Screen reader accessibility improvements

All tests passing, IDE connection verified.
Smoke test successful.
Final verification complete.
```

---

## Post-Cherry-Pick Tasks

### 1. Final Verification
```bash
# Complete verification suite
npm run lint
npm run typecheck
npm run build
npm test
npm run format
git add -A

# Integration tests
npm run test:integration

# E2E smoke tests
node scripts/start.js --profile-load synthetic "write me a haiku"
```

### 2. Create Fix Commit (if needed)
```bash
git add -A
git commit -S -m "fix: resolve conflicts and issues from gemini-cli 0.8.2→0.9.0 cherry-picks

- Adapted GEMINI.md references to LLXPRT.md
- Updated import paths for @vybestack/llxprt-code-core
- Fixed gemini branding → llxprt branding in docs
- Verified multi-provider compatibility for retry logic
- Tested session cleanup with llxprt's chat management"
```

### 3. Create Empty Merge Commit
```bash
# Merge the SPECIFIC commit hash (last cherry-picked commit from 0.9.0)
git merge -s ours --no-ff 5e9f60c7 -m "$(cat <<'EOF'
Merge upstream gemini-cli up to v0.9.0 (commit 5e9f60c7)

This is an empty merge commit to maintain parity with upstream structure.
All changes have been cherry-picked in batches:

Cherry-picked commits (36 total):
- UI improvements and bug fixes
- IDE integration enhancements (127.0.0.1, debug logging, Zed fixes)
- MCP improvements (OAuth, prompt-only servers)
- Security updates (dependency fixes, sensitive keyword linter)
- Session cleanup feature (automatic retention policies)
- Retry logic unification (verified multi-provider compatibility)
- Accessibility improvements (screen reader support)
- Memory command enhancements (adapted for LLXPRT.md)
- Extension updates (adapted for llxprt branding)

Skipped commits (46 total):
- Gemini release management commits
- ClearcutLogger telemetry (removed from llxprt for privacy)
- Model fallback features (violates developer choice)
- Subagent/CodebaseInvestigator (architecture differences)
- OpenTelemetry metrics (privacy concerns)

Maintains llxprt's multi-provider support, privacy-first approach,
and custom branding while staying in sync with upstream improvements.
EOF
)"
```

### 4. Push Branch
```bash
git push origin 20251123gmerge
```

### 5. Create Pull Request
```bash
gh pr create --title "Merge upstream gemini-cli v0.9.0 improvements" --body "$(cat <<'EOF'
## Summary

Cherry-picked 36 commits from gemini-cli v0.8.2 to v0.9.0, bringing valuable improvements while preserving llxprt's unique features.

## Key Improvements

### IDE Integration
- Fixed IDE client connection (localhost → 127.0.0.1)
- Added debug logging for troubleshooting
- Fixed Windows Zed integration
- Suppressed update messages in managed IDEs

### MCP Enhancements
- Fixed OAuth support for MCP servers
- Handle prompt-only MCP servers gracefully

### Session Management
- **Major Feature**: Automatic session cleanup with retention policies
  - Age-based cleanup (e.g., delete chats older than 30 days)
  - Count-based cleanup (e.g., keep only 100 most recent)
  - Safety minimum (won't delete recent chats)

### Bug Fixes
- Retain user message in history on stream failure
- Fix infinite loop in selection list
- Fix flicker in update state
- Less invasive paste timeout protection
- Fix terminal escape codes in /chat list

### Security
- Updated dependencies to fix vulnerabilities
- Added sensitive keyword linter

### Accessibility
- Screen reader mode improvements
- Better default settings

### Memory Commands
- Added `/memory list` subcommand (adapted for LLXPRT.md)

### UI/UX
- Reverted problematic margin calculation
- Better settings dialog padding
- Fixed Windows compatibility issues

## Adaptations Made

- ✅ GEMINI.md → LLXPRT.md in memory commands
- ✅ Gemini branding → llxprt branding in documentation
- ✅ Verified multi-provider compatibility for retry logic
- ✅ Tested session cleanup with llxprt's chat management
- ✅ Import paths updated for @vybestack/llxprt-code-core

## Testing

- ✅ All tests passing
- ✅ Lint/typecheck/build successful
- ✅ Multi-provider testing (OpenAI, Anthropic, Google)
- ✅ IDE connection testing
- ✅ Session cleanup testing
- ✅ Smoke test with synthetic prompt

## Commits Skipped

- 46 commits skipped (release management, telemetry, model fallback, architecture differences)
- See project-plans/20251123gmerge/analysis.md for full details

## Next Steps

1. Review changes
2. Test in development environment
3. Merge to main
EOF
)"
```

---

## Subagent Prompts

### Cherry-Picker Subagent Prompt Template

```
You are cherry-picking commits from gemini-cli into llxprt-code.

**Batch [N]: [Description]**

Execute the following cherry-picks:
```bash
git cherry-pick [commit1] [commit2] [commit3] [commit4] [commit5]
```

If cherry-pick succeeds cleanly:
- Report success
- List files changed
- Proceed to next step

If conflicts occur:
- Report which commits have conflicts
- List conflicted files
- DO NOT resolve conflicts (conflict-resolver subagent will handle)
- Return status for each commit

Report back:
1. Success/failure for each commit
2. List of conflicted files (if any)
3. Summary of changes
```

### Conflict-Resolver Subagent Prompt Template

```
You are resolving conflicts and issues after cherry-picking commits from gemini-cli into llxprt-code.

**Batch [N]: [Description]**
**Conflicts in:** [list of files]

Your tasks:
1. Read each conflicted file
2. Understand both versions (ours vs theirs)
3. Resolve conflicts preserving:
   - llxprt's multi-provider architecture
   - llxprt's branding and naming
   - llxprt's import paths (@vybestack/llxprt-code-core)
   - llxprt's unique features

4. For this batch specifically:
   [Batch-specific instructions from plan]

5. After resolving:
   ```bash
   git add [resolved-files]
   git cherry-pick --continue
   ```

6. Verify:
   - npm run typecheck (quick check)
   - Conflicts resolved correctly

Report back:
1. How each conflict was resolved
2. Any adaptations made
3. Files modified
4. Ready for next batch: YES/NO
```

---

## Emergency Procedures

### If Cherry-Pick Fails Completely
```bash
# Abort current cherry-pick
git cherry-pick --abort

# Check status
git status

# Document the problematic commit
# Skip to next batch or investigate further
```

### If Tests Fail After Batch
```bash
# Don't proceed to next batch
# Investigate failures
# Fix issues
# Re-run verification
# Only continue when all tests pass
```

### If Build Fails
```bash
# Check for TypeScript errors
npm run typecheck

# Check for import path issues
grep -r "@google/gemini-cli" packages/

# Fix issues before continuing
```

---

## Success Criteria

- [ ] All 36 commits successfully cherry-picked
- [ ] All conflicts resolved
- [ ] All tests passing
- [ ] Lint/typecheck/build successful
- [ ] Format applied
- [ ] GEMINI.md → LLXPRT.md adaptations complete
- [ ] Gemini branding → llxprt branding complete
- [ ] Multi-provider compatibility verified
- [ ] Session cleanup tested
- [ ] IDE connection tested
- [ ] Smoke test successful
- [ ] Fix commit created (if needed)
- [ ] Empty merge commit created
- [ ] Branch pushed
- [ ] PR created

---

## Timeline Estimate

- Batch 1-2 (10 commits + verify): ~2 hours
- Batch 3-4 (10 commits + verify): ~2 hours
- Batch 5-6 (5 commits, 1 CAREFUL + verify): ~2 hours
- Batch 7-8 (4 commits, 1 CAREFUL + verify): ~3 hours (session cleanup is big)
- Batch 9-10 (7 commits + verify): ~2 hours
- Final verification & PR: ~1 hour

**Total Estimated Time: 12 hours**

Split across multiple sessions as needed. Each verification checkpoint is a good stopping point.
