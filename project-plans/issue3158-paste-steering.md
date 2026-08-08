# Issue 3158: Expand large pastes before steering

## Problem

The Ink input prompt replaces a large pasted block with a tracked display label such as `[4 lines pasted #1]`. Normal submission resolves tracked labels to their pasted content, but Ctrl+Enter steering currently passes the display label to `onSteer` unchanged.

## Accepted behavior

1. While an agent response is active, Ctrl+Enter sends the content represented by every tracked large-paste label rather than the labels themselves.
2. Expansion preserves the exact position of surrounding typed text and the order of multiple pasted blocks.
3. Text without a tracked large-paste label, including ordinary typed text and sub-threshold pastes, is sent unchanged.
4. Expansion is read-only. If steering declines the input, the visible buffer and pending paste state remain usable, and a later normal submission still sends the full pasted content.
5. Existing normal-submit expansion and empty-input queued-steering behavior remain unchanged.

## Boundaries and non-goals

- Queued submissions are already expanded by the normal submit path before they enter the queue; no queued-steering change is included.
- Paste resolution remains an input-prompt concern; the agent steering hook and public props are unchanged.
- No explicit second paste-state cleanup path is added. Existing pruning removes entries after a consumed steer clears the buffer.
- Recursive or malformed placeholder hardening, adjacent refactors, dependencies, workflows, quality configuration, and public abstractions are out of scope.

## Behavioral evidence

Extend the existing Bun test `packages/cli/src/ui/components/InputPrompt.paste.spec.tsx` test-first:

- A four-line paste followed by Ctrl+Enter reaches `onSteer` as the full four-line content, not a display label.
- Surrounding typed text remains around the expanded paste.
- Multiple tracked paste labels all expand in order.
- A declined steer does not consume the placeholder state; normal Enter afterward submits the full paste.
- Plain text reaches steering unchanged.

The first three scenarios must fail before production code changes and pass afterward.

## Minimal design

Add a pure module-internal paste-expansion helper beside `handleLargePaste` in `inputPromptText.ts`. Use it both in the existing normal-submit path and immediately before the existing `handleSteer` call. The helper reads a `ReadonlyMap`, preserves the current split/join replacement semantics, and does not mutate paste state.

## Expected implementation surface

- `packages/cli/src/ui/components/inputPromptText.ts`
- `packages/cli/src/ui/components/inputPromptKeyHandlers.ts`
- `packages/cli/src/ui/components/inputPromptHooks.ts`
- `packages/cli/src/ui/components/InputPrompt.paste.spec.tsx`

## Verification

1. Focused Bun test in RED and GREEN states.
2. CLI package test suite.
3. Full project gates: test, lint, typecheck, format, build.
4. Stepfun smoke test.
5. Scoped code reviews and Open Code Review, with every finding classified as Blocker-Fix, In-scope-Fix, Reject, or Defer.
6. PR CI and review threads green on the candidate head, with correct ancestry and no merge conflict.
