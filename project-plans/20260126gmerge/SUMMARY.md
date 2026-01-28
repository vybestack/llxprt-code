# Cherry-Pick Summary: v0.13.0 to v0.14.0

**Branch:** `20260126gmerge`  
**Upstream range:** `v0.13.0..v0.14.0`  
**Analysis date:** 2026-01-26

---

## Overview

This sync brings 14 commits from upstream gemini-cli v0.14.0 to LLxprt Code, with 1 reimplementation and 18 skips. The skips are primarily due to:
- LLxprt's more advanced UI scrolling implementation
- Different quota/error handling architecture  
- Incompatible multi-provider vs Gemini-only assumptions
- FlashFallback being disabled in LLxprt

---

## Counts

| Category | Count |
|----------|-------|
| Total upstream commits | 33 |
| PICK | 14 |
| SKIP | 18 |
| REIMPLEMENT | 1 |

---

## Key Changes Being Picked

### Critical Features
- **Extension enable/disable** (`fa93b56`) - Dynamic extension management with reloading - **CRITICAL**

### Security Fixes
- **Server name spoofing prevention** (`f5bd474`) - Prevents MCP server name spoofing in policy engine

### Bug Fixes
- **Windows PTY crash** (`1611364`) - Fixes crash on Windows
- **Multiple string replacement test** (`77614ef`) - Test for multi-instance replacement

### Improvements
- **Consistent param names** (`f05d937`) - Standardized parameter naming across tools
- **Shell cwd in description** (`9ba1cd0`) - Shows current directory in shell commands
- **Keychain name** (`c13ec85`) - More user-friendly storage names
- **Consistent tool ordering** (`9787108`) - Tools listed in predictable order
- **DiscoveredTool policy** (`c81a02f`) - Better tool discovery with policies

### Test Improvements
- **Priority range validation** (`5f6453a`) - Cleaner test structure with helper
- **InputPrompt it.each refactor** (`c585470`) - Cleaner test patterns

### Cleanup
- **Remove unused policy TOML** (`0f5dd22`) - Removes unused files
- **Animated component tracking** (`224a33d`) - Better debug tracking

### Quota Handling
- **RetryInfo ms parsing** (`f51d745`) - Adds millisecond parsing and message fallback

---

## What's Being Skipped (and Why)

| Category | Count | Reason |
|----------|-------|--------|
| UI Scrollable support | 1 | LLxprt has MORE ADVANCED scrolling (batching, drag-drop, hit detection) |
| FlashFallback changes | 3 | FlashFallback disabled in LLxprt |
| Release/version bumps | 3 | LLxprt has own versioning |
| GitHub workflows | 2 | Gemini-specific |
| Gemini-specific docs | 2 | Not applicable |
| Quota message changes | 2 | LLxprt uses different error handling (errorParsing.ts) |
| Subagent compression | 1 | LLxprt has completely different subagent architecture |
| ModelConfigService | 1 | Incompatible with multi-provider (assumes Gemini SDK) |
| PathReader fix | 1 | LLxprt doesn't have readPathFromWorkspace function |
| WriteTodos revert | 1 | LLxprt has different todo implementation |
| Flaky test disable | 1 | Evaluate separately |

---

## Reimplementation Required

| SHA | Subject | Reason |
|-----|---------|--------|
| `b445db3` | Make list dir less flaky | Test structure differs; LLxprt already has `expectToolCallSuccess()` helper - just need to migrate test to use it |

---

## High-Risk Items (Require Extra Review)

| SHA | Subject | Risk | Notes |
|-----|---------|------|-------|
| `fa93b56` | Extension reloading | HIGH | 24 files, 664 insertions - CRITICAL feature |
| `f05d937` | Consistent param names | MEDIUM | Touches many tools, may have branding conflicts |

---

## Estimated Effort

- **Batches:** 4 (3 PICK batches + 1 REIMPLEMENT)
- **Verification cycles:** 4 quick + 2 full
- **Expected conflicts:** Medium (primarily in fa93b56 extension reloading)
- **Estimated time:** 2-3 hours

---

## Key Research Findings

### UI Divergence (Scrolling)
LLxprt has **more advanced** scrolling than upstream:
- Batching optimization (`useBatchedScroll`)
- Sophisticated mouse scrollbar drag-and-drop with hit detection
- Click/jump offset tracking
- Upstream only has basic mouse wheel + click-to-flash

**Decision:** SKIP upstream scrolling - would be a regression.

### Quota Handling Divergence
LLxprt uses `errorParsing.ts` with ERROR-type messages instead of upstream's `useQuotaAndFallback.ts` with INFO messages.

**Decision:** SKIP quota message formatting commits; PICK the retryInfo parsing improvement as it's compatible.

### Multi-Provider Architecture
Upstream's `ModelConfigService` assumes Gemini-only with `@google/genai` SDK types. LLxprt has:
- Provider-scoped settings
- Provider-specific parameter normalization
- Profile system with ProfileManager
- LoadBalancingProvider for failover

**Decision:** SKIP ModelConfigService - incompatible architecture.

---

## Next Steps

1. **Human review** of CHERRIES.md decisions
2. After approval, create PLAN.md with executable batch schedule
3. Execute batches with verification cadence
4. Track progress in PROGRESS.md, NOTES.md, AUDIT.md
5. Create PR to main
