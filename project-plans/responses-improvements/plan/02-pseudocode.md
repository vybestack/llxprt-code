# 02 – Pseudocode Phase

Goal
- Produce detailed pseudocode for each component, strictly no TypeScript. Each item maps to REQs in specification.md and aligns with docs/RULES.md.

Inputs
- ../specification.md (REQ-001..REQ-010)
- ../analysis/domain-model.md

Outputs
- analysis/pseudocode/001-parse-responses-non-streaming.md
- analysis/pseudocode/002-usage-driven-accounting.md
- analysis/pseudocode/003-reasoning-toggle.md
- analysis/pseudocode/004-stateful-handling.md
- analysis/pseudocode/005-baseurl-override.md
- analysis/pseudocode/006-tool-limits-config.md

Process
- For each component, write function signatures (language-agnostic), algorithm steps, data transformations, and error handling. No implementation code.
- Ensure each pseudocode doc references the specific REQ-00X.x behaviors it covers.

Acceptance Criteria
- All components present and mapped to REQs
- No TypeScript or concrete code present
- Clear algorithms and error paths

TODOLIST
- [ ] 001: Non-streaming parser pseudocode (REQ-001.1..4)
- [ ] 002: Usage-driven accounting pseudocode (REQ-002.1..3)
- [ ] 003: Reasoning toggle pseudocode (REQ-003.1..3)
- [ ] 004: Stateful handling & trimming pseudocode (REQ-004.1..3)
- [ ] 005: Base URL override pseudocode (REQ-005.1..2)
- [ ] 006: Tool limits config pseudocode (REQ-006.1..2)

Verification
- See 02a-pseudocode-verification.md

References
- ../specification.md
- ../../docs/PLAN.md
- ../../docs/RULES.md
