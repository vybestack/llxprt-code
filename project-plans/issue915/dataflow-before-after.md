# Issue #915 — End-to-End Dataflow: Before and After

**Companion**: [overview.md](./overview.md), [technical-overview.md](./technical-overview.md)

This document traces a concrete multi-tool conversation through the actual codebase — what touches what, in what order, with what data.

---

## The Scenario

```
user: "hi let's go edit a bunch of files by..."

ai: [thinking: user wants me to edit files, first I'll...]
    [tool_call: read_file(foo.ts)]

[tool executes, returns file content]

ai: [thinking: that's interesting, maybe I'll...]
    [tool_call: replace(foo.ts, ...)]
    [tool_call: replace(bar.ts, ...)]
    [tool_call: replace(baz.ts, ...)]

[3 tools execute, 3 responses come back]

ai: [thinking: so now I did the things, let me tell the user]
    "so I did bla bla bla bla"
```

This is 3 round-trips to the provider:
1. User message → AI thinks + calls `read_file`
2. Tool result → AI thinks + calls 3x `replace`
3. Tool results → AI thinks + responds with text (turn ends)

---

## TODAY: How It Works Now

### Round-trip 1: User message → single tool call

#### Step 1 — User types, CLI submits

```
CLI: useGeminiStream.submitQuery("hi let's go edit...")
  → geminiChat.generateContentStream(params)
```

**File**: `packages/cli/src/ui/hooks/useGeminiStream.ts`

#### Step 2 — GeminiChat assembles transcript and sends to provider

```
geminiChat.generateContentStream():
  1. normalizeToolInteractionInput(message)        → Content {role:'user', parts:[{text:'hi...'}]}
  2. ContentConverters.toIContent(content)          → IContent {speaker:'human', blocks:[{type:'text',...}]}
  3. historyService.getCuratedForProvider([userIContent], {strictToolAdjacency})
     ↓
     This is THE critical call. It takes:
       input:  stored history (IContent[]) + tail user message
       output: provider-safe IContent[] transcript
     
     Internally runs 4 repair passes:
       a) splitToolCallsOutOfToolMessages()     — fix corrupted speaker roles
       b) ensureToolCallContinuity()            — synthesize missing tool_calls for orphan responses
       c) ensureToolResponseCompleteness()      — synthesize "cancelled" responses for orphan calls
       d) ensureToolResponseAdjacency()         — destructive reconstruct: strip all tool_responses,
                                                   re-insert adjacent to their tool_calls, dedup by scoring
       e) deepCloneWithoutCircularRefs()        — serialization safety
     
     On first message, history is empty so repair passes are no-ops.
  
  4. provider.generateChatCompletion({contents: iContents, tools, ...})
```

**Files**: `packages/core/src/core/geminiChat.ts` (line ~768), `packages/core/src/services/history/HistoryService.ts` (line ~1065)

#### Step 3 — Provider translates to wire format and sends HTTP request

```
e.g. OpenAIProvider.generateChatCompletion():
  1. buildMessagesWithReasoning(iContents)
     → converts each IContent to OpenAI message format
     → normalizeToOpenAIToolId(hist_tool_*) → call_*
     → tool_call blocks → {role:'assistant', tool_calls:[...]}
     → tool_response blocks → {role:'tool', tool_call_id:'call_*', content:'...'}
  2. Sends HTTP POST to api.openai.com/v1/chat/completions
```

**Files**: `packages/core/src/providers/openai/OpenAIProvider.ts`, `packages/core/src/providers/utils/toolIdNormalization.ts`

For Anthropic, this would be:
```
AnthropicProvider:
  1. Converts IContent → Anthropic messages
     → tool_call blocks → {role:'assistant', content:[{type:'tool_use', id:'toolu_*', ...}]}
     → tool_response blocks → {role:'user', content:[{type:'tool_result', tool_use_id:'toolu_*', ...}]}
  2. ALSO runs its own parallel repair pass (adjacency, orphan synthesis, dedup)
  3. Sends HTTP POST to api.anthropic.com/v1/messages
```

**File**: `packages/core/src/providers/anthropic/AnthropicProvider.ts`

#### Step 4 — Stream comes back, response is accumulated

```
geminiChat.processStreamResponse():
  1. Iterates over stream chunks, yields each to UI immediately
  2. Accumulates modelResponseParts[] — collects thinking parts + functionCall parts
  3. At stream end: consolidates parts, validates response
  4. Calls recordHistory(userInput, modelOutput)
```

**File**: `packages/core/src/core/geminiChat.ts` (line ~2234)

#### Step 5 — History gets written (user input + AI response with tool call)

