# Driver Mode Design - Codex (Deepthinker) Proposal v2

## Overview

Driver Mode allows a parent agent to send stdin commands to LLxprt as if typed into the UI, while observing the normal rendered stdout UI. This revision addresses the Opus critique with explicit handling of Ink stdin conflicts, approval-mode prompting, full submit pipeline integration, callback stability, robust synchronization, and a re-evaluation of a DriverClient utility. Scope: macOS + Linux only.

## Goals

1. **Drive LLxprt via stdin** with predictable multi-line submission.
2. **Coexist with Ink** keyboard input (no stdin tug-of-war).
3. **Support approval-mode prompts** in suggest/confirm flows.
4. **Integrate into the real submit pipeline** (slash commands, todo preservation, streaming, history).
5. **Reliable synchronization** for parent automation.
6. **Provide a small DriverClient** for self-tests and agent-to-agent control.

## Non-Goals

- Windows support
- JSON event protocol (still a plain-text UI)
- Replacing Ink UI

---

## 1) Stdin / Ink Conflict: Explicit Multiplexing Strategy

**Problem:** Ink’s `useStdin` consumes stdin for keyboard input; a second readline interface can conflict.

**Solution:** A single stdin owner that *multiplexes* line input and keystrokes. We introduce a tiny `stdinMux` that attaches to `process.stdin` once and exposes two streams:

- **Key stream** (raw mode) for Ink interactive input
- **Line stream** (cooked mode) for driver input

### Behavior

- **Driver mode enabled:** stdin is **cooked** and line-oriented. Ink is placed into **read-only input** (no raw key capture). The UI still renders, but keyboard interaction is disabled to avoid contention. This is acceptable because driver mode is explicitly non-interactive.
- **Driver mode disabled:** Ink retains raw stdin; driver line input is inactive.

### Rationale

- Avoids “two readline interfaces” or competing `data` listeners.
- Reduces surprises in terminal state handling.
- Keeps the UI stable for humans when driver mode is off.

### Implementation Sketch

Create a central stdin manager with a single `process.stdin` subscription, toggling between raw/cooked.

```
stdinMux.start({ mode: 'driver' | 'interactive' })
stdinMux.onLine(...) // only in driver
stdinMux.onKey(...)  // only in interactive
```

Ink integration: pass a `stdin` object only when interactive. In driver mode, either pass a dummy stdin or disable `useStdin` via a prop (`inputEnabled=false`).

---

## 2) Approval Mode Interaction (Suggest/Confirm)

**Problem:** In suggest mode, tools prompt for confirmation; the parent driver needs to answer those prompts.

**Solution:** Introduce a **Driver Prompt Channel** that recognizes confirmation prompts and allows responses via stdin lines.

### Mechanics

- The UI already renders confirmation prompts; we add a *driver-visible* prompt marker to stdout **without altering human output**, using a zero-width ANSI OSC (Operating System Command) marker that terminals ignore but parent agents can parse.
- Example markers:
  - `OSC 9;LLXPRT_PROMPT:confirm:<id>:<options>`
  - `OSC 9;LLXPRT_PROMPT:input:<id>:<label>`

The prompt still appears visually as usual, but the driver can parse the OSC marker to know it must respond.

### Response Flow

- Driver sends a response line that targets a prompt by id:
  - `::prompt <id> yes`
  - `::prompt <id> no`
  - `::prompt <id> <freeform>`

The `stdinMux` forwards these special lines into a **prompt responder** that resolves the pending confirmation.

### Why OSC markers?

- Doesn’t change the UI text.
- Works on macOS/Linux terminals.
- Robust for automation (no heuristics required).

---

## 3) Full Submit Pipeline Integration

**Problem:** The prior design skipped key hooks used in the actual submit pipeline.

**Solution:** Ensure driver submissions travel through **exactly the same path** as normal interactive submits.

### Existing pipeline (must be preserved)

1. `useSlashCommandProcessor`
2. `useTodoPausePreserver`
3. `useGeminiStream`
4. `input history tracking`
5. Existing `InputPrompt` handling

### Driver Integration

Driver-mode `onSubmit` is wired into the same “submit” function used by InputPrompt. That function already passes through:

- Slash command detection/expansion
- Todo pause/resume
- Streaming response orchestration
- History updates

**Design rule:** Driver mode must call the same `submitInput(text)` used by UI, not bypass it.

---

## 4) Callback Stability Bug (useEffect dependency on onSubmit)

**Problem:** Using `useEffect([enabled, onSubmit])` causes readline/driver resources to reinitialize when callbacks change.

**Solution:** Use a stable ref for the submit handler.

```
const onSubmitRef = useRef(onSubmit);
useEffect(() => { onSubmitRef.current = onSubmit; }, [onSubmit]);

useEffect(() => {
  if (!enabled) return;
  stdinMux.onLine((line) => onSubmitRef.current(line));
  return () => stdinMux.offLine(...);
}, [enabled]);
```

This keeps the driver listener stable and avoids resource churn or duplicated listeners.

---

## 5) Robust Synchronization (No Heuristics)

**Problem:** Waiting for prompt chars or idle periods is fragile.

**Solution:** Add explicit synchronization markers in stdout using OSC codes.

### Markers

- **Ready:** `OSC 9;LLXPRT_READY` when input is accepted.
- **Busy:** `OSC 9;LLXPRT_BUSY` when a submit begins.
- **Done:** `OSC 9;LLXPRT_DONE` when response completes.
- **Prompt:** `OSC 9;LLXPRT_PROMPT:...` as described above.

