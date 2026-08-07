# Numbered Pseudocode — issue #3113

Plan ID: PLAN-20260807-ISSUE3113
Generated: 2026-08-07

Implementation MUST cite these line numbers in `@pseudocode` markers. This is
pseudocode, not TypeScript; no line may be copied verbatim as code.

---

## Contracts

### Inputs (unchanged public contract)

```
reportError(
  error:        Error | unknown
  baseMessage:  string
  context?:     unknown[] | Record<string, unknown>
  type:         string = 'general'
  reportingDir: string = os.tmpdir()
) -> Promise<void>          // never rejects
```

### Outputs

```
// written report, normal
{ "error": { "message": string, "stack"?: string }, "context"?: unknown }

// written report, array context tail-clamped  (REQ-3113-1.3)
{ "error": {...}, "context": unknown[], "contextTruncated": { "omittedEntries": number } }

// written report, context dropped            (REQ-3113-1.4)
{ "error": {...}, "contextOmitted": { "reason": "payload-exceeded-limit",
                                      "serializedBytes": number, "limitBytes": number } }

// minimal fallback report (unchanged shape, now compact)
{ "error": { "message": string, "stack"?: string } }
```

All four are emitted with **no** `space` argument to `JSON.stringify`.

### Module-private state and constants (nothing exported)

```
MAX_REPORT_STRING_CHARS     = 4096
MAX_REPORT_CONTEXT_ENTRIES  = 8
MAX_REPORT_BYTES            = 131072
MAX_REPORT_FILES            = 20
MAX_REPORT_TOTAL_BYTES      = 1048576
REPORT_DEDUPE_WINDOW_MS     = 60000
MAX_TRACKED_FINGERPRINTS    = 64
FINGERPRINT_ALGORITHM       = "sha256"   // fixed 64-hex-char key, never sliced
FINGERPRINT_FIELD_SEPARATOR = "\u0000"   // not a decimal digit: self-delimiting
REPORT_FILE_PATTERN         = /^llxprt-client-error-.*\.json$/

recentReports : Map<string, { windowStartMs: number,
                              suppressedCount: number,
                              lastReportPath: string }>
```

### Dependencies (all Node builtins already available; none injected, none new)

```
fs         from 'node:fs/promises' // readdir, stat, unlink, writeFile (already imported)
os         from 'node:os'                                             (already imported)
path       from 'node:path'                                           (already imported)
Buffer     from 'node:buffer'      // byteLength, from                 (NEW import)
createHash from 'node:crypto'      // fingerprint digest only          (NEW import)
```

Both new imports are Node built-ins, present in Node and Bun, already used
elsewhere in `packages/core` (`services/loopDetectionService.ts:7` imports
`createHash`). Neither adds a package, a lockfile entry, or an export.

---

## Component 1 — `packages/core/src/utils/errorReporting.ts`

### 1.1 `clampString(value)` — REQ-3113-1.2

```
010: FUNCTION clampString(value: string) -> string
011:   IF value.length <= MAX_REPORT_STRING_CHARS
012:     RETURN value
013:   RETURN value.slice(0, MAX_REPORT_STRING_CHARS)
014:          + " [truncated: " + value.length + " chars]"
```

### 1.2 `stringifyClamped(payload)` — REQ-3113-1.2, REQ-3113-2

```
020: FUNCTION stringifyClamped(payload: unknown) -> string
021:   // No `space` argument: compact output (REQ-3113-2).
022:   // The replacer runs for every value, so error.message, error.stack and
023:   // every context string are clamped uniformly.
024:   RETURN JSON.stringify(payload, replacer)
025:     WHERE replacer(key, value) =
026:       IF typeof value is "string" THEN clampString(value) ELSE value
027:   // NOTE: this function does NOT catch. A BigInt/circular payload still
028:   // throws to the caller so the existing serialization fallback runs
029:   // unchanged (REQ-3113-5).
```

### 1.3 `serializeBoundedReport(errorToReport, context)` — REQ-3113-1.2/1.3/1.4

```
040: FUNCTION serializeBoundedReport(errorToReport, context?) -> string
041:   base = { error: errorToReport }
042:   IF context is provided
043:     base.context = context
044:   text = stringifyClamped(base)                  // S1 — FIRST JSON.stringify call
045:   IF Buffer.byteLength(text, "utf8") <= MAX_REPORT_BYTES
046:     RETURN text                                  // S2
047:   IF context is an Array
048:     kept    = context.slice(-MAX_REPORT_CONTEXT_ENTRIES)
049:     omitted = context.length - kept.length
050:     text    = stringifyClamped({ error: errorToReport,
051:                                  context: kept,
052:                                  contextTruncated: { omittedEntries: omitted } })
053:     IF Buffer.byteLength(text, "utf8") <= MAX_REPORT_BYTES
054:       RETURN text                                // S3
055:   RETURN stringifyClamped({ error: errorToReport,
056:                             contextOmitted: {
057:                               reason: "payload-exceeded-limit",
058:                               serializedBytes: Buffer.byteLength(text, "utf8"),
059:                               limitBytes: MAX_REPORT_BYTES } })   // S4
060:   // S4 is bounded: `error` holds at most two clamped strings, so the
061:   // result is always well under MAX_REPORT_BYTES. This is the hard cap.
```

