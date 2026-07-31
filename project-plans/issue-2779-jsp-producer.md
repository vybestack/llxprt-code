# Issue 2779 delivery plan

## Scope decision

Deliver one issue-linked LLxprt Code pull request implementing the opt-in native JSP/1 producer needed by Jefe issue 522. Internal commits may split pure producer state, transport/bootstrap, native event wiring, compliance, and integration proof. No stacked PRs.

## Shared contract

- Jefe issue: https://github.com/vybestack/llxprt-jefe/issues/522
- Compliance authority: Jefe issue 477 and `llxprt-jefe/dev-docs/jsp/v1/`
- Environment variable: `LLXPRT_JSP_BOOTSTRAP_FILE`
- Closed bootstrap data: schema 1, protocol jsp/1, loopback endpoint, registration ID, publisher credential, Jefe agent ID, positive lifecycle generation.
- LLxprt generates a fresh cryptographically strong source epoch per producer start.
- JSP/1 is current-state and snapshot-first. No replay, history, resume, cursor negotiation, control, or resync-required behavior.
- Bounds are inclusive UTF-8 bytes, not JavaScript string length.
- Missing bootstrap disables observation. Explicit malformed/insecure/version-mismatched bootstrap fails startup before TUI entry. After valid startup, transport outage or queue pressure degrades telemetry without failing/blocking the foreground TUI.

## Acceptance matrix

| ID | Boundary | Inputs / edge cases | Success | Failure / side effects | Evidence |
| --- | --- | --- | --- | --- | --- |
| P1 | CLI startup | Env absent; valid, missing, malformed, insecure, wrong-version, non-loopback bootstrap | Absent disables JSP; valid config is read once and activates producer | Explicit invalid config fails fast without leaking values | Bootstrap tests |
| P2 | Identity | Agent ID/generation from bootstrap; fresh start/relaunch; same-directory instances | Producer creates new epoch, starts sequence/revisions fresh, and never self-selects Jefe identity | Stale/replayed identity cannot pass broker binding | Identity tests |
| P3 | Sink ownership | Existing foreground AgentEvent consumption and native state boundaries | One read-only bridge observes canonical copies without a second async-generator consumer or confirmation-bus transport | No foreground behavior/ownership change | Boundary/integration tests |
| P4 | Initial/current state | Session startup and explicit transitions | First accepted document is a complete snapshot; later contiguous events preserve canonical current snapshot | Later event never precedes required snapshot | State-machine tests |
| P5 | Turn/activity/wait | Turn start/end/error/cancel; tool work; explicit confirmation wait/resolution; silence | Authoritative Working/Ready/Waiting facts and elapsed anchor | Silence/timeouts never synthesize wait/activity | Transition-table tests |
| P6 | Assistant message | Streaming chunks, thinking, flush/commit, empty/at-limit/over-limit multibyte content | Publish only at actual user-visible commit with a new commit timestamp and bounded excerpt | Draft/private content never publishes; over-bound rejected locally | Commit/redaction tests |
| P7 | Todos | Session/agent filtering; empty/full replacement; revisions; at-limit/over-limit | Positive strictly increasing per-epoch revisions and complete `{text,completed}` lists | Cross-agent events ignored; invalid bounds rejected | Todo tests |
| P8 | Tool headline | Creation, approval, schedule, execution, terminal phases, concurrent interleaving | Latest-created tool remains headline while its phase updates | Older tool result cannot replace headline | Tool-order tests |
| P9 | Privacy | Thinking, prompts, args, commands, output, file/env data, approval secrets; no-content mode | Captured bytes contain no forbidden markers; no-content preserves status/timestamps | Secret/private marker fails tests before transport | Canary tests |
| P10 | Nonblocking queue | Blocked transport, capacity, overflow, recovery | Foreground hooks perform bounded synchronous enqueue only; loss triggers fresh canonical snapshot before later tail | No backpressure/throw into TUI; no silent unsafe continuation | Blocked real-server tests |
| P11 | Publisher | Register, publish, heartbeat, outage/reconnect, auth rejection | Authenticated loopback POST; quiet heartbeat; reconnect snapshot-first | Outage degrades telemetry only; no confirmation/input authority | Fake-clock and real-loopback tests |
| P12 | Compliance | Runner-owned producer challenge and fixture corpus | One executable adapter passes the Jefe producer profile | Stable failure identifies invariant | Cross-repo compliance command |
| P13 | Native integration | Real native TUI with deterministic fake responses and real loopback server | Todo replacement, committed reply, and working→ready status publish from real boundaries | Test server cannot replace agent state boundaries | LLxprt integration test |
| X1 | Jefe tmux proof | Real Jefe launches real LLxprt package-tree launcher | Jefe Preview shows actual todo, committed reply, and truthful status | No model/network credentials or semantic terminal scraping | Jefe issue 522 scenario |

