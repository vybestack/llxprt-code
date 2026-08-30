# Issue #2933 — Wire `CompressionContext.transcriptPath`

Plan date: 2026-08-22
Branch: `issue2933`

## Problem

`CompressionContext.transcriptPath` (`packages/core/src/core/compression/types.ts:157`)
is declared and consumed by both LLM compression strategies, but nothing ever
populates it. The consumer code is therefore dead:

- `packages/agents/src/compression/OneShotStrategy.ts:425-435`
- `packages/agents/src/compression/MiddleOutStrategy.ts:704-714`

Both append the same hard-coded line to the compression request when the field
is present. The value that belongs there already exists:
`SessionRecordingService.getFilePath()`, resolved live off `Config` and already
used for the hook system's `transcript_path`
(`packages/core/src/hooks/hookEventHandler.ts:204-205`).

The existing injected wording is also inaccurate: it claims a "full
pre-compression transcript", but recording can start mid-session
(`sessionControl.ts:875-917` seeds only current history) and can deactivate on
write failure.

## Accepted behavior

1. **AB1 — populated when materialized.** `CompressionHandler.buildCompressionContext()`
   returns a context whose `transcriptPath` equals the current session
   recording's materialized file path.
2. **AB2 — absent, not empty.** When there is no recording service, when the
   recording exists but has not materialized a file yet (`getFilePath()` is
   `null`), or when recording was deactivated and the path is gone, the
   `transcriptPath` key is **absent** from the built context (`in` returns
   false), never `''`.
3. **AB3 — live resolution.** The path is resolved at compression time through
   an injected provider closure, not captured at construction. Enabling,
   disabling, or swapping the recording service (resume) between two
   `buildCompressionContext()` calls is reflected in the second call.
4. **AB4 — accurate, shared wording.** Both `OneShotStrategy` and
   `MiddleOutStrategy` inject the identical notice, produced by one shared
   builder in core. The notice describes a session journal that may be
   incomplete, and steers toward searching the file for a specific string
   rather than reading it whole.

## Boundary cases

| Input | Expected |
| --- | --- |
| No provider injected (subagent/executor chat sessions, tests) | key absent |
| Provider returns `undefined` (no recording service on Config) | key absent |
| Provider returns `undefined` because `getFilePath()` is `null` (unmaterialized) | key absent |
| Provider returns `''` | key absent (empty is not a path) |
| Provider returns a real path | key present with exactly that path |
| Recording service swapped on Config between builds | second build sees the new path |
| Recording service removed from Config between builds | second build omits the key |

## Design

Mirror the existing `activeTodosProvider` injection chain exactly:

```
ChatSessionFactory.buildChatFromRuntime()
  -> chat.setTranscriptPathProvider(() =>
       config.getSessionRecordingService()?.getFilePath() ?? undefined)
  -> ChatSession.setTranscriptPathProvider()
  -> CompressionHandler.setTranscriptPathProvider()
  -> buildCompressionContext(..., transcriptPathProvider, ...)
```

The provider is synchronous (`() => string | undefined`) because
`getFilePath()` is a synchronous field read; `activeTodosProvider` is async only
because reading a todo snapshot is I/O.

Liveness (AB3) comes from resolving `config.getSessionRecordingService()` inside
the closure on every call. `sessionControl` installs/removes/swaps the service on
Config (`setSessionRecordingService` at lines 294, 307, 392, 911, 1003), so the
closure observes every transition with no extra plumbing.

Shared wording lives in a new
`packages/core/src/core/compression/transcriptPathNotice.ts`, following the
precedent of `continuationDirective.ts` (pure string builder in core, imported by
both strategies in `packages/agents`).

## Files to change

- **new** `packages/core/src/core/compression/transcriptPathNotice.ts` —
  `buildTranscriptPathNotice(transcriptPath: string): string`.
- `packages/core/src/index.ts` — export it next to `buildContinuationDirective`.
- `packages/agents/src/compression/OneShotStrategy.ts` — use the shared builder.
- `packages/agents/src/compression/MiddleOutStrategy.ts` — use the shared builder.
- `packages/agents/src/compression/compressionContextBuilder.ts` — accept
  `transcriptPathProvider` and conditionally spread `transcriptPath`.