### 1.4 `buildFingerprint(type, baseMessage, message)` — REQ-3113-4

```
070: FUNCTION buildFingerprint(type, baseMessage, message) -> string
071:   digest = createHash(FINGERPRINT_ALGORITHM)
072:   FOR EACH component IN [type, baseMessage, message]      // fixed order
073:     bytes = Buffer.from(component, "utf8")
074:     digest.update(String(bytes.length))                   // length prefix
075:     digest.update(FINGERPRINT_FIELD_SEPARATOR)
076:     digest.update(bytes)                                  // complete, untruncated
077:     digest.update(FINGERPRINT_FIELD_SEPARATOR)
078:   RETURN digest.digest("hex")
079:   // 64 hex characters, fixed size for any input. No slice anywhere.
```

Three properties this shape buys, each load-bearing:

1. **No truncation, so no false coalescing.** The whole message participates.
   Two errors that share a 512-character prefix and differ afterwards produce
   different digests, so the second is reported rather than silently suppressed.
   The accepted behavior is that *identical* failures coalesce; a truncated key
   would coalesce non-identical ones.
2. **Injective, length-safe framing.** Each component is written as
   `decimalByteLength · SEP · bytes · SEP`. The decimal count is self-delimiting
   because `SEP` is not a digit, so the byte stream cannot be reinterpreted as a
   different split — `("ab","c","x")` and `("a","bc","x")` differ, and a
   component that itself contains U+0000 does not alias another triple.
3. **Incremental, no intermediate copy.** `update` is called per component;
   `type + SEP + baseMessage + SEP + message` is never materialized. The message
   can be megabytes, and allocating a full copy of it is exactly the cost this
   issue exists to remove.

`error.stack` and `context` remain excluded (specification section 8): stacks
vary by frame across retries of the same failure, and hashing unbounded context
would reintroduce the cost being removed.

### 1.5 `consumeDuplicate(fingerprint, nowMs)` — REQ-3113-4

```
080: FUNCTION consumeDuplicate(fingerprint, nowMs)
081:        -> { suppressed: false } | { suppressed: true, count, lastReportPath }
082:   entry = recentReports.get(fingerprint)
083:   IF entry is absent
084:     RETURN { suppressed: false }
085:   IF nowMs - entry.windowStartMs >= REPORT_DEDUPE_WINDOW_MS
086:     // Fixed window expired. Drop the entry; a fresh window opens only
087:     // when the next report is actually written (line 109).
088:     recentReports.delete(fingerprint)
089:     RETURN { suppressed: false }
090:   entry.suppressedCount = entry.suppressedCount + 1
091:   RETURN { suppressed: true,
092:            count: entry.suppressedCount,
093:            lastReportPath: entry.lastReportPath }
```

### 1.6 `rememberReport(fingerprint, nowMs, reportPath)` — REQ-3113-4

```
100: FUNCTION rememberReport(fingerprint, nowMs, reportPath)
101:   // Called ONLY after a successful write, so a failing disk never
102:   // silences the next attempt.
103:   FOR EACH [key, entry] IN recentReports
104:     IF nowMs - entry.windowStartMs >= REPORT_DEDUPE_WINDOW_MS
105:       recentReports.delete(key)
106:   WHILE recentReports.size >= MAX_TRACKED_FINGERPRINTS
107:     oldestKey = key of the entry with the smallest windowStartMs
108:     recentReports.delete(oldestKey)
109:   recentReports.set(fingerprint, { windowStartMs: nowMs,
110:                                    suppressedCount: 0,
111:                                    lastReportPath: reportPath })
```

### 1.7 `collectReportFiles(reportingDir)` — REQ-3113-3

```
120: FUNCTION collectReportFiles(reportingDir)
121:        -> Array<{ path, size, mtimeMs, name }>
122:   TRY names = await fs.readdir(reportingDir)
123:   CATCH  RETURN []        // missing/unreadable dir: rotation is a no-op
124:   results = []
125:   FOR EACH name IN names
126:     IF NOT REPORT_FILE_PATTERN.test(name)
127:       CONTINUE            // every non-matching entry is left untouched
128:     full = path.join(reportingDir, name)
129:     TRY   info = await fs.stat(full)
130:     CATCH CONTINUE        // vanished or unreadable: skip
131:     IF NOT info.isFile()
132:       CONTINUE            // a directory named like a report is not a report
133:     results.push({ path: full, size: info.size,
134:                    mtimeMs: info.mtimeMs, name: name })
135:   RETURN results
```

