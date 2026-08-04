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

**AB2 — The tool schema declares `threadId` and stops implying `number` is universal.**
`PARAMETER_SCHEMA.properties` declares a `threadId` property (`type: 'string'`)
whose description states it is the review-thread node id returned by
`pr.reviews` and that `pr.resolve-thread` identifies its target with it rather
than a pull request number. The `number` property description explicitly names
`pr.resolve-thread` as an operation that does not take `number`. The prose
description states that parameters are per-operation, that an operation rejects
parameters it does not accept and names the ones it does, and that
`pr.resolve-thread` identifies its target by `threadId` alone.

**AB3 — Unknown-key detection ignores the prototype chain.**
`validateParams` rejects an unknown parameter with
`Object.prototype.hasOwnProperty.call(spec, key)` rather than `key in spec`.
Because `in` walks the prototype chain, `constructor`, `toString` and an own
`__proto__` key — all inherited from `Object.prototype` — previously passed the
unknown-key check and were then never reached by the per-kind loop (which
iterates the spec's own entries). They are now rejected as unknown, closing the
gap that silently contradicted the "unknown parameters are REJECTED" invariant.

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
7. The `github` tool's declared schema structurally declares a `threadId`
   string property whose description references `pr.reviews`, the `number`
   property description names `pr.resolve-thread`, and the prose Notes state
   the per-operation rejection rule (AB2). Assertions read the schema via
   `in`-operator narrowing with no type assertions; a substring-only version
   is rejected as tautological.
8. `constructor`, `toString` and an own `__proto__` key (built with
   `Object.defineProperty` so it is a real own enumerable key) are each
   rejected by `validateResolveThreadParams` with `INVALID_PARAM` and the
   accepted-parameter message (AB3).
9. The exact unknown-parameter message — `Unknown parameter: number.
   Accepted parameters: threadId, repo. Required: threadId.` — is pinned with
   `toBe` for the two dispatch cases and the `validateResolveThreadParams`
   case, and the no-required case pins its full message too (AB1).

## Files in scope

- `packages/providers/src/auth/proxy/github-broker-validation.ts` (AB1, AB3)
- `packages/tools/src/tools/github.ts` (AB2)
- `packages/providers/src/auth/proxy/__tests__/github-broker-unknown-param.bun.test.ts` (new; AB1, AB3)
- `packages/tools/src/tools/github-unknown-param.bun.test.ts` (new; AB2)
- `scripts/bun-test-manifest.ts` and `scripts/bun-test-manifest-data-tools.ts` (register the new tests)

## Out of scope

- Accepting or ignoring `number` on `pr.resolve-thread`.
- Reworking the per-op bespoke `Parameter number is required` pre-checks in
  `pr.view` / `pr.checks` / `pr.reviews` / `issue.view` into `requiredParams`.
- Generating a full per-operation parameter table into the tool description
  (would duplicate the broker registry across a deliberate package boundary).
- Any other operation's parameter set.
