# Cherry-picking Guide for LLxprt Code

This guide documents the process for cherry-picking changes from the upstream gemini-cli repository while maintaining llxprt's multi-provider architecture and customizations.

For the full end-to-end workflow (commit inventory → PICK/SKIP/REIMPLEMENT tables → batch plan → progress tracking),
see `dev-docs/cherrypicking-runbook.md`. This document focuses on criteria, non-negotiables, and the verification checklist.

## Overview

LLxprt Code is a fork of gemini-cli that adds multi-provider support (OpenAI, Anthropic, etc.) along with other enhancements. We regularly cherry-pick improvements from upstream while preserving our unique features.

## Process

### 1. Create a New Branch

**IMPORTANT**: Always work on a dedicated branch for cherry-picking. Never cherry-pick directly to main.

```bash
# Fetch latest from upstream
git fetch upstream

# Create a new branch from main
git checkout main
git checkout -b YYYYMMDDgmerge  # e.g., 20251215gmerge
```

### 2. Identify Commits to Cherry-pick

Review new commits from upstream:

```bash
# See what's new in upstream that we don't have
git log --oneline upstream/main ^HEAD

# Check how many commits behind we are
git rev-list --count HEAD..upstream/main

# Prefer tag-to-tag ranges when upstream has releases/tags
git fetch upstream --tags
git log --oneline --reverse v0.9.0..v0.10.0

# Historical note: older syncs used marker merge commits. We no longer create
# marker-only merges; use tracking docs and commit messages instead.
git log --oneline --grep="Merge upstream gemini-cli" -n 5
```

### 3. Cherry-pick Relevant Commits

Cherry-pick commits one by one, starting from the oldest:

```bash
git cherry-pick <commit-hash>
```

#### What to Cherry-pick:

- Bug fixes
- Performance improvements
- New features that don't conflict with multi-provider support
- Tool improvements
- UI/UX enhancements
- **IDE integration features** - llxprt has full IDE support, always cherry-pick IDE improvements
- Security fixes and permission improvements
- MCP (Model Context Protocol) improvements — when cherry-picking new MCP capabilities (e.g., service-account impersonation), follow up with the matching documentation commits so the feature ships with docs; skip doc-only MCP commits if the underlying functionality is still missing

#### What to Skip:

- `gemini-automated-issue-triage.yml` (GitHub workflow specific to gemini-cli)
- Changes that would break llxprt's multi-provider support
- Branding changes that would overwrite llxprt branding
- Auth changes that assume only Google auth (llxprt supports multiple providers)
- **Next-speaker check functionality** - This feature has been permanently disabled in llxprt and should never be re-enabled
- **Tool scheduler queue changes** - llxprt has superior parallel batching for multi-provider support
- **CLI argument removals** - Preserve backward compatibility unless there's a strong reason
- **ClearcutLogger (Google telemetry) commits** - All ClearcutLogger functionality has been completely removed from llxprt to prevent data collection
- Gemini-specific release commits
- **Emoji-related commits** - LLxprt is emoji-free by design. Skip any commits that add, fix, or modify emoji handling (e.g., `a64394a4f`, `348fa6c7c`)

#### Features Reimplemented (Don't Cherry-pick):

These upstream features have been reimplemented in llxprt with our own approach:

- **Conversation Logging (commit `36f58a34`)** - Reimplemented as privacy-first, multi-provider conversation logging via `/logging` command with local storage, granular controls, and sensitive data redaction
- **Tool Scheduler Request Queue (commit `69322e12`)** - llxprt has superior parallel batching that queues and processes multiple requests in parallel for better multi-provider performance, while upstream processes serially

#### Features Completely Removed (Don't Cherry-pick):

These upstream features have been completely removed from llxprt for privacy/security reasons:

- **ClearcutLogger (Google telemetry)** - All Google telemetry collection has been completely removed from llxprt. The codebase now uses only local file logging for telemetry, with no data sent to Google servers. Any upstream commits that add ClearcutLogger functionality should be skipped entirely.
- **NextSpeakerChecker** - removed this as it wastes tokens and causes loops
- **FlashFallback** - presently disabled but slated to be removed - no one wants to auto fall back to flash to code with if they were using a better model.
- **Smart Edit (`smart_edit`, `useSmartEdit`)** - removed; llxprt uses deterministic edits (`replace` + fuzzy edit). Skip all upstream Smart Edit tools/settings/tests.

#### Handling Conflicts:

When conflicts occur, preserve llxprt's:

- Multi-provider architecture (USE_PROVIDER instead of specific auth types)
- Import paths (`@vybestack/llxprt-code-core` instead of `@google/gemini-cli-core`)
- Branding and naming
- Extended authentication options

### 4. Fix TypeScript and Test Issues

After cherry-picking, you may encounter:

1. **TypeScript errors**: Often due to interface changes between llxprt and gemini-cli
   - Check error structures (llxprt may use different error handling)
   - Verify import paths are correct
   - Ensure provider-specific code is preserved

2. **Test failures**: Tests may expect gemini-cli behavior
   - Update test expectations to match llxprt's behavior
   - Preserve llxprt's multi-provider test scenarios
   - Fix mock objects to match llxprt's interfaces

### 5. Run Quality Checks

**IMPORTANT**: Always run these checks in order (from the repo root):

