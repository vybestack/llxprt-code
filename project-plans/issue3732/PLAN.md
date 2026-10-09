# Issue #3732: one unreadable session recording breaks `--continue` for a whole project

## Observed failure

On `0.12.0-nightly.261009.6445094cf`, `llxprt --continue` (bare or with an id)
crashes before any request is sent:

```
Error: Cannot discover continue targets: .../chats/session-2026-10-08T21-18-08-6a0e7af5-520.jsonl: Invalid session_start: missing or malformed required fields
    at listContinueTargets (...)
```

On one workstation about 20 such files exist across 10 project directories,
written between 2026-09-14 and 2026-10-08. Every project that contains one
cannot be resumed at all.

## Root cause (two defects)

### Defect A: the recorder writes a session_start the reader rejects

Reproduced with the nightly:

1. Start `llxprt` with no profile and no default provider. The UI says
   "No provider is configured".
2. `/profile load lunahigh`.
3. Send any message.

The file's first line is:

```json
{"type":"session_start","payload":{..."provider":"unknown","model":"", ...}}
```

followed by a normal `provider_switch` to `codex/gpt-6-luna` and the
conversation.

`buildNewRecordingService` (`packages/cli/src/cliSessionBootstrap.ts`) builds
the recorder at startup with `config.getProvider() ?? 'unknown'` and
`config.getModel()` (empty). `SessionRecordingService`'s constructor
(`packages/core/src/recording/SessionRecordingService.ts`) buffers
`session_start` with those values. The file is only materialized on the first
content event, so by the time anything is written the real provider/model are
known (they are in a buffered `provider_switch`), but the buffered header still
carries the startup values.

`handleSessionStart` (`packages/core/src/recording/ReplayEngine.ts`) requires
`provider` and `model` to be non-empty strings and fails the whole replay.

### Defect B: discovery turns one unreadable file into a fatal error

`SessionDiscovery.listContinueTargets` throws if any session in the chats dir
fails replay (added in #3199 so that incompatible recordings are reported
rather than silently hidden). `createOrResumeRecording` calls it before
resolving the target, so one bad file blocks bare `--continue`,
`--continue <id>`, and anything else that calls it (`/continue` completion,
`/chat`, checkpoint operations, Agent API session control, Zed ACP).

## Goals

1. **Stop producing bad headers (Defect A, first priority).** When the
   provider or model changes before the recording is materialized, the written
   `session_start` must carry the provider/model in effect at materialization.
   A session started with no provider and then given a profile before the first
   message must get a header with the real provider and model.
2. **Read legacy files.** Existing recordings whose header has
   `provider: "unknown"` and/or `model: ""` must replay and resume. Their
   effective provider/model come from the existing `provider_switch` handling
   in replay (already implemented: `acc.metadata.provider/model` are updated).
3. **One bad file must not block other sessions (Defect B).** Discovery skips
   unreadable recordings and reports them visibly instead of throwing. An
   explicit reference that resolves only to an unreadable recording still fails
   with a clear message naming the file and reason. This does not hide
   incompatible-version recordings: they keep being reported, just not as a
   fatal error for unrelated sessions.

## Non-goals

- No change to the on-disk format or recording version.
- No migration/rewrite of existing files on disk. They are read as-is.
- No change to `SessionSummary` header-derived listing fields beyond what is
  needed (a legacy file may list as `unknown/`; the resumed session reports
  the real model via replay metadata).

## Design

### A. Recorder header binds to the provider/model at materialization

In `SessionRecordingService`:

- Before materialization, `recordProviderSwitch(provider, model)` (the
  `provider_switch` enqueue path while `!materialized`) must also update the
  pending `session_start` so that the header written at materialization carries
  the latest provider/model. The `provider_switch` event itself is still
  recorded unchanged (it is history).
- Queue byte accounting (`preContentBytes`, `reserveQueueBytes`, the queue byte
  limit) must stay exact after the header is rebuilt. Rebuild the pending
  record via the same `toPendingRecord` path; do not leave stale byte counts.
- After materialization, `provider_switch` must not touch the header (the
  file is already written).
- `startTime`, `sessionId`, `seq` of `session_start` stay unchanged.
- If the recording materializes while no provider/model was ever chosen, the
  header keeps the startup values. Goal 2 makes that readable; it describes a
  session that genuinely had no model.

The resume path (`initializeForResume`) never writes a header and is
unaffected.

### B. Reader accepts legacy provider/model values

In `ReplayEngine.handleSessionStart`:

- `sessionId`, `projectHash`, `startTime` remain required non-empty strings.
- `provider` and `model` must be strings; the empty string is accepted
  (legacy files and sessions that never had a model). Non-string or missing
  values remain invalid (fail fast for real corruption).
- Replay metadata provider/model are then updated by `provider_switch` as
  today, so resuming a legacy file reports the real model.

Check every other consumer that validates `session_start` headers (for example
`SessionDiscovery.readFirstLineFromFile`/`readSessionSummary`, janitor
`sessionHeaderReader`, Zed ACP listing, Agent API session control) and make
them consistent with this contract. Do not add separate ad hoc rules.

### C. Discovery skips unreadable recordings instead of throwing

- `SessionDiscovery.listContinueTargets` must not throw because some recording
  failed replay. Unreadable recordings are excluded from targets and returned
  as diagnostics (`listContinueTargetsDetailed` already returns
  `recordingErrors` and `skippedCount`). Real I/O errors on the chats dir itself
  (other than ENOENT) still propagate.