```
geminiChat.recordHistory():
  1. Converts userInput (Content) → IContent via ContentConverters.toIContent()
  2. Converts modelOutput (Content[]) → IContent, attaching thinking blocks
  3. Calls historyService.add() for each entry
  
After this, history contains:
  [0] IContent {speaker:'human', blocks:[{type:'text', text:'hi let\'s go edit...'}]}
  [1] IContent {speaker:'ai', blocks:[
        {type:'thinking', thought:'user wants me to edit files...'},
        {type:'tool_call', id:'hist_tool_1', name:'read_file', parameters:{path:'foo.ts'}}
      ]}
```

**File**: `packages/core/src/core/geminiChat.ts` (line ~2450)

> **KEY POINT**: Tool call ID `hist_tool_1` is generated by `historyService.getIdGeneratorCallback()` during `ContentConverters.toIContent()`. This is the canonical ID that will be translated to provider format on every future send.

#### Step 6 — UI receives tool call, scheduler executes it

```
useGeminiStream: stream chunk contains functionCall part
  → scheduleToolCalls(toolCalls) → CoreToolScheduler.schedule()
  
CoreToolScheduler:
  1. Creates ToolCall entry: {callId:'hist_tool_1', name:'read_file', status:'scheduled'}
  2. Runs policy check (auto-approve / ask user / deny)
  3. Executes tool: read_file({path:'foo.ts'})
  4. Tool returns result
  5. Sets status → 'success', stores response.responseParts
  6. All calls terminal → fires onAllToolCallsComplete([completedCall])
```

**File**: `packages/core/src/core/coreToolScheduler.ts` (line ~383+)

#### Step 7 — Completed tools sent back as continuation

```
useGeminiStream.handleCompletedTools():
  1. Filters: keeps only functionResponse parts (functionCall parts already in history from step 5)
  2. Calls submitQuery(responseParts, {isContinuation: true})
  → loops back to Step 2, but now message is tool response parts
```

**File**: `packages/cli/src/ui/hooks/useGeminiStream.ts` (line ~1373)

---

### Round-trip 2: Tool result → three tool calls

#### Step 2 again — GeminiChat assembles transcript

```
geminiChat.generateContentStream():
  normalizeToolInteractionInput(functionResponseParts)
    → Content {role:'user', parts:[{functionResponse:{name:'read_file', response:{...}}}]}
  
  historyService.getCuratedForProvider([toolResultIContent], {strictToolAdjacency})
    ↓
    input history now contains:
      [0] human: "hi let's go edit..."
      [1] ai: [thinking] + [tool_call(hist_tool_1)]
    
    tail content:
      [2] tool: [tool_response(hist_tool_1)]   ← not yet in history, passed as tail
    
    Repair passes run:
      a) splitToolCallsOutOfToolMessages → no-op (tool message has no tool_call blocks)
      b) ensureToolCallContinuity → checks: tool_response(hist_tool_1) has matching tool_call? YES → no-op
      c) ensureToolResponseCompleteness → checks: tool_call(hist_tool_1) has response? YES → no-op
      d) ensureToolResponseAdjacency → reorders: tool_response(hist_tool_1) placed after tool_call(hist_tool_1) [OK]
      e) deepClone
    
    Output: clean [human, ai(tool_call), tool(tool_response)] → sent to provider
```

#### Steps 3-5 — Provider sends, stream returns, history written

```
After recordHistory, history is now:
  [0] human: "hi let's go edit..."
  [1] ai: [thinking] + [tool_call(hist_tool_1)]
  [2] tool: [tool_response(hist_tool_1)]        ← from tool result send
  [3] ai: [thinking] + [tool_call(hist_tool_2), tool_call(hist_tool_3), tool_call(hist_tool_4)]
```

#### Steps 6-7 — Three tools execute, results sent back

```
CoreToolScheduler.schedule([3 tool calls]):
  creates 3 entries: hist_tool_2, hist_tool_3, hist_tool_4
  executes all 3 (possibly parallel with buffered ordering)
  all 3 complete → onAllToolCallsComplete fires

handleCompletedTools:
  filters to functionResponse parts only
  submitQuery([3 functionResponse parts], {isContinuation: true})
```

---

### Round-trip 3: Tool results → final text response

#### Step 2 again — transcript assembly

```
historyService.getCuratedForProvider([3 tool results as tail]):
  input history:
    [0] human: "hi let's go edit..."
    [1] ai: [thinking] + [tool_call(hist_tool_1)]
    [2] tool: [tool_response(hist_tool_1)]
    [3] ai: [thinking] + [tool_call(hist_tool_2, hist_tool_3, hist_tool_4)]
  
  tail:
    [4] tool: [tool_response(hist_tool_2), tool_response(hist_tool_3), tool_response(hist_tool_4)]
  
  Repair passes:
    b) ensureToolCallContinuity → all responses have matching calls [OK]
    c) ensureToolResponseCompleteness → all calls have responses [OK]
    d) ensureToolResponseAdjacency → reorders responses adjacent to calls [OK]
    e) deepClone
  
  Output: valid 5-entry transcript → sent to provider
```

