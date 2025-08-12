# 04a – REQ-001 Non-Streaming Parser – TDD Verification

Goal
- Verify behavioral tests in 04-req-001-nonstreaming-parser-tdd.md follow docs/RULES.md and cover all sub-requirements [REQ-001.1..REQ-001.4].

Inputs
- ../specification.md [REQ-001]
- 04-req-001-nonstreaming-parser-tdd.md (test plan)
- ../../docs/RULES.md

Verification Checks
- [Behavioral] Tests assert input → output values, not implementation details
- [Coverage] Each test block includes an @requirement tag referencing REQ-001.x
- [No Mock Theater] No toHaveBeenCalled/with; no mock-only assertions
- [No Structure Theater] No toHaveProperty-only or shape-only checks
- [Failure First] Tests must fail against NotYetImplemented stub
- [Count] ≥10 tests spanning message parsing, function_call mapping, usage emission, and edge cases

Procedure
1) Grep tests for forbidden patterns per docs/RULES.md
2) Ensure @requirement tags cover REQ-001.1..4
3) Run tests; ensure failing with NotYetImplemented
4) Confirm no external HTTP/network in tests

Acceptance Criteria
- PASS when all checks met
- FAIL with specific reasons otherwise

TODOLIST
- [ ] Check for forbidden patterns (mock theater, structure-only)
- [ ] Verify @requirement coverage of REQ-001.1..4
- [ ] Run tests and observe NotYetImplemented failures
- [ ] Mark TDD verification complete

References
- ../specification.md [REQ-001]
- ../../docs/RULES.md
