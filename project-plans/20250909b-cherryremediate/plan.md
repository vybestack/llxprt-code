# Cherry-Pick Remediation Plan - Phase 2

**Date**: 2025-09-09
**Branch**: 20250908-gmerge  
**Purpose**: Complete remaining cherry-picks to reach v0.3.4 sync

## Executive Summary

This plan addresses 23 commits that remain to be cherry-picked (after excluding emoji-related commits). These include bug fixes, extension system improvements, test reliability fixes, and feature enhancements. Special attention needed for OAuth/MCP changes and theme/footer modifications.

## Critical Exclusions

### Commits to SKIP (Emoji-Free Policy)
- ❌ `a64394a4f` - (fix): Change broken emojis - **SKIP: LLxprt is emoji-free**
- ❌ `348fa6c7c` - fix(console): fix debug icon rendering in "Debug Console" Box - **SKIP: Likely emoji-related**

## Phase 1: Core Functionality (5 commits)

### 1.1 Tool Result Type Change
**Commit**: `75822d350` - Change the type of ToolResult.responseParts
**Impact**: MEDIUM - API change
**Action**: Review and adapt
```bash
git cherry-pick 75822d350
# Check if this affects our multi-provider tool handling
```

### 1.2 Error Handling Improvement  
**Commit**: `7fa592f34` - Show error instead of aborting if model fails to call tool
**Impact**: HIGH - Better error recovery
**Action**: Cherry-pick directly
```bash
git cherry-pick 7fa592f34
```

