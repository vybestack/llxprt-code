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

### AC-6: A page is never mistaken for a total

Given any list or search operation, when the results are shaped, then the broker requests one
row more than the caller's limit, returns at most the limit, and reports `hasMore`. The
repository has over 200 open issues against a default limit of 30, so a returned count of 30
previously read as a total with nothing to contradict it.

### AC-7: State is one value across operations

Given `issue.list`, `pr.list` and the search operations, when a state is shaped, then it is
lower case. gh reports `OPEN` from `issue list` but `open` from `search issues`, so the same
issue compared unequal across two operations. Lower case is the form the tool's own `state`
parameter accepts, so a shaped state round-trips back into a request.

### AC-8: Counting does not require paging

Given `search.issues` or `search.prs` whose page is truncated, when the results are shaped,
then `totalCount` reports the size of the whole result set, obtained from the search API's
`total_count`. A complete page uses its own length and issues no second request.

Evidence: three models (opus5, zai/glm-5.3, dsflash/DeepSeek-V4) were each given the same
eight realistic tasks through the tool alone. All three independently invented the same
workaround for counting — partition the query into `created:` date buckets under the 100 item
ceiling and sum them — spending roughly twenty calls on it, and one still miscounted by hand.
All three named a missing total as their top finding. After this change the same question is
one call.

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

## Model evaluation

Three models ran the same eight-task script against the tool with no shell and no `gh` binary
available (`--approval-mode yolo` is required for the tool to be registered at all in
non-interactive mode; without it the registry silently omits every tool that can prompt).
Transcripts are in `tmp/verify3407/eval-*.log`.

Unanimous findings, all fixed here: no way to obtain a total (AC-8); `pr.list` and the search
results omitted `author` that gh had all along (AC-5); search results were a thinner projection
than `issue.list` for the same underlying objects. Two of three also flagged the `state`
casing split (AC-7).

Unanimous positives, recorded so they are not regressed: the `issue.create` + `type` rejection
was called "the most actionable tool error I've encountered" and "a model of what a tool error
should say"; the `search` qualifier documentation and the do-not-quote warning were followed
correctly by all three; `issue.view` answered a four-field question in one call.

### Re-run after the fixes

The identical script was run again on all three models against the fixed build
(`tmp/verify3407/post-*.log`). Measured change:

| | before | after |
|---|---|---|
| first-call successes (opus5) | 2 of 8 | 6 of 8 |
| first-call successes (dsflash) | 4 of 8 | 7 of 8 |
| "how many open issues" | ~5-6 calls, hand-partitioned | 1 call, `totalCount` |
| "list open PRs and their authors" | not completable (68 `pr.view` calls) | 1 call |

opus5 on the counting fix: *"`search.issues` returns an explicit `totalCount: 207` alongside
`hasMore: true`... which is what would have misled me if `hasMore` were not there."* All three
still rated the `issue.create` + `type` rejection the best error they hit.

### Findings from the re-run, fixed here

- Bot authors disagreed between operations: `app/cursor` from `issue list`, `cursor[bot]` from
  `search issues`, for the same issue, so cross-operation equality failed. Normalised to the
  `[bot]` form (AC-7). Both forms are accepted as `author:` qualifiers, so this is consistency
  rather than round-tripping.
- `hasMore` and `totalCount` sat at the END of the response, and a size-truncated response is
  cut from the end, so the total was the first casualty of the truncation it exists to guard
  against. They now lead the object.
- The search endpoint is rate-limited separately and GitHub's message says only "wait a few
  minutes". Two models fired parallel searches, got 403s across all of them, and could not tell
  that non-search operations still worked; one spent roughly eight of nineteen calls on the
  lockout. The throttling case now gets its own guidance naming the unaffected operations
  (AC-3). Note this PR increases pressure on that endpoint, since a truncated search makes a
  second search-API request for the count.

### AC-9: A caller can see which query actually ran

Given any list or search operation, when results are shaped, then
`effectiveQuery` reports the query that was executed, including the repository scope and the
`type:issue`/`type:pr` discriminator gh appends invisibly. `-label:bug` against a repository
with no `bug` label excludes nothing and returns the unfiltered total, which is
indistinguishable from the filter having been dropped; all three models flagged that, and two
independently proposed this remedy.

### AC-10: Documented exclusion syntax is actually accepted

Given `issue.list`'s `search` or a search operation's `query`, when the value begins with a
dash (`-label:bug`), then it is accepted. GitHub negates a qualifier that way and this tool
documents the syntax, but the generic leading-dash flag-injection guard rejected it while
accepting the semantically identical `is:open -label:bug`, so it blocked the documented form
and nothing else. All three models hit the rejection on the third evaluation round and each
worked around it by reordering the query.

The relaxation is scoped to the two search-query parameters and is safe by construction:
`search` reaches gh as the value of `--search`, never as a bare token, and `query` is tokenized
and emitted after the `--` option terminator added for AC-2. Every other string parameter keeps
the guard, which the tests pin alongside the argv placement that makes the exemption safe.

### Findings from the third re-run, since fixed

The third round was run against the build containing AC-8 and AC-9. It confirmed those (see
below) and found three defects introduced or documented by this work:

- The leading-dash rejection above, which contradicted documentation added in this PR.
- The rate-limit guidance claimed `issue.list` was unaffected by search throttling. That became
  false the moment `issue.list` gained a count request. Corrected to name which operations
  touch the search endpoint and which genuinely never do.
- The description carried two paragraphs that read as contradicting each other on whether
  `totalCount` is a true total when `hasMore` is set. Rewritten so `totalCount` is stated once,
  unambiguously, as the size of the whole result set.

### Findings from the second re-run, since fixed

Both items the first re-run left open were taken up rather than deferred.

`issue.list` and `pr.list` now carry `totalCount` too. The concern that held it back was that
their rows come from GraphQL while a total comes from the search index, so the count might
disagree with the list it accompanies. That was measured rather than assumed, and the two
agree exactly on every uncapped comparison available:

| query | `gh` list | search `total_count` |
|---|---|---|
| open issues | 210 | 210 |
| open pull requests | 66 | 66 |
| open issues labelled `Tooling` | 33 | 33 |
| open issues `no:assignee` | 143 | 143 |
| open issues `milestone:0.12.0` | 141 | 141 |

`--state closed` needed care in the mapping: `gh pr list --state closed` includes merged pull
requests (sampled: 196 merged against 4 plain-closed) and search's `is:closed` does too, so
`closed` maps to `is:closed` rather than to an unmerged-only filter. The count request is still
only made when the page is truncated, which keeps the added pressure off the throttled search
endpoint in the common case.

Known remaining limitation, deliberately not fixed here: results past the `limit` ceiling of
100 are still unreachable, because `gh search` exposes no page flag and the v1 protocol frame
cap of 64 KiB makes simply raising the ceiling unsafe. `totalCount` removes the reason most
callers wanted paging (counting); enumerating beyond 100 still requires narrowing the query.

## Out of scope

- `gh search issues --json` has no `milestone` field at all, so AC-5's milestone half covers
  `issue.view` and `issue.list` only. Search results do carry `assignees`, `author` and
  `labels`, which are now shaped.
- The repo is publicly readable (unauthenticated `raw.githubusercontent.com` fetch of the main
  README returned 200), so none of the observed errors were permission-related.

## Verification (to be completed during implementation)

- `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, and
  the `stepfun-37` smoke test per the issue workflow.
- Live spot-check through the built-in tool after the fix: the three failing forms from the
  evidence table return results or a guided error.
