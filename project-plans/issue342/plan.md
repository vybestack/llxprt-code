# Issue #342 — Skip heavy CI jobs on docs-only changes

## Current state (verified against `main`)

`.github/workflows/ci.yml` already contains a change-detection job:

- `doc_change_filter` (line ~50): runs after `skip_check`, queries
  `repos/{owner}/{repo}/pulls/{n}/files` via `gh api`, and emits
  `outputs.docs_only`. It emits `false` for non-PR events (push,
  `merge_group`, `workflow_dispatch`), `false` when the API returns no files,
  and `false` as soon as any changed path is not documentation.

Consumers that already honour it:

| Workflow | Job | Gated? |
| --- | --- | --- |
| `ci.yml` | `test_shard` | yes |
| `ci.yml` | `secure_store_backend` | yes |
| `ci.yml` | `post_coverage_comment` | yes (via `needs`) |
| `e2e.yml` | `e2e_linux`, `e2e_macos` | yes (own `e2e_doc_change_filter`) |

## Gap this issue closes

The issue asks for `test`, `e2e` **and packaging** to be gated. `test` and
`e2e` are done; the build/packaging/smoke tier is not. On a docs-only PR the
following jobs still install dependencies, build, pack and run:

1. `bun_install_smoke` — full `bun install` + workspace link verification
2. `bun_native_modules_smoke` — `npm ci` + native module smoke harness
3. `node_consumer_smoke` — `npm pack` + install of the packed tarball
   (this is literally the packaging job)
4. `bun_test_orchestrator_smoke` — `bun install` + orchestrator run
5. `bun_native_test_parity` — `bun install` + manifest resolution
6. `acp_conformance` — `bun install` + `npm run build` + acplint run
   (20-minute cap)

None of these can observe a `.md` edit.

## How the classifier works (sound allowlist)

The docs-only decision is extracted from inline workflow bash into a committed,
testable TypeScript script: **`scripts/docs-only-filter.ts`**. It follows the
exact conventions of `scripts/affected-test-shards.ts` /
`scripts/affected-lint-targets.ts` (CLI flags, `--output github-actions`
writing to `GITHUB_OUTPUT`, a `GITHUB_STEP_SUMMARY` note, exported pure
functions for testing).

A change set is docs-only ONLY IF every touched path is documentation. The
classifier is a conservative **allowlist** — anything not explicitly
documentation is CODE (fail closed toward *more* CI):

- **CODE** (checked BEFORE any extension rule, because these are paths that the
  shard selector routes to shards or a full run — see the invariant below):
  `packages/`, `scripts/`, `integration-tests/`, `evals/`, `test-setup/`,
  `test-scripts/`, `shell-scripts/`, `eslint-rules/`, `schemas/`, `profiles/`,
  `.github/`, `.husky/`, `bundle/`.
- **DOCS**: `docs/`, `dev-docs/`, `project-plans/`, `research/`, plus root-level
  (no `/`) `README*`, `CHANGELOG*`, `CONTRIBUTING*`, `CODE_OF_CONDUCT*`,
  `SECURITY*`, `ROADMAP*`, `AGENTS.md`, and root-level
  `*.md|*.mdx|*.rst|*.txt|*.adoc`.
- **Everything else → CODE** (fail closed).

This fixes the review-found fail-open: the prior inline rule treated ANY
`*.md|*.mdx|*.rst|*.txt|*.adoc` outside `integration-tests/` as docs, so a PR
editing only `packages/core/src/prompt-config/defaults/core.md` (a RUNTIME
PROMPT INPUT embedded into the built prompt manifest) was reported
`docs_only=true`, skipped every heavy job, and greened the required `Test`
check with zero testing.

**Cross-classifier invariant (MUST hold):** every path `docs-only-filter`
calls DOCS must be a no-shard path for `scripts/affected-test-shards.ts`. The
CODE prefixes above are exactly the package/source/infra roots that the shard
selector routes to shards or a full run; being stricter than the selector is
safe, being looser is a bug. A test imports the real selector and asserts this.

### Rename handling

GitHub returns `status` and `previous_filename` for renamed entries. The
workflow fetches structured JSON entries (`gh api --paginate --jq '.[]'`) and
passes them to the script. For a renamed entry, BOTH `filename` AND
`previous_filename` must classify as docs; otherwise the change set is CODE.
This also closes the "rename `.gitignore` to `something.md`" bypass (a rename
away from `.gitignore` has no patch for the old path, so it fails closed to
CODE).

### `.gitignore` carve-out

`.gitignore` counts as docs ONLY when its patch touches nothing but
`docs/reference` ignore lines (an `!docs/reference/` un-ignore line or a
`# ...docs/reference` comment line); otherwise CODE. No patch available → CODE.
This preserves the exact patch-inspection rule the workflow used before.

