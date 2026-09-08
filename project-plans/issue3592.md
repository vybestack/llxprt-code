# Plan for #3592 — GitHub tool `issue.edit` reports success but `addProject` leaves issue outside the project

## Investigation findings (layer determination)

The issue asks which layer swallowed the failure. Traced end to end:

1. **Tool argument handling: correct.** `buildIssueEditArgv` routes
   `addProject` through `appendMulti(argv, '--add-project', ...)` which emits
   one `--add-project <title>` pair for a string or per array entry. The
   observed tool response `{"number":3507,"type":null}` matches
   `executeIssueEdit`'s return, so the op took the expected path.
2. **Broker failure surfacing: correct.** The `run` wrapper in
   `executeGitHubOp` throws a structured `BrokerErrorException` on a non-zero
   gh exit and `assertNoPartialSuccess` throws on GraphQL `errors[]` in parsed
   output. There is no swallow path on this route, so the failing adds
   genuinely exited gh 0.
3. **External condition: gh/GitHub accepted or skipped the project mutation
   without reporting failure.** gh's own resolution path fails loudly when a
   project title cannot be resolved (`'X' not found` → non-zero exit), and 46
   of 47 same-session additions succeeded with the same title, so the title
   resolved and the mutation was issued. Five additions (#3507, #3399, #3400,
   #3509 via `issue.edit`; #3592 via `issue.create`'s `project` parameter —
   issue comment 1) exited 0 without visible membership. The precise GitHub-side
   cause cannot be proven from the retained local evidence, and per the issue's
   investigation scope we do not assume a general failure.

