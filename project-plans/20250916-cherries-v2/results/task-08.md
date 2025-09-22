# Task 08 Results - Batch Picks

## Commits Picked / Ported

### Successfully Cherry-picked (3 of 5):
1. **648ab84b** → **ad0adb44c**: feat(cli): deprecate redundant CLI flags (#7360)
   - Added deprecation warnings for various CLI flags that should use settings.json instead
   - Conflict resolved in config.ts by accepting all deprecation warnings

2. **9037f25d** → **906d20567**: fix(core): treat UTF16/32 BOM files as text and decode correctly (#6081)
   - Clean cherry-pick, no conflicts
   - Properly handles UTF-16 and UTF-32 BOM file detection

3. **2a0e69d8** → **6c2f678f0**: fix(trust): Update config.isTrustedFolder (#7373)
   - Conflict in App.tsx resolved by combining token metrics state with trusted folder state
   - Deleted config.test.ts as it was already removed in llxprt (tests moved to auth.test.ts)

### Skipped Commits (2 of 5):
1. **71ad272a**: Show citations at the end of each turn (#7350)
   - REASON: Incompatible with llxprt's flat settings structure
   - Contains nested settings migration (ui.showCitations) that conflicts with llxprt's design

2. **c9e1265d**: Fix backwards-compatibility for allowedTools -> tools.allowed (#7384)
   - REASON: Migration map not applicable to llxprt's flat settings structure
   - Only adds migration mapping that llxprt doesn't use

## Original Diffs
```bash
# git show 648ab84b
commit 648ab84b2...
Author: Allen Hutchison <adh@google.com>
Date: Thu Aug 28 16:22:59 2025 -0700
    feat(cli): deprecate redundant CLI flags (#7360)
# Added deprecateOption calls for: telemetry, telemetry-target, telemetry-otlp-endpoint, 
# telemetry-otlp-protocol, telemetry-log-prompts, telemetry-outfile, show-memory-usage,
# sandbox-image, proxy, checkpointing, all-files

# git show 9037f25d
commit 9037f25d...
Author: Tayyab3245 <tmalik3245@gmail.com>
Date: Thu Aug 28 21:13:46 2025 -0400
    fix(core): treat UTF16/32 BOM files as text and decode correctly (#6081)
# Modified fileUtils.ts to properly detect and handle UTF-16/32 BOM files
# Added integration test for UTF BOM encoding

# git show 2a0e69d8
commit 2a0e69d83...
Author: shrutip90 <shruti.p90@gmail.com>
Date: Thu Aug 28 19:41:33 2025 -0700
    fix(trust): Update config.isTrustedFolder (#7373)
# Updated trust folder handling and added isTrustedFolderState to App.tsx
```

## Our Committed Diffs
```bash
# git show ad0adb44c
[20250916-gmerge ad0adb44c] feat(cli): deprecate redundant CLI flags (#7360)
 1 file changed, 44 insertions(+)

# git show 906d20567
[20250916-gmerge 906d20567] fix(core): treat UTF16/32 BOM files as text and decode correctly (#6081)
 3 files changed, 649 insertions(+), 28 deletions(-)

# git show 6c2f678f0
[20250916-gmerge 6c2f678f0] fix(trust): Update config.isTrustedFolder (#7373)
 10 files changed, 41 insertions(+), 112 deletions(-)
```

## Test Results
- Command: `npm run test`
- ✅ PASSED: 3042 tests passed, 55 skipped
- All test suites completed successfully

## Lint Results
- Command: `npm run lint:ci`
- ✅ PASSED: Zero errors or warnings
- Fixed warnings in ProQuotaDialog components (added useCallback)

## Typecheck Results
- Command: `npm run typecheck`
- ✅ PASSED: No TypeScript errors

## Build Results
- Command: `npm run build`
- ✅ PASSED: Build completed successfully
- All packages built without issues

## Format Check
- Command: `npm run format:check`
- ✅ PASSED: All files properly formatted

## Lines of Code Analysis
- Upstream intended: ~750 lines (including skipped commits)
- Actually applied: ~734 lines
- Within tolerance as we skipped migration-related changes

## Conflicts & Resolutions

### Conflict 1: packages/cli/src/config/config.ts (commit 648ab84b)
- **Issue**: Merge conflict with deprecation warnings section
- **Resolution**: Accepted all incoming deprecation warnings, they're compatible with llxprt

### Conflict 2: packages/cli/src/ui/App.tsx (commit 2a0e69d8)
- **Issue**: Merge conflict between token metrics state and trusted folder state
- **Resolution**: Combined both - kept token metrics from HEAD and added isTrustedFolderState from incoming

### Conflict 3: packages/cli/src/config/config.test.ts (commit 2a0e69d8)
- **Issue**: File deleted in HEAD but modified in incoming change
- **Resolution**: Kept file deleted as tests were moved to auth.test.ts in llxprt

## Manual Verification Notes
- Skipped 2 commits that involve nested settings migration incompatible with llxprt's flat structure
- All cherry-picked changes maintain llxprt's multi-provider architecture
- No branding overwrites or provider-specific code introduced
- Trusted folder functionality preserved with llxprt's implementation

---

Store the completed file at `project-plans/20250916-cherries-v2/results/task-08.md` and rerun the quality gate after updates.