## Ownership boundaries

- Keep producer-specific protocol, state, redaction, queue, and transport local to the CLI unless repository architecture shows a narrower established owner.
- Use canonical public AgentEvent/current native state and the actual user-visible message commit seam.
- Subscribe to todoEvents with correct session/agent filtering and full replacement.
- Do not add a second `mapLoopStream` consumer.
- Do not use ACP, CoreEventEmitter, or confirmation MessageBus as the observation transport.
- Transport never receives control/input/confirmation capabilities.

## Vertical slices

### C1 — Schema-first producer state

- Acceptance: P2, P4-P9.
- RED: closed Zod schemas and pure transition tests for snapshot/events, byte bounds, privacy, todos, tools, and message commit.
- GREEN: immutable producer state and document construction.
- Stop: public Agents API expansion or behavior not representable by JSP/1.

### C2 — Bounded sink and transport

- Acceptance: P10, P11.
- RED: blocked real loopback endpoint proves nonblocking overflow and snapshot-first recovery.
- GREEN: focused bounded queue/worker and authenticated publisher.
- Stop: new dependency, worker/process subsystem outside accepted issue intent, proxy/remote transport, or control channel.

### C3 — Bootstrap and native wiring

- Acceptance: P1, P3, P5-P8.
- RED: bootstrap cases and real boundary tests fail before wiring.
- GREEN: optional composition at CLI startup and canonical event/commit/todo seams.
- Stop: second stream consumer, TUI ownership change, ACP change, or unrelated refactor.

### C4 — Compliance and real integration

- Acceptance: P12, P13, X1.
- RED: producer adapter and native integration fail before complete implementation.
- GREEN: Jefe compliance profile and real loopback native test pass; provide executable path for Jefe harness.
- Stop: standalone bundling/packaging redesign.

## Expected paths

- Focused new modules under `packages/cli/src/observation/`
- `packages/cli/src/cliSessionBootstrap.ts`
- `packages/cli/src/ui/hooks/agentStream/useSubmitQuery.ts`
- `packages/cli/src/ui/hooks/agentStream/agentEventDispatcher.ts`
- existing canonical tool lifecycle seam
- `packages/cli/src/ui/contexts/TodoProvider.tsx` or adjacent established composition point
- focused unit/integration tests and cross-repo proof wrapper/script if needed

## Explicit non-goals

- Jefe host/UI implementation.
- ACP changes or public control APIs.
- A second foreground stream consumer.
- Remote/late attachment, other agents, subagent rows, nested tasks.
- Replay/history/resume/cursor negotiation/resync-required.
- Prompt injection, steering, confirmation response, or input control.
- Raw/draft/private content.
- New lint ignores, eslint disables, TypeScript suppression, threshold increases, or quality-gate changes.
- `.llxprt` changes.

## Scope ledger

| Item | Disposition | Notes |
| --- | --- | --- |
| Native JSP producer | Accepted | Issue intent |
| Jefe embedded endpoint compatibility | Accepted | Required shared profile |
| Real Jefe harness proof support | Accepted | Required final acceptance |
| Public Agents API | Not approved | Keep CLI-local unless proven unavoidable |
| New dependency | Not approved | Stop if required |
| ACP/control | Rejected | Separate controlling runtime |
| `.llxprt` changes | Rejected | Protected and untouched |

## Review counters

- Independent review/remediation cycles: 0 of 2. Subagent reviewers were
  unavailable for this run: every configured profile returned a provider error
  (usage limit reached, missing API key, or load-balancer exhaustion). This work
  has had no independent TypeScript reviewer.
- Local OCR: 1 of 2.
- PR OCR: 0 of 2.

## Review dispositions

Addressed:

- Foreground isolation. Every observation entry point is wrapped at the wiring
  boundary rather than at individual call sites, so a tap, producer, or
  transport failure degrades telemetry only and cannot break UI event dispatch.
- Stuck turn. `executeStream` throwing before the agent emits `done` now closes
  the observed turn instead of leaving it active for the session.
- Turn-scoped tool correlation is cleared at each turn boundary, so a cancelled
  turn cannot leak a stale approval into a later turn or grow without bound.
- The wait resolves only once every concurrently approved tool has left
  approval.
