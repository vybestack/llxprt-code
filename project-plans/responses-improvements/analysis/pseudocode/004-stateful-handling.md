# Pseudocode: Stateful Handling & Trimming (REQ-004)

Note: Pseudocode only. No TypeScript. Maps to REQ-004.1..REQ-004.3.

Function: buildStateAwareRequest(messages, previousResponseId, config)
Inputs:
- messages: IMessage[] | undefined
- previousResponseId: string | undefined
- config: { allowHistoryWithPreviousId?: boolean }
Outputs:
- object // Partial request fields to merge into Responses request

Algorithm:
1) if previousResponseId is undefined:
   - return { input: transform(messages) } // upstream handles transform
2) if previousResponseId is defined:
   - base = { previous_response_id: previousResponseId, store: true }
   - if messages is undefined or messages.length == 0 → return base  [REQ-004.1]
   - if config.allowHistoryWithPreviousId is not true →
       return base  // omit history when relying on server state [REQ-004.1]
   - else (history allowed):
       - slice = lastCompleteTurn(messages)  [REQ-004.2]
       - return { ...base, input: transform(slice) }

Helper: lastCompleteTurn(messages)
- Walk from end to start to find a user→assistant(tool_calls?)→tool outputs→user boundary
- Ensure that if tool outputs exist, the paired assistant tool_calls exist earlier in the slice
- Return slice starting at that boundary to the end

Constraints/Guards:
- Do not include unsupported fields (no arbitrary stateful flag) [REQ-004.3]
- If slice is inconsistent (partial tool pair), drop history and return empty array with base

Mapping:
- REQ-004.1: previous_response_id implies server-held state; history optional
- REQ-004.2: If history sent, must be last complete turn only
- REQ-004.3: Do not send unsupported request fields
