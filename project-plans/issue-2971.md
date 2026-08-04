# Issue #2971 — Missing workflow-level concurrency blocks

Closes #2971. Contributes to #2702 (CI execution optimization umbrella).

## Problem

On a GitHub Free plan the account shares a 20-concurrent-job ceiling. A workflow
without a `concurrency` block never cancels a superseded run, so every stale run
holds slots that an open PR needs.

Audit of the 21 files in `.github/workflows` confirms the issue's inventory:
six declare a top-level `concurrency` block (`ci.yml`, `pr-review.yml`,
`windows-installed-command.yml`, `ocr-review.yml`, `nightly.yml`,
`evals-nightly.yml`). Of the remainder, five are push/dispatch driven and can
stack: `e2e.yml`, `interactive-ui.yml`, `smoke-test.yml`, `build-sandbox.yml`,
`release.yml`.

### Correction to the issue's premise for `e2e.yml`

The issue states e2e has no cancellation at all. That is no longer accurate.
Commit `7eb9800693` (Fixes #2445) added **job-level** `concurrency` to the two
expensive jobs, `e2e_linux` (keyed per `matrix.sandbox`) and `e2e_mac`. Those
two jobs already cancel their superseded selves.

What is still missing is run-level cancellation. A superseded e2e run keeps
running its three cheap gate jobs — `skip_check`, `mergeability-gate`, and
`e2e_doc_change_filter` — because job-level concurrency cannot cancel a run.
Three ubuntu slots per superseded run, against a 20-slot ceiling, is the
remaining waste this issue targets.

## Design

### The `pull_request_target` cancellation hazard (why the naive key is wrong)

`e2e.yml` triggers on `pull_request_target: types: [labeled]`, which fires for
**any** label, while the e2e jobs only run when the label is exactly
`maintainer:e2e:ok`.

Job-level concurrency is immune to unrelated labels: a job whose `if:` evaluates
false is skipped, and a skipped job never joins a concurrency group.
Workflow-level concurrency is not immune — the *run* joins the group before any
`if:` is evaluated.

So the issue's proposed key,
`${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}`,
applied at the top level of `e2e.yml` would introduce a regression: adding an
unrelated label (for example `ci/cd`) to a PR would start a
`pull_request_target` run that joins the PR's group, cancels the in-flight
`pull_request` E2E run, and then skips its own e2e jobs because the label name
does not match. The cancelled E2E check would never be replaced.

The fix is to include both `github.event_name` and `github.event.label.name` in
the e2e group. Event identity gives each trigger type its own group, satisfying
the issue's "care required" bullet ("`pull_request_target` and `pull_request`
runs for the same PR must not cancel each other"). Label identity also separates
two `pull_request_target` runs for different labels, while allowing a repeated
`maintainer:e2e:ok` request to supersede the earlier run.

### merge_group safety

`github.event.pull_request` is absent on `merge_group` and `push` payloads, so
the `||` fallback resolves to `github.ref`. A merge-queue ref is
`refs/heads/gh-readonly-queue/<base>/pr-<n>-<sha>`, which is unique per queue
entry and never equal to a bare PR number. Merge-queue runs therefore cannot be
collapsed into, or cancelled by, a PR-keyed group. Adding `github.event_name` to
the e2e key makes this structurally impossible rather than merely unlikely.

### Required status checks

`main` has no branch protection (`GET /branches/main/protection` returns 404)
and the single repository ruleset (`blockforcedelete`) is `disabled`. There are
no required status checks, so cancellation cannot leave one pending. Every
cancellation-enabled key identifies both the trigger context and the unit of
work, so a replacement run reports the same check names as the run it cancels.
For e2e, the event-name and label-name segments prevent a skipped unrelated run
from replacing valid work. Release cancellation is disabled entirely.

### Chosen keys

| Workflow | Group | cancel-in-progress | Rationale |
|---|---|---|---|
| `e2e.yml` | `${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number \|\| github.event.inputs.branch_ref \|\| github.ref }}-${{ github.event.label.name }}` | `true` | `event_name` isolates trigger types; label identity prevents an unrelated `pull_request_target` label from cancelling valid E2E work; `branch_ref` keeps dispatches for different branches independent. The job-level blocks carry the same `event_name` and label segments so both levels express the same trigger identity, while keeping matrix legs independent. |
| `interactive-ui.yml` | `${{ github.workflow }}-${{ github.event.pull_request.number \|\| github.ref }}` | `true` | Canonical `ci.yml` pattern; the workflow has no `pull_request_target` trigger, so the hazard does not apply. |
| `smoke-test.yml` | `${{ github.workflow }}-${{ github.event_name }}-${{ github.event.inputs.ref \|\| github.ref }}` | `true` | `event_name` prevents a push from cancelling a deliberate manual run; the dispatch `ref` input identifies the tested unit of work within each trigger type. |
| `build-sandbox.yml` | `${{ github.workflow }}-${{ github.ref }}-${{ github.event.inputs.tag \|\| 'latest' }}` | `true` | Ref plus requested tag identifies the image, so only a superseding rebuild of the same tag is cancelled. |
| `release.yml` | `${{ github.workflow }}` | `false` | Serialize all releases globally regardless of ref because every release mutates global npm, registry, and release state; never cancel an in-flight publish. |

## Acceptance criteria

- [ ] `e2e.yml`, `interactive-ui.yml`, `smoke-test.yml`, and `build-sandbox.yml`
      declare a top-level concurrency group with `cancel-in-progress: true`.
- [ ] `release.yml` declares a top-level concurrency group with
      `cancel-in-progress: false`.
- [ ] Two runs of the same workflow for the same PR resolve to the same group
      (they cancel each other).
- [ ] A `merge_group` run and a `pull_request` run for the same PR resolve to
      different groups.
- [ ] A `pull_request_target` run and a `pull_request` run for the same e2e PR
      resolve to different groups.
- [ ] Different labels on `pull_request_target` runs for the same PR resolve to
      different workflow-level groups.
- [ ] The job-level e2e concurrency blocks preserve matrix isolation and include
      `github.event_name` to maintain workflow-level trigger isolation.
- [ ] `actionlint` and `yamllint` pass.

## Tests

`scripts/tests/pr-workflow-concurrency.test.ts` is extended. It currently pins
`e2e.yml` as having no top-level block; that assertion is inverted by this
change and is updated.

Structural assertions alone would be implementation-shaped, so the suite gains a
minimal GitHub-expression resolver: it takes a parsed `concurrency.group`
template plus a simulated event context and returns the string GitHub would
compute (`${{ ... }}` interpolation, `||` fallback, single-quoted literals, and
missing path → empty → falsy). Case-insensitive group *behavior* is then asserted
by comparing resolved strings across simulated `pull_request`,
`pull_request_target`, `push`, `merge_group`, and `workflow_dispatch` contexts.
That is what proves the merge-queue, label-hazard, trigger-isolation, tag, and
global-release criteria rather than restating the YAML.
