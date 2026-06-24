# Phase 18: Impl — Auth / Keys [GREEN: T18, T18b, T18c]

## Phase ID

`PLAN-20260617-COREAPI.P18`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 17a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P17a.md`

## Requirements Implemented (Expanded)

### REQ-008: auth control plane (precedence, buckets, MCP OAuth, secure-store + profile-save)

**Full Text**: `agent.auth` exposes login/logout/status/enableOAuth/disableOAuth/
listBuckets/switchBucket/mcpLogin and `auth.keys` (list/save/use/delete/setRaw/
setKeyFile) + setBaseUrl. Precedence is EXACTLY: raw `--key` > `--key-name`(flag) >
`auth-key-name`(profile) > `auth-key`(inline) > keyfile > env. `/key` writes the
provider secure store, updates active runtime auth, and sets ephemeral profile fields
so `profiles.saveCurrent` stores a REFERENCE (named key), not a raw secret. Interactive
OAuth requires `onOAuthPrompt`; absent it, the call rejects clearly (no hang).
**Behavior**:
- GIVEN: a provider configured via key, keyfile, and key-name
- WHEN: auth resolves
- THEN: the documented precedence wins and `agent.auth.status()` reflects it
**Why This Matters**: without a public auth surface #1595 deep-imports `providers/auth.js`.

## Implementation Tasks

### Files to Create / Modify

- `packages/agents/src/api/control/auth.ts` — auth sub-surface wrapping
  providers/auth + providers/runtime mutators
  (`updateActiveProviderApiKey`/`updateActiveProviderBaseUrl`), the provider secure
  store (`createProviderKeyStorage`), OAuth login/logout/status, buckets, and MCP
  OAuth. Reproduces the verified precedence chain.
  - `@plan:PLAN-20260617-COREAPI.P18` + `@requirement:REQ-008`.

### Implementation Rules

- Reproduce the EXACT tested precedence (authKeyName.test.ts) — do not guess
  ordering: raw `--key` > `--key-name`(flag) > `auth-key-name`(profile) >
  `auth-key`(inline) > keyfile > env.
- `auth.keys.save` writes the provider secure store and sets the ephemeral
  `auth-key-name` so a later `profiles.saveCurrent` stores a key REFERENCE, never
  the raw secret (T18b).
- Interactive OAuth requires `onOAuthPrompt`; absent it, reject clearly (no hang)
  (T18c).
- Call shipped functions via documented providers subpaths; do not re-implement.
- Mutators read global runtime context: ensure the agent runtime context is
  registered (see Phase 16) before invoking `updateActiveProviderApiKey` /
  `updateActiveProviderBaseUrl`.

## Verification Commands

```bash
set -e
missing=0
npm test -- --testNamePattern "@plan:.*P18"
npm test -- --testNamePattern "T18\b\|T18b\|T18c" || { echo "auth T-rows not green"; missing=1; }
exit $missing
```

### Deferred Implementation Detection (MANDATORY)

```bash
missing=0
grep -rnE "(TODO|FIXME|HACK|STUB|XXX|WIP)" packages/agents/src/api/control/auth.ts | grep -v ".spec.ts" && { echo FAIL; missing=1; } || echo OK
grep -rnE "(in a real|for now|placeholder|not yet|will be)" packages/agents/src/api/control/auth.ts | grep -v ".spec.ts" && { echo FAIL; missing=1; } || echo OK
exit $missing
```

### Semantic Verification Checklist

- [ ] Precedence chain matches REQ-008 exactly (T18 passes)
- [ ] `auth.keys.save` stores reference not secret (T18b)
- [ ] OAuth no-handler rejects clearly (T18c)
- [ ] Delegates to providers subpaths (no re-impl)

## Success Criteria

- Auth/keys working; T18/T18b/T18c green; no deferred-impl.

## Failure Recovery

- `git checkout -- packages/agents/src/api/control/auth.ts`; redo.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P18.md`
