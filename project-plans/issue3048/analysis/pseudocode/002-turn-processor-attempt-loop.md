# Pseudocode 002 — TurnProcessor attempt loop

Plan ID: `PLAN-20260806-ISSUE3048`
Target file: `packages/agents/src/core/TurnProcessor.ts`
Requirements: REQ-3048-002, REQ-3048-003, REQ-3048-004, REQ-3048-005
Referenced by: plan phase **P04**

---

## Interface contracts

```ts
// INPUTS (unchanged)
_runStreamAttempt(
  params: SendMessageParams,
  prompt_id: string,
  userContents: IContent[],
  attempt: number,
): AsyncGenerator<StreamEvent, { error: unknown; action: 'retry' | 'stop' }>

// OUTPUTS (unchanged shape)
//  yields StreamEvent (RETRY | CHUNK | AGENT_EXECUTION_*)
//  returns { error, action }

// DEPENDENCIES
//  streamProcessor.makeApiCallAndProcessStream  -> REAL, injected via constructor
//  shouldRetryStreamAttempt / applyRetryTemperature -> turnAbortHelpers.js
```

## Integration points (line by line)

```
Line 112: CALL streamProcessor.makeApiCallAndProcessStream(...)
          - MUST be called once per attempt. This is what makes the restart a
            fresh StreamOutputAccumulator + fresh history-recording closure
            (spec AD-1 / AD-7). Never hoist it out of the attempt.
Line 130: CALL shouldRetryStreamAttempt(error, params, attempt,
                                        { hasYieldedOutput: hasYieldedChunk })
          - `hasYieldedChunk` is computed from the SAME block predicate as today
            (non-empty text | thinking | tool_call). Do not widen it to include
            metadata-only chunks: usage metadata is not user-visible output.
Line 105: yield { type: StreamEventType.RETRY }
          - unchanged position: start of every attempt after the first, i.e.
            AFTER the backoff delay and BEFORE the new provider call, so every
            consumer receives the discard signal before any replacement chunk.
```

## Anti-pattern warnings

```
DO NOT: add any net lines to TurnProcessor.ts without removing at least as many.
        The file measures 797 effective lines against max-lines: 800
        (preflight F3/D). The relocation at lines 150-153 is mandatory, not
        optional, and must land in the SAME commit as the call-site change.
DO NOT: introduce a `try/finally` that records history for a failed attempt.
DO NOT: reset the accumulator, add StreamOutputAccumulator.reset, or otherwise
        try to "clean" the abandoned attempt — it is dropped with the generator.
DO NOT: leave a duplicated copy of _applyRetryTemperature behind.
```

---

## Numbered pseudocode

```
100: METHOD _runStreamAttempt(params, prompt_id, userContents, attempt)
101:   // ---- unchanged prologue -------------------------------------------
102:   IF attempt > 0
103:     // Discard signal for every downstream consumer. Emitted before the new
104:     // provider call so no replacement chunk can precede it.
105:     YIELD { type: StreamEventType.RETRY }
106:   SET hasYieldedChunk = false
107:   TRY
108:     // applyRetryTemperature now comes from turnAbortHelpers (line 150)
109:     SET currentParams = applyRetryTemperature(params, attempt)
110:     // Fresh attempt boundary: new provider stream, new accumulator, new
111:     // history closure. This is the whole basis of discard-and-restart.
112:     SET stream = AWAIT streamProcessor.makeApiCallAndProcessStream(
113:                    currentParams, prompt_id, userContents)
114:     FOR AWAIT chunk IN stream
115:       SET hasYieldedChunk = hasYieldedChunk OR chunk HAS a block that is
116:           (text with length > 0) OR thinking OR tool_call
117:       YIELD wrapChunk(chunk)
118:     RETURN { error: null, action: 'stop' }
119:   CATCH error
120:     // ---- unchanged hook-control branches ----------------------------
121:     IF error IS AgentExecutionStoppedError
122:       YIELD AGENT_EXECUTION_STOPPED event
123:       RETURN { error: null, action: 'stop' }
124:     IF error IS AgentExecutionBlockedError
125:       YIELD AGENT_EXECUTION_BLOCKED event
126:       IF error.blockedOutput EXISTS
127:         YIELD CHUNK event with error.blockedOutput
128:       RETURN { error: null, action: 'stop' }
129:     // ---- CHANGED: the post-output case is no longer excluded ---------
130:     IF shouldRetryStreamAttempt(error, params, attempt,
131:                                 { hasYieldedOutput: hasYieldedChunk })
132:       RETURN { error, action: 'retry' }
133:     RETURN { error, action: 'stop' }
134: END METHOD

140: // _createStreamGenerator is UNCHANGED. Recorded here because the restart
141: // semantics depend on it and a reviewer must be able to check them.
142: METHOD _createStreamGenerator(params, prompt_id, userContents, onDone)
143:   LOOP WHILE retrying AND attempt < INVALID_CONTENT_RETRY_OPTIONS.maxAttempts
144:     SET outcome = YIELD* _runStreamAttempt(params, prompt_id, userContents, attempt)
145:     IF outcome.action IS NOT 'retry' THEN stop looping
146:     ELSE AWAIT delay(initialDelayMs * (attempt + 1), params.config?.abortSignal)
147:          // delay() rejects on abort -> an abort during backoff wins and
148:          // propagates as an AbortError (REQ-3048-004)
149:          INCREMENT attempt
150: END METHOD

150: // ---- Relocation (mandatory, preflight F3) --------------------------
151: DELETE private method _applyRetryTemperature from TurnProcessor.ts
152: ADD    exported function applyRetryTemperature to turnAbortHelpers.ts
153:        (body copied verbatim; see pseudocode 001 lines 030-039)
154: IMPORT applyRetryTemperature alongside shouldRetryStreamAttempt
155: REPLACE the single call site (was `this._applyRetryTemperature(params, attempt)`)
156:        with `applyRetryTemperature(params, attempt)`
```

## Verification of the size budget after the edit

```
Before: TurnProcessor.ts = 797 effective lines
  - remove _applyRetryTemperature body + signature  ≈ -12
  + widen the shouldRetryStreamAttempt call         ≈ +1
  + import binding                                  ≈  0 (same import statement)
After:  ≈ 786 effective lines  (14 lines of headroom)
```

The implementer MUST confirm with
`npx eslint packages/agents/src/core/TurnProcessor.ts` (exit 0) rather than
trusting this estimate.