These markers do not affect visual output but are deterministic for parent drivers.

### Why OSC?

- Widely supported on macOS/Linux terminals.
- Doesn’t require special display handling.
- Avoids altering UI text or layout.

---

## 6) DriverClient Reconsidered (Now Included)

**Problem:** Dismissing DriverClient ignores primary use cases: self-testing and agent control.

**Solution:** Provide a small **DriverClient utility** in `packages/cli/src/driver/DriverClient.ts`.

### Responsibilities

- Spawn LLxprt with `--driver`.
- Parse OSC markers for READY/BUSY/DONE/PROMPT.
- Provide async helpers:
  - `send(text)`
  - `awaitReady()`
  - `awaitDone()`
  - `respondToPrompt(id, response)`

### Scope

- This is a thin helper (no external protocol or server).
- Used in integration tests and for automated self-driving.

---

## Revised Architecture

```
                     ┌──────────────────────────┐
   stdin ───────────>│ stdinMux (single owner)  │
                     │  - raw for Ink           │
                     │  - cooked for driver     │
                     └─────────────┬────────────┘
                                   │ driver lines
                                   v
                     ┌──────────────────────────┐
                     │ useStdinDriver           │
                     │  - backslash continuation│
                     │  - prompt routing        │
                     └─────────────┬────────────┘
                                   │ submitInput(text)
                                   v
                     ┌──────────────────────────┐
                     │ Full Submit Pipeline     │
                     │  - useSlashCommand...    │
                     │  - useTodoPause...       │
                     │  - useGeminiStream       │
                     │  - input history         │
                     └─────────────┬────────────┘
                                   │
                                   v
   stdout <──────────┌──────────────────────────┐
                     │ Ink UI Rendering + OSC   │
                     │ Markers (READY/BUSY/DONE)│
                     └──────────────────────────┘

DriverClient <────────────── parses stdout markers
```

---

## Implementation Plan (macOS/Linux)

### A) CLI Flag
- `--driver` to enable driver mode.
- If enabled: set stdinMux to driver mode and disable Ink input.

### B) stdinMux
- Single listener on `process.stdin`.
- Switch between raw/cooked.
- Expose `onLine` (driver) and `onKey` (interactive) APIs.

### C) useStdinDriver Hook
- Uses stdinMux line stream.
- Implements backslash continuation.
- Routes `::prompt <id> <response>` to prompt responder.
- Uses stable ref for `onSubmit`.

### D) Prompt Responder
- A small registry in the UI layer that tracks pending prompt ids.
- When a prompt is created, emit OSC marker with id/options.
- When driver responds, resolve the prompt promise.

### E) OSC Markers
- Add utility `emitOscMarker(type, payload?)` used by:
  - Input readiness
  - Streaming lifecycle
  - Prompt creation

### F) DriverClient
- Spawn helper with stdout marker parser.
- Provide async control helpers for self-testing.

---

## Multi-line Protocol

**Rule:** Line ending with `\` means “continue”, line without means “submit”.

```
# One submission
Hello world

# Multi-line
write a poem about:\
  quiet terminals
```

If a literal trailing backslash is needed, escape it by doubling:
```
C:\\Users\\Name\\
```

---

## Testing Plan (TDD)

### Unit Tests
- `stdinMux` mode switching
- `useStdinDriver` continuation handling
- `prompt responder` resolution
- OSC marker emission helpers

### Integration Tests
- DriverClient sends command, waits for DONE marker
- Approval-mode prompt appears; DriverClient responds and flow resumes

### Example Self-Driving Test
```
const driver = await DriverClient.start(['--driver', '--profile-load', 'synthetic']);
await driver.awaitReady();
await driver.send('/help');
await driver.awaitDone();
await driver.send('write a haiku');
await driver.awaitDone();
```

---

## Files (Planned)

| File | Change |
|------|--------|
| `packages/cli/src/config/config.ts` | Add `--driver` flag |
| `packages/cli/src/ui/stdiomux.ts` | NEW stdin multiplexer |
| `packages/cli/src/ui/hooks/useStdinDriver.ts` | NEW hook |
| `packages/cli/src/ui/AppContainer.tsx` | Wire driver mode + disable Ink input |
| `packages/cli/src/ui/prompts/promptResponder.ts` | NEW prompt registry |
| `packages/cli/src/ui/utils/oscMarkers.ts` | NEW marker helper |
| `packages/cli/src/driver/DriverClient.ts` | NEW driver client helper |

---

## Open Questions

1. Where best to emit READY/BUSY/DONE markers without crossing concerns (likely in submit lifecycle + stream completion)?
2. Should prompt ids be numeric or UUID? (UUID is safer for concurrency.)
3. Should driver mode always disable Ink input, or allow a “mixed” mode? (Default to disable to avoid conflicts.)

---

## Summary of Critique Fixes

- **stdin conflict:** Single stdin owner (stdinMux) + disable Ink input in driver mode.
- **approval mode:** Prompt markers + driver response channel.
- **integration:** Driver submits through full pipeline (slash commands, todo, streaming, history).
- **callback stability:** Stable ref for onSubmit, effect depends only on enabled.
- **synchronization:** OSC markers for READY/BUSY/DONE/PROMPT.
- **DriverClient:** Included for self-testing/agent control.

This design preserves the human-facing UI while making automation robust and deterministic on macOS/Linux.