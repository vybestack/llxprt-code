# Upstream Audit Batch 6 of 7

Analyzing commits from gemini-cli 0.23.0 for potential cherry-picking into LLxprt Code.

## 8feeffb29b — "fix: prevent infinite relaunch loop when --resume fails (#14941) (#14951)"

**Verdict:** NO_OP  
**Confidence:** HIGH  
**Evidence:**
- Upstream changes `RELAUNCH_EXIT_CODE` from 42 to 199 in `packages/cli/src/utils/processUtils.ts`
- LLxprt has `RELAUNCH_EXIT_CODE = 75` in `packages/cli/src/utils/bootstrap.ts` (different location)
- LLxprt uses `--continue` flag, not `--resume` (different command line interface)
- LLxprt bootstrap.ts already has `LLXPRT_CODE_NO_RELAUNCH` guard to prevent infinite loops

**Rationale:**
The upstream fix changes the relaunch exit code from 42 to 199 to prevent conflicts with the child process exit code when `--resume` fails. LLxprt:
1. Already uses a different exit code (75) that doesn't conflict with 42
2. Uses a different command (`--continue` not `--resume`)
3. Has explicit `LLXPRT_CODE_NO_RELAUNCH` environment variable guard
4. Code is in a different file (`bootstrap.ts` not `processUtils.ts`)

The infinite loop issue described in the upstream commit is not applicable to LLxprt's current implementation.

**Conflicts expected:** NO

---

## 58fd00a3df — "fix(core): Add .geminiignore support to SearchText tool (#13763)"

**Verdict:** REIMPLEMENT  
**Confidence:** HIGH  
**Evidence:**
- Upstream adds `GeminiIgnoreParser` integration to `ripGrep.ts`
- Upstream adds `getFileFilteringRespectGeminiIgnore()` config method
- Upstream adds `getIgnoreFilePath()` and `hasPatterns()` methods to GeminiIgnoreParser
- LLxprt ripGrep.ts exists but has NO GeminiIgnoreParser integration
- LLxprt has NO geminiIgnoreParser.ts file at all
- LLxprt uses `.llxprtignore` not `.geminiignore`
- LLxprt has `ignorePatterns.ts` utility with different approach

**Rationale:**
This is a valuable feature that enables ripgrep to respect ignore files. LLxprt needs this capability for `.llxprtignore`. The implementation needs significant adaptation:

1. Create `llxprtIgnoreParser.ts` (analogous to geminiIgnoreParser.ts)
2. Add `.llxprtignore` file reading and pattern parsing
3. Add `getIgnoreFilePath()` and `hasPatterns()` methods
4. Integrate into RipGrepTool constructor and GrepToolInvocation
5. Add config method `getFileFilteringRespectLlxprtIgnore()`
6. Add `--ignore-file` flag to ripgrep args when patterns exist

Key differences from upstream:
- File name: `.llxprtignore` not `.geminiignore`
- Parser class: `LlxprtIgnoreParser` not `GeminiIgnoreParser`
- Config method: `getFileFilteringRespectLlxprtIgnore()` not `getFileFilteringRespectGeminiIgnore()`

The current `ignorePatterns.ts` provides static patterns but doesn't read `.llxprtignore` file dynamically.

**Conflicts expected:** NO (new functionality, but requires creating new files and methods)

---

## 7b772e9dfb — "fix(patch): cherry-pick 0843d9a — startupProfiler"

**Verdict:** SKIP  
**Confidence:** HIGH  
**Evidence:**
- Upstream changes `debugLogger.log()` to `debugLogger.debug()` in `startupProfiler.ts`
- LLxprt has NO `startupProfiler.ts` file at all
- LLxprt has `profileManager.ts` for user profile management (different purpose)
- Searched for "startup" and "profil" files - only found user profile-related files

**Rationale:**
The startupProfiler.ts is for internal Google telemetry and performance profiling during CLI startup. It's not essential for LLxprt functionality. The change itself is trivial (switching from `.log()` to `.debug()` for less verbose output), but since we don't have the file at all and it's tied to Google's internal performance monitoring, there's no value in porting it.

LLxprt's profileManager.ts is for managing user profiles (different providers, settings), not startup performance profiling.

