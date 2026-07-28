# Issue #1954 — Sandbox Credential Proxy Hardening

## Security boundary

The revised transport: host writes a mode-0600 env file in a fresh mode-0700
host-only directory under HOME (outside every sandbox mount); the container
runtime receives only its path via `--env-file`. A trusted Bash entrypoint
runs with profile/rc/`BASH_ENV` startup disabled, captures the token from env
into an unexported shell variable, unsets the env value, then re-exposes it
only on inherited fd 3 to the final CLI (`LLXPRT_CAPABILITY_FD=3`). Long-lived
prefix/bridge processes never retain the token env or an open descriptor. At
CLI startup the credential-store factory reads, validates (exact 64 lowercase
hex), closes fd 3, scrubs the marker, and caches the token in module-private
state. Only after consumption does LLxprt evaluate `.llxprt/sandbox.bashrc` in
a sanitized child Bash.

## Scope ledger

### In scope

- Replace mounted consume-once file with host-only env-file → trusted-entrypoint
  → inherited-fd-3 → factory consumption pipeline.
- Trusted entrypoint runs before project Bash startup; disable implicit startup
  files (`--noprofile --norc`, `env -u BASH_ENV`).
- Preserve `.llxprt/sandbox.bashrc` exported-env/cwd behavior after consumption.
- Preserve fd 3 across Node-to-Bun and dev-launch boundaries; close parent copies.
- Consume, validate, close, scrub, module-privately cache the capability.
- Fail fast on missing/malformed/duplicate/unreadable/uncloseable transport.
- Preserve authenticated requests and reconnects for both proxy clients.
- Preserve Docker/Podman Linux+macOS; leave Seatbelt proxy behavior unchanged.

### Non-goals

No new daemon/sidecar/protocol/rotation, no public export, no SO_PEERCRED/PID
authorization, no operation policy/audit redesign, no shell-tool/hook/MCP/subagent
env-policy change, no Seatbelt redesign, no Windows container work, no unrelated
refactor/workflow/dependency/quality-tool change, no defense against in-process
arbitrary code or user-deliberate host socket mounting.

### Scope budget

- Original target: ≤20 files / 1,400 net lines; canonical review threshold:
  25 files / 1,500 net lines. User approved exceeding when required by accepted
  security behavior. Absolute boundary: 2,500 net lines.
- Final candidate scope: 22 files, 3,584 additions, 1,084 deletions, 2,500 net lines, exactly at the approved absolute boundary.

## Acceptance matrix

| AC | Behavior | Evidence |
|---|---|---|
| AC1 | No raw token in argv; mode-0600 env file in mode-0700 host-only dir outside mounts. | Production container-prep test inspects args, file bytes/modes, mount exclusion. |
| AC2 | Entrypoint disables implicit Bash startup, captures/unsets token before any prefix/user/project process, exposes only on fd 3. | Real generated entrypoint vs adversarial BASH_ENV/sandbox.bashrc; fake CLI reads fd 3. |
| AC3 | socat/su/launcher/bridge processes retain neither token env nor open fd. | Process-boundary tests inspect child env/fds and parent closure. |
| AC4 | CLI consumes fd 3 before settings/extensions/hooks/MCP/activation; validates 64-hex, closes, scrubs marker, caches privately. | Real-fd factory tests + CLI call-order test. |
| AC5 | sandbox.bashrc runs only after consumption with no capability env/fd/secret. | Real Bash helper tests + startup-order test. |
| AC6 | Model descendant cannot recover token from env/argv/files/launchers/fds. | Real child-process inspection + direct auth attempt. |
| AC7 | Both factory clients perform allowed real-socket requests; reconnect reauthenticates. | Bootstrap-fd-backed real server flow. |
| AC8 | Direct socket client without/wrong capability rejected UNAUTHORIZED. | Existing exploit regression retained. |
| AC9 | Direct/tokenless fixtures unchanged; marker/socket mismatch fails fast. | Existing direct/tokenless + mismatch tests. |
| AC10 | Cleanup idempotent only for ENOENT/EBADF; non-idempotent failures abort. | Behavioral failure-injection through production entry points. |
| AC11 | Linux/Docker-macOS/Podman-macOS same handoff; Seatbelt starts no proxy. | Cross-platform args tests + Seatbelt spawn-env assertion. |
| AC12 | No public export/protocol/dependency/workflow/quality-tool changes. | Diff/export/lint inspection. |
| AC13 | Exact head passes full verification, bounded review, green CI, clean scope ledger. | Recorded command/check results. |

## Expected paths

- `project-plans/issue-1954-sandbox-hardening.md`
- `packages/cli/src/utils/sandbox-containers.ts`
- `packages/cli/src/utils/sandbox-capability.ts`
- `packages/cli/src/utils/sandbox-entrypoint.ts`
- `packages/cli/src/utils/sandbox-exec.ts`
- `packages/cli/src/utils/sandbox-seatbelt.ts`
- `packages/cli/src/utils/sandbox.ts` (AC10 fix)
- Existing sandbox tests under `packages/cli/src/utils/`
- `packages/cli/src/launcher/bun-launcher.ts` / `.test.ts`
- `packages/cli/src/cli.tsx` / `cliStartupOrdering.test.ts`
- `packages/cli/src/utils/sandbox-bashrc.ts` / `.test.ts`
- `packages/providers/src/auth/proxy/credential-store-factory.ts`
- `packages/providers/src/auth/proxy/__tests__/factory-detection-wiring.test.ts`
- `packages/providers/src/auth/proxy/__tests__/integration.test.ts`
- `packages/providers/test-setup.ts` / `packages/cli/test-setup.ts`
- `docs/sandbox.md`

## Review finding triage

