# Issue #3030 — `github` tool agent experience (AX)

## The reported problem

A model working with the `github` tool hit this loop:

```
GitHub issue.comment #438
   Missing required parameter: body

[model reasoning]
 The tool schema declares only `op`, `number`, and `repo` as parameters, but the
 actual request needs a `body` field. Since additional parameters appear to be
 allowed despite validation warnings, I'll include `body` directly.

GitHub issue.comment #438
   issue.comment #438
   ```json
   { "url": "https://github.com/.../issues/438#issuecomment-5184514579" }
   ```
```

Two distinct defects:

1. **Discoverability.** `PARAMETER_SCHEMA` in `packages/tools/src/tools/github.ts`
   declares exactly three properties — `op`, `repo`, `number` — with
   `additionalProperties: true`. Every other parameter that any of the 21
   operations accepts (`body`, `title`, `query`, `addLabel`, `threadId`, `watch`,
   …) is invisible to the model. The model has to guess, fail, read a terse
   broker error, and retry. That is a wasted turn on every unfamiliar op.
   The broker's error (`Missing required parameter: body`) does not say which
   operation failed, what else that operation accepts, or what the parameter
   should contain.

2. **Presentation.** `returnDisplay` is `"<op> #<n>\n\n```json\n<raw shaped
   JSON>\n```"`. The user sees the operation name twice and then a JSON blob.
   What the user wants to read is "Commented on issue #438" with the link.

## Scope

- Make every operation's accepted and required parameters visible to the model
  in the function declaration itself (schema + description).
- Reject bad parameters at the tool boundary with a message that says how to fix
  it, before a round trip to the broker.
- Enrich the broker's own validation errors with the operation name and its
  accepted parameters (the broker is also reachable directly over the sandbox
  socket, so it must stand on its own).
- Replace the JSON dump in `returnDisplay` with a human-readable summary per
  operation. `llmContent` keeps the full shaped JSON — the model still needs the
  data.
- Keep a single source of truth for the operation catalog. The tool layer and
  the broker layer must not carry two hand-maintained copies of the same
  parameter tables.

Out of scope: the duplicated header line visible in the issue transcript
(`x xGitHub issue.comment #537` / `GitHub issue.comment #537`) is `StickyHeader`
behaviour shared by every tool, not something specific to `github`.

## Current architecture (verified)

- `packages/tools/src/tools/github.ts` — `GithubTool`, `SUPPORTED_OPS`,
  `MUTATING_OPS`, `DESCRIPTION`, `PARAMETER_SCHEMA`, `renderChecks`,
  `GithubToolInvocation.execute`. Depends on nothing outside `packages/tools`.
- `packages/providers/src/auth/proxy/github-broker*.ts` — `OP_REGISTRY` of 21
  `OpDescriptor`s. Each op module holds a private
  `const X_PARAMS: Readonly<Record<string, ParamKind>>` and the descriptor
  carries `requiredParams`. `executeGitHubOp` calls
  `validateParams(descriptor.params, opParams, descriptor.requiredParams)`.
- `packages/providers` already depends on `@vybestack/llxprt-code-tools`
  (`file:../tools`) and imports it via subpath exports such as
  `@vybestack/llxprt-code-tools/toolIdNormalization.js`. `packages/tools` does
  **not** depend on `packages/providers`. So the shared catalog belongs in
  `packages/tools` and flows one way.

## Design

### 1. Canonical op catalog — new `packages/tools/src/tools/github-ops.ts`

Single source of truth for: op names, mutating flag, accepted parameters,
parameter kinds, required parameters, and a one-line summary per op.

```ts
export type GithubParamKind =
  | 'repo' | 'number' | 'boolean' | 'state' | 'stateIssue' | 'label'
  | 'threadId' | 'body' | 'freetext' | 'limit' | 'closeReason' | 'color'
  | 'assignee' | 'milestone' | 'project' | 'branch';

export interface GithubOpSpec {
  readonly summary: string;
  readonly mutating: boolean;
  readonly params: Readonly<Record<string, GithubParamKind>>;
  readonly required: readonly string[];
}

export const GITHUB_OP_SPECS: Readonly<Record<string, GithubOpSpec>>;
export const GITHUB_SUPPORTED_OPS: readonly string[];   // Object.keys, insertion order preserved
export const GITHUB_MUTATING_OPS: ReadonlySet<string>;
export const GITHUB_PARAM_KIND_HINTS: Readonly<Record<GithubParamKind, string>>;

/** One line per op for the tool description. */
export function describeGithubOp(op: string): string;
/** "issue.comment accepts: number (required), body (required), repo." */
export function describeGithubOpParams(op: string): string;
/** Actionable message, or null when valid. Names the op and lists parameters. */
export function validateGithubOpParams(
  op: string,
  params: Readonly<Record<string, unknown>>,
): string | null;
```

