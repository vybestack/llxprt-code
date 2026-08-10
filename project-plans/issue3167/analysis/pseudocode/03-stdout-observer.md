# Pseudocode 03 — Stdout write observer (core seam, cli install)

Plan ID: PLAN-20260808-PERFTREND
Applies to: `packages/core/src/utils/stdio.ts`, `packages/cli/src/ui/inkRenderOptions.ts`.

**Why core owns only this:** `utils/stdio.ts` lives in core and cannot move.
The interactive Ink instance is built here; Zed builds its own — the counter
must attach to the interactive instance ONLY.

```
10:  // --- core: the seam (no cli import; cli supplies the observer) ---
11:  INTERFACE StdoutWriteObserver:
12:    onWrite(encodedBytes: number, syncDurationMs: number): void
13:  END
14:
15:  // createInkStdio gains an OPTIONAL observer; absence ⇒ current behaviour.
16:  FUNCTION createInkStdio(observer?: StdoutWriteObserver): { stdout, stderr }
17:    attach error handlers (unchanged)
18:    inkStdout = new Proxy(process.stdout, {
19:      get(target, prop, receiver):
20:        IF prop === "write":
21:          RETURN function write(...args):
22:            // count encoded bytes WITHOUT altering the call
23:            chunk = args[0]
24:            encodedBytes = byteLength(chunk)   // Buffer/Uint8Array, never str len
25:            t0 = performance.now()
26:            ok = writeToStdout(...args)        // delegate; preserve overload/enc/cb/backpressure
27:            syncDurationMs = performance.now() - t0
28:            observer?.onWrite(encodedBytes, syncDurationMs)  // D8: NO try/catch — fail fast
29:            RETURN ok
30:          END
31:        END
32:        // ...rest unchanged (bind methods)
33:    })
34:    inkStderr = new Proxy(...)                 // unchanged (no counting)
35:    RETURN { stdout: inkStdout, stderr: inkStderr }
36:  END
37:
38:  // --- cli: lazy/cached interactive stdio (fixes module-scope blocker) ---
39:  // inkRenderOptions.ts line ~24 currently: const sharedStdio = createInkStdio();
40:  // at MODULE SCOPE, before any settings exist. Replace with a lazy cache.
41:  let sharedStdio: ReturnType<typeof createInkStdio> | null = null
42:  let sharedStdioObserver: StdoutWriteObserver | null = null
43:
44:  FUNCTION setInteractiveStdoutObserver(observer: StdoutWriteObserver | null):
45:    // called once perf telemetry is resolved (settings-gated), before first render
46:    sharedStdioObserver = observer
47:    sharedStdio = null                       // invalidate cache so next build carries it
48:  END
49:
50:  FUNCTION getInteractiveStdio():
51:    IF sharedStdio == null:
52:      sharedStdio = createInkStdio(sharedStdioObserver ?? undefined)
53:    END
54:    RETURN sharedStdio
55:  END
56:
57:  // inkRenderOptions(config, settings) uses getInteractiveStdio() instead of
58:  // the module-scope constant. Zed's runZedIntegration.ts keeps calling
58:  // createInkStdio() with NO observer ⇒ its writes are uncounted.
```

**Anti-patterns (must NOT):**
- Globally monkey-patch `process.stdout.write` (Zed would be double-counted).
- Count `string.length` as bytes (line 24 uses byte length).
- Include drain/terminal-flush time in `stdout_write_sync_ms` (line 27 is the
  synchronous `writeToStdout` invocation only).
- Wrap the observer callback in try/catch or swallow its exceptions (line 28 is a
  direct call — D8: internal observer/programming errors fail fast; only
  filesystem writer failures fail open as external I/O).
- Conflate write calls with Ink render passes (`onRender` covers renders).
