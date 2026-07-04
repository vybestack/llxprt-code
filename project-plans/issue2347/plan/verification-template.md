# Verification phases 03a/04a/05a/06a — common checklist

Each verification phase (typescriptreviewer for 03a/04a/05a; deepthinker for 06a holistic) MUST:

1. READ the actual implementation + tests (not just check existence).
2. Pseudocode compliance: every numbered line of the phase's pseudocode file is traceable in the code; report deviations.
3. Fraud detection:
   - grep tests for `toHaveBeenCalled|mockReturnValue.*expect.*same-value|toThrow('NotYetImplemented')|not\.toThrow\(\)` patterns → FAIL if found doing mock theater/reverse testing
   - grep src for `TODO|FIXME|HACK|STUB|for now|placeholder|in a real` → FAIL if found
   - empty impl check: would tests fail if implementation bodies were deleted? Spot-check by reasoning through 3 tests.
4. Additive-only gates:
   - `git diff --name-only` contains NO existing *.test.ts/*.spec.ts modifications (new files only)
   - No new @google/genai importer outside packages/providers/src/gemini/**
   - `npm run typecheck` and the touched workspace's tests pass
5. RULES.md compliance: no `any`, no type assertions, no eslint-disable/ts-ignore, immutability.
6. Property-based ratio ≥30% for the phase's new tests.
7. Write a Holistic Functionality Assessment (what was implemented, how it satisfies each REQ, one traced data path, risks, PASS/FAIL verdict).

FAIL → remediation subagent with the specific findings, then re-verify. Never proceed on FAIL.