The exact catalog (transcribed from the existing broker descriptors — do not
change any op's accepted set or required set in this issue):

| op | params (kind) | required | mutating |
| --- | --- | --- | --- |
| `issue.view` | number(number), comments(boolean), repo(repo) | number | no |
| `issue.list` | search(freetext), state(stateIssue), label(label), limit(limit), repo(repo) | — | no |
| `issue.create` | title(freetext), body(body), label(label), assignee(assignee), milestone(milestone), project(project), repo(repo) | title | yes |
| `issue.comment` | number(number), body(body), repo(repo) | number, body | yes |
| `issue.edit` | number(number), title(freetext), body(body), addLabel(label), removeLabel(label), addAssignee(assignee), removeAssignee(assignee), addProject(project), removeProject(project), milestone(milestone), type(freetext), repo(repo) | number | yes |
| `issue.close` | number(number), reason(closeReason), repo(repo) | number | yes |
| `pr.view` | number(number), comments(boolean), repo(repo) | number | no |
| `pr.list` | state(state), limit(limit), repo(repo) | — | no |
| `pr.diff` | number(number), repo(repo) | number | no |
| `pr.checks` | number(number), repo(repo), watch(boolean) | number | no |
| `pr.reviews` | number(number), actionable(boolean), repo(repo) | number | no |
| `pr.create` | title(freetext), body(body), base(branch), head(branch), draft(boolean), repo(repo) | title | yes |
| `pr.comment` | number(number), body(body), repo(repo) | number, body | yes |
| `pr.edit` | number(number), title(freetext), body(body), addLabel(label), removeLabel(label), addAssignee(assignee), milestone(milestone), repo(repo) | number | yes |
| `pr.ready` | number(number), repo(repo) | number | yes |
| `pr.resolve-thread` | threadId(threadId), repo(repo) | threadId | yes |
| `search.issues` | query(freetext), limit(limit), repo(repo) | query | no |
| `search.prs` | query(freetext), limit(limit), repo(repo) | query | no |
| `run.list` | limit(limit), branch(freetext), repo(repo) | — | no |
| `label.list` | limit(limit), repo(repo) | — | no |
| `label.create` | name(freetext), color(color), description(freetext), force(boolean), repo(repo) | name | yes |

`GITHUB_SUPPORTED_OPS` must preserve the current declaration order of
`SUPPORTED_OPS` in `github.ts` (an existing test pins the enum against it).

### 2. Broker consumes the catalog — `packages/providers`

- Add a `./tools/github-ops.js` subpath export to `packages/tools/package.json`
  (matching the existing `./tools/*.js` entries: `types` → `dist/...`,
  `bun` → source `.ts`, `import` → `dist/...`).
- `github-broker-types.ts`: `export type ParamKind = GithubParamKind;`
  re-exported from the tools catalog. All existing `ParamKind` uses keep
  compiling.
- Each op module deletes its private `*_PARAMS` const and uses
  `GITHUB_OP_SPECS['<op>'].params` / `.required`. Descriptors keep every other
  field (`buildArgv`, `shape`, `execute`, `rawOutput`, …) unchanged. The
  per-op exported `validateXParams` helpers keep their signatures.
- `executeGitHubOp` enriches a validation failure with the op name and the
  accepted-parameter line, e.g.
  `issue.comment: missing required parameter "body". issue.comment accepts: number (positive integer, required), body (markdown text, required), repo (owner/name).`

Result: adding an op or a parameter is a one-place edit, and the schema the
model sees cannot drift from what the broker accepts.

### 3. Tool schema and description — `packages/tools/src/tools/github.ts`

- `SUPPORTED_OPS` / `MUTATING_OPS` become derived from the catalog and stay
  exported with the same names and shapes.
- `PARAMETER_SCHEMA` gains an explicit typed property for **every** parameter
  name in the union of all op specs (32 names: number, comments, repo, search,
  state, label, limit, title, body, assignee, milestone, project, addLabel,
  removeLabel, addAssignee, removeAssignee, addProject, removeProject, type,
  reason, watch, actionable, base, head, draft, threadId, query, branch, name,
  color, description, force). Each property carries:
  - the right JSON type (`string` / `number` / `boolean`; `label` and
    `assignee` kinds are `["string", "array"]` with `items: {type: "string"}`),
  - `enum` where the kind is closed (`state`: open/closed/merged/all — note in
    the description that `merged` is `pr.list` only; `reason`:
    completed/"not planned"),
  - a description naming the operations that accept it, e.g.
    `"Comment or issue/PR body (markdown). Required by issue.comment and pr.comment; optional for issue.create, issue.edit, pr.create, pr.edit."`
  - `minimum: 1` on `number`, `minimum: 1, maximum: 100` on `limit`.
- `additionalProperties` becomes `false`. The union is exhaustive, so a typo now
  fails at schema validation with a precise message instead of reaching the
  broker. (Verify nothing else calls `GithubTool.build` with extra keys; the
  `@`-completion hook talks to `GitHubBrokerClient` directly, not the tool.)
- `DESCRIPTION` gains a generated per-op reference block, one line per op:
  `issue.comment — comment on an issue. required: number, body. optional: repo.`
  Keep the existing worked examples and the notes about `actionable`, blocking
  `watch`, and `issue.edit`'s extra fields.
- `GithubTool.validateToolParamValues(params)` (the hook already exists on
  `BaseDeclarativeTool`) calls `validateGithubOpParams`, so a missing or
  op-inappropriate parameter is rejected before any broker call with a message
  that lists what the op takes.

### 4. Result presentation — new `packages/tools/src/tools/github-display.ts`

`renderChecks` moves here (re-exported from `github.ts` so existing importers
and tests keep working). Add:

```ts
export function renderGithubResult(
  op: string,
  params: Readonly<Record<string, unknown>>,
  data: Readonly<Record<string, unknown>>,
): string;
```

Per-op rendering (shaped field names verified against the broker's `Shaped*`
types):

| op | display |
| --- | --- |
| `issue.view` | `Issue #1663 · open · <title>` / `by <author>` / `labels: a, b` / `<n> comments` |
| `pr.view` | `PR #2317 · open · <title>` / `<headRefName> → <baseRefName>` / `draft` when `isDraft` / `review: <reviewDecision>` / `<n> comments` |
| `issue.list` / `pr.list` | `<n> issues` (or `pull requests`), then up to 10 lines `#123 open  <title>`, then `… and <k> more` |
| `search.issues` / `search.prs` | `<n> results`, then up to 10 lines `owner/repo#123 open  <title>` |
| `run.list` | `<n> workflow runs`, then up to 10 lines `<conclusion or status>  <name>  (<headBranch>)` |
| `label.list` | `<n> labels` then the names, wrapped |
| `pr.diff` | `Diff for PR #2317 — <n> lines` plus `truncated at <bytes> bytes` when `truncated` is set |
| `pr.checks` | existing `renderChecks` |
| `pr.reviews` | `<n> review threads` then up to 10 lines `<path>:<line>  <first author>: <first line of comment>`; append `(truncated)` when the shape says so |
| `issue.create` | `Created issue #<n>` + url |
| `pr.create` | `Created pull request #<n>` + url |
| `issue.comment` | `Commented on issue #<n>` + url |
| `pr.comment` | `Commented on pull request #<n>` + url |
| `issue.edit` | `Updated issue #<n>` |
| `pr.edit` | `Updated pull request #<n>` |
| `issue.close` | `Closed issue #<n>` |
| `pr.ready` | `Marked pull request #<n> ready for review` |
| `pr.resolve-thread` | `Resolved review thread` |
| `label.create` | `Created label <name>` |

Append `in <repo>` when the call carried an explicit `repo`.

Reading fields out of `data` must tolerate a field being absent or the wrong
type — that data originates from `gh`/GitHub, which is the documented external
-input exception to the repo's fail-fast preference. Absent fields are simply
omitted from the line; there is no fallback that re-prints raw JSON, and no
try/catch swallowing.

Failure path: `returnDisplay` becomes the readable message only (no
`GitHub operation failed:` prefix duplicated with the header, which already
shows the op). `llmContent` keeps the full message including the structured
code so the model can classify.

### 5. Docs

`docs/tools/github.md` gains a per-operation parameter table (generated content
mirrored by hand into the doc) and a short "what you see" note explaining that
the transcript shows a summary while the model receives full JSON.

## Test plan (behavioural, written first)

No mock theater: assert observable output — schema contents, validation
messages, rendered strings — never call counts on internal helpers.

### New `packages/tools/src/tools/github-ops.test.ts`

1. Every op in `GITHUB_OP_SPECS` declares `repo` (every op supports cross-repo).
2. `GITHUB_SUPPORTED_OPS` equals the op keys and matches the previously pinned
   order.
3. `GITHUB_MUTATING_OPS` contains exactly the ten write ops and no read op.
4. Every entry in `required` is a key of that op's `params` (a required
   parameter the op does not accept is unsatisfiable).
