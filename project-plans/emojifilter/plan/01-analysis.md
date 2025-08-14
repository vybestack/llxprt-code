# Phase 1: Domain Analysis

## Worker Command
```bash
claude --dangerously-skip-permissions -p "
Read specification.md and create detailed domain analysis.
Focus on:
1. Entity relationships between filter, config, and existing components
2. State transitions for filtering process
3. Business rules for each mode
4. Edge cases with Unicode and chunks
5. Error scenarios and recovery

Output complete domain model to analysis/domain-model.md
"
```

## Expected Output
- Complete entity model
- State transition diagrams
- Business rule definitions
- Edge case catalog
- Error handling strategy

## Verification Checklist
- [ ] All REQ tags addressed
- [ ] No implementation details
- [ ] Complete edge case coverage
- [ ] Clear business rules
- [ ] Integration points identified