# Issue 3407: Make the github tool survive real agent search queries and expose assignment state

Plan ID: `PLAN-20260828-ISSUE3407`

Supersedes the scope of the auto-generated plan comment `PLAN-20260828-3407` (repo extraction
plus `issue.create` type guidance) after live reproduction widened the root cause.

## Failure evidence

All observations below were reproduced live through the built-in github tool from inside the
container sandbox (proxied broker path), on CLI `0.11.0-nightly.260828.2fadb59ac`.

| Call | Result |
|---|---|
| `search.issues` query `repo:alibaba/open-code-review author:acoliver` | Error: `Invalid search query "( repo:\"alibaba/open-code-review author:acoliver\" ) type:issue" ... resources do not exist or you do not have permission` (the original report) |
| `search.issues` query `author:acoliver is:issue is:open` | Error: `Invalid search query "( author:\"acoliver is:issue is:open\" ) type:issue" ... users cannot be searched` |
| `search.issues` query `milestone:0.11.0 is:open` + repo | No error, empty result set |
| `search.issues` query `milestone:"0.11.0" is:open` + repo | Parses (quoted value), empty result set |
| `search.issues` query `author:acoliver` + repo | Correct results |
| `search.issues` query `is:open` + repo | Correct results |

The pattern: an unquoted value-bearing qualifier (`repo:`, `author:`, `assignee:`, `milestone:`,
`label:`, `user:`, `org:`, `commenter:`) followed by more terms has the entire remainder of the
query swallowed into that qualifier's value. Depending on the qualifier this produces either a
misleading permission error or a silently empty result. The
same session showed the downstream cost: asked to find unassigned open 0.11.0 issues, the
agent concluded that "no GitHub milestones exist and nothing is assigned," when in fact four
open issues carry the 0.11.0 milestone and assignments exist. Two independent gaps caused that:

1. The search trap above made every scoped query fail or return empty.
2. `issue.list` and `issue.view` request `number,title,state,author,labels,updatedAt` (plus
   `body`/`comments` for view) from gh and their shaped contracts drop `assignees` and
   `milestone` entirely, so assignment state is invisible to agents even when listing works.

`argv` construction is the proximate cause: `buildSearchIssuesArgv`/`buildSearchPrsArgv` splice
`params.query` verbatim into a **single** `gh search` positional
(`github-broker-search-ops.ts`, `appendSearchQuery`) with no normalization, even though the ops
already declare a dedicated `repo` parameter that correctly becomes `--repo`.

### Correction from host-side experiments against real `gh`

`gh search issues` takes `[<query>...]` — **many** positional terms — and builds the API query
by quoting each term's value itself. Passing the whole query as one argv element is therefore
the entire bug: gh sees a single term `repo:alibaba/open-code-review author:acoliver`, splits
it once on the first `:`, and quotes everything after it as the value. Measured directly:

| argv | Result |
|---|---|
| `gh search issues "repo:vybestack/llxprt-code author:acoliver"` | `Invalid search query "( repo:"vybestack/llxprt-code author:acoliver" ) type:issue"` |
| `gh search issues "repo:vybestack/llxprt-code" "author:acoliver"` | correct results |
| `gh search issues "author:acoliver" "is:open" --repo vybestack/llxprt-code` | correct results |
| `gh search issues 'milestone:0.11.0' 'is:open' --repo …` | correct results (2 issues) |
| `gh search issues 'milestone:"0.11.0"' 'is:open' --repo …` | `[]` |

Two consequences that change the plan as originally written:

1. **Splitting the query into separate positional argv elements is the fix**, and it subsumes
   the whole class of swallowed-qualifier failures at once, for every qualifier, without
   enumerating them.
2. **Auto-quoting qualifier values (the mechanism AC-2 originally proposed) is actively
   wrong.** gh quotes values itself, so a pre-quoted `milestone:"0.11.0"` argv element reaches
   the API double-quoted and matches nothing. That is also the explanation for the
   `milestone:"0.11.0" is:open` empty result previously recorded as an unexplained follow-up:
   it was gh re-quoting an already-quoted value, not a milestone data problem. The bare form
   returns results. That follow-up is therefore closed by this change rather than deferred.

Accordingly AC-2 keeps its observable outcome (later terms parse as their own qualifiers) but
its mechanism becomes quote-aware tokenization, and pre-quoting is explicitly forbidden.

Secondary report in the issue: `issue.create` rejects `type` with a message that lists accepted
parameters but does not say that issue type is set afterwards via `issue.edit`, so the agent
kept retrying the same rejected call. `issue.edit` accepts `type`; `issue.create` cannot, since
`gh issue create` has no `--type` flag.

## Accepted behavior

### AC-1: `repo:` embedded in the query is lifted to the dedicated repo parameter

Given a `search.issues` or `search.prs` call whose `query` contains a `repo:owner/name` token
(quoted or unquoted), when the argv is built, then the token is removed from the query string
and `owner/name` is passed as `--repo` (an explicit `repo` parameter still wins; a conflict is
resolved in favor of the explicit parameter).

### AC-2: Value-bearing qualifiers no longer swallow the rest of the query

Given a query containing any value-bearing qualifier (`author:`, `assignee:`, `milestone:`,
`label:`, `user:`, `org:`, `commenter:`, and `repo:` when AC-1 does not lift it) followed by
further terms, when argv is built, then each whitespace-separated term becomes its own `gh`
positional argument, so gh parses every term as a separate qualifier or freetext keyword.

