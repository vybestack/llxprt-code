# Task 31 Results – PORT 987f08a6

## Status: BLOCKED

## Summary
Could not complete cherry-pick of commit 987f08a6 which adds enforcedAuthType setting. The commit requires extensive adaptations for llxprt's flat settings structure and multi-provider architecture.

## Commits Picked / Ported
- Upstream: 987f08a6 "Add enforcedAuthType setting (#6564)"
- Local: SKIPPED - too many conflicts requiring major refactoring

## Original Diffs
```diff
# git show --stat 987f08a6
 docs/cli/configuration.md                      |  1 +
 docs/cli/enterprise.md                         | 14 +++++
 packages/cli/src/config/settings.ts            |  1 +
 packages/cli/src/config/settingsSchema.ts      | 10 ++++
 packages/cli/src/gemini.tsx                    |  2 +
 packages/cli/src/ui/App.tsx                    | 22 ++++++--
 packages/cli/src/ui/components/AuthDialog.test.tsx | 48 +++++++++++++++++
 packages/cli/src/ui/components/AuthDialog.tsx  | 36 +++++++++++--
 packages/cli/src/validateNonInterActiveAuth.test.ts | 77 +++++++++++++++++++++++++++
 packages/cli/src/validateNonInterActiveAuth.ts | 12 ++++-
 10 files changed, 214 insertions(+), 9 deletions(-)
```

## Our Committed Diffs
N/A - Cherry-pick was aborted

## Test Results
- Command: `npm run test`
- Not executed - cherry-pick blocked

## Lint Results
- Command: `npm run lint:ci`
- Not executed - cherry-pick blocked

## Typecheck Results
- Command: `npm run typecheck`
- Not executed - cherry-pick blocked

## Build Results
- Command: `npm run build`
- Not executed - cherry-pick blocked

## Format Check
- Command: `npm run format:check`
- Not executed - cherry-pick blocked

## Lines of Code Analysis
N/A - Cherry-pick was aborted

## Conflicts & Resolutions

### Major Architecture Mismatch
The upstream commit assumes a nested settings structure:
- `security.auth.enforcedType`
- `security.auth.selectedType`
- `security.auth.useExternal`

LLxprt uses a flat settings structure:
- `enforcedAuthType`
- `selectedAuthType`
- `useExternalAuth`

### Files with Conflicts
1. **packages/cli/src/config/settings.ts** - Migration map structure mismatch
2. **packages/cli/src/config/settingsSchema.ts** - Settings structure incompatible
3. **packages/cli/src/ui/App.tsx** - Auth validation logic references
4. **packages/cli/src/ui/components/AuthDialog.tsx** - Provider-specific OAuth handling
5. **packages/cli/src/validateNonInterActiveAuth.ts** - Auth type enforcement logic
6. **packages/cli/src/validateNonInterActiveAuth.test.ts** - Test expectations

### Required Adaptations (Too Complex)
1. Refactor all nested settings references to flat structure
2. Adapt enforcedAuthType to work with USE_PROVIDER pattern
3. Update auth validation for multi-provider support
4. Modify AuthDialog to handle provider-agnostic enforcement
5. Rewrite tests for llxprt's auth model

## Manual Verification Notes
This commit needs to be manually ported rather than cherry-picked:
- The enforcedAuthType feature is valuable for enterprise deployments
- Requires a dedicated refactoring task to adapt for llxprt's architecture
- Should be implemented as a separate llxprt feature, not a direct port