### GitHub API guards

- **File-count ceiling:** the workflow fetches the PR's authoritative
  `changed_files` count (`gh api repos/{repo}/pulls/{n} --jq '.changed_files'`)
  and passes it to the script. If the returned entry count does not equal
  `changed_files` (the files endpoint caps at 3000 even with `--paginate`), or
  either value is unavailable, the script emits `docs_only=false` (fail closed)
  with a reason in the step summary.
- **Detector failure must not wedge PRs:** every `gh api` call uses `|| true`,
  and the script always exits 0 (any internal/API failure resolves to
  `docs_only=false`, i.e. run full CI). This matches the existing empty-file-list
  branch and the `|| true` already used in `e2e.yml`, so an API blip can no
  longer skip all six heavy jobs and wedge the `Lint`/`Test` aggregators.

## Acceptance criteria

### AC1 — the six heavy jobs are skipped on docs-only PRs

Each of `bun_install_smoke`, `bun_native_modules_smoke`,
`node_consumer_smoke`, `bun_test_orchestrator_smoke`,
`bun_native_test_parity` and `acp_conformance`:

- lists `doc_change_filter` in `needs`
- declares the exact `if` condition
  `${{ needs.doc_change_filter.outputs.docs_only != 'true' && needs.skip_check.outputs.should_skip != 'true' }}`
  (asserted as the full normalized string, not a substring, in tests)
- does NOT add `always()`/`!cancelled()` — it keeps the plain `needs` + `if`
  shape it shares with the pre-existing `test_shard`/`secure_store_backend`
  gates

### AC2 — cheap jobs keep running on docs-only PRs

`skip_check`, `doc_change_filter`, `shard_selector`, `lint_github_actions`,
`lint_javascript`, `lint_shell`, `lint_yaml` and `codeql` must **not** gain a
`docs_only` gate. Documentation is still linted (prettier, `lint:doc-links`,
`lint:doc-placement`) and workflow YAML is still actionlint'ed.

### AC3 — the `Test` required check stays honest (no unconditional early return)

`test` is the required aggregator. There is intentionally **NO unconditional
docs-only early return**. Instead:

- `test` gains `doc_change_filter` in `needs` and reads `docs_only`.
- `shard_selector` is an independent, stricter classifier than
  `doc_change_filter`; requiring it to succeed (and, when it reports tests,
  requiring the selected shards to succeed) means a misclassification by
  `doc_change_filter` fails closed instead of greening the required check.
- The `shard_selector` result check, the `has_tests` logic, and the `test_shard`
  result check are UNCHANGED.
- The `node_consumer_smoke` check accepts `skipped` when `docs_only == 'true'`
  (otherwise must be `success`).
- The `acp_conformance` check accepts `skipped` when `docs_only == 'true'`
  (otherwise must be `success`).

Result: green on a genuine docs-only PR (selector success + `has_tests=false` +
both docs-only-skippable jobs `skipped`); red whenever the selector, any
selected shard, or any non-skipped required job fails — even if
`doc_change_filter` wrongly said docs-only.

### AC4 — the `Lint` required check stays honest

`lint` is a required aggregator. It:

- runs with `if: ${{ always() }}`
- explicitly fails when any of `lint_github_actions`, `lint_javascript`,
  `lint_shell`, `lint_yaml` is not `success`
- requires `node_consumer_smoke == 'success'` **unless** `docs_only == 'true'`,
  in which case a `skipped` node consumer smoke is accepted (same exemption
  shape the `test` aggregator uses)
- stays green by design when `skip_check` reported a duplicate run

### AC5 — non-PR events are unaffected

`push` to `main`/`release/**`, `merge_group` and `workflow_dispatch` produce
`docs_only=false` (emitted directly by the detect step before the script runs),
so every job above runs exactly as it does today.

### AC6 — the classifier is sound and tested

`scripts/docs-only-filter.ts` exports pure functions (`classifyPath`,
`gitignoreIsDocs`, `classifyEntry`, `classifyDocsOnly`) covered by behavioral
tests in `scripts/tests/docs-only-filter.bun.test.ts`, including the exact
regression guard (`packages/core/src/prompt-config/defaults/core.md` → CODE),
rename handling, `.gitignore` carve-out, API truncation, and the
cross-classifier invariant against the real shard selector.

## Boundary cases

