# Plan — #2984: Make advisory enrichment steps non-fatal (umbrella close-out)

## Goal

Close the umbrella issue #2984 ("make the Issue Planner workflow reliable")
by satisfying its last open acceptance criterion:

> Optional enrichment failures cannot fail the run.

Both enumerated child defects are already closed (#2960 confinement symlinks,
#2972 search-query interpolation / concurrency). The remaining gap is that two
advisory-enrichment helper invocations run **unguarded** under
`set -euo pipefail`, so a failure in either aborts the whole run — contradicting
the umbrella's theme #2 ("Optional context gathering should degrade to empty,
not abort").

## Root cause

`.github/workflows/issue-planner.yml`:

1. Step **"Extract linked references and fetch linked issues"** runs
   `bun .github/scripts/issue-planner.ts --extract-linked-references …`
   unguarded. If the helper throws (e.g. malformed `issue.json`), `set -e`
   aborts the job. (The *linked-issue fetch loop* below it is already
   `if !`-guarded, but the helper call itself is not.)

2. Step **"Extract /plan feedback"** runs
   `bun .github/scripts/issue-planner.ts --extract-feedback` unguarded.
   Same abort risk.

Both are advisory: linked references and `/plan` feedback are optional context.
The downstream consumers already tolerate empty output (`mapfile` reads nothing
from an empty `linked-references.txt`; `--render-context` treats empty/missing
`feedback.txt` as `null`).

## Fix (mirrors the #2972 related-candidate pattern)

Wrap each helper call in an `if ! … then ::warning:: ; printf '' > <file>` guard
so a failure degrades to empty output with a visible `::warning::`, exactly like
the existing `--build-search-query` / `gh search` guards.

### Essential steps stay fatal (do NOT guard)

`Gather issue metadata`, `Validate required repository variables`,
`Render planner context/instructions`, `Confine filesystem`, and
`Run planner agent` are essential — they are not advisory enrichment and must
remain able to fail the run (the visible-failure contract depends on it).

## Files

| File | Change |
|------|--------|
| `.github/workflows/issue-planner.yml` | Guard the two enrichment helper calls |
| `scripts/tests/issue-planner-enrichment.bun.test.ts` | **NEW** bun-native workflow-structure assertions |
| `scripts/bun-test-manifest.ts` | Register the new bun test file |

No script (`issue-planner.ts`) changes — the script throws appropriately; the
workflow catches and degrades.

## Tests (test-first, bun-native, TS — no vitest/node/js)

`issue-planner-enrichment.bun.test.ts` (uses `parseWorkflowYaml` /
`workflowJob` / `findStep` / `asString` from `typed-test-helpers.ts`):

1. **`--extract-linked-references` is guarded** — the step script matches
   `/if\s+!\s+bun[\s\S]*?--extract-linked-references/`, contains `::warning::`,
   and contains the empty fallback `printf '' > planner/linked-references.txt`.
2. **`--extract-feedback` is guarded** — matches
   `/if\s+!\s+bun[\s\S]*?--extract-feedback/`, contains `::warning::`, and
   contains `printf '' > planner/feedback.txt`.
3. **#2972 regression** — the related-candidate step still guards
   `--build-search-query` and `gh search prs` (not weakened).
4. **Essential steps stay fatal** — `Gather issue metadata` and
   `Render planner context and instructions` contain neither `|| true` nor
   `2>/dev/null` (enrichment hardening did not over-weaken essential steps).

The regex form (`if ! bun … <mode>`) fails on the old unguarded code and passes
on the guarded code, so it is a true regression guard.

## Verification

- `bun test scripts/tests/issue-planner-enrichment.bun.test.ts` (new test)
- `npx vitest run --config ./scripts/tests/vitest.config.ts scripts/tests/issue-planner.test.ts` (existing planner tests still pass)
- `npx tsc --project tsconfig.scripts.json`
- `npx eslint .github/workflows/issue-planner.yml scripts/tests/issue-planner-enrichment.bun.test.ts scripts/bun-test-manifest.ts --max-warnings 0`
- `npx prettier --check` on all touched files
- Workflow YAML lint passes (actionlint / yamllint via CI)

## Out of scope

- Any change to `issue-planner.ts` logic.
- Model/provider/prompt quality.
- Making the plan blocking.
