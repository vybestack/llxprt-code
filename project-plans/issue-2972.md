# Issue #2972 — Issue Planner: title metacharacters + double-fire on labeled creation

Closes #2972. Contributes to #2702 (CI execution optimization). Distinct from #2960.

## Problem

Two independent defects in `.github/workflows/issue-planner.yml`:

1. **Defect 1 — title interpolated into a `gh search` query unescaped.** The
   "Precompute related PRs/issues candidates" step builds
   `search_query="\"${issue_title}\""` from the raw issue title. Titles with
   `:`, `(`, `)`, `,`, or `"` produce invalid GitHub search syntax and, because
   the step runs under `set -euo pipefail`, a single failed search aborts the
   whole planner run. The repo's own title convention (`Title (#NNN)`) trips
   this. Example failure (issue #2970): trailing `(#2578)` + colon + comma
   produced `Invalid search query … The search query contains invalid syntax`.
2. **Defect 2 — double-fire on labeled issue creation.** `issues: [opened,
   edited, reopened, labeled]` means creating an issue with a label emits both
   `opened` and `labeled`. The job-level concurrency block uses
   `cancel-in-progress: false`, so both runs complete → two planner runs per
   creation, both failing because of Defect 1. Observed: 3 issues → 6 runs.

## Acceptance criteria (from the issue)

- [ ] A title containing a colon, a comma, and a trailing parenthetical
      reference yields a successful planner run (no invalid-query abort).
- [ ] The precompute step cannot fail the workflow; search failure degrades to
      empty candidates.
- [ ] The issue title is never string-interpolated into a search query.
- [ ] Creating an issue with a label produces exactly one planner run.
- [ ] A concurrency block keyed on issue number is present (cancel-in-progress
      collapses duplicates).
- [ ] Existing planner behavior for well-formed titles is unchanged.

## Design

### Defect 1 — keyword extraction in the TS helper + best-effort step

Move query construction out of bash into a pure, unit-tested function in
`.github/scripts/issue-planner.ts` so the untrusted title is never
string-interpolated into shell/search syntax.

New exported pure function `buildRelatedSearchQuery(title: string): string`:
- Strip all `#NNN` issue references (trailing `(#NNN)` and inline).
- Split on every non `[A-Za-z0-9_]` run (this removes `: , ( ) " \` | & …` and
  whitespace in one pass).
- Keep tokens of length >= 2; de-duplicate case-insensitively; cap at 10.
- Return a space-joined string (`""` when nothing usable remains).

New CLI mode `--build-search-query <dir>`: reads `planner/issue.json`, runs
`buildRelatedSearchQuery` on `title`, writes `planner/search-query.txt`.

Rewrite the "Precompute related PRs/issues candidates" workflow step to:
- Run `bun .github/scripts/issue-planner.ts --build-search-query planner`.
- Read `search_query` from `planner/search-query.txt` (never the raw title).
- Pre-create `related-prs.json` / `related-issues.json` as `[]`.
- If the query is non-empty, run each `gh search … | jq …` inside
  `if ! …; then echo "::warning::…"; printf '[]' > …; fi` so a search failure
  degrades to empty candidates instead of aborting (`set -euo pipefail` stays,
  because `if !` is exempt from `set -e`).
- Keep `--merged` (not the invalid `--state merged`), `--repo "${REPO}"`, and
  the self-exclusion `select(.number != $issue_number)`.

### Defect 2 — cancel duplicate triggers

Flip the job `concurrency.cancel-in-progress` from `false` to `true`. The group
stays keyed on `github.event.issue.number`. The opened+labeled pair then
collapses to a single run (the newest cancels the earlier in-flight run). This
is safe because `reconcilePlanComment` is idempotent — the surviving run
converges the issue to exactly one marker comment. The `labeled` trigger is
kept so adding a label still re-plans (existing behavior preserved); only the
duplicate run is eliminated.

## Test plan (test-first, per dev-docs/RULES.md)

Target file: `scripts/tests/issue-planner.test.ts` (existing conventions: pure
function unit tests + CLI entrypoint tests + textual/structural assertions on
the workflow YAML step scripts).

1. **`buildRelatedSearchQuery` unit tests** (new describe block, pure function):
   - Title `'Remove all Vitest escape hatches: scripts, configs, deps, lint plugin, and CI guard (#2578)'`
     → contains `Remove`, `Vitest`; contains none of `:`, `,`, `(`, `)`, `#`,
     `2578`, `"`.
   - Inline + trailing `#NNN` both removed.
   - Quotes/backslashes/parens removed.
   - De-dup case-insensitive; keyword cap at 10.
   - Non-string / empty / all-metacharacter input → `''`.
2. **`--build-search-query` CLI test** (real entrypoint, temp dir): write
   `issue.json` with a metacharacter title, run the CLI, assert
   `search-query.txt` is clean (no metacharacters, no `#NNN`).
3. **Workflow YAML tests** (`.github/workflows/issue-planner.yml` describe):
   - Update `filters self and confines title search to the current repository`:
     drop the `search_query="\"${issue_title}\""` assertion (that is the bug);
     keep `--repo "${REPO}"`, `select(.number != $issue_number)`,
     `--argjson issue_number "${ISSUE_NUMBER}"`.
   - New test: precompute step is best-effort — no `${issue_title}`
     interpolation, uses `--build-search-query`, reads `search-query.txt`,
     emits `::warning::`, wraps searches with `if ! gh search`.
   - New test: concurrency `cancel-in-progress: true` present (extend
     `asYamlJob`/`YamlJob` to parse `cancel-in-progress`).
   - Keep the `--merged` / not `--state merged` regression guard unchanged.

## Out of scope

- Defect 2 trigger narrowing/dropping of `labeled` (optional per the issue; not
  required by acceptance criteria; would change existing behavior).
- #2960 (filesystem confinement false-positives) — separate issue.
