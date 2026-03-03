# LLxprt Code Cherry-Pick Audit - Batch 4 of 7

## 2515b89e2b — "feat: Pass additional environment variables to shell execution (#15160)"
**Verdict:** REIMPLEMENT  
**Confidence:** HIGH  
**Evidence:**
- Upstream: `packages/core/src/services/shellExecutionService.ts` at line 182-220
- LLxprt: `packages/core/src/services/shellExecutionService.ts` has `sanitizeEnvironment` method (different architecture)
- Upstream adds: GitHub Action-related env vars (ADDITIONAL_CONTEXT, AVAILABLE_LABELS, BRANCH_NAME, etc.) and changes `GEMINI_CLI_TEST` filter to `GEMINI_CLI_*`
- LLxprt: Uses `LLXPRT_CODE` instead of `GEMINI_CLI_*`, has `isSandboxOrCI` parameter, different env sanitization logic

**Rationale:**
The upstream commit adds useful GitHub Actions environment variables that would benefit LLxprt Code when running in CI/GH Actions contexts. However, our code has diverged significantly:
1. We have a `sanitizeEnvironment()` method instead of `getSanitizedEnv()` 
2. We use `LLXPRT_CODE=1` instead of `GEMINI_CLI_*` prefix
3. We have sandbox-aware env filtering via `isSandboxOrCI` parameter

We should reimplement the GitHub Actions vars (BRANCH_NAME, ISSUE_NUMBER, PULL_REQUEST_NUMBER, etc.) into our `sanitizeEnvironment()` method. The `GEMINI_CLI_*` → `LLXPRT_CODE*` pattern change is less critical since we don't have test infra using that convention yet.

**Conflicts expected:** NO - simple additive change to env var whitelist

---

## 9e6914d641 — "Handle all 429 as retryableQuotaError (#15288)"
**Verdict:** PICK  
**Confidence:** HIGH  
**Evidence:**
- Upstream: `packages/core/src/utils/googleQuotaErrors.ts` lines 117-128, 249-265
- LLxprt: Same file exists at identical path with same structure
- Comparison: Our file ALREADY has this exact change at lines 103-117 and 239-255
- Checked: `DEFAULT_RETRYABLE_DELAY_SECOND = 5` constant exists in both

**Rationale:**
We already have this fix! Our `googleQuotaErrors.ts` was updated with the same logic that treats all 429s as retryable with a 5-second fallback. The upstream commit:
1. Adds fallback for 429 without "retry in" message (we have this at line 103-117)
2. Adds final catch-all for any remaining 429s (we have this at line 239-255)
3. Uses `DEFAULT_RETRYABLE_DELAY_SECOND = 5` (we have this at line 16)

This is a NO_OP because we independently implemented the same fix or already cherry-picked this in an earlier batch.

**Conflicts expected:** NO - already present

---

## 1e10492e55 — "fix: prevent infinite loop in prompt completion on error (#14548)"
**Verdict:** PICK  
**Confidence:** HIGH  
**Evidence:**
- Upstream: `packages/cli/src/ui/hooks/usePromptCompletion.ts` removes lines 145-146
- LLxprt: `packages/cli/src/ui/hooks/usePromptCompletion.ts` has identical code at lines 129-131
- Bug: Clearing `lastRequestedTextRef.current = ''` in catch block causes infinite retry loop on errors
- Our code: Has the SAME BUG at line 130

**Rationale:**
We have the exact same infinite loop bug. When prompt completion fails, the catch block clears `lastRequestedTextRef.current = ''`, which allows the same failing request to retry infinitely. The fix is to remove those two lines:
```typescript
// Clear the last requested text to allow retry only on real errors
lastRequestedTextRef.current = '';
```

This is a clean pick - just delete lines 129-130 in our usePromptCompletion.ts. The comment is misleading; the clearing actually CAUSES infinite retries rather than preventing them.

**Conflicts expected:** NO - exact same code structure

---

## 70696e364b — "fix(ui): show command suggestions even on perfect match and sort them (#15287)"
**Verdict:** REIMPLEMENT  
**Confidence:** MEDIUM  
**Evidence:**
- Upstream changes: `InputPrompt.tsx`, `useSlashCompletion.ts` (with tests)
- LLxprt equivalent: `InputPrompt.tsx`, `useSlashCompletion.tsx` (note: .tsx not .ts)
- Checked: We have useSlashCompletion.tsx at `packages/cli/src/ui/hooks/useSlashCompletion.tsx`
- Logic: Upstream changes suggestion filtering to show matches even for perfect matches, adds sorting to prioritize exact matches

