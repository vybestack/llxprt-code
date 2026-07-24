# Plan: Skip expensive trusted-context PR work while merge conflicts are reported (Issue #2587)

- **Issue:** https://github.com/vybestack/llxprt-code/issues/2587
- **Parent:** https://github.com/vybestack/llxprt-code/issues/2658
- **Branch:** `issue2587`
- **Rules:** `dev-docs/RULES.md` — behavioral TDD is mandatory (RED → GREEN → REFACTOR), tests must exercise the real workflow scripts and YAML, and infrastructure adapters may be faked without testing mock calls.

## 1. Verified platform behavior and scope

GitHub does not run workflows triggered by `pull_request` while the pull request has a merge conflict. Converting those workflows to `pull_request_target` would weaken security and required-check integrity, so these remain unchanged:

- `.github/workflows/ci.yml`
- `.github/workflows/interactive-ui.yml`
- `.github/workflows/windows-installed-command.yml`
- The normal internal-PR `pull_request` leg of `.github/workflows/e2e.yml`

The repository must explicitly gate expensive work that still starts in trusted context:

- `.github/workflows/ocr-review.yml` on automatic `pull_request_target` and authorized PR comment commands. `workflow_dispatch` is an explicit operator override.
- `.github/workflows/pr-review.yml` on `pull_request_target`.
- `.github/workflows/e2e.yml` on the approved-fork `pull_request_target` path.

`.github/workflows/auto-label-trusted-contributors.yml` remains ungated because it is cheap metadata automation. Events created by the repository `GITHUB_TOKEN` do not recursively start `labeled` workflows, so this auto-label workflow cannot resume E2E after a head update.

CodeRabbit is an external GitHub App. Its current repository configuration has no mergeability predicate, so Actions cannot reliably prevent, cancel, or retrigger CodeRabbit reviews based on conflicts. `.coderabbit.yaml` remains unchanged.

## 2. Binding architectural decisions

### AD1 — One reusable mergeability gate

Add `.github/workflows/_pr-mergeability-gate.yml` as a reusable `workflow_call` contract. It accepts:

- `check-mergeability`: boolean; false is an explicit bypass.
- `pull-request-number`: string.
- `expected-head-sha`: optional string used to reject stale event work.

It returns string outputs:

- `should-run`: `true` or `false`.
- `reason`: stable diagnostic reason.

The gate has only `pull-requests: read`, does not check out code, receives no repository secrets, and uses the repository's pinned `actions/github-script` revision.

### AD2 — Decide conflicts only from REST `mergeable`

The webhook payload is not authoritative because `mergeable` is commonly null while GitHub computes the result. The gate calls `github.rest.pulls.get` and:

- permits when `mergeable === true`;
- skips when `mergeable === false`;
- polls a bounded number of times when `mergeable === null`;
- retries and may fail open only for statusless network errors, HTTP 429, and HTTP 5xx responses;
- fails visibly with sanitized diagnostics for permanent HTTP errors, including 4xx authentication, authorization, not-found, and configuration failures;
- fails visibly for invalid gate inputs;
- skips stale event work when the current API head differs from `expected-head-sha`.

Do not interpret `mergeable_state` values such as blocked, behind, or unstable as git conflicts.

### AD3 — Keep workflows triggered; skip only expensive jobs

Trusted-context workflows still create a cheap gate job. Their expensive jobs use `needs` and `if` to skip when the gate returns false. This preserves observable successful/skipped workflow conclusions and avoids expected checks being absent solely because of a workflow-level filter.

### AD4 — Preserve authorization and cancellation

- OCR's exact existing event/authorization predicate moves to the gate-caller job. Unauthorized and non-PR comments cannot enter its concurrency group.
- OCR's gate and review jobs share the current per-PR concurrency group so a newer conflicting update can cancel stale review work before returning false.
- PR Review retains its existing workflow-level per-PR cancellation.
- E2E retains its job/matrix concurrency and trusted `maintainer:e2e:ok` boundary.

### AD5 — New fork heads require fresh E2E approval

