<!-- @plan:PLAN-20260617-COREAPI.P02 @requirement:REQ-006 -->
# Pseudocode: tool/confirmation merge + respondToConfirmation(correlationId)

Plan ID: PLAN-20260617-COREAPI
Phase: P02 (finalized)
Component: `packages/agents/src/api/control/toolControl.ts`
Requirements: REQ-006 (tools/scheduler/confirmation, correlationId, dual consumer paths)

---

## Interface Contracts

```typescript
// INPUTS:
interface ConfirmRequestInput { correlationId: string; callId: string; name: string; details: ToolConfirmationDetails }
interface RespondInput { confirmationId: string; decision: ToolDecision }   // approve|deny|modify

// OUTPUTS:
//   onConfirmationRequest callback fires with ToolConfirmation
//   respondToConfirmation publishes TOOL_CONFIRMATION_RESPONSE on MessageBus
//   onToolUpdate fires with ToolUpdate

// DEPENDENCIES (real):
interface Dependencies {
  messageBus: MessageBus                          // publish/subscribe
  loopEvents: AsyncIterable<AgenticLoopEvent>     // tool status/output SOURCE — the SAME loop-event stream
                                                   // event-adapter.md consumes (kinds tool_update / tool_output
                                                   // / tools_complete). The Agent facade does NOT own a stable
                                                   // CoreToolScheduler (AgenticLoop creates its OWN transient
                                                   // per-turn scheduler internally and emits status through this stream).
  confirmationCoordinator: ConfirmationCoordinator// routes by correlationId -> callId
  projectConfirmation, projectToolUpdate: pure projectors
}
```

## Integration Points

```
Line 20: messageBus.subscribe(TOOL_CONFIRMATION_REQUEST) - coordinator-driven (interactive path)
Line 40: loopEvents tool_update/tool_output/tools_complete - status/output -> ToolUpdate (SAME stream event-adapter consumes)
Line 87: messageBus.publish(TOOL_CONFIRMATION_RESPONSE)  - keyed by correlationId
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT key responses on tool name        [OK] key on correlationId/confirmationId
[ERROR] DO NOT expose two response paths as one  [OK] interactive (coordinator) vs raw a2a (stream) are distinct
[ERROR] DO NOT leak raw scheduler status union   [OK] project to public ToolUpdate status enum
[ERROR] DO NOT allow >1 response per confirmation [OK] dedup; new correlationId on editor-modify
[ERROR] DO NOT subscribe to a status-update method on the scheduler [OK] no such method exists; tool status/output flows
      — CoreToolScheduler has NO                 through the AgenticLoopEvent stream (tool_update / tool_output /
      subscription method named                  tools_complete), the SAME stream event-adapter.md consumes. The Agent
      a status-update subscription                 facade does NOT own a stable scheduler (AgenticLoop creates its own
      => ZERO matches); the loop owns            per-turn scheduler internally). Where a directly-owned scheduler IS used,
      a transient per-turn scheduler             source status ONLY from the REAL callback handlers set through
      internally and emits status via            CoreToolSchedulerOptions / setCallbacks (onToolCallsUpdate /
      the AgenticLoopEvent stream                outputUpdateHandler / onAllToolCallsComplete) — never a phantom
                                            status-update subscription that does not exist.
[ERROR] DO NOT pass a model to switchActiveProvider [OK] model is applied via setActiveModel + initializeContentGeneratorConfig
```

## Numbered Pseudocode