Tokenization is quote-aware: a double-quoted run is one term and its surrounding quotes are
stripped, so `milestone:"0.11.0" is:open` yields the terms `milestone:0.11.0` and `is:open`,
and the freetext phrase `"sandbox proxy" is:open` yields `sandbox proxy` and `is:open`. The
builder MUST NOT add quotes of its own: gh quotes values when it constructs the API query, and
a pre-quoted value reaches the API double-quoted and matches nothing.

### AC-3: Search failures carry self-correction guidance

Given a search operation that still fails with gh's "cannot be searched" classification, when
the broker shapes the error, then the message tells the caller concretely what to do (use the
`repo` parameter for repository scoping; quote multi-word qualifier values). This is required
because the github tool is the only sanctioned GitHub interface: the sandbox deliberately
ships no `gh` binary and no `GH_TOKEN`/`GITHUB_TOKEN`, so shelling out to raw gh is never a
valid escape hatch and the tool must complete the correction loop itself.

### AC-4: `issue.create` type rejection points at `issue.edit`

Given an `issue.create` call with a `type` parameter, when validation rejects it, then the
message explicitly states that issue type is set via `issue.edit` after creation.

### AC-5: Assignment and milestone state are visible

Given `issue.view` and `issue.list`, when results are shaped, then each issue includes
`assignees` (logins) and `milestone` (title, null when unset), with the gh `--json` field
lists extended accordingly. List omits bodies as today.

Both fields exist on `gh issue view` and `gh issue list` (verified against the live field
list). Their raw shapes are `assignees: [{ id, login, name, databaseId }]` and
`milestone: { number, title, description, dueOn }`, and `milestone` is absent/null when unset.
Shaping MUST reduce assignees to logins and milestone to its title string: the raw milestone
carries a multi-paragraph `description` that would otherwise be repeated on every item of
every list response for no benefit.

## Inputs and boundaries

- Touch `packages/providers/src/auth/proxy/github-broker-search-ops.ts` (query tokenization and
  `repo:` lifting applied in both search builders), `github-broker-errors.ts` (search-specific
  guidance), `github-broker-issue-ops.ts` and `github-broker-shaping.ts` (field lists and
  assignee/milestone extraction), `github-broker-types.ts` (the optional per-op error
  augmentation hook), `github-broker-validation.ts` (op-aware parameter redirect), and the
  shared catalog / descriptions in `packages/tools/src/tools/github-ops.ts`, `github.ts` and
  `github-display.ts`.
- The normalization helper is pure and unit-tested through the exported argv builders; no new
  process spawning, no network in tests.
- No new operations (no `milestone.list`), no protocol or framing changes, no changes to the
  credential proxy transport. The v1 64 KiB frame cap and v2 4 MiB budget are documented
  context only.
- gh's own search semantics are the contract; the helper must not reorder freetext terms.

## Test-first implementation

Extend existing files; no new test files.

1. `packages/providers/src/auth/proxy/__tests__/github-broker-p10b.test.ts` — argv cases for
   AC-1/AC-2: `repo:` extraction (quoted, unquoted, explicit-param precedence, mixed),
   auto-quoting of bare qualifier values, passthrough of quoted values and freetext.
2. `packages/providers/src/auth/proxy/__tests__/github-broker-write-ops.test.ts` — `issue.create`
   with `type` asserts the rejection names `issue.edit` (AC-4).
3. `packages/tools/src/tools/github-unknown-param.bun.test.ts` — same guidance at the tool layer.
4. `packages/tools/src/tools/github.test.ts` — description/schema regressions for search
   parameters (repo param for scoping) and the `issue.create`/`issue.edit` type split.
5. Issue-op shaping tests (where `issue.view`/`issue.list` shaping is covered today) —
   `assignees` and `milestone` extraction, including null milestone and empty assignee list.

## Sandbox and proxy findings (context for reviewers)

- The broker executes `gh` host-side in both environments: sandboxed tool calls travel the
  credential-proxy socket (`LLXPRT_CREDENTIAL_SOCKET` + capability token) to the same
  `executeGitHubOp` used in-process on the host. `buildMinimalEnv()` reads the executing
  (host) process env, so gh auth, `GH_CONFIG_DIR`, and proxy variables behave identically.
  No proxied-vs-direct behavioral difference was found for search; the failure reproduces on
  both paths (the original report was host-side macOS, no sandbox).
- Differences that do exist inside the sandbox, verified from this session's container. All
  of them are design properties of the credential boundary, not deficiencies:
  - `gh` is not on PATH and `GH_TOKEN`/`GITHUB_TOKEN` are absent from the environment by
    design; the brokered github tool is the only sanctioned GitHub interface. The practical
    consequence for agents is that tool-side self-correction (AC-1 through AC-3) is the only
    correction path; the raw-gh fallback observed in the original report is a host-side habit
    that cannot exist in the sandbox.
  - `ocr` is not installed, so the open-code-review step of the issue workflow must run
    host-side.
  - Outbound HTTPS, localhost port binding, `/tmp` and `$HOME` writes, and git push
    authentication over the forwarded SSH agent all work; `/etc` writes are denied.

## Out of scope

- `gh search issues --json` offers `assignees` but has no `milestone` field at all, so AC-5
  covers `issue.view` and `issue.list` only; search result shaping is unchanged.
- The repo is publicly readable (unauthenticated `raw.githubusercontent.com` fetch of the main
  README returned 200), so none of the observed errors were permission-related.

## Verification (to be completed during implementation)

- `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, and
  the `stepfun-37` smoke test per the issue workflow.
- Live spot-check through the built-in tool after the fix: the three failing forms from the
  evidence table return results or a guided error.
