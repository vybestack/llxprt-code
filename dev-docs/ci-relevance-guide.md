# CI Workflow Relevance Guide

> Issue #2693 — Audit CI workflow path filters: irrelevant workflows trigger on
> unrelated PRs.

This document explains how the llxprt-code CI workflows decide whether to
allocate a runner for a given change. Every workflow is classified, and every
path-filtered workflow's entries are traceable to an input the job actually
consumes. The behavioral test that owns each gating policy is named so that
future authors do not reintroduce over-broad filters.

## Principles

1. **Traceable inputs.** Every entry in a workflow `paths:` filter must
   correspond to a file the workflow can observe (install, build, test, or
   otherwise consume). An entry with no traceable input is a bug.

2. **Conservative coarse candidates.** GitHub path filters cannot distinguish
   fields within a single JSON file. A root `package.json` is a coarse
   candidate because the workflow consumes its workspaces, dependency metadata,
   and lifecycle scripts. Coarse candidates are acceptable **only** when paired
   with a job-level semantic gate that can distinguish relevant changes within
   the coarse file.

3. **Semantic gates over extension allowlists.** A `paths-ignore` rule that
   substitutes filename extensions (`.md`, `.txt`) or a documentation
   percentage for actual relevance is a false-negative trap. Runtime prompt
   inputs, test fixtures, and packaged source are `.md`/`.txt` files that are
   NOT documentation — an extension allowlist turns them into green required
   checks with zero testing. Use the tested classifier
   (`scripts/docs-only-filter.ts`) instead.

4. **Fail-closed at external boundaries only.** Uncertainty — an unparseable
   manifest, an incomplete file list, an untrustworthy push base, a count
   mismatch, an unsupported event — always selects running the job. Fail-closed
   decisions are placed only at genuinely external/unpredictable boundaries
   (workflow event type, GitHub-API data shape). Everything else fails fast
   (throws) so a bug surfaces immediately rather than silently gating.

5. **Symmetric PR/push filters.** PR and push `paths:` lists must be identical
   unless a real event-input difference is documented. A drift between the two
   means a push to `main` triggers a job that a PR does not (or vice versa).

6. **Successful terminal checks.** An intentional heavy-job skip must produce a
   successful terminal check, not an absent or permanently pending required
   check. A gated job that resolves to "skip" must let the workflow reach a
   green conclusion.

