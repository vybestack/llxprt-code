## Batch 08

### Selection Record

Batch: 08
Type: PICK (2 commits)
Upstream SHA(s): 6ded45e5, d2c9c5b3
Subject: feat: Add markdown toggle (alt+m) to switch between rendered and raw… (#10383) / Use Node.js built-ins in scripts/clean.js instead of glob. (#11286)
Playbook: N/A
Prerequisites Checked:
  - Previous batch record exists: YES
  - Previous batch verification: PASS
  - Previous batch pushed: N/A
  - Special dependencies: None
Ready to Execute: YES

### Execution Record

**6ded45e5 - Add markdown toggle (alt+m) to switch between rendered and raw**: SKIPPED (CONFLICTS)

Upstream analysis:
- Adds RawMarkdownIndicator.tsx component for showing raw markdown state
- Adds toggle state to UIStateContext (showRawMarkdown)
- Modifies GeminiMessage.tsx, GeminiMessageContent.tsx, ToolMessage.tsx to support raw markdown view
- Adds alt+m keyboard shortcut via MarkdownDisplay.tsx prop
- Creates new components: RawMarkdownIndicator.tsx, ToolMessageRawMarkdown.test.tsx
- 19 files changed, 245 insertions, 7 deletions

LLxprt assessment:
  git cherry-pick 6ded45e5
  Multiple conflicts:
  - packages/cli/src/test-utils/render.tsx
  - packages/cli/src/ui/AppContainer.tsx
  - packages/cli/src/ui/components/Composer.test.tsx (modify/delete)
  - packages/cli/src/ui/components/Composer.tsx
  - packages/cli/src/ui/components/messages/GeminiMessage.tsx
  - packages/cli/src/ui/components/messages/ToolMessage.test.tsx
  - packages/cli/src/ui/components/messages/ToolMessage.tsx
  - packages/cli/src/ui/contexts/UIStateContext.tsx
  - packages/cli/src/ui/utils/CodeColorizer.tsx
  - packages/cli/src/ui/components/views/ToolsList.test.tsx (modify/delete)

Investigation findings:
  RawMarkdownIndicator.tsx does not exist in LLxprt
  showRawMarkdown state does not exist in LLxprt's UIStateContext.tsx
  LLxprt UI components have diverged significantly from upstream
  LLxprt has different component structure (missing some files, different tests)

Decision: SKIP - This would require a complex REIMPLEMENT to adapt upstream's markdown toggle to LLxprt's different UI architecture. Too many conflicts (10 files) across different subsystems.

**d2c9c5b3 - Use Node.js built-ins in scripts/clean.js instead of glob**: PICKED (COMMITTED with resolution)

Upstream changes:
- Replaces glob library with Node.js built-in readdirSync/statSync
- Changes workspace dist cleaning from globSync() to directory iteration
- Changes vsix file cleanup from globSync() to readdirSync()

  git cherry-pick d2c9c5b3
  Auto-merging scripts/clean.js
  CONFLICT (content): Merge conflict in scripts/clean.js

Conflict resolution:
- LLxprt's clean.js had diverged from upstream
- LLxprt has additional .stryker-tmp cleanup using glob (not in upstream)
- Applied upstream changes for workspace packages and vsix files
- Kept glob for .stryker-tmp since upstream removed it but LLxprt still needs it

Modified clean.js segments:
1. Imports: Added readdirSync, statSync from 'node:fs', kept globSync for backward compatibility
2. Workspace cleaning: Applied upstream's readdir/stat logic over glob
3. VSIX cleanup: Applied upstream's readdir logic over glob
4. Stryker cleanup: Kept LLxprt's glob-based approach

Final result: c3d9e02e1 - "Use Node.js built-ins in scripts/clean.js instead of glob. (#11286)"

### Verification Record

  git log --oneline -1
  c3d9e02e1 Use Node.js built-ins in scripts/clean.js instead of glob. (#11286)

  npm run lint
  PASS

  npm run typecheck
  PASS

Note: No tests were run for clean.js changes as it's a build script.

### Status Documentation

Batch 08 commits:
- 6ded45e5 - SKIP (10 file conflicts, requires complex REIMPLEMENT)
- d2c9c5b3 - COMMITTED c3d9e02e1 (with conflict resolution - kept glob for .stryker-tmp)

### Commit/Push Record

Commit c3d9e02e1 created for d2c9c5b3 with conflict resolution. 6ded45e5 skipped due to conflicts. AUDIT.md, PROGRESS.md updated.