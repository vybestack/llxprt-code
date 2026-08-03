# Plan: GitHub host-broker for sandboxes

Plan ID: `PLAN-20260731-GHBROKER`
Generated: 2026-07-31
Total Phases: 19 (P01–P19)
Issues: closes #1663, closes #135
Design: [DESIGN.md](./DESIGN.md)

## Critical Reminders

1. TDD is mandatory — no production line without a failing test first.
2. Integration tests before unit tests.
3. Every artifact carries `@plan PLAN-20260731-GHBROKER.P##` and `@requirement REQ-###`.
4. Phases execute in exact numerical sequence. No skipping.
5. **Never regress the shipped sandbox hardening** (#1954 → #2467 → #2784). No
   new secret transport, no new env var, no new mount, no new listener, no
   relaxation of `list_api_keys` / `has_api_key` restrictions.
6. No eslint-disable, no ts-ignore/ts-expect-error/ts-nocheck, no complexity
   threshold increases. Fix the underlying issue.
7. Fail fast over defense in depth, except for genuinely external input
   (GitHub API responses, network I/O) where defensive parsing is correct.

---

## Requirements

### REQ-001: Credential never enters the sandbox

**Full Text**: No GitHub credential value shall be transmitted into the sandbox
container, placed in its environment, mounted into its filesystem, or returned
in any broker response.
**Behavior**:
- GIVEN a sandboxed session with the broker active
- WHEN the agent invokes any `github` operation
- THEN the response contains no substring equal to the host GitHub token
**Why This Matters**: This is the entire point of #1663. Any leak makes the
feature worse than useless because it looks safe.

### REQ-002: Typed operations, never a shell string

**Full Text**: The sandbox shall send an operation name and structured
arguments. The broker shall never accept, construct, or execute a
caller-supplied shell command string.
**Behavior**:
- GIVEN a broker request
- WHEN it is dispatched
- THEN arguments are passed as argv to `gh` with no shell interpretation
**Why This Matters**: Removes quoting/injection as a class of vulnerability and
makes the op set an auditable boundary.

### REQ-003: Broker multiplexes on the existing authenticated socket

**Full Text**: GitHub operations shall be served over the existing credential
proxy socket using the existing capability-token handshake. No new listener,
socket path, port, or authentication mechanism shall be introduced.
**Behavior**:
- GIVEN a sandbox connection authenticated by capability token
- WHEN a `github.*` op is sent
- THEN it is dispatched by the broker over that same connection
**Why This Matters**: #2784 hardened exactly one channel; a second one would
double the attack surface and the maintenance burden.

### REQ-004: Broker is a distinct component from the credential proxy

**Full Text**: GitHub operation handling shall live in a component separate from
`CredentialProxyServer`, sharing transport only.
**Behavior**:
- GIVEN the broker handles a GitHub op
- WHEN it needs credentials
- THEN it uses the host `gh` CLI's own auth, never `providerKeyStorage`
**Why This Matters**: The proxy's job is to hand credentials out; the broker's
job is never to. Same class = confused deputy.

### REQ-005: Concurrent dispatch with serialized writes

**Full Text**: Request dispatch shall execute concurrently per connection while
socket writes remain serialized. A long-running operation shall not delay
unrelated operations on the same connection.
**Behavior**:
- GIVEN a blocking `pr.checks` watch in flight
- WHEN a `get_api_key` request arrives on the same connection
- THEN it is answered without waiting for the watch to finish
**Why This Matters**: Today's `inFlight` chain would deadlock the agent's own
LLM provider auth behind a 15-minute CI watch.

### REQ-006: Frames accommodate real GitHub payloads

**Full Text**: The protocol shall carry responses at least as large as a
fully-commented issue or PR.
**Behavior**:
- GIVEN issue #1663 (~50 KB) with all comments
- WHEN retrieved via `issue.view`
- THEN the response is delivered without a frame-size error
**Why This Matters**: The 64 KB cap is already breached by the issue this
feature was requested on.

### REQ-007: Long-running operations have per-op timeouts and cancellation

**Full Text**: Operations shall specify their own timeout, and callers shall be
able to cancel an in-flight operation, terminating host-side work.
**Behavior**:
- GIVEN a blocking watch
- WHEN the user presses Ctrl+C
- THEN the host-side poller stops and no orphan remains
**Why This Matters**: A 30 s global timeout cannot express a 15-minute watch,
and an uncancellable one leaks host resources.

### REQ-008: gh-shaped tool surface

**Full Text**: Operation names shall mirror `gh` subcommands and parameters
shall mirror `gh` long flags with dashes removed. No `--json`/`--jq` equivalent
shall be required.
**Behavior**:
- GIVEN a model familiar with `gh`
- WHEN it needs `gh issue view 1663 --repo owner/name --comments`
- THEN `github({op:"issue.view", number:1663, repo:"owner/name", comments:true})`
  is the natural translation
**Why This Matters**: #135 exists because models hand-roll `--jq` badly.
Familiar shape plus shaped output removes both failure modes.

### REQ-009: Cross-repository operation

**Full Text**: Every operation shall accept an optional `repo: "owner/name"`,
defaulting to the current repository.
**Behavior**:
- GIVEN the session is in `vybestack/llxprt-code`
- WHEN the agent requests an issue in `acoliver/otherproject`
- THEN it is retrieved
**Why This Matters**: Bugs are cross-project. Implicit-repo-only would make the
tool useless for the actual workflow.

### REQ-010: Blocking watch with tiered polling

**Full Text**: `pr.checks` with `watch: true` shall block until checks conclude,
polling at 10 s for the first 30 s and 30 s thereafter.
**Behavior**:
- GIVEN a PR with running checks
- WHEN watched
- THEN the call returns once all checks conclude, within 30 s of conclusion
**Why This Matters**: Replaces the current poll-and-fight-timeouts pathology.
Bounded API cost (~2.4 % of hourly budget).

### REQ-011: Live progress UI during a blocking watch

**Full Text**: While a watch blocks, the UI shall display each check and its
state, updating in place, with elapsed time.
**Behavior**:
- GIVEN a watch in progress
- WHEN a check transitions
- THEN the display updates without scrolling
**Why This Matters**: A multi-minute silent block is indistinguishable from a
hang.

### REQ-012: Writes require confirmation

**Full Text**: Mutating operations shall route through the existing tool
confirmation path. Read operations shall not prompt.
**Behavior**:
- GIVEN `issue.comment`
- WHEN invoked
- THEN the user confirms, with normal allowlist/"always allow" semantics
**Why This Matters**: A prompt-injected agent must not post under the user's
identity unattended; prompting every read would be intolerable.

### REQ-013: Shaped, token-efficient responses

**Full Text**: Responses shall be structured for direct consumption.
`pr.reviews` with `actionable: true` shall exclude summary-only review bodies.
**Behavior**:
- GIVEN a PR with a long CodeRabbit summary and 5 actionable comments
- WHEN `pr.reviews {actionable:true}` is called
- THEN the 5 actionable items are returned without the summary
**Why This Matters**: #135's core complaint, and it keeps payloads small.

### REQ-014: `@issue-NNN` / `@pr-NNN` context references

**Full Text**: The at-completion system shall offer GitHub issue/PR references
which expand to shaped context, using the same broker backend.
**Behavior**:
- GIVEN the user types `@issue-16`
- WHEN completion runs
- THEN matching issues are offered and selection injects shaped context
**Why This Matters**: #135's originating request.

### REQ-015: Hardening is preserved

**Full Text**: `list_api_keys` shall continue returning empty to sandbox
callers, `has_api_key` shall remain blocked, capability-token authentication
shall remain required, and the capability shall remain confined to the
module-private factory cache.
**Behavior**:
- GIVEN the #1954 pentest exploit chain
- WHEN replayed against the post-change server
- THEN it fails at the same step it fails today
**Why This Matters**: Non-negotiable. A feature PR must not regress a security
fix.

---

## Phase Index

| Phase | Title | Requirements |
|---|---|---|
| P01 | Preflight verification | all |
| P02 | Analysis & pseudocode — transport | 005, 006, 007 |
| P03 | Concurrent dispatch, serialized writes | 005 |
| P04 | Verification of P03 | 005 |
| P05 | Frame capacity, per-op timeout, cancel | 006, 007 |
| P06 | Verification of P05 | 006, 007, 015 |
| P07 | Analysis & pseudocode — broker & op set | 002, 003, 004, 008 |
| P08 | Broker component, multiplexed dispatch | 002, 003, 004 |
| P09 | Verification of P08 | 001, 003, 004 |
| P10 | Read operations | 008, 009, 013 |
| P11 | Write operations + confirmation | 008, 009, 012 |
| P12 | Verification of P10–P11 | 008, 009, 012, 013 |
| P13 | `pr.checks` watch, tiered poll, cancel | 007, 010 |
| P14 | Live watch UI | 011 |
| P15 | `github` tool registration & description | 008, 013 |
| P16 | `@issue-NNN` / `@pr-NNN` completion | 014 |
| P17 | Security behavioral tests | 001, 015 |
| P18 | Documentation | all |
| P19 | Final verification, ocr, PR | all |

---

## P01: Preflight verification

**Phase ID**: `PLAN-20260731-GHBROKER.P01`

Verify every assumption before code. Record results in `preflight.md`.

- [ ] `MAX_FRAME_SIZE`, `REQUEST_TIMEOUT_MS`, `IDLE_TIMEOUT_MS` values current
- [ ] `state.inFlight` chain still serializes dispatch
- [ ] `get_api_key` still serves sandbox callers; `has_api_key` still blocked
- [ ] Capability token still arrives via fd 3 and lives only in the factory cache
- [ ] Host `gh` authenticated; `gh --version` ≥ 2.x
- [ ] `gh` present in sandbox image
- [ ] `updateIssue` still accepts `issueTypeId`/`labelIds`/`projectIds`
- [ ] `resolveReviewThread` still takes only `threadId`
- [ ] `useAtCompletion` non-file source precedent intact

**Exit**: every box ticked or the plan is amended.

---

## P02: Analysis & pseudocode — transport

**Phase ID**: `PLAN-20260731-GHBROKER.P02`
**Prerequisites**: P01

Produce `analysis/pseudocode/001-concurrent-dispatch.md` and
`002-frame-and-cancel.md`. Numbered lines. Must cover:

- write-queue ordering guarantees and back-pressure
- in-flight registry keyed by request id, with cancellation
- interaction with `IDLE_TIMEOUT_MS` while an op is legitimately long
- version negotiation and v1/v2 coexistence contract
- failure semantics when a cancelled op's host work is mid-flight

**No production code in this phase.**

---

## P03: Concurrent dispatch, serialized writes

**Phase ID**: `PLAN-20260731-GHBROKER.P03`
**Prerequisites**: P02
**Requirements**: REQ-005

Replace the `state.inFlight` handler chain with concurrent dispatch plus a
per-connection write queue.

**Integration test first**: a slow op and a fast op issued together on one
connection; the fast one returns first.

**Files to modify**
- `packages/providers/src/auth/proxy/credential-proxy-server.ts`
  — `shouldContinueProcessing()`, add write queue

**Verification**
```bash
grep -r "@plan PLAN-20260731-GHBROKER.P03" packages/ | wc -l
npm test -- credential-proxy-server
```
Existing proxy suites must pass unchanged.

---

## P04: Verification of P03

**Phase ID**: `PLAN-20260731-GHBROKER.P04`

Independent check: pseudocode compliance, no interleaved writes under load, no
regression in #2467/#2784 behavioral suites, no suppression directives added.

---

## P05: Frame capacity, per-op timeout, cancel

**Phase ID**: `PLAN-20260731-GHBROKER.P05`
**Prerequisites**: P04
**Requirements**: REQ-006, REQ-007

**Integration test first**: a ~50 KB and a ~500 KB payload round-trip; a
long-running op is cancelled and the host-side work stops.

**Files to modify**
- `packages/auth/src/proxy/framing.ts` — capacity
- `packages/auth/src/proxy/proxy-socket-client.ts` — per-request timeout, cancel
- `packages/providers/src/auth/proxy/credential-proxy-server.ts` — cancel op

Frame capacity must remain **bounded** — raising it is not removing it; an
unbounded frame is a memory-exhaustion vector from a hostile sandbox.

---

## P06: Verification of P05

**Phase ID**: `PLAN-20260731-GHBROKER.P06`
**Requirements**: REQ-015

Confirm bounded capacity, no partial-frame regression, capability auth intact,
enumeration restrictions intact, v1 clients still negotiate.

---

## P07: Analysis & pseudocode — broker & op set

**Phase ID**: `PLAN-20260731-GHBROKER.P07`
**Prerequisites**: P06
**Requirements**: REQ-002, REQ-003, REQ-004, REQ-008

Produce `analysis/pseudocode/003-github-broker.md` covering argv construction
(no shell), op registry, `repo` resolution, GraphQL error translation
(HTTP 200 + `errors[]`), rate-limit 403/429 surface, and the response-shaping
contract per op.

---

## P08: Broker component, multiplexed dispatch

**Phase ID**: `PLAN-20260731-GHBROKER.P08`
**Requirements**: REQ-002, REQ-003, REQ-004

New host-side broker, registered as a dispatch target on the existing socket.
No new listener. Executes `gh` by argv. Uses no `providerKeyStorage`.

**Integration test first**: a `github.*` op over an authenticated connection
returns shaped data; an unauthenticated connection is rejected identically to
today.

---

## P09: Verification of P08

**Phase ID**: `PLAN-20260731-GHBROKER.P09`
**Requirements**: REQ-001, REQ-003, REQ-004

Assert: no new socket/listener/env/mount; broker never imports
`providerKeyStorage`; no response contains the host token.

---

## P10: Read operations

**Phase ID**: `PLAN-20260731-GHBROKER.P10`
**Requirements**: REQ-008, REQ-009, REQ-013

`issue.view`, `issue.list`, `pr.view`, `pr.list`, `pr.diff`, `pr.reviews`
(+`actionable`), `pr.checks` (non-watch), `run.list`, `search.issues`,
`search.prs`, `label.list`. All accept `repo`.

---

## P11: Write operations + confirmation

**Phase ID**: `PLAN-20260731-GHBROKER.P11`
**Requirements**: REQ-008, REQ-009, REQ-012

`issue.create`, `issue.comment`, `issue.edit` (type/labels/projects/assignees/
state in one `updateIssue`), `issue.close`, `pr.create`, `pr.comment`,
`pr.edit`, `pr.ready`, `pr.resolve-thread`, `label.create`.

Every write routes through the existing tool-confirmation path.

---

## P12: Verification of P10–P11

**Phase ID**: `PLAN-20260731-GHBROKER.P12`

Op-name/flag fidelity to `gh`, `repo` honoured on every op, shaping contract
met, no write bypasses confirmation.

---

## P13: `pr.checks` watch, tiered poll, cancel

**Phase ID**: `PLAN-20260731-GHBROKER.P13`
**Requirements**: REQ-007, REQ-010

Blocking watch. Poll 10 s for the first 30 s, then 30 s. Cancellation stops the
host poller. Behavioral test with a fake clock asserting the schedule and that
`get_api_key` is answered during the watch (REQ-005 end-to-end).

---

## P14: Live watch UI

**Phase ID**: `PLAN-20260731-GHBROKER.P14`
**Requirements**: REQ-011

In-place check list with elapsed time; Ctrl+C cancels. **Must be exercised in
the tmux harness** (`dev-docs/tmux-harness.md`) before the PR.

---

## P15: `github` tool registration & description

**Phase ID**: `PLAN-20260731-GHBROKER.P15`
**Requirements**: REQ-008, REQ-013

Register the tool; description carries worked examples and the exact response
shape per op. Add the sandbox `gh`-auth-failure hint pointing at the tool.

---

## P16: `@issue-NNN` / `@pr-NNN` completion

**Phase ID**: `PLAN-20260731-GHBROKER.P16`
**Requirements**: REQ-014

New at-completion source following the `CommandKind.SUBAGENT` precedent, backed
by the broker. Debounced search, cancellation via the existing reducer.

---

## P17: Security behavioral tests

**Phase ID**: `PLAN-20260731-GHBROKER.P17`
**Requirements**: REQ-001, REQ-015

- Replay the #1954 exploit chain; it must fail where it fails today.
- Assert no `github` op response contains the host token (real token-shaped
  value, not a mock).
- Assert the broker cannot be induced to execute a shell string.
- Assert no new secret reaches container env, mounts, or the image.

---

## P18: Documentation

**Phase ID**: `PLAN-20260731-GHBROKER.P18`

`docs/tools/` entry for the tool, `docs/sandbox.md` update describing the
boundary, and an explicit note that `shellEnvSecrets` was considered and
rejected with the reason.

---

## P19: Final verification, ocr, PR

**Phase ID**: `PLAN-20260731-GHBROKER.P19`

`npm run test`, `lint`, `typecheck`, `format`, `build`, plus the profile smoke.
Then detached ocr with a 20-minute floor, remediate findings, then open the PR
referencing #1663 and #135.
