# Cherry-picking Guide for LLxprt Code

This guide documents the process for cherry-picking changes from the upstream gemini-cli repository while maintaining llxprt's multi-provider architecture and customizations.

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
git checkout -b YYYYMMDD-gmerge  # e.g., 20250801-gmerge
```

### 2. Identify Commits to Cherry-pick

Review new commits from upstream:

```bash
# See what's new in upstream that we don't have
git log --oneline upstream/main ^HEAD
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

#### What to Skip:

- `gemini-automated-issue-triage.yml` (GitHub workflow specific to gemini-cli)
- Changes that would break llxprt's multi-provider support
- Branding changes that would overwrite llxprt branding
- Auth changes that assume only Google auth (llxprt supports multiple providers)

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

**IMPORTANT**: Always run these checks in order:

```bash
# 1. Run lint first
npm run lint

# 2. Run build to catch TypeScript errors
npm run build

# 3. Run tests
npm test

# 4. Run format AFTER everything passes
npm run format
```

### 6. Commit Fixes

If you made fixes after cherry-picking:

```bash
git add -A
git commit -m "fix: resolve conflicts and test failures from cherry-picks

- <specific fixes made>
- <preserved llxprt features>"
```

### 7. Create Empty Merge Commit

To maintain parity with upstream's merge structure:

```bash
# Create an empty merge commit using -s ours strategy
# IMPORTANT: Merge the specific commit hash, NOT upstream/main
git merge -s ours --no-ff <last-cherry-picked-commit-hash> -m "Merge upstream gemini-cli up to commit <hash>

This is an empty merge commit to maintain parity with upstream structure.
All changes have already been cherry-picked:
- <list of cherry-picked features>

Maintains llxprt's multi-provider support, branding, and authentication
differences while staying in sync with upstream improvements."
```

**Critical**: Always merge the specific commit hash (e.g., `c795168e`), never merge `upstream/main`. This prevents bringing in all upstream commits again.

### 8. Push the Branch

```bash
git push origin YYYYMMDD-gmerge
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
4. **Document conflicts** - Help future maintainers understand decisions
5. **Keep commits atomic** - One cherry-pick per commit for easy tracking

## Merge Strategy

The `-s ours` merge strategy creates a merge commit without actually merging any content. This is used because:

1. We've already cherry-picked all desired changes
2. We want to maintain the same merge structure as upstream
3. It prevents accidental overwrites of llxprt customizations
4. It clearly marks our sync point with upstream

**Critical Detail**: When creating the merge commit, always specify the exact commit hash (not `upstream/main`). This ensures we only create a merge marker to that specific commit, not to the entire upstream branch.

This approach ensures we stay up-to-date with upstream improvements while maintaining llxprt's unique identity and features.
