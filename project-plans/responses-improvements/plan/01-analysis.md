# 01 – Analysis Phase

Goal
- Derive a complete domain analysis from specification.md covering entities, states, transitions, business rules, edge cases, and error scenarios. No implementation details. Map each item explicitly to REQ-00X.

Inputs
- specification.md (REQ-001..REQ-010)
- docs/PLAN.md (process)
- docs/RULES.md (testing doctrine)

Outputs
- analysis/domain-model.md updated and validated:
  - Entities and relationships
  - State transitions for: endpoint selection, request build, streaming parse, non-streaming parse, cache update
  - Business rules BR1..BR9 mapped to REQ-00X
  - Edge cases EC1..EC8
  - Error scenarios ES1..ES3

Process (Worker Protocol)
- Read specification.md
- Enumerate behaviors for each REQ-00X
- Define state machines for streaming and non-streaming flows
- List edge cases per behavior (see EC1..EC8 patterns)
- Identify error scenarios and expected handling
- Update analysis/domain-model.md

Acceptance Criteria
- All REQ-001..REQ-010 have at least one mapped behavior (REQ-008)
- No implementation details or TypeScript
- Edge cases and errors are explicit
- Immutability and behavior-first principles present (docs/RULES.md)

TODOLIST
- [ ] Read specification.md and extract behaviors per REQ
- [ ] Validate mapping: REQs → BRs/ECs/ESs
- [ ] Confirm state diagrams cover streaming and non-streaming
- [ ] Validate no implementation instructions leaked
- [ ] Finalize analysis/domain-model.md

Verification
- See 01a-analysis-verification.md

References
- ../specification.md
- ../../docs/PLAN.md
- ../../docs/RULES.md
