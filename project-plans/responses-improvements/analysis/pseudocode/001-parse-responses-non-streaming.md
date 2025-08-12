# Pseudocode: Non-Streaming Responses Parser (REQ-001)

Note: Pseudocode only. No TypeScript. Maps to REQ-001.1..REQ-001.4. Follow docs/RULES.md (pure functions, strict types, behavior-first).

Function: parseResponsesNonStreaming(responseJson)
Inputs:
- responseJson: object // OpenAI /v1/responses non-streaming JSON (see specification)
Outputs:
- IMessage[] // ordered assistant messages and tool_calls; final message may carry usage

Algorithm:
1. Validate shape
   - if responseJson.object != 'response' → throw Error('Invalid responses payload') [REQ-001.1]
2. Initialize result = []
3. If responseJson.output is array:
   - For each item in responseJson.output in order:
     a) if item.type == 'message':
        - Extract all text parts in item.content where part.type == 'text'
        - For each text segment in order:
          - push({ role: assistant, content: segment }) [REQ-001.2]
     b) if item.type == 'function_call':
        - id = item.call_id || item.id // fallback if call_id missing [Edge: EC2]
        - name = item.name || ''
        - args = item.arguments || ''
        - push({ role: assistant, content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: args } }] }) [REQ-001.3]
     c) else: ignore unknown type (future-proof) // do not throw
4. If responseJson.usage exists:
   - Map usage = { prompt_tokens: input_tokens||0, completion_tokens: output_tokens||0, total_tokens: total_tokens||0 }
   - If result is empty → push({ role: assistant, content: '', usage })
     else → push({ role: assistant, content: '', usage })  // ensure emitted [REQ-001.4]
5. Return result

Error Handling:
- Missing output: return only usage message if present [EC1]
- Unknown item shapes: skip

Immutability:
- Do not mutate responseJson; construct new IMessage objects

Complexity:
- O(n) over output items and content parts

Mapping:
- REQ-001.1: Validate and parse response object, not chat/completions
- REQ-001.2: Collect text into ordered IMessage chunks
- REQ-001.3: Map function_call items into tool_calls
- REQ-001.4: Emit final usage-bearing message if usage present
