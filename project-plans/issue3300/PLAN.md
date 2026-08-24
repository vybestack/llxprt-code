# Plan for issue #3300 — SS3 key decoding drops the `O` from `key.sequence`

## Accepted behavior

`key.sequence` must be the exact bytes the parser consumed for an SS3
(`ESC O ...`) sequence, so that `ESC + parsed.sequence` reconstructs the
original input, matching the CSI reader's contract.

### Acceptance criteria

- **AC1:** `\x1bOA` decodes to one key `{ name: 'up', shift: false, meta: false, ctrl: false }` with `sequence: '\x1bOA'`.
- **AC2:** An SS3 sequence with a numeric modifier prefix round-trips its bytes: `\x1bO2A` decodes to `{ name: 'up', shift: true }` with `sequence: '\x1bO2A'`.
- **AC3:** A bracketed-paste payload containing `\x1bOA` (`\x1b[200~before\x1bOAafter\x1b[201~`) is delivered as `{ name: 'paste', sequence: 'before\x1bOAafter' }` — the `O` intact.
- **AC4:** CSI round-trip behavior is unchanged: `\x1b[A` still decodes with `sequence: '\x1b[A'`.

### Boundary cases (considered, behavior = "sequence is the consumed bytes")

- Incomplete SS3 flush: `\x1bO` followed by the ESC_TIMEOUT flush emits a key with `sequence: '\x1bO'` (previously `'\x1b'`). No main-branch test pins the old value; no consumer matches `'\x1b'`-valued SS3 output (verified by grep of `sequence ===` consumers — all match single printable chars or paste events).
- SS3 keys split across multiple `data` events still decode identically; only `sequence` construction changes.
- `\x1b[O` (CSI FOCUS_OUT) is untouched — different code path (`readBracketSequence`).

### Out of scope (classified)

- **Defer:** Bare-Escape `meta: true` cleanup from the issue Notes. Not part of the acceptance criteria; PR #3303 (issue #2024) explicitly pins `escape meta: true` in its AC3.3 test, so changing it here would semantically conflict with that open PR. Follow-up only, with its own issue if desired.
- **Defer:** Adding the `sequence` assertion to PR #3303's AC3.6 test. That file (`KeypressContext.escape.test.ts`) does not exist on `main`; it lives in open PR #3303. Creating it here would duplicate/conflict with that PR. Once #3303 merges, the assertion `expect(key.sequence).toBe('\x1bOA')` should be added there (its comment block says exactly this). Coordinate via a PR comment, not by editing the other PR's files.

## Root cause

`readOCodeSequence` (packages/cli/src/ui/contexts/KeypressContext.tsx) sets
`sequence` to only the final character (`String(ch)`), omitting the `O` and
any digit prefix. `emitKeys` then emits `ESC + parsed.sequence`, so `\x1bOA`
is reported as `\x1bA`. `bufferPaste` reassembles paste payloads by
concatenating `key.sequence`, corrupting pasted text containing SS3 bytes.

## Change

Single production edit in `readOCodeSequence`: initialize `sequence` to
`'O'`, append a consumed digit prefix, and append the final character. No
change to `code`/`modifier` derivation, `emitKeys`, `bufferPaste`, or
`readBracketSequence`.

## Test plan (TDD — tests fail before the fix, pass after)

Extend `packages/cli/src/ui/contexts/KeypressContext.parsing.test.tsx`
(existing MockStdin + fake-timers harness; same file already covers parser
round-trips and bracketed paste) with a new describe block for SS3 parsing:

1. AC1: `\x1bOA` → `{ name: 'up', sequence: '\x1bOA' }`.
2. AC2: `\x1bO2A` → `{ name: 'up', shift: true, sequence: '\x1bO2A' }`.
3. AC3: paste start + `before\x1bOAafter` + paste end → one paste event with `sequence: 'before\x1bOAafter'`.
4. AC4: `\x1b[A` → `{ name: 'up', sequence: '\x1b[A' }` (guard against regression).
5. Boundary: `\x1bO` + ESC_TIMEOUT flush → emitted with `sequence: '\x1bO'` (consumed-bytes contract).

## Verification

Full cycle per the issue workflow: `npm run test`, `npm run lint`,
`npm run typecheck`, `npm run format`, `npm run build`, and the
`bun scripts/start.ts --profile-load stepfun-37` smoke test. Then OCR review
(capped at 2 rounds), PR, CI watch, CodeRabbit triage.

## Review-triage classifications (pre-declared)

- Blocker-Fix: anything that breaks AC1–AC4, existing tests, lint/typecheck/build/CI.
- In-scope-Fix: sequence-construction correctness in `readOCodeSequence` and the new tests.
- Reject: suggestions to change `bufferPaste`, CSI parsing, keybindings, or add speculative hardening.
- Defer: bare-Escape `meta` cleanup; AC3.6 assertion in PR #3303's file; anything touching other open efforts.