### 1.8 `rotateReports(reportingDir, keepPath)` — REQ-3113-3

```
140: FUNCTION rotateReports(reportingDir, keepPath)
141:   entries = await collectReportFiles(reportingDir)
142:   count = entries.length                  // includes keepPath when present
143:   total = SUM(entry.size FOR entry IN entries)
144:   candidates = entries WHERE entry.path != keepPath
145:   SORT candidates ASCENDING BY (mtimeMs, THEN name)
146:     // mtimeMs ties are common on fast writes; the embedded ISO-8601
147:     // timestamp sorts lexicographically in chronological order, so the
148:     // name tie-break agrees with creation order. Fully deterministic.
149:   WHILE candidates is not empty
150:         AND (count > MAX_REPORT_FILES OR total > MAX_REPORT_TOTAL_BYTES)
151:     victim = candidates.shift()           // oldest first
152:     TRY   await fs.unlink(victim.path)
153:     CATCH { }                             // concurrent deletion / permission:
154:                                           // best-effort janitor, never throws
155:     count = count - 1
156:     total = total - victim.size           // decremented even on unlink
157:                                           // failure so the loop terminates
158:   // Post-condition after a completed non-concurrent pass:
159:   //   matching files <= MAX_REPORT_FILES
160:   //   sum of their sizes <= MAX_REPORT_TOTAL_BYTES
161:   //   keepPath still present; no non-matching entry touched
```

### 1.9 `writeMinimalReport(errorToReport, baseMessage, reportPath)` — REQ-3113-2, REQ-3113-5

```
170: FUNCTION writeMinimalReport(errorToReport, baseMessage, reportPath) -> boolean
171:   TRY
172:     content = stringifyClamped({ error: errorToReport })   // compact
173:     await fs.writeFile(reportPath, content)
174:     reportToStderr(baseMessage +
175:       " Partial report (excluding context) available at: " + reportPath)
176:     RETURN true
177:   CATCH minimalWriteError
178:     reportToStderr(baseMessage +
179:       " Failed to write even a minimal error report:", minimalWriteError)
180:     RETURN false
181:   // Only change versus today: compact output and a boolean result so the
182:   // caller owns dedupe bookkeeping and rotation in exactly one place.
```

### 1.10 `reportError(...)` — orchestration

```
190: EXPORTED ASYNC FUNCTION reportError(error, baseMessage,
191:                                     context?, type = "general",
192:                                     reportingDir = os.tmpdir())
193:   errorToReport = normaliseError(error)                    // unchanged
194:   fingerprint   = buildFingerprint(type, baseMessage, errorToReport.message)
195:   nowMs         = Date.now()
196:   duplicate     = consumeDuplicate(fingerprint, nowMs)
197:   IF duplicate.suppressed
198:     reportToStderr(baseMessage +
199:       " Duplicate error report suppressed (" + duplicate.count +
200:       " within " + (REPORT_DEDUPE_WINDOW_MS / 1000) + "s). Previous report: " +
201:       duplicate.lastReportPath)
202:     RETURN                                                  // no file written
203:
204:   timestamp      = new Date().toISOString().replace(/[:.]/g, "-")
205:   reportFileName = "llxprt-client-error-" + type + "-" + timestamp + ".json"
206:   reportPath     = path.join(reportingDir, reportFileName)   // format frozen
207:
208:   TRY
209:     stringifiedReportContent = serializeBoundedReport(errorToReport, context)
210:   CATCH stringifyError
211:     // Existing serialization fallback, byte for byte unchanged.
212:     reportToStderr(baseMessage +
213:       " Could not stringify report content (likely due to context):",
214:       stringifyError)
215:     reportToStderr("Original error that triggered report generation:", error)
216:     IF context
217:       reportToStderr(
218:         "Original context could not be stringified or included in report.")
219:     written = await writeMinimalReport(errorToReport, baseMessage, reportPath)
220:     IF written
221:       rememberReport(fingerprint, nowMs, reportPath)
222:       await rotateReports(reportingDir, reportPath)
223:     RETURN
224:
225:   TRY
226:     await fs.writeFile(reportPath, stringifiedReportContent)
227:   CATCH writeError
228:     // Existing write fallback, byte for byte unchanged. No dedupe entry is
229:     // recorded and no rotation runs, so a failing disk neither silences
230:     // the next attempt nor deletes anything.
231:     reportToStderr(baseMessage +
232:       " Additionally, failed to write detailed error report:", writeError)
233:     reportToStderr("Original error that triggered report generation:", error)
234:     IF context
235:       logContextFallback(context)
236:     RETURN
237:
238:   reportToStderr(baseMessage + " Full report available at: " + reportPath)
239:   rememberReport(fingerprint, nowMs, reportPath)
240:   await rotateReports(reportingDir, reportPath)
```

