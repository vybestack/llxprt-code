# 01a – Analysis Verification

Goal
- Verify analysis/domain-model.md completely and correctly maps requirements to behaviors without leaking implementation details.

Inputs
- ../specification.md (REQ-001..REQ-010)
- ../analysis/domain-model.md
- ../../docs/PLAN.md
- ../../docs/RULES.md

Verification Checks
- [REQ Coverage] Every REQ-00X must be referenced by at least one BR/EC/ES mapping
- [No Implementation] File must not contain code, TypeScript, or function implementations
- [States] Both streaming and non-streaming state transitions described
- [Edge/Error] All EC1..EC8 and ES1..ES3 (or supersets) present and traceable to REQs
- [Immutability] Notes emphasize behavior-first, immutable patterns (per docs/RULES.md)

Procedure
1) Grep for TypeScript code patterns (e.g., backticks with ts, import/export, function parentheses)
2) Scan for REQ-00X tags and count coverage
3) Validate that each BR/EC/ES is connected back to one or more REQ-00X
4) Confirm no external HTTP assumptions in analysis

Acceptance Criteria
- FAIL if any REQ has no mapped BR/EC/ES
- FAIL if code/implementation instructions are present
- PASS otherwise

TODOLIST
- [ ] Check REQ tag coverage in analysis/domain-model.md
- [ ] Confirm no code/TS snippets present
- [ ] Validate state transitions completeness
- [ ] Validate edge and error scenarios mapped to REQs
- [ ] Mark PH01 complete
