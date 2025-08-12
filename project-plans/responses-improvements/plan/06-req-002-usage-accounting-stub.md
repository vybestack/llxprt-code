# 06 – REQ-002 Usage-Driven Accounting (Streaming) – Stub Phase

Goal
- Create minimal compile-only stubs for usage-driven accounting adapter that wraps the streaming iterator and ensures a usage-bearing message is emitted when server usage is present.

Scope
- New module (adapter): packages/core/src/providers/openai/streamUsageAccounting.ts
- Exported API: wrapWithUsageAccounting(streamIterator, conversationId, parentId, promptMessages): AsyncIterable<IMessage>
- No logic beyond throwing NotYetImplemented

Worker Instructions
- Create TypeScript file with strict types and the exported function signature
- The function body should immediately throw new Error('NotYetImplemented')
- No side effects, no console logs, no TODO comments

Acceptance Criteria
- TypeScript compiles with the new file present
- Public signature matches the pseudocode contract (analysis/pseudocode/002-usage-driven-accounting.md)

TODOLIST
- [ ] Create streamUsageAccounting.ts with exported wrapWithUsageAccounting
- [ ] Ensure strict typing, no any or assertions
- [ ] Confirm compilation under tsconfig strict settings

References
- specification.md → [REQ-002]
- analysis/pseudocode/002-usage-driven-accounting.md
- docs/RULES.md