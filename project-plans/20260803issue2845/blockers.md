# Blockers on PR #2989 (issue #2845)

The agents migration itself is complete: 330/330 files pass under Bun locally,
3728 test cases under both runners (exact parity). What remains are **two
pre-existing, cross-cutting defects that live outside `packages/agents`** and
that this migration is simply the first thing to exercise.

Both are now reproduced and root-caused on Linux, not guessed at. I built a
Linux x86_64 container to stop burning 20-minute CI rounds on hypotheses:

```
docker run -d --name llxprt-linux --platform linux/amd64 \
  -v "$PWD":/src:ro -w /work oven/bun:1.3.14 sleep infinity
docker exec llxprt-linux bash -c \
  'cp -r /src/packages /src/package.json /src/bun.lock /src/bunfig.toml \
        /src/test-setup /src/tsconfig.json /work/ && cd /work && \
   rm -rf node_modules packages/*/node_modules && bun install --ignore-scripts'
docker exec -w /work/packages/agents llxprt-linux bun test --timeout 30000 <file>
```

Install takes ~9s; the container is still running and ready to iterate in.

---

# Blocker 1 — Bun segfaults on the native keyring

## What happens

```
Bun v1.3.14 (0d9b296a) Linux x64 | Kernel v6.17.0 | glibc v2.39
Features: ... process_dlopen(3)
panic(main thread): Segmentation fault at address 0x88
oh no: Bun has crashed. This indicates a bug in Bun, not your code.
```

```
FAILED: src/api/__tests__/capabilityGaps.integration.spec.ts (killed by signal SIGILL)
FAILED: src/core/__tests__/subagentOrchestrator-runtime.test.ts (killed by signal SIGILL)
```

("killed by signal" is diagnostics I added in this PR — it previously printed a
meaningless `exit code -1`, which is why round 1 looked like a normal failure.)

## Evidence it is the keyring

Both crash **mid-file**, at exactly the first test that resolves a credential:

| File | Declared | Ran | Dies on |
| --- | --- | --- | --- |
| `capabilityGaps.integration.spec.ts` | 18 | 10 | test 11 — `tool-keys:` → `await agent.tools.keys.status('exa')` |
| `subagentOrchestrator-runtime.test.ts` | 15 | 9 | test 10 — profile with `'auth-key-name': 'chutesminimax'` |

Both reach `packages/storage/src/secure-store/default-keyring-adapter.ts`:

```ts
const module = await import('@napi-rs/keyring');
```

…a `dlopen`'d NAPI call. `process_dlopen(3)` in the crash report confirms native
modules were loaded. The agents shard has **no Secret Service** — `dbus-x11`,
`gnome-keyring` and `libsecret` are installed only by the dedicated
`SecureStore Backend (ubuntu-latest, keyring)` job (`.github/workflows/ci.yml:1330`).

### The repo already half-knew this

`scripts/bun-native-modules-smoke.ts`:

```
 * - @napi-rs/keyring — native OS credential store (construct-only; no I/O)
```
```ts
pass('@napi-rs/keyring: construct Entry (no credential I/O)');
```

The Bun native-module gate deliberately constructs an `Entry` and does **no
credential I/O**. Nothing had ever made the real call under Bun in CI.

## Options

- **A. Force the non-native fallback backend for the agents Bun run.** A seam
  exists — `forceRuntimeReplacedForTesting()` returns `null` *before* importing
  `@napi-rs/keyring`, so zero native calls are issued. Smallest change, contained
  in `packages/agents`. Those two tests then exercise the fallback backend. On a
  daemon-less runner today the behaviour is environment-dependent anyway, so this
  is arguably a fidelity increase. Downside: the seam is named for "runtime was
  replaced on disk" (issue #2926); a purpose-named seam would mean touching
  `packages/storage`.
- **B. Install dbus + gnome-keyring on the agents shard.** Keeps the native path
  under test; costs CI setup time, changes the workflow, and does not help anyone
  running the suite under Bun on a Linux dev box.
