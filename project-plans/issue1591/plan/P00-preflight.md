# Phase P00: Preflight Verification

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Verification
Prerequisites: None

## Purpose

Verify ALL assumptions before writing any production code. Confirm that the repository state matches the plan's expectations and that no blockers exist.

## Expanded Requirements

- Verify all source files referenced by the plan exist at their expected paths
- Verify all types/interfaces match the plan's descriptions
- Confirm `packages/settings` does NOT exist (and document this as a constraint)
- Confirm build/test/lint/typecheck all pass on the current codebase
- Confirm no unexpected imports exist in policy/confirmation-bus source files
- Run the smoke test to establish a green baseline

## Exact File Tasks

None (verification only — no production code changes).

## Verification Commands

```bash
# 1. Dependency verification
npm ls @iarna/toml --workspace @vybestack/llxprt-code-core
npm ls zod --workspace @vybestack/llxprt-code-core
npm ls @google/genai --workspace @vybestack/llxprt-code-core
npm ls vitest --workspace @vybestack/llxprt-code-core
npm ls fast-check --workspace @vybestack/llxprt-code-core

# 2. Verify packages/settings does NOT exist
ls -d packages/settings 2>&1 | grep -q "No such file" && echo "PASS: packages/settings does not exist" || echo "FAIL: packages/settings exists — plan must be updated"

# 3. Verify key source files exist
ls packages/core/src/policy/types.ts
ls packages/core/src/policy/policy-engine.ts
ls packages/core/src/policy/stable-stringify.ts
ls packages/core/src/policy/utils.ts
ls packages/core/src/policy/toml-loader.ts
ls packages/core/src/policy/config.ts
ls packages/core/src/policy/policy-helpers.ts
ls packages/core/src/policy/policies/read-only.toml
ls packages/core/src/confirmation-bus/types.ts
ls packages/core/src/confirmation-bus/message-bus.ts
ls packages/core/src/tools/tool-confirmation-types.ts

# 4. Verify forbidden imports in current policy/confirmation-bus (baseline)
grep -rn "from.*@google/genai" packages/core/src/confirmation-bus/ --include='*.ts' | head -5
grep -rn "from.*scheduler/types" packages/core/src/confirmation-bus/ --include='*.ts' | head -5
grep -rn "from.*tool-confirmation-types" packages/core/src/confirmation-bus/ --include='*.ts' | head -5

# 5. Full verification gate (must all pass)
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
```

## Success Criteria

- [ ] All dependency checks return expected results
- [ ] `packages/settings` confirmed non-existent (documented as constraint)
- [ ] All 11 key source files exist at expected paths
- [ ] Current policy/confirmation-bus imports match plan assumptions
- [ ] All 6 verification gate commands pass (test, lint, typecheck, format, build, smoke)
- [ ] Preflight results recorded in `analysis/preflight-results-template.md`

## Failure Recovery

If preflight fails:
1. Identify which specific check failed
2. If a source file is missing or at a different path — update the plan to match reality
3. If verification gate commands fail — fix the existing codebase first (do NOT proceed with extraction on a broken baseline)
4. Use `git diff` to check for uncommitted changes that might affect results
5. Targeted revert: `git checkout -- <specific-file>` only if needed to restore clean baseline
