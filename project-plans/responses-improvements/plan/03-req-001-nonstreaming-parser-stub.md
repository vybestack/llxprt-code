# 03 – REQ-001 Non-Streaming Responses Parser – Stub Phase

Goal
- Create a minimal compile-only skeleton for the non-streaming /v1/responses parser per specification.md [REQ-001.1..REQ-001.4]. No logic beyond throwing NotYetImplemented.

Scope
- New file: packages/core/src/providers/openai/parseResponsesNonStreaming.ts
- Exported API: parseResponsesNonStreaming(responseJson: unknown): IMessage[]
- Integrate placeholder import into OpenAIProvider.ts (to be wired in later phases; do not modify provider now)

Worker Instructions
- Create TypeScript file with strict types and exact function signature (return type IMessage[])
- Do not implement logic; every path throws new Error('NotYetImplemented')
- Add minimal types mirroring the simplified shape in specification.md under an internal type alias to satisfy compile-time contracts
- No console logs, no side effects, no TODO comments

Acceptance Criteria
- TypeScript compiles with new file present
- Function signature matches pseudocode contract
- No production logic in the file

TODOLIST
- [ ] Create parseResponsesNonStreaming.ts with public function parseResponsesNonStreaming
- [ ] Export function from an index barrel if required by project conventions (skip if not applicable)
- [ ] Ensure file compiles under tsconfig strict settings
- [ ] Prepare for TDD phase by confirming import path from OpenAIProvider.ts

References
- specification.md → [REQ-001]
- analysis/pseudocode/001-parse-responses-non-streaming.md
- docs/RULES.md (strict TS, no any, no side effects)