- **C. Stub the secure store in just those two files.** Smallest blast radius,
  but they are explicitly "capability-gap adequacy" tests meant to hit real
  surfaces.
- **D. Bump Bun.** It is genuinely a Bun bug (its own message says so), but this
  is a repo-wide toolchain change and there is no evidence a later version fixes it.
- **E. Report upstream** — worth doing regardless, does not unblock the PR.

**Recommendation: A.** Native credential behaviour is verified by the
`SecureStore Backend` job, which still runs both backends. The agents suite is
not where that coverage lives.

---

# Blocker 2 — The shared Bun/Vitest compat shim is too slow on Linux

## What happens

Five tests across two files exceed the 30s per-test budget on Linux while taking
~1s on macOS:

- `turn.idle-timeout.test.ts` — "disabled path", "env var precedence", "default-off"
- `subagent.stream-idle.test.ts` — "disabled path", "env var precedence"

**These five tests are now byte-identical to `main`.** My remediation touched
other tests in those files; these were reverted. So this is not something the
migration changed — it is the shim being unable to service them under Bun on Linux.

## Root cause

`test-setup/augment-bun-vi.ts`, `advanceTimerChunk` (line ~139). The loop steps
the fake clock one *timer firing* at a time, and after every single step calls:

```ts
const MICROTASK_DRAIN_ROUNDS = 20;
const flushPendingTasks = async (): Promise<void> => {
  for (let i = 0; i < MICROTASK_DRAIN_ROUNDS; i++) {
    await Promise.resolve();
  }
  await new Promise<void>((resolve) => realSetImmediate(resolve));
};
```

So the cost of `advanceTimersByTimeAsync(N)` is
`O(number of timer firings in N) × (20 microtasks + one real event-loop round-trip)`.

The tests that fail advance **30 fake minutes** and **700 fake seconds** while a
repeating timer is pending, which is tens of thousands of real round-trips.

Measured, same code, 3000 timer firings:

| Platform | Duration |
| --- | --- |
| macOS (arm64) | 13 ms |
| Linux (x86_64 container) | 228 ms |

~17× slower per step. Extrapolated to the real tests' firing counts that turns a
sub-second advance into one that blows a 30s budget — and in the container a
single file did not finish even with a 300s per-test timeout.

Ruled out along the way: Bun's native `advanceTimersToNextTimer` is **not** at
fault; it moves the clock correctly on both platforms (verified, delta=3600000).

## Options

- **A. Make the macrotask yield periodic instead of per-step** in
  `flushPendingTasks` / `advanceTimerChunk` — e.g. drain microtasks every step
  but only cross a real event-loop boundary every N steps or at the end of the
  advance. Order-of-magnitude win, and the per-step `setImmediate` looks
  unnecessary for correctness.
- **B. Lower `MICROTASK_DRAIN_ROUNDS`.** Cheaper but a smaller win; the real
  cost is the macrotask round-trip.
- **C. Change the agents tests to advance less fake time.** Rejected — "no
  timeout even after 30 minutes" is the assertion; shrinking it weakens the test.

**Recommendation: A**, but note the file is shared by `core`, `auth`, `cli`,
`providers`, `telemetry` and `a2a-server`. Changing it means re-verifying those
suites, which is real scope beyond this issue — hence flagging rather than
doing it.

---

## State of the rest of the PR

- 330/330 files pass under Bun locally; 3728 test cases under both runners
  (exact parity, independently confirmed by the merged `junit.xml` root element).
- All acceptance criteria met except A1/A6, which are gated on the two blockers
  above.
- Two local reviews (DeepThinker + OCR) complete; all Blocker and Should-fix
  findings remediated.
- All four PR review threads answered and resolved — including a CodeRabbit
  claim refuted with a minimal reproduction (Bun 1.3.14 does **not** honour
  `[test] timeout` in `bunfig.toml`; upstream oven-sh/bun#13988 is not in it).
- Three rounds of genuine Linux-only bugs found and fixed, plus a real
  already-aborted-`AbortSignal` regression caught by review.

Latest head: `2a5d8416c`.
