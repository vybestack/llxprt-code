# REIMPLEMENT Plan: Refactor PolicyEngine to Core Package

**Upstream SHA:** `ffc5e4d048ffa5e93af56848aa315fd4338094bb`  
**Subject:** Refactor PolicyEngine to Core Package (#12325)

## Overview

Major refactor moving PolicyEngine from CLI to Core package (1357 additions, 2156 deletions - net reduction). Creates `/policies` command and moves policy files to core.

## Files Changed (Upstream)

**Package Changes:**
- `package-lock.json` (deps)
- `packages/core/package.json` (+4 deps)

**CLI Removals:**
- `packages/cli/src/config/config.ts` (-18 lines)
- `packages/cli/src/config/policy.test.ts` (-1656 lines - DELETED)
- `packages/cli/src/config/policy.ts` (-230 lines significantly reduced)
- `packages/cli/src/ui/AppContainer.tsx` (-13 lines)

**CLI Additions:**
- `packages/cli/src/services/BuiltinCommandLoader.test.ts` (+24)
- `packages/cli/src/services/BuiltinCommandLoader.ts` (+4)
- `packages/cli/src/ui/commands/policiesCommand.test.ts` (+108 - new)
- `packages/cli/src/ui/commands/policiesCommand.ts` (+73 - new)

**Core Package - New Policy Module:**
- `packages/core/src/config/config.test.ts` (+2 modified)
- `packages/core/src/config/config.ts` (+20 modified)
- `packages/core/src/config/storage.ts` (+17)
- `packages/core/src/index.ts` (+2 exports)
- `packages/core/src/policy/config.test.ts` (+644 - new)
- `packages/core/src/policy/config.ts` (+251 - new)
- `packages/core/src/policy/index.ts` (+2 - new)
- `packages/core/src/policy/policies/read-only.toml` (+56 - new)
- `packages/core/src/policy/policies/write.toml` (+63 - new)
- `packages/core/src/policy/policies/yolo.toml` (+31 - new)
- `packages/core/src/policy/toml-loader.test.ts` (+225 - moved)
- `packages/core/src/policy/toml-loader.ts` (+6 - moved)
- `packages/core/src/policy/types.ts` (+18 - new)

**Tool Updates:**
- `packages/core/src/tools/edit.ts` (+3)
- `packages/core/src/tools/mcp-client.ts` (-9)
- `packages/core/src/tools/shell.ts` (+3)
- `packages/core/src/tools/smart-edit.ts` (+4) - SKIP (Smart Edit removed)
- `packages/core/src/tools/web-fetch.ts` (+4)
- `packages/core/src/tools/write-file.ts` (+3)

## LLxprt Considerations

1. **LLxprt Has Policy Engine** - We already have policy functionality in CLI
2. **TOML Policies** - New .toml policy files are useful
3. **Smart Edit** - Skip smart-edit.ts changes (removed in LLxprt)
4. **Tool Batching** - Ensure policy changes don't break our batching
5. **Command System** - `/policies` command may need adaptation

## High-Risk Areas

- `packages/cli/src/config/policy.ts` - LLxprt may have diverged
- `packages/core/src/tools/*` - Policy integration with tools
- Test coverage reduction from deleted tests

## Implementation Steps

1. Check LLxprt's current policy.ts implementation
2. Review which policy functionality to move to core vs keep in CLI
3. Cherry-pick with careful conflict resolution
4. Skip smart-edit.ts changes
5. Adapt /policies command for LLxprt
6. Ensure TOML policy files are in correct location
7. Full test suite

## Verification

```bash
npm run lint && npm run typecheck
npm run test
npm run build
# Test policy functionality
node scripts/start.js --profile-load synthetic --prompt "/policies"
```

## Decision

- [ ] Careful cherry-pick with significant manual review
- [ ] May need to reconcile LLxprt vs upstream policy approaches
- [ ] Skip smart-edit changes

---

*Plan to be executed during Batch 21 (FINAL)*
