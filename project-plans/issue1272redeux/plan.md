# Issue #1272 (Redeux) — Minimal Ordering-Only Remediation Plan

## Goal

Implement a minimal, TDD-first fix for #1272 that corrects thinking/content ordering in CLI display/history assembly **without** introducing real-time thinking streaming and **without** global thinking text normalization.

## Scope Constraints (Must Keep)

1. Keep main-style thinking model in UI hook:
   - `thinkingBlocksRef` array in `useGeminiStream`
   - thought text derived from `subject/description`
   - `sourceField: 'thought'`
2. Keep `GeminiMessage` pending behavior:
   - thinking hidden while pending (`showThinking && !isPending`)
3. Do **not** change provider streaming semantics for this task.
4. Do **not** add `normalizeThinkingText`-style flattening to interactive UI path.
5. Limit changes to CLI stream assembly path (primarily `useGeminiStream` and tests).

## Problem Hypothesis

Ordering regressions happen at pending/commit boundaries when content chunks are split into `gemini` and `gemini_content` items while thinking blocks are repeatedly attached to both pending and committed items. The minimal fix should ensure deterministic commit order and avoid duplicate/misaligned thinking attachment.

## Target Ordering Contract

For each assistant turn in interactive CLI history:

1. Exactly one committed `gemini` item should carry that turn’s `thinkingBlocks` (if any thought events occurred).
2. Any overflow continuation `gemini_content` items for the same turn should **not** duplicate `thinkingBlocks`.
3. The visible display order must remain:
   - thinking (rendered by `GeminiMessage` on committed item)
   - then assistant text content for that same committed sequence.
4. Pending UI remains unchanged (no live thinking body rendering in pending message).

## TDD Plan

### Step 1 — Add failing tests first

Primary test file:
- `packages/cli/src/ui/hooks/useGeminiStream.thinking.test.tsx`

Add/adjust tests to assert:

1. **Single-owner thinking blocks**
   - When content splits into `gemini` + `gemini_content`, only first committed `gemini` has `thinkingBlocks`.
   - `gemini_content` entries have no `thinkingBlocks`.

2. **No duplicate thinking on multiple content flushes**
   - With multiple content chunks causing multiple commits, thinking is not repeated on each committed segment.

3. **Stable ordering with thought-before-content stream sequence**
   - Thought event(s) then content yields final history where thinking is attached to first committed assistant item, followed by content continuation items.

4. **Preserve source metadata**
   - `sourceField` remains `'thought'`.

### Step 2 — Minimal implementation to satisfy tests

Primary implementation file:
- `packages/cli/src/ui/hooks/useGeminiStream.ts`

Expected minimal approach:

- Introduce turn-local consumption semantics for thinking blocks so they are committed once per assistant turn.
- Ensure `beforeText` commit path and flush path share the same "first committed gemini item owns thinking" rule.
- Ensure continuation (`gemini_content`) updates do not reattach thinking blocks after first committed ownership is established.
- Keep all other behavior intact (sanitization, pending updates, tool flow, cancellation behavior).

### Step 3 — Run focused tests

Run at minimum:

- `npm run test -- packages/cli/src/ui/hooks/useGeminiStream.thinking.test.tsx`
- Any directly impacted sibling tests if needed:
  - `packages/cli/src/ui/hooks/useGeminiStream.test.tsx`
  - `packages/cli/src/ui/components/messages/GeminiMessage.test.tsx`

### Step 4 — Full verification cycle

From project root, run:

1. `npm run test`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run format`
5. `npm run build`
6. `node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"`

## Non-Goals

- No provider-side incremental reasoning emission changes.
- No replacement of `thinkingBlocksRef` with text buffers.
- No display normalization pipeline (`thinkingTextJoiner`) in interactive UI.

## Risk Notes

- `useGeminiStream` has many responsibilities; keep edits narrowly scoped to thinking block attachment logic.
- Avoid regressions in cancellation and queued submission behavior by not touching unrelated branches.

## Acceptance Criteria

1. New ordering tests fail before implementation and pass after.
2. Existing behavior constraints remain unchanged (no live thinking body while pending).
3. Thinking appears once, in-order, on committed assistant history display.
4. Full verification suite passes.
