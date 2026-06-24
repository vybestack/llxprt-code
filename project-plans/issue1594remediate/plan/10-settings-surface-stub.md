<!-- @plan:PLAN-20260621-COREAPIREMED.P10 @requirement:REQ-002,REQ-INT-003 -->
# Phase 10: Agent Settings/Config Surface — Stub

## Phase ID

`PLAN-20260621-COREAPIREMED.P10`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 09a completed (PASS)
- Verification: `test -f project-plans/issue1594remediate/.completed/P09a.md`

## Requirements Implemented (Expanded)

### REQ-002: Agent settings/config projection

**Full Text**: The public `Agent` interface MUST expose a typed settings/config surface adequate
for CLI consumption: `getConfig()`, `getEphemeralSetting(key)`, `setEphemeralSetting(key, value)`,
and `getEphemeralSettings()`. These delegate to the bound `Config`; the Agent MUST NOT maintain a
parallel settings store nor re-implement normalization/side-effects.
- **REQ-002.1**: `getEphemeralSettings()` returns the full normalized map identical to the Config's.
- **REQ-002.2**: `getConfig()` returns the exact bound `Config` instance (identity).
- **REQ-002.3**: write/normalization/side-effects are owned by `Config`; errors propagate.

> CRIT-2 NOTE: `getConfig()` is SHARED by C1 (identity of the ADOPTED Config) and C2 (settings
> projection). Its interface member is DECLARED WITH the fromConfig seam in P06 (`agent.ts`) — as a
> NotYetImplemented STUB in `agentImpl.ts` — because the early parity slice (P07/EP1) and fromConfig
> TDD (P08/T1) reference its identity and must COMPILE before P09; the REAL `return this.deps.config`
> impl lands at P09 (GREEN). P10 runs after P09, so the real impl already exists. The settings surface
> (P10–P12) therefore REFERENCES the already-present `getConfig`; it does NOT re-declare or
> re-implement it. REQ-002.2 (identity) is VERIFIED by the settings tests against that existing member.

**Behavior**:
- GIVEN an agent bound to a `Config`
- WHEN `agent.getConfig()` is called
- THEN it returns the SAME `Config` instance the agent uses internally (member declared P06, implemented P09)

### REQ-INT-003: settings call-site adequacy (integration)

**Full Text**: The exposed surface MUST cover the ephemeral-settings read/write operations the CLI
uses today so #1595 can route them through the Agent rather than deep-importing core config.

## Implementation Tasks

### Files to Modify

- `packages/agents/src/api/agent.ts`
  - ADD to the public `Agent` interface the THREE ephemeral methods: `getEphemeralSetting(key: string): unknown; setEphemeralSetting(key: string, value: unknown): void; getEphemeralSettings(): Readonly<Record<string, unknown>>;`
  - DO NOT (re)declare `getConfig()` here — it is already on the `Agent` interface from P06 (CRIT-2).
    A duplicate interface member is an error; reference the existing one.
  - Markers: `@plan:PLAN-20260621-COREAPIREMED.P10`, `@requirement:REQ-002`.

- `packages/agents/src/api/agentImpl.ts`
  - ADD the THREE ephemeral methods as STUBS throwing `NotYetImplemented` (e.g.
    `getEphemeralSetting(key: string): unknown { throw new Error('NotYetImplemented'); }`). Do NOT
    implement delegation yet.
  - DO NOT touch the existing `getConfig()` impl from P09 (it already returns `this.deps.config`);
    do NOT add a second `getConfig` (CRIT-2).
  - Markers: `@plan:PLAN-20260621-COREAPIREMED.P10`, `@requirement:REQ-002`.

### Constraints

- Strict TS; no `any`/assertions; explicit return types.
- Stub only; tests in P11. No reverse testing later.
- UPDATE existing files; no parallel versions.

## Verification Commands

```bash
set -e
# CRIT-2: getConfig was declared on the interface in P06 and MUST already be present — P10 must NOT re-declare it.
grep -q "getConfig(): Config" packages/agents/src/api/agent.ts || { echo "FAIL: getConfig should already exist on the Agent interface from P06"; exit 1; }
# Exactly ONE getConfig declaration on the interface (no duplicate introduced by P10).
if [ "$(grep -cE "getConfig\s*\(\s*\)\s*:\s*Config" packages/agents/src/api/agent.ts)" -ne 1 ]; then echo "FAIL: getConfig must be declared exactly once on the Agent interface (P10 must not duplicate P06)"; exit 1; fi
for m in getEphemeralSetting setEphemeralSetting getEphemeralSettings; do
  grep -q "$m" packages/agents/src/api/agent.ts || { echo "MISSING $m on interface"; exit 1; }
  grep -q "$m" packages/agents/src/api/agentImpl.ts || { echo "MISSING $m impl stub"; exit 1; }
done
grep -rq "@plan:PLAN-20260621-COREAPIREMED.P10" packages/agents/src/api/ || { echo "MISSING marker"; exit 1; }
npm run typecheck
echo OK
```

### Semantic Verification Checklist

- [ ] THREE ephemeral methods declared on the public `Agent` interface with correct types.
- [ ] `getConfig()` is NOT re-declared (interface member already present from P06; exactly one declaration).
- [ ] Stub impls compile (ephemeral methods throw NotYetImplemented; getConfig untouched — its real impl is from P09).
- [ ] No parallel settings store introduced.
- [ ] typecheck clean.

## Success Criteria

- Interface + stub compile; public surface widened additively.

## Failure Recovery

- `git checkout -- packages/agents/src/api/agent.ts packages/agents/src/api/agentImpl.ts`.

## Deferred Implementation Detection (MANDATORY — scoped)

Scoped to the source file(s) THIS stub creates/modifies (NOT an unscoped `__tests__/` global scan
that would trip on pre-existing #1594 matches). A stub may contain the SINGLE allowed
`NotYetImplemented` throw and nothing else deferred.

```bash
set -e
# scoped target file(s): packages/agents/src/api/agent.ts, packages/agents/src/api/agentImpl.ts
for F in "packages/agents/src/api/agent.ts" "packages/agents/src/api/agentImpl.ts"; do
  test -f "$F" || continue
  # No deferred-impl placeholder language on lines THIS phase added (diff-scoped).
  if git diff HEAD -- "$F" | grep -E "^\\+" | grep -nE "(TODO|FIXME|HACK|XXX|TEMPORARY|WIP|placeholder|for now|in a real|coming soon)"; then
    echo "FAIL: deferred-implementation marker on changed lines in $F"; exit 1
  fi
  # No `return null/undefined/{{}}/[]` stand-in masquerading as behavior beyond the allowed throw.
  # (Stub bodies must throw NotYetImplemented, not silently return fake values.)
  if grep -nE "throw new Error\\('Not implemented'\\)|throw new Error\\(\"Not implemented\"\\)" "$F"; then
    echo "FAIL: generic 'Not implemented' throw — use the canonical NotYetImplemented marker in $F"; exit 1
  fi
done
echo "PASS: no deferred-implementation markers beyond the allowed NotYetImplemented throw."
```

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P10.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P10
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```