- `packages/agents/src/compression/CompressionHandler.ts` — field + setter, pass
  through to the builder.
- `packages/agents/src/core/chatSession.ts` — delegating setter.
- `packages/agents/src/core/ChatSessionFactory.ts` — wire the closure off `config`.
- `packages/agents/src/core/ChatSessionFactory.test.ts` and
  `ChatSessionFactory.tokenReestimate.test.ts` — chat doubles need the new method.

## Tests (written first)

1. `packages/agents/src/compression/__tests__/transcriptPathContext.test.ts`
   - AB1/AB2/AB3 through the real `CompressionHandler.buildCompressionContext()`
     with a real `SessionRecordingService` in a temp dir: before materialization
     the key is absent; after `recordContent` + `flush` the key equals
     `service.getFilePath()`; after swapping in a second service the next build
     returns the second path; after removing the service the key is absent again.
   - Provider returning `''` yields an absent key.
   - No provider at all yields an absent key.
2. `packages/agents/src/compression/__tests__/transcriptPathInjection.test.ts`
   - Behavioral, through `OneShotStrategy.compress()` and
     `MiddleOutStrategy.compress()` with a fake provider that captures the
     request messages: with `transcriptPath` set, the request contains the
     notice, containing the path; both strategies emit byte-identical notice
     text; with the field unset, no notice appears.
   - Wording accuracy: notice does not claim a "full" transcript and mentions
     searching.
3. `packages/core/src/core/compression/transcriptPathNotice.test.ts`
   - The builder embeds the given path and produces the same output for the same
     input (pure function contract used by both strategies).
4. `packages/agents/src/core/ChatSessionFactory.test.ts`
   - Capture the provider handed to the chat and invoke it: returns the path of
     the recording service currently installed on Config, returns `undefined`
     when none is installed, and returns the new path after Config swaps the
     service (AB3 at the wiring seam).

## Review triage

Findings from the design review and from Open Code Review, with disposition.

| Finding | Disposition |
| --- | --- |
| A recorder deactivated by a write failure still returns its old path, so `transcriptPath` kept advertising a dead journal | **Blocker-Fix.** Acceptance criterion 2 names this case. Resolution moved into `resolveTranscriptPath`, which requires `isActive()`; covered by a real-recorder test and a factory test. |
| The direct core subpath imported by both strategies was missing from `packages/core/package.json` exports | **Blocker-Fix.** Added, matching the `continuationDirective.js` entry. |
| `ChatSession.setTranscriptPathProvider` sat between two tested halves without being tested itself | **In-scope-Fix.** Added a test driving a real `ChatSession` through `performCompression` and asserting the path reaches the strategy's context. |
| Wrap `transcriptPathProvider?.()` in try/catch for symmetry with `activeTodosProvider` | **Reject.** `activeTodosProvider` is guarded because it reads a todo snapshot from disk. This provider reads a field off Config and cannot throw; adding a swallow contradicts the project's fail-fast preference and would hide a real bug. |
| `ChatSessionFactory.test.ts` adds `setTranscriptPathProvider` to its chat double without asserting on it | **Reject.** `ChatSessionFactory.transcriptPath.test.ts` captures the installed provider and invokes it, which is a stronger check than asserting the setter was called. |
| The hoisted `vi.mock` of `@vybestack/llxprt-code-settings` in the context test risks a TDZ error and interacts badly with `restoreAllMocks` | **In-scope-Fix by removal.** The mock was unnecessary; the tests pass against the real `Storage.getGlobalConfigDir()`. |
| Type assertions in the new tests | **Reject.** The `as unknown as` fixtures match the established convention in the neighbouring test files. The nullable-path assertions were removed in favour of a narrowing helper. |

## Out of scope

- What the session journal records.
- Subagent/executor chat sessions (`subagentRuntimeSetup.ts`, `executor.ts`) do
  not wire `activeTodosProvider` either; matching that seam is not part of this
  issue.
- Any context-architecture or mutation-journaling work (#1393).
