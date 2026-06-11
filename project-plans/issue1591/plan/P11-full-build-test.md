# Phase P11: Full Build & Test Suite

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Verification
Prerequisites: P10d-V (source deletion verified)

## Purpose

Run the complete verification gate. All six mandatory commands must pass with no exceptions. Verify TOML loading from dist output with documented rule counts.

## Worker / Verifier Assignment

- **Worker**: typescriptreviewer (runs full verification gate)
- **Verifier**: deepthinker (confirms all criteria met)

## Expanded Requirements

- Run all 6 verification commands in sequence
- All must pass — no partial credit
- Document any warnings or deprecation notices
- Verify TOML loading from dist output with exact rule counts and priority values
- Run source+dist TOML load behavioral tests

## @plan / @requirement Marker Verification

This phase verifies that markers from all previous phases are present:

```bash
# Verify @plan markers exist across the codebase
rg "@plan.*PLAN-20260609-ISSUE1591" packages/policy/src --type ts --count
# Expected: markers in all production and test files

rg "@plan.*PLAN-20260609-ISSUE1591" packages/core/src --type ts --count
# Expected: markers in all modified core files

rg "@plan.*PLAN-20260609-ISSUE1591" packages/cli/src --type ts --count
# Expected: markers in modified CLI files
```

## Exact File Tasks

None (verification only).

## Verification Commands

### Final Verification Gate (Exactly 6 Commands — Mandatory)

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
```

ALL six must pass — no partial credit, no substitutions. TOML dist loading behavioral verification runs in the dedicated P11b phase after this review.

## Success Criteria

- [ ] `npm run test` — ALL tests pass (zero failures)
- [ ] `npm run lint` — zero lint errors
- [ ] `npm run typecheck` — zero type errors
- [ ] `npm run format` — zero formatting issues
- [ ] `npm run build` — builds successfully
- [ ] `node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"` — completes without error
- [ ] @plan markers present across all three packages
- [ ] No warnings or deprecation notices that weren't present before

## Failure Recovery

1. If any command fails — identify the specific failure
2. Determine if it's policy-related or pre-existing
3. If policy-related — fix the specific issue, re-run only the failed command first, then all 6
4. If pre-existing — verify with `gh` that same failure exists on main branch
5. Do NOT proceed to P11a until ALL 6 commands pass