**Rationale:**
This is a UX improvement: when you type `/review`, it now shows both `/review` and `/review-frontend` instead of hiding suggestions. The upstream changes:

1. **useSlashCompletion.ts** (lines 391-402): Removed logic that hid suggestions on perfect match
2. **useSlashCompletion.ts** (lines 119-167): Added sorting to prioritize exact matches, show subcommands for parent commands
3. **InputPrompt.tsx** (lines 592-596): Changed condition to execute perfect match only if at first suggestion (index 0) or no suggestions showing

Our code divergence:
- We use React state (`useState`) in useSlashCompletion.tsx vs upstream's plain refs
- Our InputPrompt.tsx has different completion hooks architecture (useCommandCompletion wrapper)
- We have schema-driven completion hints that upstream doesn't

The behavioral fix should be reimplemented:
1. Remove `if (isPerfectMatch) setSuggestions([])` logic from our useSlashCompletion.tsx
2. Add sorting to prioritize exact matches first
3. Update InputPrompt.tsx submit logic to check `activeSuggestionIndex <= 0` for perfect match execution

**Conflicts expected:** YES - code structure differs, will need manual adaptation

---

## 402148dbc4 — "feat(hooks): reduce log verbosity and improve error reporting in UI (#15297)"
**Verdict:** SKIP  
**Confidence:** HIGH  
**Evidence:**
- Upstream changes: 7 files - `clientHookTriggers.ts`, `coreToolHookTriggers.ts`, `geminiChatHookTriggers.ts`, `sessionHookTriggers.ts`, `hookEventHandler.ts`, `hookRunner.ts`, `hookEventHandler.test.ts`
- Primary change: `debugLogger.warn()` → `debugLogger.debug()` for hook execution failures
- New feature: `coreEvents.emitFeedback()` to show warnings in UI for failed hooks
- LLxprt state: 
  - We have completely rewritten hooks system (PLAN-20260216-HOOKSYSTEMREWRITE)
  - No `coreEvents.emitFeedback()` infrastructure
  - Different file structure: no `clientHookTriggers.ts`, `geminiChatHookTriggers.ts` (Gemini-specific)
  - Our hookEventHandler.ts has only 4 debugLogger calls vs upstream's many
  - Our hookRunner.ts has 3 debugLogger calls vs upstream's many

**Rationale:**
This commit addresses verbose logging that clutters the UI when hooks fail. The upstream approach:
1. Downgrades hook failure logs from `warn` to `debug` level
2. Adds UI feedback via `coreEvents.emitFeedback('warning', ...)` to show user-facing warnings

Our situation is fundamentally different:
- We reimplemented the entire hooks system with different architecture
- We don't have the same logging verbosity problem (only 4 warn calls in hookEventHandler, 3 in hookRunner)
- We don't have `coreEvents.emitFeedback()` infrastructure
- We don't have Gemini-specific hook triggers (`geminiChatHookTriggers.ts`)

The spirit of the fix (reduce noise, improve UX) may be valuable, but it would require:
1. Auditing our actual hook logging to see if we have verbosity issues
2. Implementing a feedback mechanism (or using our existing DebugLogger differently)
3. Completely different file modifications since we don't have their trigger files

**Skip rationale:** Major architectural divergence makes this a large effort for unclear benefit. Our rewritten hooks system may not have the same logging issues. If we do have verbosity problems, we should address them with our own solution that fits our architecture.

**Conflicts expected:** N/A - skipping due to architectural mismatch

---

## Summary Statistics

- **PICK**: 2 commits (1e10492e55 infinite loop fix, 9e6914d641 already has it as NO_OP)
- **REIMPLEMENT**: 2 commits (2515b89e2b env vars, 70696e364b suggestions UX)
- **SKIP**: 1 commit (402148dbc4 hooks logging - architectural divergence)
- **NO_OP**: 1 commit (9e6914d641 - already have the 429 handling)

## Priority Order for Implementation

1. **HIGH**: 1e10492e55 - Infinite loop bug fix (2 lines deleted, critical fix)
2. **MEDIUM**: 70696e364b - Suggestions UX improvement (affects user experience)
3. **LOW**: 2515b89e2b - GitHub Actions env vars (nice-to-have for CI/Actions users)
4. **SKIP**: 402148dbc4 - Hooks logging (defer until we prove we have the problem)