```
10: METHOD attachConfirmationListeners(emit)
11:   seen = new Set()                                     # dedup by confirmationId
12:
20:   messageBus.subscribe(TOOL_CONFIRMATION_REQUEST, (msg) =>
21:     confirmation = projectConfirmation({
22:       confirmationId: msg.correlationId,               # response key
23:       toolCallId: msg.callId,                          # UI grouping key
24:       name: msg.name,
25:       details: msg.details })
26:     IF confirmation.confirmationId IN seen
27:       RETURN                                           # dedup
28:     seen.add(confirmation.confirmationId)
29:     emit({ type: 'tool-confirmation', confirmation })  # stream event
30:     fireOnConfirmationRequest(confirmation)            # callback path
31:   )
32:
40:   # tool status/output SOURCE: the AgenticLoopEvent STREAM (the SAME stream event-adapter.md
41:   # consumes). The Agent facade does NOT own a stable CoreToolScheduler — AgenticLoop creates its
42:   # OWN transient per-turn scheduler internally (AgenticLoop.ts getOrCreateScheduler) and surfaces
43:   # status/output via kinds tool_update (:455) / tool_output (:444) / tools_complete (:357).
44:   # There is NO status-update subscription method on CoreToolScheduler (grep packages/
45:   # => ZERO matches for any such handler). Where a directly-owned
46:   # scheduler IS genuinely used, source status ONLY from the REAL callback handlers
47:   # set through CoreToolSchedulerOptions / setCallbacks (onToolCallsUpdate /
48:   # outputUpdateHandler / onAllToolCallsComplete — coreToolScheduler.ts:89-91,185-191).
49:   FOR AWAIT ev IN loopEvents
50:     SWITCH ev.kind
51:       CASE 'tool_update':                     # ev.toolCalls: ToolCall[]
52:         FOR tc IN ev.toolCalls
53:           update = projectToolUpdate(tc)       # raw status union -> public enum
54:           fireOnToolUpdate(update)
55:           emit({ type: 'tool-status', update })
56:       CASE 'tool_output':                     # ev.callId + ev.chunk — incremental output
57:         update = projectToolOutput(ev.callId, ev.chunk)
58:         fireOnToolUpdate(update)
59:         emit({ type: 'tool-status', update })
60:       CASE 'tools_complete':                  # ev.completed: CompletedToolCall[]
61:         FOR ct IN ev.completed
62:           update = projectToolUpdate(ct)       # surface each completed tool result as a ToolUpdate
63:           fireOnToolUpdate(update)
64:           emit({ type: 'tool-status', update })
65:     END SWITCH
66:   END FOR
67: END METHOD
68:
80: METHOD respondToConfirmation(confirmationId, decision)
81:   IF confirmationId NOT IN seen
82:     THROW ToolControlError('unknown confirmationId: ' + confirmationId)
83:   payload = mapDecision(decision)                       # approve|deny|modify -> outcome
84:   IF decision == 'modify'
85:     # editor-modify produces a NEW correlationId via coordinator; old one is retired
86:     seen.delete(confirmationId)
87:   messageBus.publish({ type: TOOL_CONFIRMATION_RESPONSE,
88:                        correlationId: confirmationId,   # coordinator routes by this
89:                        outcome: payload })
90:   RETURN
91: END METHOD
92:
100: # B7 — no-handler / handler-rejection behavior is OWNED BY AgenticLoop, NOT here.
101: # The public Agent.chat()/stream() delegate to AgenticLoop.run(); this control
102: # surface NEVER throws on the high-level path. Verified AgenticLoop semantics
103: # (AgenticLoop.ts:29-32, :237-247) the facade RELIES ON:
104: #   - no approvalHandler + ASK_USER (non-interactive) -> SAFE TOOL DENIAL
105: #     (denied tool-result returned to model; loop proceeds) — NOT a throw
106: #   - approvalHandler rejection -> ToolConfirmationOutcome.Cancel (denial)
107: # The confirmation-coordinator throw (confirmation-coordinator.ts:320-325,
108: # !isInteractive()) applies ONLY to the RAW coordinator path reached via the
109: # documented power-user `internals` subpath — never the default Agent surface.
```

## Notes for impl phase
- Lines 23-24 keep `confirmationId`(correlationId) and `toolCallId` distinct (R-CORR).
- Lines 84-86 handle ModifyWithEditor re-confirmation with a new correlationId.
- **D1 (pinned):** tool status/output is sourced from the `AgenticLoopEvent` STREAM
  (kinds tool_update / tool_output / tools_complete — the SAME stream event-adapter.md
  consumes). The Agent facade does NOT own a stable `CoreToolScheduler`;
  `AgenticLoop` creates its OWN transient per-turn scheduler internally and emits
  status through this stream. There is NO status-update subscription method on
  CoreToolScheduler (grep packages/ => ZERO matches for any such handler). Where a
  directly-owned scheduler IS genuinely used, source status ONLY from the REAL callback handlers set through
  `CoreToolSchedulerOptions` / `setCallbacks` (`onToolCallsUpdate` /
  `outputUpdateHandler` / `onAllToolCallsComplete` — coreToolScheduler.ts:89-91,185-191).
- **B7:** No-handler/handler-rejection is delegated to `AgenticLoop` (safe denial),
  so this control surface does NOT implement a throw fallback. The high-level path
  yields a denied `tool-result`, never throws. The coordinator throw is scoped to the
  raw `internals` path only. Impl phase (P17) wires `onApproval` → loop's
  `approvalHandler` and asserts safe-denial (T3/T11/T21) — see lines 100-109.
- The raw a2a path (T2b) consumes `ToolCallConfirmation` via the unmerged stream and is
  NOT routed through this coordinator path.