#### Steps 3-5 — Provider sends, AI responds with text

```
Stream returns: [thinking] + "so I did bla bla bla"
recordHistory writes:
  [4] tool: [tool_response(hist_tool_2, hist_tool_3, hist_tool_4)]
  [5] ai: [thinking] + [text: "so I did bla bla bla"]

No tool calls → turn ends. No more continuations.
```

---

### Final history state (IContent[]):

```
[0] human: "hi let's go edit a bunch of files by..."
[1] ai:    [thinking: user wants me to...] [tool_call: hist_tool_1 read_file]
[2] tool:  [tool_response: hist_tool_1 → file content]
[3] ai:    [thinking: interesting...] [tool_call: hist_tool_2 replace] [tool_call: hist_tool_3 replace] [tool_call: hist_tool_4 replace]
[4] tool:  [tool_response: hist_tool_2] [tool_response: hist_tool_3] [tool_response: hist_tool_4]
[5] ai:    [thinking: so now I did...] [text: "so I did bla bla bla"]
```

---

## WHERE IT BREAKS TODAY

Now the user switches provider — say from OpenAI to Anthropic — and sends the next message.

```
historyService.getCuratedForProvider([new user message], {strictToolAdjacency: true})
```

The 4 repair passes must infer tool interaction validity from the IContent blocks:
- Are all tool_calls paired with tool_responses? (scan blocks, match IDs)
- Are responses adjacent to their calls? (reorder/reconstruct)
- Any duplicates? (score and pick best)
- Any orphans? (synthesize)

**This inference-from-blocks approach can fail when:**

1. **Cancellation corrupted the blocks** — user cancelled mid-tool-execution, scheduler wrote partial state, functionCall and functionResponse ended up in wrong speaker roles or same message.

2. **Compression removed one side** — summarization dropped an old tool_response but kept the tool_call (or vice versa), creating an orphan that repair must synthesize.

3. **Streaming snapshot** — history was captured mid-stream while tools were still executing, creating tool_calls without responses that aren't actually cancelled.

4. **Duplicate tool results** — same callId appears in multiple tool messages (replay artifact, adapter-level retry), and the scoring heuristic picks the wrong one or both survive.

The repair passes work *most of the time*, but they're inferring what should be known.

---

## AFTER #915: How It Will Work

The fundamental change: **tool interaction lifecycle becomes authoritative state, not inference from blocks.**

### What changes

#### New: Tool Interaction Ledger

A canonical store keyed by `callId` that tracks lifecycle truth:

```
ledger[hist_tool_1] = { status: 'complete', toolName: 'read_file', hasRealResult: true }
ledger[hist_tool_2] = { status: 'complete', toolName: 'replace',   hasRealResult: true }
ledger[hist_tool_3] = { status: 'complete', toolName: 'replace',   hasRealResult: true }
ledger[hist_tool_4] = { status: 'complete', toolName: 'replace',   hasRealResult: true }
```

**Who writes to it:** `CoreToolScheduler` — at schedule time, at execution time, at completion/cancellation/error time. Single writer, idempotent by callId.

#### New: Transcript Builder (replaces inference-based repair)

A pure function that reads from `{history, ledger, providerConstraints}` and produces a protocol-valid `IContent[]`:

```
buildProviderTranscript(history, ledger, {strictToolAdjacency: true})
```

Instead of *inferring* whether tool_call(hist_tool_2) has a response by scanning forward through IContent blocks, it *looks up* `ledger[hist_tool_2].status === 'complete'` and knows.

### Same scenario, after #915

#### Round-trip 1 (unchanged except ledger writes)

Steps 1-5 are identical. The only addition:

```
Step 6 — CoreToolScheduler executes tool:
  BEFORE: just tracks status internally in toolCalls[] array
  AFTER:  also writes to ledger:
    ledger.record('hist_tool_1', { status: 'scheduled', toolName: 'read_file', args: {...} })
    ... tool executes ...
    ledger.record('hist_tool_1', { status: 'complete', result: {...} })
```

Step 7 — `handleCompletedTools` sends continuation (unchanged).

#### Round-trip 2 (unchanged except ledger writes)

Same. Scheduler writes 3 entries to ledger as tools execute.

#### Round-trip 3 (unchanged)

Same. AI responds with text, turn ends.

#### Where it changes: next turn after provider switch

