# Phase 00a: Preflight Verification

## Phase ID

`PLAN-20251202-THINKING-UI.P00a`

## Purpose

Verify ALL assumptions before writing any code.

---

## Dependency Verification

| Dependency | Verification Command | Expected | Status |
|------------|---------------------|----------|--------|
| ink (React for CLI) | `npm ls ink` | Installed | [ ] |
| React | `npm ls react` | Installed | [ ] |
| vitest | `npm ls vitest` | Installed | [ ] |

---

## Type/Interface Verification

### ThinkingBlock Interface

| Type Name | Expected Definition | Verification Command | Status |
|-----------|---------------------|---------------------|--------|
| ThinkingBlock | `{ type: 'thinking', thought: string, sourceField?, signature? }` | `grep -A 10 "interface ThinkingBlock" packages/core/src/services/history/IContent.ts` | [ ] |
| ContentBlock | Union includes ThinkingBlock | `grep "ContentBlock" packages/core/src/services/history/IContent.ts` | [ ] |

### Reasoning Ephemeral Settings

| Setting | Expected | Verification Command | Status |
|---------|----------|---------------------|--------|
| reasoning.includeInResponse | Exists in ephemeralSettingHelp | `grep "reasoning.includeInResponse" packages/cli/src/settings/ephemeralSettings.ts` | [ ] |
| Config.getEphemeralSetting | Method exists | `grep "getEphemeralSetting" packages/core/src/config/Config.ts` | [ ] |

---

## File Path Verification

| File | Purpose | Exists | Status |
|------|---------|--------|--------|
| packages/cli/src/ui/components/messages/GeminiMessage.tsx | Main AI message component | [ ] | [ ] |
| packages/cli/src/ui/components/messages/GeminiMessageContent.tsx | Content-only AI message | [ ] | [ ] |
| packages/cli/src/ui/colors.js | Theme colors | [ ] | [ ] |

---

## Call Path Verification

| Function | Expected Caller | Verification | Status |
|----------|-----------------|--------------|--------|
| ThinkingBlockDisplay | GeminiMessage | Will call from render | [ ] |
| Config.getEphemeralSetting | ThinkingBlockDisplay | Get reasoning.includeInResponse | [ ] |

---

## Test Infrastructure Verification

| Component | Test File Pattern | Test Patterns Work? | Status |
|-----------|-------------------|---------------------|--------|
| GeminiMessage | `**/GeminiMessage*.test.tsx` | [ ] | [ ] |
| Messages | `packages/cli/src/ui/components/messages/` | [ ] | [ ] |

---

## Blocking Issues Found

[List any issues that MUST be resolved before proceeding]

---

## Verification Gate

- [ ] All dependencies verified
- [ ] ThinkingBlock interface matches expectations
- [ ] reasoning.includeInResponse setting exists
- [ ] GeminiMessage and GeminiMessageContent files exist
- [ ] Test infrastructure ready

**IF ANY CHECKBOX IS UNCHECKED: STOP and update plan before proceeding.**

---

## Verification Commands

```bash
# Run all verifications
cd /Users/acoliver/projects/llxprt-code-branches/llxprt-code-2

# 1. Check ThinkingBlock interface
grep -A 10 "interface ThinkingBlock" packages/core/src/services/history/IContent.ts

# 2. Check ContentBlock union includes ThinkingBlock
grep "ContentBlock" packages/core/src/services/history/IContent.ts

# 3. Check reasoning.includeInResponse setting exists
grep "reasoning.includeInResponse" packages/cli/src/settings/ephemeralSettings.ts

# 4. Check GeminiMessage exists
ls -la packages/cli/src/ui/components/messages/GeminiMessage.tsx

# 5. Check GeminiMessageContent exists
ls -la packages/cli/src/ui/components/messages/GeminiMessageContent.tsx

# 6. Check colors exist
ls -la packages/cli/src/ui/colors.*

# 7. Check ink is installed
npm ls ink

# 8. Check vitest for testing
npm ls vitest
```
