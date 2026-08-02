# Pseudocode: GitHub Broker

Plan ID: `PLAN-20260731-GHBROKER`
Phase: P07 (analysis) → implemented in P08 (component), P10/P11 (ops), P13 (watch)
Requirements: REQ-001, REQ-002, REQ-003, REQ-004, REQ-008, REQ-009, REQ-013
Component: `packages/providers/src/auth/proxy/github-broker.ts` (new)

---

## Contract

### Inputs
```typescript
interface GitHubOpRequest {
  op: string;                       // "issue.view", "pr.checks", ...
  repo?: string;                    // "owner/name"; defaults to cwd repo
  [param: string]: unknown;         // op-specific, validated per descriptor
}
```

### Outputs
```typescript
interface GitHubOpResponse {
  data: unknown;                    // shaped per op, never raw gh JSON
  truncated?: { field: string; originalBytes: number };
}
```

### Dependencies (NEVER stubbed)
```typescript
import { execFile } from 'node:child_process';  // NEVER exec/spawn with shell
```

**The broker MUST NOT import `providerKeyStorage`, `TokenStore`, or anything
from the credential-storage layer (REQ-004).** Its only credential interaction
is that the `gh` child process reads its own keyring. Enforce with a test that
greps the module's import graph.

---

## Integration: how the broker reaches the socket (REQ-003)

```
01: EXTEND CredentialProxyServerOptions:
02:   extraHandlers?: Record<string, RequestHandler>
03: IN CredentialProxyServer constructor:
04:   MERGE options.extraHandlers INTO this.requestHandlers
05:   REJECT at construction if a key collides with a built-in op name
06:      (fail fast — silent override of get_api_key would be catastrophic)
07:
08: The broker is constructed by the CLI and injected. The server does not
09:   import the broker; the broker does not import the server's storage.
10:   No new listener, socket, port, env var or mount. Requests reach the
11:   broker only AFTER the handshake gate, so capability-token auth applies
12:   to every GitHub op with no extra code.
```

---

## Argument construction — never a shell (REQ-002)

```
13: ALWAYS execFile('gh', argv, { shell: false })
14: NEVER exec(), NEVER spawn(..., {shell:true}), NEVER string concatenation
15:
16: Every parameter is validated by its descriptor BEFORE reaching argv:
17:   repo    → /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
18:   number  → Number.isInteger(v) AND v > 0
19:   state   → enum: open | closed | merged | all
20:   label   → /^[A-Za-z0-9 ._-]+$/ per element
21:   threadId→ /^[A-Za-z0-9_=-]+$/
22:   body    → any string; passed via --body-file with a temp file, NOT
23:              inline, so newlines and length are never an argv concern
24:   free text (search, title) → any string, but see line 26
25:
26: REJECT any string parameter whose value begins with '-'. Even with
27:   execFile, a value like "--repo" landing in a positional slot would be
28:   read by gh as a flag. Fail fast with INVALID_PARAM.
29:
30: Unknown parameters are REJECTED, not ignored (fail fast). A typo must
31:   not silently produce a different query than the caller intended.
```

### Environment for the child process

```
32: DO NOT set GH_TOKEN or GITHUB_TOKEN. gh must resolve its own keyring
33:   credential; setting one would materialise a secret the broker has no
34:   reason to hold (REQ-001).
35: PASS a minimal env: PATH, HOME, and the gh config vars only.
36: SET GH_PROMPT_DISABLED=1 and GH_NO_UPDATE_NOTIFIER=1 so a child can
37:   never block waiting on a TTY that does not exist.
```

---

## Op registry

```
38: INTERFACE OpDescriptor {
39:   name: string                    // "issue.view"
40:   mutating: boolean               // drives confirmation (REQ-012)
41:   params: Record<string, ParamSpec>
42:   buildArgv(params) → string[]    // pure; no I/O
43:   shape(rawJson) → unknown        // pure; no I/O
44: }
45:
46: DISPATCH:
47:   LOOKUP descriptor BY op name; unknown op → UNKNOWN_OP (fail fast)
48:   VALIDATE params against descriptor.params
49:   argv = descriptor.buildArgv(params)
50:   raw = AWAIT runGh(argv, signal)
51:   RETURN descriptor.shape(raw)
```

### Repo resolution (REQ-009)

```
52: IF params.repo PROVIDED: validate (line 17), append ['--repo', repo]
53: ELSE: omit --repo entirely and let gh infer from cwd
54: NEVER attempt to "helpfully" guess a repo when inference fails; surface
55:   gh's own error so the caller learns the cwd is not a repo.
```

---

## Running gh

```
56: runGh(argv, signal):
57:   child = execFile('gh', argv, { shell: false, signal,
58:                                  maxBuffer: 8 * 1024 * 1024, env: minimalEnv })
59:   AWAIT completion
60:   IF signal.aborted → THROW CancelledError
61:   IF exitCode === 0 → PARSE stdout AS JSON (ops always request --json)
62:   ELSE → CLASSIFY per the error table below
63:
64: maxBuffer of 8 MiB is deliberately larger than the 4 MiB frame cap so an
65:   oversize response fails in shaping (where we can truncate intelligibly)
66:   rather than as an opaque ENOBUFS from the child process.
```

---

## Error translation

GitHub failures arrive in three different shapes. All three must become a
structured response; none may leak a credential.

