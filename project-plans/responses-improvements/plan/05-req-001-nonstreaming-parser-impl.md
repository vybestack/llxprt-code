# 05 – REQ-001 Non-Streaming Responses Parser – Implementation Phase

Goal
- Implement parseResponsesNonStreaming to satisfy behavioral tests from Phase 04, following analysis and pseudocode.

Inputs
- ../specification.md [REQ-001.1..REQ-001.4]
- ../analysis/pseudocode/001-parse-responses-non-streaming.md
- test/providers/openai/parseResponsesNonStreaming.spec.ts (from Phase 04)
- ../../docs/RULES.md

Implementation Rules
- Do NOT modify tests
- Implement exactly as specified by pseudocode (pure, immutable, no side effects)
- Strict TypeScript (no any, no assertions). Explicit return types.
- No console logs or TODOs

High-Level Steps (Behavioral)
1) Validate response.object === 'response' [REQ-001.1]
2) Walk output[] in order; for message items, emit assistant text messages [REQ-001.2]
3) For function_call items, emit assistant message with tool_calls[] [REQ-001.3]
4) If usage exists, emit final assistant message with mapped usage [REQ-001.4]
5) Edge-handling: fallback to item.id for missing call_id; ignore unknown types [EC2]

TODOLIST
- [ ] Implement packages/core/src/providers/openai/parseResponsesNonStreaming.ts per pseudocode
- [ ] Ensure function signature: (responseJson: unknown) => IMessage[]
- [ ] Run tests: npm test parseResponsesNonStreaming
- [ ] Refactor only if tests remain green

References
- ../specification.md [REQ-001]
- ../analysis/pseudocode/001-parse-responses-non-streaming.md
- ../../docs/PLAN.md, ../../docs/RULES.md