- Startup (`createOrResumeRecording` in `cliSessionBootstrap.ts`): use the
  readable targets; print one visible warning listing skipped recordings
  (path and reason) through the existing warning channel used for
  "Could not resume session". Bare `--continue` resumes the newest readable,
  unlocked session. `--continue <ref>` resolves against readable targets; if
  the ref matches only an unreadable recording (by session id/prefix or file),
  fail with a clear message naming the file and the replay error, matching the
  existing "Could not resume session" behavior (warn and start new), and do
  not crash with a stack trace.
- `resumeSession` (`packages/core/src/recording/resumeSession.ts`) uses
  `listSessions` (header-only) and then replays; bare `--continue` must skip a
  candidate that fails replay and try the next unlocked readable one, instead
  of failing the whole resume because the newest file is unreadable. Release
  any lock taken on a skipped candidate.
- Other callers of `listContinueTargets` (`performResume.ts`,
  `continueCommand.ts`, `chatCommand.ts`, `continuePackageActions.ts`,
  `CheckpointService.ts`, `agents/src/api/control/sessionControl.ts`,
  `useSessionBrowserHelpers.ts`, Zed ACP) keep working with healthy sessions
  when an unreadable one is present. Where a caller already has a user-visible
  channel, surface skipped recordings there; do not add new UI.

## Test-first plan (behavioral, real files, no mock theater)

Follow `dev-docs/RULES.md` and the `typescript-test-writing` skill. Use real
temp chats dirs and real `SessionRecordingService` / `ReplayEngine` /
`SessionDiscovery` / `resumeSession`. Write each test first, see it fail for
the stated reason, then implement.

Recorder (Defect A):

1. Recorder constructed with `provider: 'unknown', model: ''`, then
   `recordProviderSwitch('codex', 'gpt-6-luna')`, then a content event and
   flush: the file's first line is `session_start` with provider `codex` and
   model `gpt-6-luna`; the `provider_switch` line is still present; replay
   succeeds and metadata reports `codex/gpt-6-luna`.
2. Multiple switches before materialization: header has the last one.
3. Switch after materialization: header on disk is unchanged; replay metadata
   reflects the switch.
4. Queue byte accounting stays exact: `getPendingByteCount()` equals the sum of
   serialized pending record bytes after a header rebuild, and the configured
   queue byte limit is still enforced.
5. Startup integration (`buildNewRecordingService`/`setupSessionRecording`
   path or the narrowest real seam that covers it): a config with no provider
   at startup followed by a provider/model change before the first message
   produces a resumable file.

Reader (legacy files):

6. A fixture written exactly like the real legacy files
   (`"provider":"unknown","model":""` header, then `provider_switch`, then
   content) replays: `ok: true`, history restored, metadata provider/model from
   the switch.
7. Missing or non-string `provider`/`model`, or empty `sessionId`/
   `projectHash`/`startTime`, still fail with the existing error.
8. `resumeSession` resumes such a legacy file by explicit id and as the newest
   session with bare `--continue`.

Discovery (Defect B):

9. Chats dir with one healthy session and one unreadable session (use a
   genuinely invalid recording, e.g. non-string model or unsupported version):
   `listContinueTargets` returns the healthy target and does not throw;
   detailed results report the unreadable file with its reason. Update the
   existing test "reports an incompatible recording during continue-target
   discovery" so the incompatible recording is still reported (diagnostics),
   not thrown.
10. Startup `--continue` (bare) with a newer unreadable file and an older
    healthy file resumes the healthy one and emits one warning naming the
    skipped file.
11. `--continue <id>` for a healthy session resumes it while another file is
    unreadable.
12. `--continue <id>` naming the unreadable file: no crash; clear warning with
    the file and reason; falls back to a new session as today.
13. Bare resume via `resumeSession` when the newest unlocked candidate fails
    replay: skips it, releases its lock, resumes the next one.
14. At least one non-startup caller (e.g. `/continue` completion or
    `CheckpointService` name validation) still works when an unreadable file
    is present.

## Verification

Full cycle, all must pass:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load lunahigh "write me a haiku and nothing else"
```

Manual check against copies of the real legacy files (never the originals):
copy a project's chats dir into a scratch project hash dir, rewrite the
project hash, and run `bun scripts/start.ts --continue -p ...` from the
scratch project. Expect a resume, not a stack trace. Repeat the bare-startup
reproduction (no provider, `/profile load`, message) and confirm the new
header carries the real provider/model.

## Additions made during implementation

- The model picker called `recordProviderSwitch` without its receiver, so the
  call threw and the error was swallowed; the profile dialogs never recorded a
  switch. Both now go through one helper (`recordActiveProviderSwitch`).
- The header is bound from the live Config at materialization (including the
  prepared-batch publish path), so a provider/model change that never reaches
  `recordProviderSwitch` still produces a correct header.
- Startup resume warnings were only emitted through `debugLogger.warn`, which
  prints nothing unless debug logging is on. `setupSessionRecording` now
  returns `startupWarnings`; interactive mode shows them in the existing
  startup warnings area and `-p` mode writes them to stderr.
- Lock acquisition during resume catches only `SessionLockedError`; other
  errors (for example EACCES) propagate.

## Known follow-ups (out of scope)

- `--list-sessions` in a non-TTY shell prints "No input provided via stdin"
  instead of the list.
- In one `-p` run with the opus profile the answer text was printed three
  times.
- `packages/cli/src/ui/layouts/default-app-layout.resize.test.tsx` (5) and
  `default-app-layout.cap.test.tsx` (1) fail locally on an untouched checkout
  of main at `6445094cf`.