```
67: GRAPHQL: HTTP 200 with a top-level errors[] array.
68:   IF parsed.errors IS non-empty:
69:     code = mapGraphQLError(parsed.errors[0].type)
70:       NOT_FOUND        → NOT_FOUND
71:       FORBIDDEN        → PERMISSION_DENIED
72:       RATE_LIMITED     → RATE_LIMITED
73:       otherwise        → GITHUB_ERROR
74:     MESSAGE = parsed.errors[0].message
75:   NOTE: partial success (data AND errors both present) is REPORTED AS AN
76:     ERROR, not silently returned as partial data. Fail fast.
77:
78: REST/CLI: non-zero exit.
79:   stderr contains 'rate limit' OR 'API rate limit exceeded'
80:                                   → RATE_LIMITED
81:   stderr contains 'Could not resolve to a' OR 'not found'
82:                                   → NOT_FOUND
83:   stderr contains 'gh auth login' OR 'authentication'
84:                                   → HOST_AUTH_REQUIRED
85:   stderr contains 'HTTP 403'      → PERMISSION_DENIED
86:   otherwise                       → GITHUB_ERROR
87:
88: TRANSPORT: gh binary missing / ENOENT → HOST_GH_UNAVAILABLE
89:
90: SANITISE every message before it leaves the broker: run the outbound
91:   string through a redactor for token-shaped substrings
92:   (gh[pousr]_[A-Za-z0-9]{20,}, github_pat_[A-Za-z0-9_]{20,}).
93:   This is belt-and-braces — the broker never holds a token — but stderr
94:   comes from an external process we do not control, which is exactly the
95:   case where defensive handling is correct.
```

### Rate limiting (REQ-010 support)

```
96:  ON RATE_LIMITED: include retryAfter seconds when gh reports a reset time.
97:  The watch loop (P13) MUST back off rather than continue polling.
98:  Steady-state watch cost: 30s interval = 120 req/hr against a 5000/hr
99:    REST budget (2.4%). Multiple concurrent watches are bounded by the
100:   16-op per-connection cap from P03.
```

---

## Shaping contracts (REQ-013)

Verified against live `gh` output. Shaping is what keeps payloads inside the
frame budget and removes the caller's need for `--jq`.

```
101: issue.view  → { number, title, state, author, labels[], body,
102:                 comments: [{ author, createdAt, body }] }
103:   comments INCLUDED only when params.comments is true.
104:
105: pr.checks   → { checks: [{ name, bucket, state, link }],
106:                 summary: { pass, fail, pending, skipping } }
107:   gh exposes `bucket` (pass|fail|pending|skipping) — use it directly
108:   rather than re-deriving state, and use it for the watch terminal
109:   condition (P13): done WHEN no check has bucket === 'pending'.
110:
111: pr.reviews  → { threads: [{ id, path, line, isResolved, isOutdated,
112:                             viewerCanResolve,
113:                             comments: [{ author, body }] }] }
114:   WHEN params.actionable IS true, EXCLUDE threads where
115:     isResolved OR isOutdated. This is the #135 ask: it drops the
116:     summary-only review bodies and leaves the items needing action.
117:   The thread `id` is what pr.resolve-thread consumes, so the actionable
118:     listing and the resolve op compose without a second round trip.
119:
120: issue.list / search.* → { issues: [{ number, title, state, labels[],
121:                                       updatedAt }] }
122:   Bodies EXCLUDED from list results. A list of 68 issues with bodies is
123:   the single most likely way to blow the frame budget.
124:   DEFAULT limit 30; hard maximum 100.
124a:
124b: CRITICAL — RESPONSE ENVELOPE: every op MUST return a non-array object.
124c:   isProxyResponseFrame() in proxy-socket-client.ts explicitly rejects an
124d:   array as `data`:
124e:       Array.isArray(frame.data) → invalid frame
124f:   A bare array is therefore silently unusable on the client. Collection
124g:   ops wrap in a named key: issue.list → { issues }, pr.list → { prs },
124h:   label.list → { labels }, run.list → { runs },
124i:   search.issues → { issues }, search.prs → { prs }.
124j:   This matches pr.checks ({ checks, summary }) and pr.reviews
124k:   ({ threads, truncated }), which were already correct.
124:
125: TRUNCATION: if a shaped body exceeds 64 KiB, truncate and set
126:   truncated: { field, originalBytes }. Never silently drop.
```

---

## Invariants (assert in tests)

```
I1: No op response ever contains a value matching a GitHub token pattern.
I2: The broker module's import graph contains no credential-storage module.
I3: gh is never invoked through a shell; argv is always an array.
I4: A parameter beginning with '-' is rejected, not passed through.
I5: An unknown op or unknown parameter is rejected, not ignored.
I6: extraHandlers cannot override a built-in op name.
I7: GraphQL partial success is surfaced as an error, never as partial data.
I8: Every op honours `repo`; omitting it infers from cwd.
```

---

## Test Plan (integration first; real gh where the repo is public)

```
T1:  issue.view against a real public issue returns the shaped contract   (REQ-013)
T2:  issue.view with repo targets another repository                      (REQ-009, I8)
T3:  a parameter beginning with '-' is rejected INVALID_PARAM             (I4)
T4:  an unknown op → UNKNOWN_OP; an unknown param → INVALID_PARAM         (I5)
T5:  constructing the server with a colliding extraHandler throws         (I6)
T6:  a GraphQL errors[] payload maps to the right structured code         (lines 67-76)
T7:  GraphQL data+errors together surfaces as error, not partial data     (I7)
T8:  simulated stderr carrying a token-shaped string is redacted          (I1, lines 90-95)
T9:  broker import graph excludes credential storage                      (I2)
T10: pr.reviews actionable excludes resolved and outdated threads         (REQ-013)
T11: issue.list omits bodies and caps at the limit                        (lines 120-124)
T12: an oversize body truncates with a marker rather than failing         (lines 125-126)
T13: gh missing from PATH → HOST_GH_UNAVAILABLE                           (line 88)
T14: capability-token auth still required to reach any github op          (REQ-015)
```