Keep E2E's `pull_request_target` trigger limited to `labeled`. A persistent `maintainer:e2e:ok` label is not scoped to a particular head SHA, so `synchronize` must not authorize newly pushed fork code to receive repository secrets.

After a conflict-resolution push changes the head, a maintainer must remove and re-add `maintainer:e2e:ok` after the head changes, or use manual `workflow_dispatch`. The fresh label event carries the new expected head SHA through the mergeability gate. This deliberately preserves security over automatic rerun convenience.

## 3. Requirements

### REQ-2587-1: Authoritative conflict decision

- **GIVEN** an eligible trusted-context PR workflow event
- **WHEN** GitHub's REST PR response reports `mergeable: false`
- **THEN** the expensive review/test job is skipped and the gate succeeds with a conflict reason.

### REQ-2587-2: Pending and uncertain state is safe

- **GIVEN** REST mergeability is null or temporarily unavailable
- **WHEN** bounded polling cannot obtain a boolean
- **THEN** the gate warns and permits work rather than stranding a valid PR indefinitely.

### REQ-2587-3: Stale event work does not run

- **GIVEN** the event expected head differs from the current PR head
- **WHEN** the gate resolves PR state
- **THEN** it returns false with a stale-head reason so the newer synchronize run owns the work.

### REQ-2587-4: Existing event contracts remain intact

Push, merge-group, ordinary `pull_request`, and explicit workflow-dispatch behavior remain unchanged. Authorized OCR commands are mergeability-checked; OCR workflow dispatch bypasses the gate intentionally. Unauthorized comments still cannot cancel OCR.

### REQ-2587-5: Security boundaries remain intact

The mergeability gate has read-only PR access, never checks out PR code, receives no provider credentials, and does not convert native `pull_request` workflows to `pull_request_target`.

### REQ-2587-6: Conflict resolution requires fresh fork E2E approval

Normal conflict resolution updates the PR head and emits `synchronize`, so OCR and PR Review reevaluate mergeability. E2E does not authorize a new fork head from a persistent label. A maintainer must remove and re-add `maintainer:e2e:ok` or invoke `workflow_dispatch` explicitly.

## 4. TDD phases

### Phase 1 — Reusable gate behavior (RED then GREEN)

**Create first:** `scripts/tests/pr-mergeability-gate.test.js`

The test parses the real reusable workflow and executes the real `actions/github-script` body. Fake only the Octokit REST adapter and timer. Assert observable outputs/warnings, not adapter call counts.

RED behaviors:

1. Bypass allows without requiring a PR number.
2. `mergeable: true` allows.
3. `mergeable: false` skips with conflict reason.
4. null followed by true allows.
5. null followed by false skips.
6. repeated null warns and allows.
7. exhausted network, HTTP 429, and HTTP 5xx uncertainty warns and allows with sanitized diagnostics.
8. permanent HTTP 401, 403, 404, and 422 errors fail visibly without exposing response details.
9. current head different from expected head skips as stale.
10. missing/malformed PR number with checking enabled fails visibly.
11. Workflow permissions are exactly `pull-requests: read`; no checkout, shell step, or secrets contract exists.
12. Script does not consume event-payload `mergeable` or `mergeable_state`.

**GREEN:** Add `.github/workflows/_pr-mergeability-gate.yml` with the minimum implementation satisfying those tests.

### Phase 2 — OCR wiring (RED then GREEN)

**Create/extend first:** `scripts/tests/pr-mergeability-workflow-wiring.test.js` and the existing OCR workflow tests where they own authorization/concurrency behavior.

RED behaviors:

1. The mergeability caller carries the exact authorized event/comment predicate.
2. Gate and code-review use the shared current per-PR concurrency group.
3. Automatic target events and authorized comments check mergeability.
4. Workflow dispatch bypasses mergeability.
5. `code-review` needs the gate and runs only when `should-run` is true.
6. Infrastructure notification cannot run for a conflict-skipped code-review job.
7. Existing fork safety, trusted checkout, command syntax, permissions, outputs, and timeout remain unchanged.

