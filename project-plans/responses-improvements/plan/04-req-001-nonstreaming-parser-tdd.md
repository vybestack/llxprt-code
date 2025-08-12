# 04 – REQ-001 Non-Streaming Responses Parser – TDD Phase

Goal
- Write behavioral tests that prove correct parsing of OpenAI /v1/responses non-streaming JSON per specification.md [REQ-001.1..REQ-001.4]. Tests must reference requirements and assert input → output behavior (no mock theater) per docs/RULES.md.

Target
- Module under test: packages/core/src/providers/openai/parseResponsesNonStreaming.ts (to be implemented in Phase 05)

Behavioral Tests (All must use @requirement tags)
1) Valid response object, single text message (REQ-001.1, REQ-001.2)
   /**
    * @requirement REQ-001.1
    * @scenario Parse basic non-streaming response with single text item
    * @given response.object == 'response' and output: [{type:'message', content:[{type:'text', text:'Hello'}]}]
    * @when parseResponsesNonStreaming(response)
    * @then emits [ { role:'assistant', content:'Hello' } ]
    */

2) Multiple text segments preserved in order (REQ-001.2)
   - Input: output: [message: content: [text:'A', text:'B']]
   - Expect: emits two assistant messages ['A','B'] in order

3) Function call mapping with call_id present (REQ-001.3)
   - Input: output: [{type:'function_call', name:'get_weather', call_id:'call_1', arguments:'{"city":"SF"}'}]
   - Expect: [{ role:'assistant', content:'', tool_calls:[{ id:'call_1', type:'function', function:{ name:'get_weather', arguments:'{"city":"SF"}'}}]}]

4) Function call mapping without call_id, fallback to item.id (REQ-001.3, EC2)

5) Interleaved message and function_call items preserve order (REQ-001.2, EC3)

6) Empty output but usage present → only usage message emitted (REQ-001.4, EC1)

7) Usage mapping appended as final message (REQ-001.4)
   - Input usage: { input_tokens:5, output_tokens:7, total_tokens:12 }
   - Expect final emitted message has usage: { prompt_tokens:5, completion_tokens:7, total_tokens:12 }

8) Unknown item types are ignored (forward compatibility) (EC unknown)

9) Robustness: Missing message.content or empty arrays (still no throw, no emissions) (EC)

10) Non-string text fields ignored safely (type-guard behavior) (EC)

Test Rules (docs/RULES.md)
- Pure input → output assertions (no internal calls/mocks)
- One behavior per test; explicit values, not structure-only checks
- Strict TypeScript in test typing; no any

File Plan
- test/providers/openai/parseResponsesNonStreaming.spec.ts
  - Import the function; construct typed payloads; assert emitted IMessage[] strictly equals expected

TODOLIST
- [ ] Add test file parseResponsesNonStreaming.spec.ts
- [ ] Implement 10 behavioral tests referencing REQ-001.x tags
- [ ] Ensure tests fail with NotYetImplemented
- [ ] Commit tests only (no impl)

References
- ../specification.md [REQ-001]
- ../analysis/pseudocode/001-parse-responses-non-streaming.md
- ../../docs/RULES.md