# Pseudocode: CLI Session Module Split

Plan ID: PLAN-20260629-ISSUE2285
Component: cliSessionDispatch.tsx responsibility split

## Preflight confirmation (authoritative — see preflight-results.md §9)

P01 preflight CONFIRMED the six cli.tsx imports against the actual
`packages/cli/src/cliSessionDispatch.tsx` source (line numbers verified):

| Export | Kind | cliSessionDispatch.tsx line |
|--------|------|------------------------------|
| `dispatchInteractiveOrNonInteractive` | `export async function` | :404 |
| `formatNonInteractiveError` | `export function` | :91 |
| `initializeOutputListenersAndFlush` | `export function` | :246 |
| `installNonInteractiveSigintHandler` | `export function` | :112 |
| `setupUnhandledRejectionHandler` | `export function` | :138 |
| `startInteractiveUI` | `export async function` | :274 |

Additional exports NOT imported by cli.tsx but exported: `setWindowTitle`
(:222), `NonInteractiveSessionOptions`, `PipedOrPromptSessionOptions`,
`SessionDispatchOptions` (:373-390).

`validateDnsResolutionOrder` is re-exported from `cliBootstrap` (`cli.tsx:100`)
— CONFIRMED NOT in `cliSessionDispatch.tsx` (grep returned no hits).

Preflight also confirmed the side effects enumerated in §9
(SIGINT/exithandlers, process.exit, stdout/stderr writes, enableMouseEvents/
disableMouseEvents, appendFileSync, Ink render, registerSyncCleanup) and the
candidate split seams + safe test seams below.

## Interface Contracts

```
INPUT: packages/cli/src/cliSessionDispatch.tsx (current quarantine)
OUTPUT: stable ownership modules + preserved exports for cli.tsx
```

cli.tsx currently imports and re-exports these six names:
- `dispatchInteractiveOrNonInteractive`
- `formatNonInteractiveError`
- `initializeOutputListenersAndFlush`
- `installNonInteractiveSigintHandler`
- `setupUnhandledRejectionHandler`
- `startInteractiveUI`

`validateDnsResolutionOrder` is re-exported from `cliBootstrap` — NOT part of
this split.

## Candidate stable modules

```
10: // session/nonInteractiveSession.ts
20: //   dispatchInteractiveOrNonInteractive
30: //   runPipedOrPromptSession
40: //   runNonInteractiveSession
50: //   NonInteractiveSessionOptions, PipedOrPromptSessionOptions, SessionDispatchOptions
60:
70: // session/interactiveUI.ts
80: //   startInteractiveUI
90: //   setWindowTitle (UI-adjacent)
100:
110: // session/outputListeners.ts
120: //   initializeOutputListenersAndFlush
130:
140: // session/signalHandlers.ts
150: //   installNonInteractiveSigintHandler
160: //   setupUnhandledRejectionHandler
170:
180: // session/errorReporting.ts
190: //   formatNonInteractiveError
200: //   reportNonInteractiveError
210:
220: // session/terminalCleanup.ts
230: //   mouseEventsExitHandler
240: //   (restoreTerminalProtocolsSync registration helpers)
```

## Numbered pseudocode — refactor order (behavior-preserving)

```
300: METHOD splitCliSessionDispatch()
310:   // STEP 1: characterization tests already GREEN (prior phase)
315:   // STEP 1b (revision 3 finding 22 — stop condition): if the P10 seam
316:   //   audit verdict was B (entangled) AND the entanglement cannot be
317:   //   resolved by pure code-motion WITHOUT introducing a production seam
318:   //   that P11 forbids (e.g. a new exported internal helper), STOP and
319:   //   escalate to the coordinator for a plan revision BEFORE proceeding.
320:   //   The split must not create production seams the characterization
321:   //   contract forbids; if it would, the plan is revised, not forced.
330:   // STEP 2: extract leaf modules first (no inbound deps within the split)
340:   EXTRACT outputListeners.ts (initializeOutputListenersAndFlush)
350:   EXTRACT signalHandlers.ts (sigint + unhandled rejection)
360:   EXTRACT errorReporting.ts (formatNonInteractiveError, reportNonInteractiveError)
370:   EXTRACT terminalCleanup.ts (mouse/terminal helpers)
380:   // STEP 3: extract interactive UI (depends on terminalCleanup)
390:   EXTRACT interactiveUI.ts (startInteractiveUI, setWindowTitle)
400:   // STEP 4: extract non-interactive session (depends on outputListeners, signalHandlers, errorReporting)
410:   EXTRACT nonInteractiveSession.ts (dispatch + runners)
420:   // STEP 5: cliSessionDispatch.tsx becomes a thin re-export barrel OR is deleted
430:   IF cli.tsx can import directly from the new modules:
440:     UPDATE cli.tsx imports to point at the new modules
450:     DELETE cliSessionDispatch.tsx
460:   ELSE:
470:     REDUCE cliSessionDispatch.tsx to a thin re-export barrel (narrow compatibility)
475:   // STEP 5b (revision 3 finding 16): if cliSessionDispatch.tsx is DELETED,
476:   //   any characterization test that imported the OLD path directly must be
477:   //   RETARGETED to the new module path. Retargeting is constrained:
478:   //   ONLY the import specifier changes; the observable-effect assertion
479:   //   BODIES must remain byte-identical. A diff that changes an assertion
480:   //   body (not just an import line) is a BLOCKING failure — it indicates
481:   //   the split changed behavior, not just structure. Verify by diffing
482:   //   the test file excluding import lines: assertion bodies must be stable.
490:   // STEP 6: remove all temporary/quarantine language
500:   PURGE "TEMPORARY", "quarantine", "holding pen" from comments and docs
510:   RUN characterization tests — must still be GREEN
520: ENDMETHOD
```

## Integration points

- Line 315-321: plan-revision stop condition (revision 3 finding 22). If the
  seam audit found entanglement that forces a forbidden production seam, the
  plan is revised rather than forcing a seam P11 forbids.
- Line 430: cli.tsx imports must be updated to the new module paths (or the
  thin re-export barrel). The six re-exported names must resolve.
- Line 475-482: retargeting constraint (revision 3 finding 16). When the old
  module is deleted, characterization-test import paths are retargeted, but
  assertion bodies must remain stable (diff proves only import lines changed).
- Line 510: characterization tests from the prior phase are the behavior
  contract. They must pass (with only import-path retargeting) after the split.

## Anti-pattern warnings

```
[ERROR] DO NOT: mock cliSessionDispatch in characterization tests and assert
         only that mocks were called
[OK] DO: replace external effects (stdout/stderr/process.exit/Ink render) with
         captured sinks and run the REAL dispatch code

[ERROR] DO NOT: leave "TEMPORARY" / "quarantine" comments in the split modules
[OK] DO: stable ownership — each module has a single clear responsibility

[ERROR] DO NOT: move validateDnsResolutionOrder into session modules
[OK] DO: leave it in cliBootstrap.tsx — it is not part of this split

[ERROR] DO NOT: create parallel cliSessionDispatchV2.tsx
[OK] DO: modify/extract the existing module
```
