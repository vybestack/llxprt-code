# Issue #3019 — `pr.resolve-thread` rejects `number` with a dead-end error

## Problem

Calling the `github` tool as:

    { "op": "pr.resolve-thread", "threadId": "PRRT_...", "number": 3018 }

fails with:

    GitHub operation failed: Unknown parameter: number

`resolveReviewThread` takes only a thread node id, so `pr.resolve-thread`'s
descriptor (`packages/providers/src/auth/proxy/github-broker-multistep-ops.ts`)
accepts exactly `threadId` and `repo`. The broker's strict validation
(`github-broker-validation.ts`) rejects any parameter outside that set — which
is the documented and correct invariant
(`project-plans/20260731-gh-sandbox-broker/analysis/pseudocode/003-github-broker.md`
line 30: "Unknown parameters are REJECTED, not ignored (fail fast)").

Two things combine to make this a dead end for a model:

1. **The tool schema advertises `number` globally.** `PARAMETER_SCHEMA` in
   `packages/tools/src/tools/github.ts` documents exactly three properties —
   `op`, `repo`, `number` — with `additionalProperties: true`. `number` is
   described as "Issue or pull request number, for operations that take one",
   with nothing anywhere saying which operations those are. Supplying the PR
   number for a PR-scoped operation is the natural reading.
2. **The rejection carries no recovery information.** `Unknown parameter:
   number` names only what is wrong, never what is right. A caller that passed
   only `number` (no `threadId`) gets the same message, which hides the real
   problem — the missing `threadId` — completely.

In the reported session the model abandoned the tool and issued a raw
`gh api graphql` mutation instead.

## Accepted behaviour

**AB1 — Unknown-parameter rejections are self-correcting.**
When an operation is called with a parameter its descriptor does not accept,
the `INVALID_PARAM` message names the offending parameter *and* the parameters
that operation does accept, in descriptor declaration order, plus its required
parameters when the descriptor declares any. For issue #3019 the message
becomes:

    Unknown parameter: number. Accepted parameters: threadId, repo. Required: threadId.

**AB2 — The tool schema stops implying `number` is universal.**
The `github` tool's `number` schema description and its prose description state
that parameters are per-operation, that an operation rejects parameters it does
not accept and names the ones it does, and that `pr.resolve-thread` identifies
its target by `threadId` alone.

Behaviour NOT changed (deliberate): `pr.resolve-thread` continues to REJECT
`number` rather than accepting and ignoring it. Silently ignoring unknown
parameters is explicitly forbidden by the broker's design (a typo must not
produce a different query than the caller intended), and `number` is genuinely
meaningless to `resolveReviewThread`.

## Inputs and boundary cases

| Case | Expected |
| --- | --- |
| `pr.resolve-thread` + `{threadId, number}` | `INVALID_PARAM`; message lists `threadId, repo` and `Required: threadId` |
| `pr.resolve-thread` + `{number}` only | Same message — the unknown-parameter check runs first, and the message reveals the required `threadId` |
| Op whose descriptor declares no `requiredParams` (e.g. `issue.list`) | Message lists accepted parameters, and has NO `Required:` clause |
| Multiple unknown parameters | First unknown key in insertion order reported (unchanged) |
| Known parameter with an invalid value | Existing per-kind messages unchanged |
| Valid parameters | Still validate to `null`; no gh invocation behaviour changes |
| Unknown *operation* | Still `UNKNOWN_OP`, unchanged |

Accepted-parameter order is the descriptor's declaration order (`Object.keys`
of the param spec), which is deterministic and puts the operation's primary
parameter first.

## Tests that prove it (written first, Bun + `bun:test`)

New file: `packages/providers/src/auth/proxy/__tests__/github-broker-unknown-param.bun.test.ts`,
registered in `scripts/bun-test-manifest.ts` under the `providers` workspace.

1. `executeGitHubOp('pr.resolve-thread', { threadId, number })` rejects with a
   message containing `Unknown parameter: number`, `Accepted parameters:
   threadId, repo` and `Required: threadId` — driven through the real dispatch
   path, which validates before any `gh` process is spawned.
2. `executeGitHubOp('pr.resolve-thread', { number })` (no `threadId`) produces
   the same self-correcting message.
3. `validateResolveThreadParams({ threadId, number })` returns
   `code === 'INVALID_PARAM'` with the accepted-parameter list.
4. `validateIssueListParams({ bogus: true })` lists `search, state, label,
   limit, repo` and contains no `Required:` clause.
5. `validateIssueViewParams({ number, bogusParam })` lists `number, comments,
   repo`.
6. Regression guards: a valid `pr.resolve-thread` param set still validates to
   `null`; an invalid *value* (e.g. `repo: 'not-a-repo'`) still yields its
   existing message and is not rewritten.
7. The `github` tool's declared schema/description documents the per-operation
   parameter rule and that `pr.resolve-thread` is addressed by `threadId`
   rather than `number` (AB2).

## Files in scope

- `packages/providers/src/auth/proxy/github-broker-validation.ts` (AB1)
- `packages/tools/src/tools/github.ts` (AB2)
- `packages/providers/src/auth/proxy/__tests__/github-broker-unknown-param.bun.test.ts` (new)
- `scripts/bun-test-manifest.ts` (register the new test)

## Out of scope

- Accepting or ignoring `number` on `pr.resolve-thread`.
- Reworking the per-op bespoke `Parameter number is required` pre-checks in
  `pr.view` / `pr.checks` / `pr.reviews` / `issue.view` into `requiredParams`.
- Generating a full per-operation parameter table into the tool description
  (would duplicate the broker registry across a deliberate package boundary).
- Any other operation's parameter set.
