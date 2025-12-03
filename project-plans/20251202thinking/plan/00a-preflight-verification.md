# Phase 00a: Preflight Verification

## Phase ID

`PLAN-20251202-THINKING.P00a`

## Purpose

Verify ALL assumptions before writing any code. This phase is MANDATORY before any implementation phase.

## Dependency Verification

| Dependency | Expected | Verification Command | Status |
|------------|----------|---------------------|--------|
| openai types | Type definitions for ChatCompletionChunk | `grep -r "ChatCompletionChunk" packages/core/` | PENDING |
| IContent | ContentBlock union exists | `grep "ContentBlock" packages/core/src/services/history/IContent.ts` | PENDING |
| ThinkingBlock | Interface exists in IContent.ts | `grep "ThinkingBlock" packages/core/src/services/history/IContent.ts` | PENDING |
| EphemeralSettings | Settings service exists | `grep -r "ephemeral" packages/core/src/settings/` | PENDING |

## Type/Interface Verification

| Type Name | Expected Definition | Verification | Match? |
|-----------|---------------------|--------------|--------|
| ThinkingBlock | `{ type: 'thinking', thought: string }` | Read IContent.ts lines 175-183 | PENDING |
| ContentBlock | Union including ThinkingBlock | Read IContent.ts | PENDING |
| OpenAIProvider | Class with generateChatStream | Read OpenAIProvider.ts | PENDING |
| ProviderSettings | Interface for ephemeral settings | Read settings/types.ts | PENDING |

## File Location Verification

| File | Expected Path | Exists? |
|------|---------------|---------|
| IContent.ts | `packages/core/src/services/history/IContent.ts` | PENDING |
| OpenAIProvider.ts | `packages/core/src/providers/openai/OpenAIProvider.ts` | PENDING |
| ProviderSettings | `packages/core/src/settings/types.ts` | PENDING |
| Existing tests | `packages/core/src/providers/openai/*.test.ts` | PENDING |

## Call Path Verification

| Function | Expected Caller | Verification Command | Evidence |
|----------|-----------------|---------------------|----------|
| generateChatStream | geminiChat.ts | `grep "generateChatStream" packages/core/` | PENDING |
| buildMessages | OpenAIProvider internal | Read OpenAIProvider.ts | PENDING |
| HistoryService.add | After stream completes | `grep -r "HistoryService" packages/core/` | PENDING |

## Existing Pattern Verification

| Pattern | Location | How It Works |
|---------|----------|--------------|
| Stream yielding IContent | OpenAIProvider.generateChatStream | PENDING - read the method |
| Building messages from history | OpenAIProvider private methods | PENDING - read the method |
| Ephemeral settings access | SettingsService | PENDING - find pattern |

## Test Infrastructure Verification

| Component | Test File Exists? | Patterns Match? |
|-----------|-------------------|-----------------|
| OpenAIProvider | `OpenAIProvider.test.ts` | PENDING |
| IContent types | Type tests or usage tests | PENDING |
| Settings | Settings tests | PENDING |

## Blocking Issues Found

(To be filled during verification)

1. _[Issue 1]_
2. _[Issue 2]_

## Required Verifications Before Proceeding

### 1. ThinkingBlock Interface Check

```bash
# Run this and paste output:
grep -A 10 "interface ThinkingBlock" packages/core/src/services/history/IContent.ts
```

Expected: Interface with `type: 'thinking'` and `thought: string`

### 2. OpenAIProvider Streaming Check

```bash
# Run this and paste output:
grep -n "reasoning_content" packages/core/src/providers/openai/OpenAIProvider.ts
```

Expected: Either no matches (needs implementation) or existing handling

### 3. Settings Pattern Check

```bash
# Run this and paste output:
grep -rn "ephemeral" packages/core/src/settings/ | head -20
```

Expected: Pattern for ephemeral settings exists

### 4. Test File Existence