**Conflicts expected:** N/A (file doesn't exist)

---

## b7ad7e1035 — "fix(patch): cherry-pick 07e597d — quota error handling + retry"

**Verdict:** REIMPLEMENT  
**Confidence:** MEDIUM  
**Evidence:**
- Upstream changes in `googleQuotaErrors.ts`:
  - Removes `DEFAULT_RETRYABLE_DELAY_SECOND` fallback (was 5s)
  - Makes `retryDelayMs` optional in `RetryableQuotaError` and `TerminalQuotaError`
  - When no delay is parseable, returns `retryDelayMs: undefined` instead of 5000ms
- Upstream changes in `retry.ts`:
  - Adds warning log when max attempts reached
  - Only waits on `RetryableQuotaError` if `retryDelayMs !== undefined`
  - Uses `debugLogger.warn()` instead of `console.warn()`
- LLxprt still has `DEFAULT_RETRYABLE_DELAY_SECOND = 5` in googleQuotaErrors.ts
- LLxprt's RetryableQuotaError always sets `retryDelayMs` (not optional)
- LLxprt's retry.ts doesn't check for undefined retryDelayMs

**Rationale:**
This is an important fix for Google quota error handling. The upstream changes improve retry behavior by:
1. Not imposing arbitrary 5s delays when the API doesn't provide retry guidance
2. Allowing the exponential backoff logic in retry.ts to take over when no explicit delay is provided
3. Better logging for debugging retry loops

For LLxprt, this needs careful adaptation because:
- LLxprt supports multiple providers (not just Google)
- Some providers might not provide retry delays at all
- The change affects both quota detection (googleQuotaErrors.ts) and retry execution (retry.ts)

Implementation plan:
1. Make `retryDelayMs` optional in both error classes
2. Remove DEFAULT_RETRYABLE_DELAY_SECOND constant
3. Update retry.ts to check `retryDelayMs !== undefined` before using explicit delay
4. Test that exponential backoff works when retryDelayMs is undefined
5. Ensure this doesn't break non-Google providers

**Conflicts expected:** YES - requires coordinated changes across googleQuotaErrors.ts and retry.ts, careful testing needed

---

## bf90b59935 — "feat: launch Gemini 3 Flash in Gemini CLI [ACTION][ACTION][ACTION] (#15196)"

**Verdict:** SKIP  
**Confidence:** HIGH  
**Evidence:**
- 65 files changed with massive model routing refactoring
- Adds `PREVIEW_GEMINI_FLASH_MODEL = 'gemini-3-flash-preview'`
- Adds `PREVIEW_GEMINI_MODEL_AUTO = 'auto-gemini-3'`
- Changes model resolution logic: `getEffectiveModel()` → `resolveModel()`, `resolveClassifierModel()`
- Removes `isInFallbackMode` parameter from model resolution
- Simplifies fallback handler by removing legacy logic
- Changes `isPreviewModel()` to check for Gemini 3 models specifically
- Updates prompts.ts to use new `resolveModel()` and `isPreviewModel()` APIs
- Massive refactoring of fallback/handler.ts (deletes ~150 lines of legacy code)
- Changes to model routing strategies, classifier logic, availability policies

**Rationale:**
This commit is fundamentally about:
1. **Launching Gemini 3 models** - specific to Google's roadmap, not applicable to LLxprt
2. **Removing legacy Gemini 2.5 fallback logic** - replaces old hard-coded model names with policy-driven approach
3. **Auto model selection between Gemini 2.5 and 3** - Google-specific feature

For LLxprt:
- We already have `/model` command for manual model selection across ANY provider
- We support multiple providers (OpenAI, Anthropic, Google, etc.) - not just Gemini
- We don't need "auto-gemini-3" vs "auto-gemini-2.5" distinction
- Our model routing is provider-agnostic, not tied to specific Gemini versions
- The "classifier" logic in this commit is for deciding between Flash vs Pro within Gemini family

**What we might want eventually:**
- The policy-driven fallback approach (separate from Gemini 3)
- Simplified model resolution logic (but adapted for multi-provider)
- These should be cherry-picked from earlier availability/policy commits, not this mega-commit

**Why SKIP this specific commit:**
- Too Gemini-specific
- Too large and tangled with Gemini 3 launch
- Generic infrastructure improvements are better cherry-picked from smaller, focused commits

**Conflicts expected:** N/A (intentionally skipping)

---

## Summary

| Commit | Verdict | Priority | Reason |
|--------|---------|----------|--------|
| 8feeffb29b | NO_OP | N/A | Already handled differently in LLxprt bootstrap |
| 58fd00a3df | REIMPLEMENT | HIGH | Need .llxprtignore support in ripgrep |
| 7b772e9dfb | SKIP | N/A | Google telemetry, not needed |
| b7ad7e1035 | REIMPLEMENT | MEDIUM | Better quota retry logic, needs multi-provider adaptation |
| bf90b59935 | SKIP | N/A | Gemini 3 launch, too specific, too large |

**Recommended action items:**
1. Implement `.llxprtignore` support in ripgrep tool (from 58fd00a3df)
2. Consider reimplementing quota retry improvements (from b7ad7e1035) with multi-provider testing
3. Review earlier policy-driven fallback commits instead of the Gemini 3 mega-commit