User switches to Anthropic. Sends next message.

```
BEFORE (today):
  historyService.getCuratedForProvider([newMessage], {strictToolAdjacency: true})
    → runs 4 repair passes, infers validity from blocks
    → usually works, but fragile under corruption/compression/cancellation

AFTER (#915):
  transcriptBuilder.build(history, ledger, {strictToolAdjacency: true})
    → for each tool_call block in history:
        look up ledger[callId] → knows status authoritatively
    → for each tool_response block in history:
        look up ledger[callId] → confirms it's the canonical completion
    → no inference needed: ledger IS the truth
    → pairing, adjacency, dedup, synthetic closures all driven by ledger state
    → produces clean IContent[] → handed to Anthropic provider adapter
    → adapter converts hist_tool_* → toolu_*, builds wire messages
    → HTTP request succeeds
```

### The cancellation case (where today breaks, after #915 doesn't)

Say in round-trip 2, user cancels after tool 2 completes but before tools 3 and 4 finish:

```
BEFORE (today):
  CoreToolScheduler.cancelAll():
    - tool 2: already complete, response exists
    - tools 3,4: cancelled, synthetic "cancelled" responseParts created
    - handleCompletedTools: writes functionCall+functionResponse parts to history
    
  But: the parts can end up in wrong speaker roles, or with the functionCall
  embedded in the same message as functionResponse (known corruption pattern).
  
  Next turn: getCuratedForProvider repair passes try to fix this:
    - splitToolCallsOutOfToolMessages catches some
    - ensureToolResponseCompleteness catches some
    - but edge cases slip through → 400 on strict provider

AFTER (#915):
  CoreToolScheduler.cancelAll():
    - same execution, but ALSO writes to ledger:
      ledger[hist_tool_2] = { status: 'complete', hasRealResult: true }
      ledger[hist_tool_3] = { status: 'cancellation/interruption-complete' }
      ledger[hist_tool_4] = { status: 'cancellation/interruption-complete' }
    
  History blocks may still have corruption artifacts — doesn't matter.
  
  Next turn: transcriptBuilder.build(history, ledger, ...)
    - Reads ledger: knows tool 3 and 4 were cancelled
    - Emits synthetic tool_responses for 3 and 4 (per closure policy)
    - Doesn't need to infer from blocks — ledger is authoritative
    - Provider gets clean transcript → no 400
```

### The compression case

Say compression summarized old history and dropped tool_response for hist_tool_1:

```
BEFORE:
  History after compression:
    [0] ai: [summary of earlier conversation]
    [1] ai: [tool_call(hist_tool_2, hist_tool_3, hist_tool_4)]  ← tool_call(hist_tool_1) was in compressed region
    [2] tool: [tool_response(hist_tool_2, hist_tool_3, hist_tool_4)]
    
  But wait — what about hist_tool_1? Its tool_response was also in the compressed region.
  ensureToolCallContinuity won't even see it (the call was compressed away).
  This is fine IF both sides were removed. But if only one side survived → orphan → 400.
  
  Today's repair passes try to catch this, but compression doesn't guarantee atomicity.

AFTER:
  Compression can remove blocks freely — the ledger still knows:
    ledger[hist_tool_1] = { status: 'complete' }
    
  TranscriptBuilder: if hist_tool_1 blocks are absent from history, it's simply
  not included in the rendered transcript. No orphan possible because the ledger
  doesn't emit a call without its result (or vice versa) — it emits complete pairs
  or nothing.
```

---

## Summary: What Actually Changes

| Aspect | Today | After #915 |
|--------|-------|------------|
| **Source of tool lifecycle truth** | Inferred from `IContent[]` blocks at render time | Authoritative `ToolInteractionLedger` keyed by callId |
| **Who writes tool state** | Multiple ad-hoc paths (recordHistory, handleCompletedTools, cancelAll, compression) | Single writer: `CoreToolScheduler` → ledger (idempotent by callId) |
| **Transcript assembly** | `getCuratedForProvider()` with 4 inference-based repair passes | `TranscriptBuilder.build()` reading from ledger + history (repair passes become validation/fallback) |
| **Provider switching** | Repair passes must successfully infer validity from potentially-corrupted blocks | Ledger state is authoritative regardless of block-level artifacts |
| **Cancellation handling** | responseParts written to history with potential speaker-role corruption | Ledger records terminal state; transcript builder emits correct synthetic completions |
| **Compression safety** | Must not separate call/result pairs — but no enforcement | Ledger preserves lifecycle truth independent of block presence in history |
| **Steps that change in the flow** | Step 3 (transcript assembly), Step 6 (scheduler writes ledger) | Everything else — provider translation, streaming, UI — unchanged |