`logContextFallback` and `formatContextFallback` (`errorReporting.ts:130-156`)
are **unchanged**.

### Anti-pattern warnings for component 1

```
DO NOT: export any constant, helper, or the recentReports map
    DO: keep every addition module-private; tests restate the values

DO NOT: add a `reportingLimits` / `ErrorReportOptions` parameter or object
    DO: keep the five-parameter signature exactly as it is (REQ-3113-5)

DO NOT: call JSON.stringify anywhere before line 209
    DO: keep fingerprinting a node:crypto digest over three strings
        (errorReporting.test.ts mocks JSON.stringify by call count and must
        keep passing; a digest adds no JSON.stringify call)

DO NOT: slice, truncate, or otherwise shorten the fingerprint or its inputs
    DO: hash the complete type, baseMessage and message — the digest is already
        fixed-size, and truncation would coalesce two non-identical long errors

DO NOT: build `type + SEP + baseMessage + SEP + message` and hash that string
    DO: call digest.update once per framed component (lines 073-077); the
        message can be megabytes and must never be copied

DO NOT: drop the decimal length prefix and rely on the separator alone
    DO: keep `length · SEP · bytes · SEP` framing so the encoding is injective

DO NOT: fingerprint error.stack or context
    DO: hash exactly type, baseMessage and the normalised message

DO NOT: add a uniqueness suffix, counter, or PID to the report filename
    DO: keep `llxprt-client-error-${type}-${timestamp}.json` frozen

DO NOT: rotate before the write, or rotate after a failed write
    DO: rotate once, after a successful write, with the new file protected

DO NOT: rewrite an existing report to bump an occurrence counter
    DO: emit the count on stderr (line 198-201)

DO NOT: wrap rotation in a mutex, queue, or lock file
    DO: swallow ENOENT and document the best-effort concurrency contract

DO NOT: swallow the stringify error inside stringifyClamped
    DO: let it propagate so the existing fallback at line 210 runs

DO NOT: use `catch (e) { }` — sonarjs/no-ignored-exceptions is an error
    DO: use `} catch {` with a comment stating why, as reportToStderr already does
```

---

## Component 2 — `packages/agents/src/core/turn.ts`

Module-private constant, placed next to the existing module constants near
`turn.ts:72`:

```
300: CONSTANT TURN_REPORT_HISTORY_TAIL = 8
301:   // Matches MAX_REPORT_CONTEXT_ENTRIES in the core writer so a Turn report
302:   // looks the same whether the caller or the writer bounded it.
```

Replacing `turn.ts:588-594` inside `handleRunError`:

```
310: history             = this.chat.getHistory(/* curated */ true)
311: recentHistory       = history.slice(-TURN_REPORT_HISTORY_TAIL)
312:   // slice(-8) on [] yields []; on a 3-entry history yields all 3.
313: omittedHistoryCount = MAX(0, history.length - TURN_REPORT_HISTORY_TAIL)
314: await reportError(
315:   error,
316:   "Error when talking to " + this.providerName + " API",
317:   { request: req,                    // the failed request, semantically separate
318:     recentHistory: recentHistory,    // bounded tail, never the whole conversation
319:     omittedHistoryCount: omittedHistoryCount },
320:   "Turn.run-sendMessageStream")
321: structuredError = buildStructuredError(error)
322: YIELD { type: AgentEventType.Error, value: { error: structuredError } }
```

### Integration points

```
Line 310: this.chat.getHistory(true) -> IContent[]
          Real ChatSession dependency, already injected via the constructor.
          Unchanged call; only what is done with the result changes.

Line 314: reportError(...) from '@vybestack/llxprt-code-core/utils/errorReporting.js'
          Already imported at turn.ts:27. MUST stay awaited — the existing call
          is awaited and fire-and-forget would lose the report on process exit.
          The object literal is assignable to `Record<string, unknown>`.

Line 321: buildStructuredError / the yielded Error event are UNCHANGED.
          Every existing turn test that asserts the emitted events keeps passing.
```

### Anti-pattern warnings for component 2

```
DO NOT: [...history, req]                       // the defect: request lost in history
    DO: { request, recentHistory, omittedHistoryCount }

DO NOT: history.slice(0, 8)                     // head, not tail — wrong end
    DO: history.slice(-TURN_REPORT_HISTORY_TAIL)

DO NOT: export TURN_REPORT_HISTORY_TAIL or read it from a setting
    DO: module-private constant

DO NOT: add a debug flag that restores full-history capture
    DO: nothing — opt-in full history is explicitly out of scope

DO NOT: change the yielded events, the error mapping, or any other branch of
        handleRunError
    DO: change only the reportError context argument
```