- The publisher no longer overwrites the producer's `bridge_observed_ms`.
- A phase change for a superseded tool no longer advances the sequence.
- Loopback octets are constrained, and boundary fixtures derive from
  `JSP_BOUNDS` rather than repeating literals.
- Recording cleanup registers before observation setup, so the intended
  fail-fast on an invalid bootstrap no longer strands the lock handle, and a
  telemetry shutdown failure no longer skips recording disposal.
- The compliance adapter reports malformed challenge JSON through its own
  diagnostic instead of leaking a raw `SyntaxError`.
- `initProducerState` no longer accepts an unused clock.

Dismissed with reason:

- "Out-of-range loopback octets are a security hole." Not reachable: URL parsing
  rejects an invalid IPv4 literal before the loopback test runs, so the endpoint
  is refused as malformed. The stricter pattern was still adopted, and the test
  pins the code the implementation actually returns.
- "Replace the queue's `Array.shift()` to avoid O(n^2) draining." Capacity is
  256 documents, so the worst case is trivial; a head-pointer ring buffer adds
  state and compaction logic for no measurable benefit.
- "Log publisher failures." Any console output would corrupt the alternate-
  screen TUI. Publication failure is observable from the broker side, and the
  queue already records overflow and forces snapshot-first recovery.
- "Remove the redundant `setToolContext` injection in the scheduler." Changing
  tool context injection is outside this issue's accepted scope and carries
  regression risk disproportionate to the cleanup.

## Verification evidence

### RED

- `npm test -- --run src/observation` from `packages/cli` failed before implementation: all 11 partial suites failed collection because workspace declaration outputs were absent; Vite also reported recursive duplicate `overflowed` and `stopped` queue members.
- After rebuilding workspace packages, the same command reached the behavioral tests and failed 7 assertions: registration did not capture the initial snapshot, the native tap missed `turn.started`, compliance omitted required event evidence, and transport/queue tests encoded the broken registration and recovery behavior.

### Focused GREEN

- `npm test -- --run src/observation` from `packages/cli` — pass, 8 files / 54 tests at final head.
- Scoped ESLint over every issue source, test, native seam, and adapter with `--max-warnings 0` — pass at final head.
- The final issue-scope scan found no NUL bytes, `any`, type assertions, or non-null assertions.
- `cargo run --quiet --bin jefe-jsp-compliance -- producer --adapter 'bun .../llxprt-code/scripts/jsp-producer-adapter.ts' --nonce 2779` from `llxprt-jefe` — pass at final head, 13/13 checks.

### Exact head

- `npm run format` — pass.
- `npm run typecheck` — pass across all workspaces, scripts, and evals.
- `npm run build` — pass across all workspaces and the VS Code companion.
- `npm run lint` — attempted twice with 1200-second and 1800-second execution limits; both processes were externally terminated with signal 15 without diagnostics. Scoped issue lint passes as recorded above.
- `npm run test` — attempted twice at final head with an 1800-second limit; both processes were externally terminated with signal 15 without test diagnostics. The focused 54-test issue suite passes as recorded above.
- `bun scripts/start.ts --profile-load ollamakimi "write me a haiku and nothing else"` — reached the configured provider, then failed because the Ollama account had exhausted its weekly usage quota (HTTP 429 after six retries).

## Deferred findings

- X1 is resolved. Jefe now emits the agreed contract (`LLXPRT_JSP_BOOTSTRAP_FILE` with `protocol`, `registration_id`, and `publisher_credential`; see `src/jsp_host.rs` `BOOTSTRAP_ENV`), matching this producer's `jspWiring.ts` reader. The real Jefe tmux launch proof now passes end-to-end: real Jefe drives a real PTY, launches the real native LLxprt producer, and its Preview renders `Status: Ready`, `[x] Native LLxprt todo`, and the committed `Native LLxprt JSP reply`, with `(no tasks)` asserted absent. Evidence: `llxprt-jefe` scenario `dev-docs/tmux-scenarios/v1/jsp-llxprt-preview-native.json`, `status: passed`, exit 0.
- Producer wire behavior was additionally confirmed against a raw listener: the first request is `POST /jsp/1/register` with `Authorization: Bearer pub-…`, `jsp-registration-id: reg-…`, and a complete snapshot-first document (`kind: snapshot`, `source_sequence: 0`, freshly generated `source_epoch`, full provenance/availability envelopes).
- Repository-wide lint and test completion are environment/tooling blockers rather than known implementation failures: both commands were run as required but received signal 15 at their execution limits. The changed scope has clean lint, typecheck, focused tests, build, and producer compliance evidence.
- The required live smoke command is externally blocked by the configured Ollama account's weekly quota (HTTP 429).