| Input | Expected |
| --- | --- |
| genuine docs-only PR (selector success, `has_tests=false`) | six heavy jobs skipped; `Lint` + `Test` green |
| `docs_only == 'false'` | unchanged full CI |
| `docs_only == ''` (filter skipped/failed) | `!= 'true'` → heavy jobs run (fail-open toward *more* CI) |
| `docs_only == 'true'` but selector reports tests + `test_shard` skipped | **red** — selector still gates |
| `docs_only == 'true'` but `node_consumer_smoke=failure` | **red** — exemption only accepts `skipped` |
| `packages/core/src/prompt-config/defaults/core.md` only | `docs_only=false` → full CI (the fail-open fix) |
| rename `packages/.../foo.ts` → `docs/foo.md` | `docs_only=false` → full CI |
| rename `.gitignore` → `docs/notes.md` | `docs_only=false` → full CI |
| API truncation (entry count ≠ `changed_files`) | `docs_only=false` → full CI |
| `gh api` blip / empty file list | `docs_only=false`, job succeeds → full CI (never wedges) |
| `should_skip == 'true'` | everything skipped; `Lint` + `Test` green by design |
| shell metacharacters in a `needs.*.result` value | aggregators must not evaluate them (positional-parameter substitution) |

## Tests (behavioral, `bun:test`)

New file `scripts/tests/docs-only-filter.bun.test.ts` — tests the EXPORTED
classifier functions against realistic structured file entries:

- pure docs change (`docs/`, `README.md`, `dev-docs/`, `project-plans/`) → true
- `packages/core/src/prompt-config/defaults/core.md` alone → **false**
  (regression guard, named to be obvious)
- `packages/core/src/core/legacy-model-limits.expected.txt` → false
- `packages/cli/src/providers/README.md` → false
- `.github/pull_request_template.md` → false
- `integration-tests/TESTING_STRATEGY.md` → false
- mixed docs + one `.ts` → false; unknown path → false
- rename `packages/core/src/foo.ts` → `docs/foo.md` → false
- rename `docs/a.md` → `docs/b.md` → true
- rename `.gitignore` → `docs/notes.md` → false
- `.gitignore` docs/reference-only patch → true; other patch → false; no patch → false
- entry count < `changed_files` (truncation) → false; zero entries → false
- path-classification unit cases (docs prefixes, root docs, all CODE prefixes)
- cross-classifier invariant: every DOCS path selects no shards via the REAL
  `selectAffectedShards`

New file `scripts/tests/ci-docs-only-skip.bun.test.ts`:

**Static workflow wiring (parse `ci.yml`)**

1. each heavy job `needs` `doc_change_filter`
2. each heavy job's normalized `if` EQUALS the shared exact condition (full
   string, not a substring)
3. cheap jobs have **no** `docs_only` gate
4. `doc_change_filter` invokes `scripts/docs-only-filter.ts`
5. `doc_change_filter` emits `docs_only=false` on non-PR events
6. `lint` declares `if: always()`

**Executable aggregator behaviour (run the real `run:` bash with substituted
`needs` values, following the existing `runTestAggregate` harness)**

7. `Test` aggregator: docs-only + selector success + `has_tests=false` +
   `node_consumer_smoke=skipped` + `acp=skipped` → exit 0
8. `Test` aggregator: docs-only + `has_tests=true` + `test_shard=skipped` →
   exit 1 (selector still gates)
9. `Test` aggregator: docs-only + `node_consumer_smoke=failure` → exit 1
   (exemption only accepts `skipped`)
10. `Test` aggregator: code PR with `node_consumer_smoke=failure` → exit 1
11. `Test` aggregator: code PR with `acp_conformance=failure` → exit 1
12. `Test` aggregator: code PR with `test_shard=skipped`, `has_tests=true` →
    exit 1
13. `Test` aggregator: shell-injection sentinel in a result value is not
    evaluated
14. `Lint` aggregator: all linters `success`, `node_consumer_smoke=skipped`,
    `docs_only=true` → exit 0
15. `Lint` aggregator: code PR rejects a skipped `node_consumer_smoke` → exit 1
16. `Lint` aggregator: `lint_javascript=failure` → exit 1 (even when
    `docs_only=true`)
17. `Lint` aggregator: `should_skip=true` with everything `skipped` → exit 0
18. `Lint` aggregator: shell-injection sentinel is not evaluated

Existing assertions in `scripts/tests/ci-acplint-workflow.test.ts` that pin the
`lint` and `test` `needs` lists include `doc_change_filter`; they are the
pinning tests for those lists.

## Explicitly out of scope

- Refactoring the duplicated detection shell between `ci.yml`,
  `e2e.yml` and `pr-review.yml` into a shared composite action. The
  `e2e.yml` duplicate classifier is deliberately deferred (it is not modified).
- Gating `codeql` (security scan; the issue names test/e2e/packaging).
- Adopting `dorny/paths-filter` in place of the existing `gh api` script.
- Changing the documentation path patterns themselves.
