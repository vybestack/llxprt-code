# 06a – REQ-002 Usage-Driven Accounting – Stub Verification

Goal
- Verify the stub created in 06-req-002-usage-accounting-stub.md contains no logic, compiles, and exports the correct API.

Inputs
- ../specification.md [REQ-002.1..REQ-002.3]
- ../analysis/pseudocode/002-usage-driven-accounting.md
- Source: packages/core/src/providers/openai/streamUsageAccounting.ts
- ../../docs/RULES.md

Verification Checks
- [Signature] wrapWithUsageAccounting(streamIterator, conversationId, parentId, promptMessages) exported
- [Stub Only] Function throws new Error('NotYetImplemented')
- [Strict TS] No any, no type assertions; compile under strict
- [No Side Effects] No console logs or global state

Procedure
1) Grep file for logic beyond NotYetImplemented (loops/ifs)
2) Run TypeScript compile
3) Check exports are used or intentionally exported

Acceptance Criteria
- PASS if all checks succeed
- FAIL otherwise

TODOLIST
- [ ] Grep stub for non-stub logic
- [ ] Compile project (tsc -p tsconfig.json)
- [ ] Confirm export signature matches pseudocode
- [ ] Mark Phase 06 verified

References
- ../specification.md
- ../../docs/PLAN.md
- ../../docs/RULES.md