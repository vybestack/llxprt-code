# Risk Register

@plan:PLAN-20251027-STATELESS5.P01

| ID | Description | Requirement | Mitigation | Owner | Status |
|----|-------------|-------------|-----------|-------|--------|
| R1 | Runtime state misses Config call site causing regression | REQ-STAT5-001 | Exhaustive inventory + integration tests (P01/P11) | TBD | Open |
| R2 | Slash command relies on Config side effects | REQ-STAT5-002 | TDD coverage in P07, fallback logging | TBD | Open |
| R3 | GeminiChat accidentally retains Config reference | REQ-STAT5-004 | P09 tests + code review checklist | TBD | Open |
| R4 | Diagnostics UI diverges from runtime state | REQ-STAT5-005 | Integration tests + manual QA | TBD | Open |
| R5 | HistoryService lifecycle confusion | REQ-STAT5-005 | Address design question #5 in P01 | TBD | Open |

> Update mitigation status after each relevant phase.