```bash
# Run this and paste output:
ls -la packages/core/src/providers/openai/*.test.ts 2>/dev/null || echo "No test files"
```

Expected: Test files exist for OpenAIProvider

### 5. Import Path Verification (GAP 9)

```bash
# Verify file locations for import paths
echo "=== Checking IContent.ts ==="
ls -la packages/core/src/services/history/IContent.ts

echo "=== Checking SettingsService.ts ==="
ls -la packages/core/src/settings/SettingsService.ts

echo "=== Checking OpenAIProvider.ts ==="
ls -la packages/core/src/providers/openai/OpenAIProvider.ts

echo "=== Checking if reasoning directory exists (should NOT exist yet) ==="
ls -la packages/core/src/providers/reasoning/ 2>&1 || echo "Directory does not exist - EXPECTED"
```

Expected:
- IContent.ts exists at `packages/core/src/services/history/IContent.ts`
- SettingsService.ts exists at `packages/core/src/settings/SettingsService.ts`
- OpenAIProvider.ts exists at `packages/core/src/providers/openai/OpenAIProvider.ts`
- reasoning directory does NOT exist yet (will be created in P06)

**Import Path Reference**:
From `packages/core/src/providers/openai/OpenAIProvider.ts`:
- To IContent: `../../services/history/IContent.js`
- To SettingsService: `../../settings/SettingsService.js`
- To reasoningUtils (P06+): `../reasoning/reasoningUtils.js`

From `packages/core/src/providers/reasoning/reasoningUtils.ts`:
- To IContent: `../../services/history/IContent.js`

From `packages/core/src/core/geminiChat.ts`:
- To reasoningUtils: `../providers/reasoning/reasoningUtils.js`

### 6. Existing ThinkingBlock Usage Verification

```bash
# Find all current usages of ThinkingBlock in the codebase
echo "=== Finding ThinkingBlock consumers ==="
grep -r "ThinkingBlock" packages/core/src/ packages/cli/src/ --include="*.ts" | grep -v "\.test\.ts" | grep -v node_modules

echo "=== Finding code that yields thinking content blocks ==="
grep -r "type: 'thinking'" packages/core/src/ packages/cli/src/ --include="*.ts" | grep -v "\.test\.ts" | grep -v node_modules

echo "=== Checking for existing thinking block handling ==="
grep -r "thought:" packages/core/src/ packages/cli/src/ --include="*.ts" | grep -v "\.test\.ts" | grep -v node_modules
```

Expected:
- Identify all existing ThinkingBlock consumers to ensure backward compatibility
- Document any existing patterns for creating/handling thinking blocks
- Verify that adding `sourceField?` and `signature?` optional properties won't break existing code

## Verification Gate

- [ ] All dependencies verified and available
- [ ] All types match expectations or plan updated
- [ ] All call paths confirmed possible
- [ ] Test infrastructure ready
- [ ] No blocking issues remain

**IF ANY CHECKBOX IS UNCHECKED**: STOP and update plan before proceeding to Phase 03.

## Holistic Functionality Assessment (MANDATORY)

Before marking this phase complete, the verifier MUST write a detailed assessment.

### Assessment Template

When creating the completion marker file (`project-plans/20251202thinking/.completed/P00a.md`), include:

```markdown
## Holistic Functionality Assessment

### What was verified?
[Describe what dependencies, types, and patterns were verified in your own words]

### Does it satisfy the requirements?
[For each verification category (Dependencies, Types, File Locations, Call Paths), explain what was confirmed]

### What is the data flow?
[Not applicable for preflight - instead explain: Are all integration points available and ready?]

### What could go wrong?
[Identify any dependencies that are fragile or assumptions that might not hold]

### Verdict
[PASS/FAIL with explanation. List any blocking issues that must be resolved before proceeding.]
```

### Verification Gate

**DO NOT create the completion marker until you have verified ALL dependencies and documented the findings.**

## Phase Completion

Create: `project-plans/20251202thinking/.completed/P00a.md` after all verifications pass.
