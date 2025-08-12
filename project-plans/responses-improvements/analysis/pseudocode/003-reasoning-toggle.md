# Pseudocode: Reasoning Rendering Toggle (REQ-003)

Note: Pseudocode only. No TypeScript. Maps to REQ-003.1..REQ-003.3.

Function: renderReasoningDeltaIfEnabled(deltaText, config, model)
Inputs:
- deltaText: string // streaming text chunk possibly containing reasoning JSON
- config: { showReasoningThinking?: boolean; reasoningAllowedModels?: string[] }
- model: string
Outputs:
- Array<IMessage> // zero or more assistant messages to emit

Algorithm:
1) If config.showReasoningThinking is not true → return [] [REQ-003.1]
2) If model not in (config.reasoningAllowedModels || []) → return [] [REQ-003.3]
3) If deltaText does not look like JSON object/array → return []
4) Try parse json = JSON.parse(deltaText)
   a) If json has keys { reasoning, next_speaker }:
      - messages = []
      - messages.push({ role: assistant, content: "🤔 Thinking: " + json.reasoning + "\n\n" })
      - if json.answer or json.response present:
        - messages.push({ role: assistant, content: formatArrayResponse(json.answer || json.response) })
      - return messages [REQ-003.3]
   b) else return []
5) Catch parse error → return [] [REQ-003.2]

Notes:
- formatArrayResponse follows existing array→string logic in streaming parser (see analysis mapping).
- No accumulation here; caller manages accumulation windows.
- Never attempt reasoning parsing when toggle is false. [REQ-003.2]