**GREEN:** Modify `.github/workflows/ocr-review.yml` minimally.

### Phase 3 — PR Review wiring (RED then GREEN)

RED behaviors:

1. Existing trigger types and workflow-level concurrency remain unchanged.
2. A read-only reusable gate runs before the expensive review.
3. The gate receives the event PR number and head SHA.
4. The review job needs the gate and runs only when permitted.
5. Existing provider secrets remain scoped to the review job, not the gate.

**GREEN:** Modify `.github/workflows/pr-review.yml` minimally.

### Phase 4 — Approved fork E2E wiring (RED then GREEN)

RED behaviors:

1. Existing push, pull_request, merge_group, workflow_dispatch, and labeled target triggers remain.
2. Target `synchronize` is not registered and cannot reuse a persistent approval label for a new fork head.
3. Labeled target E2E requires the exact `maintainer:e2e:ok` label event.
4. The mergeability gate and target setup run only for that eligible label event.
5. Native and manual events continue only when the target gate is intentionally skipped.
6. Target E2E requires successful duplicate-check and doc-filter dependencies plus a successful gate whose output is exactly true.
7. Both Linux and macOS jobs preserve doc-only, duplicate-skip, matrix, continue-on-error, checkout, secret, and concurrency contracts.
8. Auto-label remains ungated, but its `GITHUB_TOKEN` label write cannot recursively trigger E2E.

**GREEN:** Modify `.github/workflows/e2e.yml` minimally.

### Phase 5 — Regression and full verification

Run focused tests, then all script tests. Validate YAML/action syntax through repository linting. Run the complete required suite:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

The smoke command must produce a haiku and no additional user-facing prose. Formatting changes must be reviewed and limited to intended files.

## 5. Files

### Create

- `.github/workflows/_pr-mergeability-gate.yml`
- `scripts/tests/pr-mergeability-gate.test.js`
- `scripts/tests/pr-mergeability-workflow-wiring.test.js`

### Modify

- `.github/workflows/ocr-review.yml`
- `.github/workflows/pr-review.yml`
- `.github/workflows/e2e.yml`
- `scripts/tests/ocr-review-workflow.test.js` if necessary to preserve its existing ownership of authorization/concurrency assertions
- `scripts/tests/pr-workflow-concurrency.test.js` if necessary to preserve its existing ownership of concurrency assertions

### Intentionally unchanged

- `.github/workflows/ci.yml`
- `.github/workflows/interactive-ui.yml`
- `.github/workflows/windows-installed-command.yml`
- `.github/workflows/auto-label-trusted-contributors.yml`
- `.coderabbit.yaml`
- `.llxprt/**`

## 6. Known limitation

GitHub has no mergeability-changed Actions event. Normal conflict resolution modifies the PR head and emits `synchronize`, which retriggers OCR and PR Review. It intentionally does not trigger fork E2E: a persistent approval label is not head-scoped, and `GITHUB_TOKEN` label writes cannot recursively create the required `labeled` workflow run. A maintainer must remove and re-add the approval label after reviewing the new head, or use manual workflow dispatch. If mergeability changes solely because the base branch changes without a head update, no guaranteed event exists; operator workflow dispatch or rerun remains the fallback. CodeRabbit requires vendor-side mergeability support for exact equivalent behavior, so `.coderabbit.yaml` remains unchanged.

## 7. Completion gate

- [ ] Every production change was preceded by a failing behavioral test.
- [ ] Explicit `mergeable: false` skips expensive trusted-context work.
- [ ] Null and retryable network/429/5xx uncertainty fails open and is observable.
- [ ] Permanent REST failures fail visibly with sanitized diagnostics.
- [ ] Stale event heads cannot run expensive work.
- [ ] Native pull-request workflow security remains unchanged.
- [ ] New fork heads require a fresh label event or manual dispatch before E2E receives secrets.
- [ ] OCR authorization and cancellation semantics remain intact.
- [ ] All focused and full verification commands pass.
