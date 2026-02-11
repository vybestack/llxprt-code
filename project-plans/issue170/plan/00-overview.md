# Plan: Configurable Compression Strategies

Plan ID: PLAN-20260211-COMPRESSION
Generated: 2026-02-11
Total Phases: 15 (P01 through P15)
Requirements: REQ-CS-001 through REQ-CS-011, REQ-CS-006A

Issues: #169, #170, #171, #173
Branch: `issue_170_171_172_173`
Design: `project-plans/issue170/overview.md`
Requirements: `project-plans/issue170/requirements.md`

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. Completed preflight verification (Phase 01)
2. Read the requirements document in full — every REQ-CS-* is cited in phases
3. Written tests BEFORE implementation in each TDD cycle
4. Verified all dependencies and types exist as assumed
5. Run the full verification suite: `npm run test && npm run lint && npm run typecheck && npm run format && npm run build`

## Integration Analysis (MANDATORY)

### Existing code that will USE this feature

- `packages/core/src/core/geminiChat.ts` — `performCompression()` becomes a thin dispatcher that delegates to strategy
- `packages/core/src/runtime/createAgentRuntimeContext.ts` — new ephemeral accessors for `compressionStrategy()` and `compressionProfile()`
- `packages/core/src/runtime/AgentRuntimeContext.ts` — interface additions for new accessors
- `packages/cli/src/ui/commands/setCommand.ts` — dynamic completer for `compression.profile`
- `packages/cli/src/config/settingsSchema.ts` — settings dialog entries

### Existing code to be REPLACED/REMOVED

- `geminiChat.ts`: `getCompressionSplit()`, `directCompressionCall()`, `applyCompression()`, `adjustForToolCallBoundary()`, `findForwardValidSplitPoint()`, `findBackwardValidSplitPoint()` — all extracted into strategy/utils modules
- `prompts.ts`: `getCompressionPrompt()` import in geminiChat.ts removed (function kept but unused; dead code cleaned up)

### How users ACCESS this feature

- `/set compression.strategy middle-out` or `/set compression.strategy top-down-truncation` (with autocomplete)
- `/set compression.profile <profilename>` (with autocomplete from saved profiles)
- `/settings` dialog — strategy dropdown and profile text field under Chat Compression
- Profile load: `--profile-load` applies saved compression settings

### Migration

- No data migration needed — new settings default to current behavior (`middle-out`)
- Existing `chatCompression.contextPercentageThreshold` preserved alongside new fields

## Phase Summary

| Phase | ID | Type | Description | Requirements |
|-------|------|------|-------------|--------------|
| 01 | P01 | Preflight | Verify all assumptions before writing code | — |
| 02 | P02 | Types & Constants | Create `compression/types.ts` with interfaces, const tuple, and factory types | REQ-CS-001.1, 001.4, 001.5, 001.6, 010.3 |
| 03 | P03 | Shared Utils TDD | Tests for tool-call boundary functions (extracted behavior) | REQ-CS-004.1–004.4 |
| 04 | P04 | Shared Utils Impl | Extract boundary functions from geminiChat.ts into `compression/utils.ts` | REQ-CS-004.1–004.4 |
| 05 | P05 | Middle-Out TDD | Tests for MiddleOutStrategy (split, LLM call, result assembly, equivalence) | REQ-CS-002.1–002.8 |
| 06 | P06 | Middle-Out Impl | Extract middle-out logic from geminiChat.ts into MiddleOutStrategy | REQ-CS-002.1–002.9, 005.1–005.5 |
| 07 | P07 | Top-Down Truncation TDD | Tests for TopDownTruncationStrategy (no LLM, oldest-first, boundaries, minimum) | REQ-CS-003.1–003.5 |
| 08 | P08 | Top-Down Truncation Impl | Implement TopDownTruncationStrategy | REQ-CS-003.1–003.5 |
| 09 | P09 | Factory TDD | Tests for strategy factory (lookup, unknown name → error) | REQ-CS-001.2, 001.3 |
| 10 | P10 | Factory Impl | Implement compressionStrategyFactory | REQ-CS-001.2, 001.3 |
| 11 | P11 | Settings & Config TDD | Tests for settings registry entries, EphemeralSettings types, ChatCompressionSettings, runtime accessors, /set autocomplete | REQ-CS-007–011, 006A.1 |
| 12 | P12 | Settings & Config Impl | Wire settings registry, types, runtime accessors, setCommand completer, settingsSchema dialog entries | REQ-CS-007–011, 006A.1 |
| 13 | P13 | Dispatcher Integration TDD | Tests for performCompression as dispatcher: strategy delegation, result application, atomicity, fail-fast, prompt loading | REQ-CS-006.1–006.4, 005.1–005.5, 006A.2–006A.4 |
| 14 | P14 | Dispatcher Integration Impl | Rewrite performCompression as dispatcher, remove extracted methods from geminiChat.ts, wire prompt loading | REQ-CS-002.9, 006.1–006.4, 005.1–005.5, 006A.2–006A.4 |
| 15 | P15 | Full Verification | End-to-end test: `node scripts/start.js --profile-load syntheticglm47 "write me a haiku"`, full suite verification, deferred implementation detection | All |

## Execution Rules

Per `dev-docs/COORDINATING.md`:

- ONE PHASE = ONE SUBAGENT — each phase gets exactly one worker subagent + one verifier
- NEVER SKIP PHASES — execute P01, P02, P03, ..., P15 in strict order
- VERIFY BEFORE PROCEEDING — each phase verified before next begins
- If verification FAILS, remediate with a worker subagent and re-verify. Do not proceed.