5. `validateGithubOpParams('issue.comment', { number: 1 })` returns a message
   that contains `issue.comment`, `body`, and the word `required`.
6. `validateGithubOpParams('issue.comment', { number: 1, body: 'x', titel: 'y' })`
   returns a message naming `titel` and listing the accepted parameters.
7. `validateGithubOpParams('issue.comment', { number: 1, body: 'x' })` returns
   `null`.
8. `validateGithubOpParams('issue.destroy', {})` returns a message naming the
   unknown op.
9. `describeGithubOp` output for each op contains the op name and every
   required parameter name.

### Extend `packages/tools/src/tools/github.test.ts`

10. For every op, every key of that op's `params` appears in
    `PARAMETER_SCHEMA.properties` — the model can see every parameter it may
    need. (This is the direct regression test for the issue.)
11. `PARAMETER_SCHEMA.additionalProperties` is `false`.
12. `tool.validateToolParams({ op: 'issue.comment', number: 438 })` is
    non-null and mentions `body`.
13. `tool.validateToolParams({ op: 'issue.comment', number: 438, body: 'hi' })`
    is `null`.
14. `tool.build({ op: 'issue.view', number: 1, body: 'x' })` throws — `body` is
    not accepted by `issue.view`.
15. `tool.description` contains a line for every op naming its required
    parameters.
