# Issue #864 – Propagate tool cancellation results into provider-visible history

GitHub issue: https://github.com/vybestack/llxprt-code/issues/864

## Issue Thread Notes (pulled via `gh`)
- Issue body is minimal: “@coderabbit look into this”.
- CodeRabbit’s analysis highlights the key gap as a missing regression test at the scheduler→history boundary (cancelled tool calls must persist as a provider-valid tool_call+tool_response pair), plus potential tool-call ID normalization mismatches across scheduler/history/providers.

## Problem Statement (from issue)
`CoreToolScheduler` can emit rich cancellation output (`CancelledToolCall` with paired `functionCall` + `functionResponse` parts), but provider request builders can still end up with histories that:
- miss corresponding tool results after cancellation, or
- contain mismatched/invalid tool pairing that breaks strict provider invariants (most visible with Codex `/responses`, but also affects Anthropic/OpenAI Chat-style tooling).

## Provider Constraints (why this hard-fails on switching)
Some providers validate tool structure strictly:
- **OpenAI Chat / Vercel AI SDK**: `role:"tool"` messages must be a response to a preceding assistant message with tool calls (tool messages must form a contiguous run after that assistant tool-call message).
- **Anthropic Messages API**: each `tool_result` must have a corresponding `tool_use` **in the previous assistant message**.

Any duplicate/out-of-order tool result in history can cause a hard 400 when switching providers.

## Canonical History Model: `IContent`
File: `packages/core/src/services/history/IContent.ts`
- Tool calls: `ToolCallBlock { type:'tool_call', id, name, parameters }` inside `speaker:'ai'`
- Tool results: `ToolResponseBlock { type:'tool_response', callId, toolName, result, error?, isComplete? }` inside `speaker:'tool'`
- Cancellation is represented via `ToolResponseBlock.error` and/or structured `ToolResponseBlock.result`.

## Failure Modes Observed

### A) Cancellation persisted as a single `role:'user'` Content containing both `functionCall` + `functionResponse`
Files:
- `packages/cli/src/ui/hooks/useGeminiStream.ts`
- `packages/core/src/services/history/ContentConverters.ts`

Buggy shape (Gemini `Content`):
- one `role:'user'` entry containing both `{functionCall}` and `{functionResponse}` parts

`ContentConverters.toIContent()` treats any `role:'user'` with any `functionResponse` as `speaker:'tool'`, producing a single tool message that contains **both** `tool_call` and `tool_response` blocks. Providers typically serialize tool calls only from `speaker:'ai'`, so those tool calls are effectively dropped → orphaned tool results → 400.

### B) Duplicate / out-of-order tool results (observed on provider switching)
Evidence (local debug logs):
- `~/.llxprt/debug/llxprt-debug-2025-12-19-10-45-15.jsonl`
  - `[OpenAIVercelProvider] Chat payload snapshot` (line ~9761) shows repeated tool results for the same toolCallId interleaved later in the transcript.
  - `[OpenAIVercelProvider] Error ... InvalidParameter: messages with role "tool" must be a response ... "tool_calls".` (line ~9792)

This is a different class of corruption: even if tool calls exist, a late duplicate tool result breaks adjacency and strict providers hard-fail.

## Fix Strategy (design + implemented route)
Goal: enforce provider-safe invariants at the history boundary so provider switching can’t 400 due to history structure.

### 1) Canonicalize tool-call IDs at ingest
File: `packages/core/src/services/history/ContentConverters.ts`
- Normalize incoming provider IDs to canonical `hist_tool_*` (including malformed `call...` variants and double-prefix cases).

### 2) Make provider-visible history tool-adjacent and de-duplicated
File: `packages/core/src/services/history/HistoryService.ts`
`getCuratedForProvider()` now:
1. Splits any `speaker:'tool'` message that contains `tool_call` blocks into a synthetic `speaker:'ai'` tool-call message followed by a `speaker:'tool'` tool-result message.
2. Synthesizes missing tool calls for tool results that survived compression (existing behavior).
3. Synthesizes missing tool results **only for truly-orphaned tool calls** (a later non-tool message exists, meaning the conversation advanced without the tool completing), while preserving pending/in-flight tool calls.
4. Normalizes tool adjacency for provider payloads:
   - relocates tool results so they appear immediately after the assistant message that introduced their tool call(s)
   - drops duplicate/out-of-order tool results by `callId`

Note: `getCuratedForProvider(tailContents)` accepts optional “tail” contents (e.g., the next user message) so provider-normalization can close pending tool calls *before* the next non-tool turn is sent to strict providers.

### 3) Fix the CLI write-path that produced failure mode (A)
File: `packages/cli/src/ui/hooks/useGeminiStream.ts`
- The “all tools cancelled” path now writes two history entries:
  - `role:'model'` for `functionCall` parts
  - `role:'user'` for `functionResponse` parts

This matches `GeminiChat.normalizeToolInteractionInput()` expectations and prevents mixed tool_call+tool_response tool messages.

## Test-First Workflow (implemented; prefer modifying existing tests)
- `packages/core/src/services/history/ContentConverters.test.ts`
  - malformed tool ID normalization regression coverage
- `packages/core/src/core/coreToolScheduler.test.ts`
  - scheduler→history regression: cancelled tool call responseParts remain a valid tool_call + tool_response pair in provider-visible history
- `packages/core/src/services/history/HistoryService.test.ts`
  - provider-curation regression tests for:
    - late duplicate tool results being dropped
    - out-of-order tool results being relocated to satisfy strict adjacency
    - orphaned tool calls getting a synthetic “cancelled” tool result in provider view (non-mutating)
- `packages/cli/src/ui/hooks/useGeminiStream.test.tsx`
  - verifies the CLI write-path records tool calls/results in the correct roles when all tools are cancelled

## Route Forward (recommended next steps)
1. Root-cause why duplicate tool results are being recorded (failure mode B). Likely candidates:
   - double-commit/rehydration of history on provider switching
   - retry/replay logic writing the same tool completion twice
2. Add an optional runtime invariant checker when writing history:
   - “tool_response(callId) already exists” → treat as idempotent and skip (or log)
3. Consider centralizing ID normalization across providers (single util for `hist_tool_*` ↔ provider ids) to reduce drift.

## Verification / Smoke Checks (repo root)
Run in order; fix failures and rerun from the top:
1. `npm run format`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run test`
5. `npm run build`
6. `node scripts/start.js --profile-load synthetic --prompt "analyze this codebase and tell me what it does, do not use a subagent"`

## Old-UI tmux repro scripts
- Provider switch + tool-call smoke: `scripts/oldui-tmux-script.issue864-provider-switch.llxprt.json`
- Provider switch + **switch back to Anthropic via profile** + ask a memory question (repro for tool adjacency errors after provider switching): `scripts/oldui-tmux-script.issue864-provider-switch-return-sonnetthinking.llxprt.json`
