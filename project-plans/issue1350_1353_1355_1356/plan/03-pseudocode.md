# Phase 03: Pseudocode Development

## Phase ID

`PLAN-20260211-SECURESTORE.P03`

## Prerequisites

- Required: Phase 02a completed
- Verification: `ls .completed/P02a.md`
- Expected files from previous phase: `analysis/domain-model.md`

## Requirements Implemented (Expanded)

This phase creates pseudocode for ALL implementation requirements. The pseudocode files are referenced by line number in all subsequent implementation phases.

## Implementation Tasks

### Files to Create

- `analysis/pseudocode/secure-store.md` — SecureStore class pseudocode
  - MUST include numbered lines for: constructor, keytar loading, availability probe, set/get/delete/list/has, fallback file read/write, error classification, helper functions
  - MUST include interface contracts, integration points, anti-pattern warnings
  - MUST include: `@plan:PLAN-20260211-SECURESTORE.P03`

- `analysis/pseudocode/provider-key-storage.md` — ProviderKeyStorage class pseudocode
  - MUST include numbered lines for: constructor, key name validation, saveKey/getKey/deleteKey/listKeys/hasKey, singleton
  - MUST include: `@plan:PLAN-20260211-SECURESTORE.P03`

- `analysis/pseudocode/key-commands.md` — /key command handler pseudocode
  - MUST include numbered lines for: main handler, save/load/show/list/delete subcommands, legacy path, autocomplete, secure input masking
  - MUST include: `@plan:PLAN-20260211-SECURESTORE.P03`

- `analysis/pseudocode/auth-key-name.md` — auth-key-name integration pseudocode
  - MUST include numbered lines for: bootstrap arg parsing, profile field recognition, precedence resolution, named key resolution, startup diagnostics
  - MUST include: `@plan:PLAN-20260211-SECURESTORE.P03`

### Pseudocode Requirements

Every pseudocode file MUST include:

1. **Interface Contracts** — inputs, outputs, dependencies
2. **Numbered Lines** — every line of algorithmic pseudocode numbered
3. **Integration Points** — where this component calls others
4. **Anti-Pattern Warnings** — what NOT to do
5. **Error Handling** — every error path defined
6. **Transaction Boundaries** — where atomicity is required

### Required Code Markers

```markdown
<!-- @plan PLAN-20260211-SECURESTORE.P03 -->
```

## Verification Commands

```bash
# Check all four pseudocode files exist
ls analysis/pseudocode/secure-store.md
ls analysis/pseudocode/provider-key-storage.md
ls analysis/pseudocode/key-commands.md
ls analysis/pseudocode/auth-key-name.md

# Check all files have numbered lines
for f in analysis/pseudocode/*.md; do
  COUNT=$(grep -cE "^[0-9]+:" "$f")
  echo "$f: $COUNT numbered lines"
done
# Expected: each file has 20+ numbered lines

# Check plan markers
grep -r "PLAN-20260211-SECURESTORE.P03" analysis/pseudocode/
# Expected: 4+ occurrences (one per file)

# Check interface contracts
for f in analysis/pseudocode/*.md; do
  grep -q "Interface Contract\|INPUTS\|OUTPUTS\|DEPENDENCIES" "$f" && echo "OK: $f has contracts" || echo "MISSING: $f lacks contracts"
done

# Check anti-pattern warnings
for f in analysis/pseudocode/*.md; do
  grep -q "Anti-Pattern\|ERROR.*DO NOT\|DO NOT:" "$f" && echo "OK: $f has warnings" || echo "MISSING: $f lacks warnings"
done

# Check no actual TypeScript implementation
for f in analysis/pseudocode/*.md; do
  grep -q "export class\|export function\|export interface" "$f" && echo "FAIL: $f contains implementation" || echo "OK: $f is pseudocode only"
done
```

## Structural Verification Checklist

- [ ] All four pseudocode files created
- [ ] Every file has numbered lines
- [ ] Plan markers present in all files
- [ ] No actual TypeScript implementation code
- [ ] Interface contracts in all files
- [ ] Anti-pattern warnings in all files

## Semantic Verification Checklist (MANDATORY)

1. **Does pseudocode cover all requirements?**
   - [ ] R1-R6 covered in secure-store.md
   - [ ] R7B, R8 covered in secure-store.md
   - [ ] R9-R11 covered in provider-key-storage.md
   - [ ] R12-R20 covered in key-commands.md
   - [ ] R21-R26 covered in auth-key-name.md

2. **Are all error paths defined?**
   - [ ] Error taxonomy mapping in secure-store.md
   - [ ] Input validation errors in provider-key-storage.md
   - [ ] User-facing error messages in key-commands.md
   - [ ] Named key resolution failures in auth-key-name.md

3. **Are integration points explicit?**
   - [ ] SecureStore → keytar adapter calls documented
   - [ ] ProviderKeyStorage → SecureStore calls documented
   - [ ] KeyCommand → ProviderKeyStorage calls documented
   - [ ] RuntimeSettings → ProviderKeyStorage calls documented

## Success Criteria

- All four pseudocode files created with 20+ numbered lines each
- Complete requirement coverage across all files
- No implementation code — only algorithmic pseudocode

## Failure Recovery

1. `rm -rf analysis/pseudocode/`
2. Re-run Phase 03

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P03.md`
