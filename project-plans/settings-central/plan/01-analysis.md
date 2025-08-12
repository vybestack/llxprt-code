# Phase 1: Domain Analysis

## Objective

Analyze the settings domain to understand relationships, state transitions, and business rules.

## Worker Task

```bash
claude --dangerously-skip-permissions -p "
Read the specification at project-plans/settings-central/specification.md.
Analyze the settings domain and create a comprehensive domain model.

Create analysis/domain-model.md with:

1. Entity Relationships:
   - Settings Service → Repository (1:1)
   - Settings Service → Providers (1:N)
   - Settings Service → Event Emitter (1:1)
   - Provider → Settings Snapshot (1:1)

2. State Transitions:
   - Initial Load: File → Memory → Providers
   - Update: Validate → Memory → File → Events → Providers
   - Switch Provider: Validate → Update Active → Events → Reinitialize
   - Reset: Load Defaults → Memory → File → Events

3. Business Rules:
   - Settings must be valid per schema before persistence
   - Provider switch must update baseUrl and model atomically
   - Failed updates must not modify any state
   - Events must fire after successful persistence
   - Providers must not cache settings locally

4. Edge Cases:
   - Corrupt settings file → Load defaults
   - Missing provider config → Use defaults
   - Invalid API key → Allow save but mark invalid
   - Concurrent updates → Last write wins
   - File system errors → Retry with exponential backoff

5. Error Scenarios:
   - Validation failure → Return error, no state change
   - File write failure → Rollback memory, emit error event
   - Provider initialization failure → Keep old provider active
   - Event emission failure → Log but continue
   - Schema migration failure → Backup and reset

Do NOT write any implementation code, only analysis.
"
```

## Verification Checklist

- [ ] All entities and relationships documented
- [ ] State machine diagram included
- [ ] Business rules cover all requirements
- [ ] Edge cases address real scenarios
- [ ] Error handling strategy defined
- [ ] No implementation details included