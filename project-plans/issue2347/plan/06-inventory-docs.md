# Phase 06: Import inventory + migration docs

Plan: PLAN-20260702-LLMTYPES.P06
Requirements: REQ-012

## Deliverables

NEW scripts/genai-import-inventory.ts
  - Bun/tsx-compatible TS script following the conventions of existing scripts/*.ts (see scripts/check-eslint-guard.ts style)
  - Uses `git ls-files 'packages/**/*.ts' 'packages/**/*.tsx'` + content grep for `@google/genai`
  - Emits deterministic sorted markdown table: file → owning issue (#2348/#2349/#2350/#2351/enclave)
  - Classification rules (path-prefix based):
    - packages/providers/src/gemini/** and packages/core/src/code_assist/** → enclave
    - packages/core/** → #2348
    - packages/agents/** → #2349
    - packages/cli/** → #2350
    - packages/tools/**, packages/mcp/**, packages/telemetry/**, packages/a2a-server/**, packages/test-utils/** → #2351
    - packages/providers/** (non-gemini) → #2349 (provider-layer shared files) — verify against actual files and adjust if a better owner exists
    - anything unmatched → exit 1 with the offending path listed
  - `--check` mode: regenerates and diffs against the checked-in baseline; non-zero exit on drift
NEW dev-docs/genai-import-baseline.md — generated output, checked in
NEW dev-docs/genai-migration.md:
  - The full symbol disposition table from issue #2347 (copy from the issue body)
  - Per-package migration guidance for #2348–#2351 exactly as the issue's Plan item 4 describes
  - The anti-regression rule: migration PRs may not introduce Google-shaped temporary neutral aliases
  - The enclave end-state and #2352 enforcement expectations
NEW scripts/tests/genai-import-inventory.test.ts — behavioral: run the script's classify function on
  fixture paths, assert classifications; assert unmatched path → error result. (Follow existing
  scripts/tests/*.test.ts conventions.)

## Notes

- Do NOT wire into CI in this PR (that ratchet is #2352); the script + baseline just land.
- package.json: add npm script "genai:inventory" only if trivially consistent with existing script entries; otherwise skip (avoid scope creep).

## Forbidden

- Modifying CI workflows
- Classification via per-file hardcoded lists (prefix rules only, so it stays maintainable)