| Finding | Class | Decision |
|---|---|---|
| F1 prefixes mutate BASH_ENV argv | Blocker | Compose prefixes into script after capture. |
| F2 stdio:'inherit' doesn't pass fd 3 | Blocker | Explicit stdio array mapping parent fd3→child fd3. |
| F3 applySandboxBashrc runs on host/direct | Blocker | Run only when LLXPRT_CREDENTIAL_SOCKET set. |
| F4 host-only file under mounted tmpdir | Blocker | Use mode-0700 dir under HOME. |
| F5 bashrc helper spoofable via stdout | Blocker | Positional argv, dedicated fd 4 pipe, NUL encoding. |
| F6 fd consumer trims/silent-downgrades | Blocker | Read-to-EOF strict max, exact 64-hex+delimiter, AggregateError. |
| F7 entrypoint doesn't always scrub env token | Blocker | Always unset on every branch. |
| F8 cleanup swallows non-idempotent errors | Blocker | Attempt all steps, ENOENT/EBADF only, AggregateError. |
| F9 source-text/synthetic tests | Blocker | Replace with production-path tests. |
| F10 numeric debug-port | In-scope | Fix interpolation, use PATH fixture. |
| F11 duplicate scripts/start.ts | In-scope | Removed. |
| F12 test duplication | In-scope | Consolidate aggressively. |
| F13 docs overstate old boundary | In-scope | Rewrite after tests pass. |
| F14 unrelated baseline typecheck | Defer | Do not touch. |

### Local OCR cycle 1 triage

| Finding | Class | Decision |
|---|---|---|
| O1 child-process isolation | In-scope | BASHPID behavioral evidence through real Bash probe. |
| O2 afterEach chdir guard | Reject | Original cwd not removed; guard would hide infra failure. |
| O3 PATH inheritance | In-scope | Added initial value and verifies existing+appended segments. |
| O4 capability keys omitted from unset | Blocker | Sanitized evaluation actively removes all parent capability keys. |
| O5 launcher retains fd on sync failure | Blocker | Close on success/failure; aggregates primary+close errors. |
| O6 HOME may be user-mounted | Reject | Default mounts exclude HOME; custom HOME mounts are non-goal. |
| O7 abnormal termination cleanup | Reject | Cleanup registered on exit/SIGINT/SIGTERM/close; SIGKILL can't run handlers. |
| O8 exact-mode fchmod redundant | Reject | Restrictive umask can clear owner bits; fchmod enforces exact mode. |
| O9 non-guaranteed test fd | In-scope | Replaced with external process beginning with exact fd 3. |
| O10 synthetic forwarding overwrites fd | In-scope | Replaced with real launcher/real child forwarding evidence. |
| O11 launcher lacks real-spawn evidence | In-scope | Added real relaunchUnderBunIfNeeded child-process evidence. |
| O12 test cleanup lacks finally | In-scope | Real fd/temp tests now use try/finally. |
| O13 CLI ordering uses mocks | Reject | Test proves production call order; separate real suites prove behaviors. |
| O14 invalid startup transport not in ordering | Reject | Strict marker behavior exercised in real factory/entrypoint tests. |
| O15 Seatbelt env spread carries markers | Blocker | Seatbelt child env deletes token/fd/socket; behavioral evidence added. |
| O16 Seatbelt spawn success unchecked | In-scope | Test verifies successful execution before inspecting output. |
| O17 reset test did not warm cache | In-scope | Test consumes real fd capability before reset, proves no reuse. |
| O18 factory accepted fd markers other than 3 | Blocker | Consumer accepts exactly marker `3`; never reads/closes unintended fds. |
| O19/O20 outer su pre-opened-fd | Reject | Generated outer wrapper receives env token and creates fd 3. |
| O21 marker 3 with unreadable fd | Blocker | Entrypoint fails fast and scrubs transport markers; test added. |
| O22 source test does not prove args push | Reject | Host-only producer and entrypoint tests already exercise returned args. |
| O23 source test does not prove cleanup | Reject | AC10 behavior covered through production cleanup/failure tests. |


### Local OCR cycle 2 triage

Final OCR reviewed 19 code/test files. Accepted findings fixed capability-key re-export, Bun parent fd/env cleanup and child termination, bridge-listener teardown, Seatbelt runtime evidence, same-process cache reset, fd-only ordering, dead prepared state, and AC10 primary+cleanup error aggregation. Rejected findings requested an out-of-scope bashrc timeout, swallowing cleanup errors, custom-HOME defense, or a temp-file `su` fallback; these contradicted the accepted matrix/non-goals or were unsupported. Existing behavioral suites cover factory/bashrc side effects, host-only args/modes/mount exclusion, cleanup, and generated inner-entrypoint fd handling. No third review was run.

## Exact-head local verification

- Focused CLI security/startup/cleanup suites: 7 files, 186 tests passed.
- Focused provider factory/proxy/reconnect suites: 3 files, 102 tests passed.
- Full `npm run test`: passed, including test-utils 119/119 and VS Code companion 55 passed/1 skipped.
- `npm run lint`: passed.
- `npm run lint:eslint-guard`: passed.
- `npm run typecheck`: passed for all workspaces, scripts, and evals.
- `npm run format`: passed.
- `npm run build`: passed for all workspaces and VS Code companion.
- `git diff --check` and staged diff check: passed.
- Stepfun compatibility smoke passed and returned a haiku.
- Ollamakimi smoke reached the provider but failed with HTTP 429 session usage limit; no implementation/runtime bootstrap error occurred.
- Docker and Podman CLIs were present, but both daemons were unavailable, so a live container/tmux security run could not be performed locally. Behavioral generated-entrypoint and platform-path suites passed.