```bash
# 1. Lint
npm run lint

# 2. Typecheck
npm run typecheck

# 3. Tests
npm run test

# 4. Format
npm run format

# 5. Build
npm run build

# 6. Synthetic smoke-run
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

If you get noisy “working tree modified” warnings during long runs, it’s OK to
run `npm run format` earlier as a convenience. Just rerun it after your final
code changes.

### 5a. Batch Verification Phase (When Cherry-picking Multiple Commits)

When cherry-picking multiple commits, **verify after every batch**, and run the full suite every **2nd** batch.

**Verification Process**:

1. After completing a batch (often 5 PICK commits, or 1 REIMPLEMENT)
2. Run quick verification:
   ```bash
   npm run lint
   npm run typecheck
   ```
3. After every 2nd batch (Batch 2, 4, 6, …), run full verification suite:
   ```bash
   # Full verification in order
   npm run lint
   npm run typecheck
   npm run test
   npm run format
   npm run build
   node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
   git add -A  # Stage formatted changes if any
   ```
4. Verify commits were actually applied:
   ```bash
   # Check that all expected commits are present
   git log --oneline -10  # Review recent commits
   git diff HEAD~5..HEAD --stat  # Check changes in last 5 commits
   ```
5. Fix any issues before proceeding to next batch
6. Create a fix commit if needed:
   ```bash
   git add -A
   git commit -m "fix: resolve issues from batch N cherry-picks"
   ```

**Why Batch Verification?**

- Catches integration issues early
- Prevents accumulation of errors
- Ensures each batch is stable before proceeding
- Makes troubleshooting easier by isolating problematic commits

### 6. Commit Fixes

If you made fixes after cherry-picking:

```bash
git add -A
git commit -m "fix: resolve conflicts and test failures from cherry-picks

- <specific fixes made>
- <preserved llxprt features>"
```

### 7. Record the Sync Range (No Marker Merge Commits)

We no longer create marker-only merge commits (e.g. `git merge -s ours`) as a
“sync point”. These create synthetic ancestry and can hide intentional SKIP /
REIMPLEMENT decisions.

Instead:

- Keep a tracking table (PICK/SKIP/REIMPLEMENT) for the upstream range.
- Ensure reimplementation commits include the upstream SHA in the message.
- If you want a git-level marker, prefer an annotated tag on the final commit
  (optional, only if your release workflow uses tags).

### 8. Push the Branch

```bash
git push origin YYYYMMDDgmerge  # e.g., 20251215gmerge
```

### 9. Create Pull Request

Create a PR to main with:

- Summary of cherry-picked changes
- Any conflicts resolved
- Test results confirming everything works

## Common Issues and Solutions

### Auth-related Conflicts

Gemini-cli assumes Google-only auth, while llxprt supports multiple providers:

```typescript
// Gemini-cli pattern:
expect(refreshAuthMock).toHaveBeenCalledWith(AuthType.USE_GEMINI);

// LLxprt pattern:
expect(refreshAuthMock).toHaveBeenCalledWith(AuthType.USE_PROVIDER);
```

### Import Path Conflicts

Always use llxprt's package names:

```typescript
// Wrong:
import { Config } from '@google/gemini-cli-core';

// Correct:
import { Config } from '@vybestack/llxprt-code-core';
```

### Tool Name and Policy Divergence

When cherry-picking tool/scheduler/policy changes, verify the actual tool names
used in LLxprt (search for `static readonly Name` in
`packages/core/src/tools/`) and keep the default policies in sync
(`packages/core/src/policy/policies/*.toml`).

Important nuance: models/providers sometimes emit short aliases for tool names,
but upstream and LLxprt can still share the same canonical tool name. Treat
aliases as input normalization, not upstream divergence.

Common model aliases → canonical tool names (upstream + LLxprt):

| Alias (commonly emitted) | Canonical tool name   |
| ------------------------ | --------------------- |
| `ls`                     | `list_directory`      |
| `grep`                   | `search_file_content` |
| `edit`                   | `replace`             |

Actual LLxprt tool-name divergence vs upstream (examples):

| Upstream      | LLxprt                                        |
| ------------- | --------------------------------------------- |
| `web_fetch`   | `google_web_fetch` / `direct_web_fetch`       |
| `write_todos` | `todo_write` (and `todo_read` / `todo_pause`) |

### Error Structure Changes

LLxprt may use different error structures:

```typescript
// Example: ToolCallResponseInfo
{
  error: Error; // Error object
  errorType: ToolErrorType; // Separate type field
}
```

## Important Notes

1. **Never merge directly to main** - Always use a PR
2. **Preserve llxprt's unique features** - Multi-provider support is core to llxprt
3. **Test thoroughly** - Especially provider switching and authentication flows
4. **Keep commits atomic** - One cherry-pick per commit for easy tracking
5. **Always verify code changes** - Don't just check commit messages; verify actual code was cherry-picked
6. **IDE features are important** - llxprt has full IDE integration, don't skip IDE-related commits
7. **Git history is the source of truth** - Use git commands to check sync status, not manual logs

## Sync Tracking (No Marker Merge Commits)

We track upstream parity via:

1. The cherry-pick/reimplementation commits themselves (with upstream SHAs in
   commit messages where applicable).
2. A tracking document for the chosen upstream range (so SKIPs are explicit).

This avoids “fake” history from marker-only merges while keeping the repository
auditable and reviewable.