16. Existing tests (enum pinned to `SUPPORTED_OPS`, confirmation matrix,
    dispatch, watch progress) keep passing unchanged.

### New `packages/tools/src/tools/github-display.test.ts`

17. `issue.comment` result renders `Commented on issue #438` and the URL, and
    contains no `{` / `"url"` JSON punctuation.
18. `issue.create` renders `Created issue #123` and the URL.
19. `issue.close` renders `Closed issue #438`.
20. `issue.view` renders number, state and title on the first line.
21. `pr.view` renders `head → base` and the draft marker when `isDraft`.
22. `issue.list` with 25 items renders the count, 10 lines, and `… and 15 more`.
23. `pr.reviews` renders one line per thread with path and author.
24. `pr.diff` renders the line count and notes truncation when present.
25. A result with missing/oddly-typed fields still renders a non-empty line and
    does not throw.
26. `renderChecks` behaviour is unchanged (existing cases move or stay green).
27. An explicit `repo` appears in the rendered line.

### Extend `packages/providers/src/auth/proxy/__tests__/github-broker-write-ops.test.ts` (or a sibling)

28. Every `OP_REGISTRY` descriptor's `params` is reference-equal to
    `GITHUB_OP_SPECS[name].params`, and `requiredParams` matches `.required` —
    the two layers cannot drift.
29. `executeGitHubOp('issue.comment', { number: 1 })` rejects with a message
    containing `issue.comment`, `body`, and the accepted-parameter list.
30. Existing broker validation and dispatch tests keep passing.

Register every new test file in `scripts/bun-test-manifest-data-tools.ts`
(tools workspace) and in the providers entry of `scripts/bun-test-manifest.ts`
if a new providers test file is added.

## Constraints

- No new `.js` files, no new vitest-only tests: TypeScript, run under Bun via
  the manifest.
- Never add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`,
  never downgrade a lint severity, never raise a complexity/size threshold.
  Files must stay under the 800-line cap and within the configured complexity
  limits — split into helpers instead.
- TypeScript strict: no `any`, no type assertions to force shapes.
- New files carry `Copyright 2026 Vybestack LLC`.
- Keep `@plan` / `@requirement` doc tags in the style already used by the
  surrounding GHBROKER files.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, and
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
Because this changes terminal output, also exercise the rendering in the tmux
harness (`dev-docs/tmux-harness.md`) before opening the PR.
