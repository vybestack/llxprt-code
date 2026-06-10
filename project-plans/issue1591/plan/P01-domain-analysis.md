# Phase P01: Domain Analysis

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Analysis
Prerequisites: P00 (preflight passed)

## Purpose

Analyze all source code that will be affected by the extraction. Map every import, every export, every type dependency. Fill the preflight results template with actual data.

## Expanded Requirements

- Complete the dependency audit for all policy and confirmation-bus source files
- Map all call paths from CLI → core → policy/confirmation-bus
- Identify exact files and line numbers for every import that will change
- Verify the domain model matches actual code
- Confirm the integration contract is accurate

## Exact File Tasks

| File | Action | Description |
|------|--------|-------------|
| `analysis/preflight-results-template.md` | FILL | Record all actual verification outputs |
| `analysis/dependency-audit.md` | VERIFY | Cross-reference against actual code; update if discrepancies found |
| `analysis/domain-model.md` | VERIFY | Cross-reference entity relationships against actual code |
| `analysis/integration-contract.md` | VERIFY | Cross-reference integration points against actual code |

## Verification Commands

```bash
# Verify all policy/confirmation-bus import sites
grep -rn "from.*confirmation-bus" packages/core/src --include='*.ts' | grep -v '.test.ts' | grep -v 'node_modules'
grep -rn "from.*policy/" packages/core/src --include='*.ts' | grep -v '.test.ts' | grep -v 'node_modules'
grep -rn "from.*@google/genai" packages/core/src/confirmation-bus --include='*.ts'
grep -rn "from.*@google/genai" packages/core/src/policy --include='*.ts'

# Verify CLI import sites
grep -rn "PolicyEngine\|PolicyDecision\|MessageBus\|createPolicyEngineConfig" packages/cli/src --include='*.ts'

# Count tool files importing MessageBus
grep -rl "MessageBus" packages/core/src/tools --include='*.ts' | wc -l
```

## Success Criteria

- [ ] Preflight results template fully filled with actual outputs
- [ ] All dependency/import sites mapped with exact file paths and line numbers
- [ ] Domain model verified against actual code structure
- [ ] Integration contract verified against actual call paths
- [ ] No discrepancies between plan documents and actual codebase
- [ ] Total count of files requiring import updates matches plan estimates (25+ tools, 5+ subagents, etc.)

## Failure Recovery

If analysis reveals discrepancies:
1. Document the discrepancy in the preflight results
2. Update the affected analysis artifact to match reality
3. If the discrepancy affects the overview/specification, update those too
4. Do NOT proceed to P02 until all analysis artifacts are consistent with actual code