Conclusion: the exit code is not a trustworthy success signal for this
mutation. The tool must confirm the requested membership after the write and
report a structured failure when it is absent — exactly the issue's Expected
behavior ("A requested project addition should be applied, or the tool should
report the failure").

## Accepted behavior (scope)

- `issue.edit` with `addProject`: after the `gh issue edit` step, read the
  issue's `projectItems` (paginated) and require every requested project title
  to be present (case-insensitive, matching gh's own resolution semantics).
- `issue.create` with `project` (issue comment 1 extends the observed defect
  here): same verification after creation, using the issue number parsed from
  the URL gh prints.
- Failures throw the shared structured broker error (`GITHUB_ERROR`) naming
  the op, the issue, the missing title(s), and the titles the issue is actually
  a member of (or `(none)`), preserving underlying error detail from any failed
  read.
- `removeProject` is NOT verified (the issue is about additions only).
- `buildIssueEditArgv`, `hasCliEditFields`, and `pr.resolve-thread` remain
  unchanged. Success response shapes remain `{number, type}` (edit) and
  `{url, number}` (create).

## Acceptance criteria

1. `issue.edit` with `addProject` returns success only when the post-edit read
   confirms membership for every requested title (string or array form).
2. Missing membership after the CLI step throws a structured `GITHUB_ERROR`
   naming op, `owner/name#number`, missing title(s), and present titles —
   never a success-shaped response.
3. The membership read paginates `projectItems` (`first:100`, cursor) while
   `hasNextPage` is true, so an issue in more than 100 projects cannot produce
   a false failure.
4. `issue.edit` without `addProject` issues no verification read (labels-only
   remains exactly one CLI call; type-only path unchanged).
5. `issue.create` with `project` verifies the created issue's membership; if
   the printed URL yields no issue number, it reports a structured failure
   naming the URL. Without `project`, `issue.create` is unchanged.
6. A verification read that itself fails (non-zero exit / GraphQL errors)
   propagates as a structured broker error with the underlying detail intact.

## Test plan (bun, recording-stub runner; no live mutation)

In `packages/providers/src/auth/proxy/__tests__/github-broker-multistep.test.ts`
(new `describe` for project verification):

- success: `projectItems` contains the title (exact and case-insensitive
  match) → resolves; result shape `{number, type}`.
- missing: empty `projectItems` → rejects with message naming the title and
  `(none)`; when other titles are present they are listed.
- array `addProject` with one missing → error names only the missing one.
- pagination: first page `hasNextPage: true`, target on page 2 → resolves and
  exactly two verification reads are issued.
- combined `addProject` + `type`: `updateIssue` still issued; single repo
  resolution shared (one `repo view` when repo omitted).
- read failure: stubbed `run` throws on the verification call → rejects with
  the thrown error preserved.
- regression: labels-only edit still exactly one call (existing test already
  pins this; must remain green).

In `github-broker-write-ops.test.ts` (new `describe` for `issue.create`):

- with `project`: CLI call + verification read; success shape `{url, number}`
  unchanged.
- with `project` and non-numeric stdout → structured error naming the URL.
- without `project`: exactly one CLI call, no verification read.
- missing membership after create → structured error naming the project.

## Implementation steps

1. `github-broker-multistep-ops.ts`:
   - `requestedProjectTitles(value): string[]` — normalize string|string[]
     to non-empty titles.
   - `verifyIssueProjectMembership(run, owner, name, number, titles, opName)`:
     paginated `projectItems` query (distinct `$issueNumber`/`projectItems`
     fragments so test stubs and the existing `issue(number:$number)` lookup
     cannot collide), case-insensitive title match, structured `GITHUB_ERROR`
     listing present titles when missing.
   - Wire into `executeIssueEdit` after the CLI step, sharing `resolveOwnerName`
     with the type step when both apply.
2. `github-broker-issue-write-ops.ts`: add `executeIssueCreate` (raw-output
   run → `shapeCreatedUrl` → verify when `project` requested) and set it as the
   `issue.create` descriptor's `execute`.
3. Tests per the plan above, following the existing recording-stub style and
   doc-comment annotations (`@issue 3592`).
4. Full verification cycle (test, lint, typecheck, format, build, stepfun-37
   smoke).

## Out of scope (explicitly)

- Verifying `removeProject` removals.
- Re-implementing project resolution or the add mutation in GraphQL ourselves.
- Retrying the add internally; the caller decides on failure.
- Changes to the tool-layer docs in `packages/tools` (param meanings and
  response shapes are unchanged).

## Related

- Issue #3592 (this fix), #3507/#3399/#3400/#3509/#3592 (observed instances).
- Existing plan references: PLAN-20260731-GHBROKER.P11/P19 (multistep ops and
  fail-fast conventions this change follows).

## Completion record (2026-09-08)

### Implementation

Per plan, plus one review-driven addition. `verifyIssueProjectMembership`
(paginated `projectItems` read, case-insensitive title match, structured
`GITHUB_ERROR` naming op, `owner/name#number`, missing and present titles)
wired into `executeIssueEdit`; `executeIssueCreate` added and registered;
`requestedProjectTitles` normalizes string|array.

### Review remediation (round 1 finding, resolved in round 2)

AC-1's array form was rejected at the public validation boundary
(`addProject` used the string-only `project` kind in
`packages/tools/src/tools/github-ops.ts`), so arrays never reached the
executor end-to-end. Fix: `addProject`-specific `projectList` kind accepting
string or non-empty string array (reusing the repeatable-string validation
convention); `issue.create` `project` and `removeProject` remain string-only.
Boundary tests added in
`packages/providers/src/auth/proxy/__tests__/github-broker-issue3592-boundary.test.ts`
(array passes validation and dispatch, repeated `--add-project` flags plus
verification read; `[]` and `[1]` rejected with zero executor calls).
Follow-up review round (scope: original ACs + the finding only): PASS.

### Verification evidence

- Targeted: 59 providers proxy tests + 55 tools tests, all pass.
- `npm run lint` (after `build:types`, CI's order — type-aware eslint needs
  cross-workspace `dist/*.d.ts`): 0 errors. `npm run typecheck`, `npm run
  format`, `npm run build`: all pass.
- Full `npm run test`: 21 failing files across storage/cli/core/providers/
  vscode-ide-companion — all proven pre-existing/environmental by stashing
  this diff and rerunning the identical failing set on the clean tree (97
  identical failures; log: `tmp/issue3592-clean-tree-proof.log`). Main CI
  ("LLxprt Code CI") is green at this branch's base commit.

### Known environmental gaps (this sandbox)

- stepfun-37 smoke test: blocked — "Credential proxy authentication failed:
  Invalid or missing capability token"; no credentials exist in this sandbox
  (no config dir, keyfile, or env). Startup smoke must be re-run on the host.
- Local `ocr` review: blocked — ocr CLI installed but no LLM endpoint
  configured in this sandbox. The repo's own "OCR Review" workflow provides
  this gate on the PR.