7. **Rename and deletion handling.** Deleting or renaming a relevant input is
   itself relevant. A semantic gate that consumes structured changed-file
   entries (status + previous_filename) can select run for a rename to OR
   from a relevant path — the shared docs-only filter does this for renames
   today. Deletion-of-input sensitivity (beyond plain path classification)
   was a property of the deleted Windows relevance classifier (#2693,
   removed with the per-PR path in #3249).

8. **Event paths are a coarse boundary.** GitHub `paths:` filters and
   `on:` event triggers are a coarse pre-classifier that determines whether
   a workflow _starts_ at all. They cannot distinguish fields within a single
   file, and the GitHub changed-file API has platform-specific limitations
   around rename detection and the 3000-file ceiling. Coarse boundaries are
   acceptable only when paired with a job-level semantic gate (like the
   shared docs-only filter) that can
   make the fine-grained run/skip decision. Consolidating all event paths
   into a universal, always-running relevance gate is explicitly deferred —
   the current per-workflow coarse-plus-semantic design is the accepted
   architecture.

## 21-workflow classification

Every workflow in `.github/workflows/` falls into one of these categories:

### Event-path filtered (path filter + optional job-level gate)

| Workflow             | Filter                       | Job-level gate     | Behavioral test owner                            |
| -------------------- | ---------------------------- | ------------------ | ------------------------------------------------ |
| `interactive-ui.yml` | `pull_request`, `push` paths | none (broad build) | `scripts/tests/interactive-ui-paths.bun.test.ts` |

These workflows use `paths:` to select a coarse candidate set.

### Job-level gated (no path filter; run on PR/push but skip via job output)

| Workflow  | Events                                                                            | Gate                            | Behavioral test owner                            |
| --------- | --------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------ |
| `ci.yml`  | `push`, `pull_request`, `merge_group`, `workflow_dispatch`                        | `docs_only` (shared classifier) | `scripts/tests/ci-docs-only-skip.bun.test.ts`    |
| `e2e.yml` | `push`, `pull_request`, `pull_request_target`, `merge_group`, `workflow_dispatch` | `docs_only` (shared classifier) | `scripts/tests/e2e-docs-only-wiring.bun.test.ts` |

These workflows trigger on all PRs but use a `docs_only` job output to skip
heavyweight jobs when the change is documentation-only. Both invoke the tested
`scripts/docs-only-filter.ts` classifier with structured file entries and the
authoritative `changed_files` count.

### Intentionally broad (no path filter; triggers on push-to-main/release and manual)

| Workflow         | Events                                           | Reason                                                               |
| ---------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| `smoke-test.yml` | `push` (main, release/\*\*), `workflow_dispatch` | Runs the full smoke suite on merge or manual dispatch; not every PR. |

### Reusable / caller-controlled (no PR/push triggers)

| Workflow                        | Reason                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `_evals-run.yml`                | Called by `evals-nightly.yml`; the caller controls when it runs.                                                                    |
| `_pr-mergeability-gate.yml`     | Called by `e2e.yml` and others; the caller controls when it runs.                                                                   |
| `windows-installed-command.yml` | Called by `nightly.yml` (nightly Windows installed-command smoke) and manually dispatchable; no PR/push triggers since issue #3249. |

### Pull-request-target / action-gated

| Workflow                              | Events                                                                                                                      | Reason                                                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `ocr-review.yml`                      | `pull_request_target` (opened/reopened/synchronize/ready_for_review), `issue_comment` (created/edited), `workflow_dispatch` | Automatic PR-target reviews on open/sync/ready, authorized comment triggers, and manual dispatch. Not label-triggered. |
| `pr-review.yml`                       | `pull_request_target` (opened/reopened/synchronize/ready_for_review/edited)                                                 | Runs on PR lifecycle action types with job-level authorization gates. Not label-triggered.                             |
| `auto-label-trusted-contributors.yml` | `pull_request_target`                                                                                                       | Label automation for trusted contributors.                                                                             |

### Scheduled / manual / non-code-event

| Workflow                          | Events                          | Reason                                                     |
| --------------------------------- | ------------------------------- | ---------------------------------------------------------- |
| `assign-stale-cleanup.yml`        | `schedule`, `workflow_dispatch` | Stale issue cleanup.                                       |
| `assign.yml`                      | `issue_comment`, `issues`       | Issue/PR assignment automation.                            |
| `build-sandbox.yml`               | `workflow_dispatch`             | Manual sandbox build.                                      |
| `evals-nightly.yml`               | `schedule`, `workflow_dispatch` | Nightly evaluation suite.                                  |
| `issue-planner.yml`               | `issues`, `issue_comment`       | Issue planning automation.                                 |
| `llxprt-scheduled-pr-triage.yml`  | `workflow_dispatch`             | Manual PR triage (schedule disabled until app configured). |
| `luther.yml`                      | `schedule`, `workflow_dispatch` | Scheduled automation.                                      |
| `nightly.yml`                     | `schedule`, `workflow_dispatch` | Nightly full test suite.                                   |
| `ocr-infrastructure-notifier.yml` | `workflow_run`                  | Triggered by completion of the OCR Review workflow.        |
| `release.yml`                     | `schedule`, `workflow_dispatch` | Release automation.                                        |
| `upstream-sync.yml`               | `workflow_dispatch`             | Manual upstream sync.                                      |

These workflows are triggered by non-code events (schedules, issue comments,
labels) and have no code-path filter because the event itself determines
relevance.

## Windows installed-command smoke scheduling

The Windows installed-command smoke no longer runs per-PR (issue #3249):
the 20-45 min `windows-latest` job sat on virtually every PR's critical
path because the `packages/*/src/**` path filter matched nearly all
runtime-source changes. It now runs via `nightly.yml`, which calls the
reusable workflow through its `windows_installed_command` job, plus
manual `workflow_dispatch` for debugging Windows-specific install
failures. The #2693 semantic relevance classifier and its per-PR
`windows_relevance` gate were deleted as dead code along with the PR
trigger.

**Behavioral test owner:**
`scripts/tests/windows-installed-command-workflow.bun.test.ts`

## E2E docs-only detection

E2E reuses the tested `scripts/docs-only-filter.ts` policy (issue #342) with
structured changed-file entries and the authoritative `changed_files` count.
The classifier is a conservative allowlist: anything not explicitly
documentation is CODE, which makes required checks run.

Package-local Markdown/text, scripts, workflow/configuration, fixtures, and
unknown paths are CODE. Only the policy's explicit documentation locations
(`docs/`, `dev-docs/`, `project-plans/`, `research/`, root-level
`README*`/`CHANGELOG*`/etc.) may skip heavy E2E jobs.

**Behavioral test owner:**

- Classifier: `scripts/tests/docs-only-filter.bun.test.ts`
- E2E wiring: `scripts/tests/e2e-docs-only-wiring.bun.test.ts`
- CI wiring: `scripts/tests/ci-docs-only-skip.bun.test.ts`

## Interactive UI path contract

The Interactive UI workflow's `paths:` filter includes only the direct inputs
consumed by the test:

- The tmux harness entry and its split helper modules.
- The Bun test preload (`scripts/tests/test-setup.ts`).
- The test file itself (`scripts/tests/interactive-ui.test.ts`).
- The seven executed scenario JSON files.
- The deterministic session seed invoked by the resize scenario
  (`scripts/seed-session-browser-resize.ts`).
- The scenario config referenced by the executed scenarios
  (`scripts/fixtures/welcome-completed.json`,
  `scripts/system-settings.interactive-ui.json`).
- The response fixture files referenced by those scenarios.

The seven executed scenarios are:
`scripts/tmux-script.slash-autocomplete.json`,
`scripts/tmux-script.approval-ui.json`,
`scripts/tmux-script.issue2208-newlines.fake.json`,
`scripts/tmux-script.provider-model.json`,
`scripts/tmux-script.welcome.json`,
`scripts/tmux-script.session-browser-resize.json`, and
`scripts/tmux-script.unicode-composer.json`.

The provider/model, welcome, resize, and Unicode scenarios are added by issue #2017.
Tool-approval deny/Escape and session-browser open/navigation/search journeys are
owned by PRs #3308 and #3310 and are executed and listed by those PRs, not by
this lane.

Broad package/runtime paths remain because the job runs `npm ci`, a
workspace-wide build, the real CLI launcher, and the real tmux UI tests.
The stale `packages/ui/**` path was removed (no such tracked package
exists). Direct setup/install inputs (`.nvmrc`, `.bun-version`, `.npmrc`)
were added because the job's setup-node, setup-bun, and `npm ci` steps
consume them. Unrelated script tests, fixtures, or tmux scenarios do not
trigger the workflow.

**Behavioral test owner:** `scripts/tests/interactive-ui-paths.bun.test.ts`

## Adding a new path-filtered workflow

1. List every file the workflow installs, builds, tests, or otherwise
   consumes. Each becomes a `paths:` entry.
2. If a coarse candidate (a single file whose fields matter) is needed,
   add a cheap job-level semantic gate (like the shared docs-only filter)
   that runs on an inexpensive runner and outputs a boolean.
3. Write a Bun behavioral test that reads the real workflow YAML through
   `scripts/tests/typed-test-helpers.ts` and asserts the wiring.
4. Add the workflow to the classification table above.
5. Keep PR and push path filters identical.
