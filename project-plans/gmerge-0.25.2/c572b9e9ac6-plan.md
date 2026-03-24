# Playbook: Adapt Session Cleanup to Remove Related Activity Logs When Present

**Upstream SHA:** `c572b9e9ac6`
**Upstream Subject:** feat(cli): cleanup activity logs alongside session files (#16399)
**Upstream Stats:** CLI housekeeping change; small LLxprt adaptation

## What Upstream Does

Upstream extends session-retention cleanup so that when obsolete session artifacts are deleted, related per-session activity log files are also deleted. The intent is to prevent orphaned diagnostic files from accumulating after the corresponding chat/session file has been removed.

## Why REIMPLEMENT in LLxprt

1. `CHERRIES.md` marks this work **REIMPLEMENT** because LLxprt’s session management differs from upstream and needs a local design.
2. LLxprt’s current `packages/cli/src/utils/sessionCleanup.ts` only cleans expired or corrupted chat session files under the chats temp directory.
3. The user explicitly noted two critical repo facts:
   - `sessionCleanup.ts` currently cleans expired/corrupted chat session files only.
   - `packages/cli/src/utils/activityLogger.ts` is absent.
4. Because `activityLogger.ts` does not exist today, this batch cannot be a verbatim port of upstream log-cleanup plumbing. The playbook must instead guide a conservative LLxprt implementation: clean up related activity-log files only if LLxprt already has an identifiable on-disk log location/pattern in the current repo, or add narrowly scoped support without introducing telemetry-like passive logging infrastructure.
5. The user also explicitly said to preserve LLxprt architecture and naming. That means no upstream Gemini-specific paths, no telemetry reintroduction, and no assumption that activity logs are mandatory.

## LLxprt File Existence Map

**Present (verified):**
- [OK] `packages/cli/src/utils/sessionCleanup.ts` — current session retention cleanup implementation; deletes chat files only
- [OK] `packages/cli/src/utils/sessionCleanup.test.ts` — unit coverage for cleanup behavior
- [OK] `packages/cli/src/utils/sessionCleanup.integration.test.ts` — integration coverage for startup cleanup behavior
- [OK] `packages/cli/src/utils/sessionUtils.ts` — helper layer for locating/parsing session files
- [OK] `packages/cli/src/gemini.tsx` — startup path that invokes `cleanupExpiredSessions`

**Absent / important constraint:**
- [MISSING] `packages/cli/src/utils/activityLogger.ts` — explicitly absent in current repo and must not be assumed as an existing dependency

**Needs repo-grounded discovery before implementation:**
- Any actual activity-log directory, naming pattern, or retention helper elsewhere in the repo

## Files to Modify/Create

### Modify: `packages/cli/src/utils/sessionCleanup.ts`
- Extend cleanup planning/deletion so that when a session file is selected for deletion, any corresponding activity-log artifact is also selected and deleted — but only if LLxprt has a real current-repo convention for such files.
- Keep the current startup-safe behavior: cleanup failures must not break CLI startup.
- Preserve current result accounting semantics or extend them carefully if tests justify additional counters.

### Modify: `packages/cli/src/utils/sessionCleanup.test.ts`
- Add behavioral tests for deleting associated log files when they exist.
- Add coverage that missing companion log files are ignored gracefully.
- Add coverage that unrelated log files are not deleted.

### Modify: `packages/cli/src/utils/sessionCleanup.integration.test.ts`
- Extend integration coverage only if the current test harness already creates temp session artifacts on disk and can naturally verify companion log cleanup.

### Create only if justified by current repo evidence
- If the repo already has a clear activity-log path pattern but lacks a tiny helper, a small helper module may be created.
- Do **not** create `packages/cli/src/utils/activityLogger.ts` just to mirror upstream unless execution-time code search proves LLxprt now needs a narrowly scoped shared helper for existing log-file conventions.

## Preflight Checks

```bash
# Inspect current cleanup implementation and what it deletes today
sed -n '1,280p' packages/cli/src/utils/sessionCleanup.ts

# Confirm activityLogger.ts is absent
test ! -f packages/cli/src/utils/activityLogger.ts && echo "OK: activityLogger.ts absent"

# Search the repo for activity-log concepts or file naming conventions
grep -R "activity log\|activityLogger\|activity-log\|session log\|chat log" \
  packages scripts --include="*.ts" --include="*.tsx" --include="*.md"

# Review current cleanup tests
sed -n '1,260p' packages/cli/src/utils/sessionCleanup.test.ts
sed -n '1,260p' packages/cli/src/utils/sessionCleanup.integration.test.ts
```

## Implementation Steps

1. Read `sessionCleanup.ts` fully and identify where session files are discovered, classified, and deleted.
2. Search the current repo for any existing activity-log artifact convention.
   - Look for directories under project temp/storage locations.
   - Look for file names derived from session IDs.
   - Look for startup/debug utilities that write per-session files.
3. If a real existing activity-log convention is found:
   - Add a small helper in `sessionCleanup.ts` or a narrowly scoped utility to derive candidate log paths from a session file/session ID.
   - When a session file is marked for deletion, attempt deletion of its related log artifact(s) as part of the same cleanup pass.
4. If no real existing convention is found:
   - Implement the minimal forward-compatible path only if supported by nearby settings/storage code, or document in the playbook execution notes that the batch should be adapted to the nearest current LLxprt artifact shape rather than inventing upstream infrastructure.
   - Do not add passive activity logging or telemetry-like collection.
5. Ensure ENOENT remains non-fatal for both session and companion-log deletions.
6. Keep cleanup result/debug logging aligned with LLxprt’s current style.
7. Add/update unit and integration tests around companion artifact cleanup.
8. Run verification.

## Verification

```bash
npm run lint
npm run typecheck
npm run test -- --reporter=verbose packages/cli/src/utils/sessionCleanup.test.ts
npm run test -- --reporter=verbose packages/cli/src/utils/sessionCleanup.integration.test.ts
npm run build
```

## Execution Notes / Risks

- **Key repo fact:** `sessionCleanup.ts` currently cleans expired/corrupted chat session files only.
- **Key repo fact:** `packages/cli/src/utils/activityLogger.ts` is absent.
- **Risk:** upstream assumes a companion activity-log subsystem that LLxprt may not yet have. Do not fabricate a broad new logging architecture to satisfy this batch.
- **Risk:** if companion artifacts share only a session ID and not an exact filename match, be careful to avoid over-deleting unrelated files.
- **Risk:** result counters may need careful thought if one session deletion can imply multiple file deletions. Preserve current semantics unless there is a compelling repo-local reason to expand them.
- **Do not** introduce telemetry, passive session analytics, or upstream-branded file names.
- **Do not** edit unrelated startup files unless a small wiring change is strictly required by tests.
- **Success criteria:** LLxprt startup cleanup continues deleting stale session files safely and, where current repo evidence supports it, also removes directly associated activity-log artifacts without broadening scope into a new logging subsystem.