### 1.3 Persistent Process Fix
**Commit**: `cf9de689c` - fix(#6392): latest prompt being reloaded when ending a persistent process
**Impact**: MEDIUM - UX improvement
**Action**: Cherry-pick directly

### 1.4 Tools Command Documentation
**Commit**: `bdd63ce3e` - Added usage details to /tools command  
**Impact**: LOW - Documentation
**Action**: Cherry-pick and adapt for llxprt tools

### 1.5 Ripgrep Version Downgrade
**Commit**: `df79433be` - Downgrade version of ripgrep to the version from 7 months ago
**Impact**: MEDIUM - Dependency management
**Action**: Evaluate if needed (check Node 22 compatibility)

## Phase 2: Logging & Storage (REQUIRES CAREFUL REVIEW)

### 2.1 Shell Error Logging
**Commit**: `142192ae5` - fix(cli) - Add logging for shell errors
**Impact**: MEDIUM
**Action**: **MUST VERIFY** - Ensure this is local logging only, NO telemetry to Google
```bash
git show 142192ae5 --stat
# Review carefully for any telemetry/clearcut references
# Adapt to use our local logging only
```

### 2.2 Storage Interface
**Commit**: `366483853` - feat(cli) - Define shared interface for storage
**Impact**: HIGH - Architecture change
**Action**: Review compatibility with our existing multi-provider token storage
```bash
git show 366483853
# Check if this conflicts with our MultiProviderTokenStore
# May need significant adaptation
```

## Phase 3: UI/Theme Updates (REQUIRES ADAPTATION)

### 3.1 Color Tokens for Footer
**Commit**: `6fb01ddcc` - Update colors tokens for inputer/footer
**Impact**: MEDIUM - UI change
**Action**: **ADAPT CAREFULLY**
- Our footer is different from gemini-cli
- Must respect theme settings
- Verify dark/light mode compatibility
```bash
git show 6fb01ddcc
# Review changes to ensure theme-aware implementation
# Adapt for llxprt's custom footer
```

### 3.2 Sandbox Build Error Display
**Commit**: `327c5f889` - Print error when failing to build sandbox
**Impact**: LOW - Error messaging
**Action**: Cherry-pick directly

### 3.3 Error Messages Enhancement
**Commit**: `3e74ff71b` - feat(errors): Make errors more informative
**Impact**: MEDIUM - UX improvement
**Action**: Cherry-pick and verify multi-provider context

## Phase 4: Trust & Security Features (5 commits)

### 4.1 Untrusted Folders Protection
**Commit**: `ae1f67df0` - feat: Disable YOLO and AUTO_EDIT modes for untrusted folders
**Impact**: HIGH - Security feature
**Action**: Cherry-pick directly

### 4.2 Trust Default Handling
**Commit**: `97ce197f3` - Treat undefined same as true for isTrustedFolder
**Impact**: HIGH - Security default
**Action**: Review default behavior carefully

### 4.3 Flaky Test Fixes
**Commit**: `2c6794fee` - fix: resolve three flaky tests
**Impact**: LOW - Test stability
**Action**: Cherry-pick if tests exist

### 4.4 IDE Error Log
**Commit**: `75b1e01bb` - fix(ide): remove noisy error log
**Impact**: LOW - Log cleanup
**Action**: Cherry-pick directly

### 4.5 Ctrl+C Test Reliability
**Commit**: `2df3480cb` - fix(cli): make Ctrl+C UI test less flaky
**Impact**: LOW - Test stability
**Action**: Cherry-pick if test exists

## Phase 5: Extension System (6 commits)

### 5.1 Extension Variables
**Commit**: `b6cca0116` - [extensions] Add an initial set of extension variables
**Impact**: MEDIUM - Extension system
**Action**: Cherry-pick and adapt for llxprt extensions

### 5.2 Extension Enable Command
**Commit**: `51bb624d4` - Add extensions enable command
**Impact**: MEDIUM - Feature addition
**Action**: Cherry-pick if extension system compatible

### 5.3 Workspace Extension Migration
**Commit**: `c79f145b3` - Add prompt to migrate workspace extensions
**Impact**: MEDIUM - Migration feature
**Action**: Adapt for llxprt extension structure

### 5.4 Unused Dependencies Cleanup
**Commit**: `0324dc2eb` - chore: unused deps
**Impact**: LOW - Cleanup
**Action**: Cherry-pick selectively (check if deps are actually unused in llxprt)

## Phase 6: OAuth/MCP Enhancements (REQUIRES CAREFUL REVIEW)

### 6.1 MCP OAuth Fallback
**Commit**: `c33a0da1d` - feat(mcp): Add ODIC fallback to OAuth metadata look up
**Impact**: HIGH - OAuth flow
**Action**: **CRITICAL REVIEW NEEDED**
- We have our own OAuth token store implementation
- Check if this is compatible or needs reimplementation
- Ensure multi-provider support maintained
```bash
git show c33a0da1d
# Review OAuth implementation
# May need to reimplement for our MultiProviderTokenStore
```

### 6.2 Tool Confirmation Flag
**Commit**: `52dae2c58` - feat(cli): Add --allowed-tools flag to bypass tool confirmation
**Impact**: MEDIUM - CLI feature
**Action**: Cherry-pick and verify security implications

### 6.3 Config Non-Optional
**Commit**: `4e49ee4c7` - Make config non optional in ToolConfirmationMessage
**Impact**: LOW - Type safety
**Action**: Cherry-pick directly

## Execution Plan

### Day 1: Core & Critical Reviews
1. Review and adapt storage interface (366483853)
2. Verify logging is local-only (142192ae5)
3. Apply core functionality fixes (Phase 1)

### Day 2: UI & Security
1. Adapt theme/footer changes (6fb01ddcc)
2. Apply trust/security features (Phase 4)
3. Test UI in dark/light modes

### Day 3: Extensions & OAuth
1. Review OAuth/MCP changes (c33a0da1d)
2. Apply extension system updates
3. Test multi-provider OAuth flows

### Day 4: Testing & Verification
1. Run full test suite
2. Manual testing of affected features
3. Multi-provider verification

## Verification Checklist

After each phase:
- [ ] `npm run lint` - No errors
- [ ] `npm run build` - Successful build
- [ ] `npm test` - Tests pass
- [ ] `npm run format` - Code formatted

Final verification:
- [ ] Multi-provider authentication works
- [ ] Theme switching works correctly
- [ ] No telemetry to Google
- [ ] Extension system functional
- [ ] OAuth flows work for all providers

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| OAuth changes break multi-provider | Extensive testing, possible reimplementation |
| Theme changes break custom UI | Careful adaptation, preserve llxprt styling |
| Logging sends data to Google | Code review, verify local-only |
| Storage interface conflicts | May need adapter layer |
| Extension system incompatible | Conditional cherry-pick |

## Critical Review Points

1. **OAuth/MCP commit (c33a0da1d)**: May need complete reimplementation
2. **Storage interface (366483853)**: Check compatibility with MultiProviderTokenStore
3. **Logging commit (142192ae5)**: MUST be local-only, no telemetry
4. **Theme/footer (6fb01ddcc)**: Must respect themes and work with custom footer

## Success Criteria

- [ ] All 23 non-emoji commits evaluated
- [ ] No regression in multi-provider support
- [ ] No data sent to Google
- [ ] Theme system remains functional
- [ ] OAuth works for all providers
- [ ] Tests pass consistently
- [ ] Build and lint succeed

## Notes

1. **Emoji-free policy**: Two commits skipped per llxprt design
2. **OAuth complexity**: May require significant adaptation
3. **Theme sensitivity**: UI changes need careful testing
4. **Provider testing**: Test with at least 3 providers (Gemini, Anthropic, OpenAI)
5. **Backup branch**: Create backup before starting