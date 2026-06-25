<!-- @plan:PLAN-20260622-COREAPIGAP.P15 @requirement:REQ-007 -->
# Phase 15: Tool-Key Storage (`agent.tools.keys`) — Behavioral TDD

## Phase ID

`PLAN-20260622-COREAPIGAP.P15`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 14a completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P14a.md`

## Requirements Implemented (Expanded)

### REQ-007: Built-in tool-key storage via `agent.tools.keys` (masked)

**Full Text**: EXTEND the existing `AgentToolControl` (`agent.ts:223-230`) — keeping ALL existing
members (`list`/`setEnabled`/`onConfirmationRequest`/`respondToConfirmation`/`onToolUpdate`/
`setEditorCallbacks`) EXACTLY as-is (REQ-009 non-breaking) — with a NEW nested `readonly keys`
sub-controller (`AgentToolKeyControl`) backed by the core `ToolKeyStorage`. This is **DISTINCT** from
`Agent.auth.keys` (provider-auth keys at `agent.ts:241-258`) — built-in TOOL keys (Exa, etc.) are a
different concern (R-KEYS-DISTINCT). Raw key material is NEVER returned (R-NO-RAW-SECRETS).
- **REQ-007.1**: `supported(): readonly ToolKeyInfo[]` — projects the static tool-key registry
  (`getSupportedToolNames`/`getToolKeyEntry`) to `{toolName, displayName, description?}`.
- **REQ-007.2**: `status(toolName): Promise<ToolKeyStatus>` — `{toolName, hasKey, maskedKey?, keyFile?}`.
  `maskedKey` is `maskKeyForDisplay(rawKey)` and present ONLY when a key is stored. The raw key is
  NEVER on the returned object.
- **REQ-007.3**: `save(toolName, key): Promise<void>` — delegates to `storage.saveKey`.
- **REQ-007.4**: `delete(toolName): Promise<void>` — delegates to `storage.deleteKey`.
- **REQ-007.5**: `setKeyFile(toolName, path | null): Promise<void>` — `null` clears
  (`clearKeyfilePath`); a string sets (`setKeyfilePath`).
- **REQ-007.6**: `getKeyFile(toolName): Promise<string | null>` — delegates to `getKeyfilePath`.
- **REQ-007.7**: tool-name validation is owned by `ToolKeyStorage.assertValidToolName` (invoked inside
  every storage method); an invalid name's throw PROPAGATES (delegate, do not catch).

**Behavior (GIVEN/WHEN/THEN)**:
- GIVEN the registry contains Exa → `supported()` includes `{toolName:"exa", displayName:"Exa Search",
  description: <string>}`.
- GIVEN a stored key `"abcd1234efgh"` (length > 8) → `status("exa")` is `{toolName:"exa", hasKey:true,
  maskedKey:"ab********gh"}` and `Object.keys(status)` contains NO raw key; `maskedKey !== "abcd1234efgh"`.
- GIVEN a stored short key (length ≤ 8) → `status.maskedKey` is fully masked (all `*`).
- GIVEN NO stored key and NO keyfile → `status("exa")` is `{toolName:"exa", hasKey:false}` (no
  `maskedKey`).
- GIVEN a keyfile path configured but no stored key → `status("exa").keyFile` equals the configured path
  and `hasKey:false`.
- GIVEN `save("exa", k)` then `delete("exa")` → `status("exa").hasKey` goes `true` then `false`.
- GIVEN `setKeyFile("exa","/p")` then `getKeyFile("exa")` → `"/p"`; then `setKeyFile("exa", null)` →
  `getKeyFile("exa")` is `null`.
- GIVEN an unregistered tool name → `save/status/delete/getKeyFile` REJECT (the storage throws).
- GIVEN the live agent → `agent.tools.keys` is a DISTINCT object from `agent.auth.keys`.

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/__tests__/toolKeys.behavior.test.ts`

  Drive a REAL `ToolKeyStorage` hermetically — NO mock theater. The blessed hermetic seam (the EXACT
  recipe used by `packages/core/src/tools/tool-key-storage.test.ts:172`) is a real `ToolKeyStorage`
  constructed over a temp dir + an in-memory keyring ADAPTER (a real object implementing
  `KeyringAdapter` over a `Map` — NOT a spy/stub):

  1. **Hermetic storage helper** (declare inline in the test):
     ```ts
     import { promises as fs } from 'node:fs';
     import * as os from 'node:os';
     import * as path from 'node:path';
     import { ToolKeyStorage } from '@vybestack/llxprt-code-core';
     // KeyringAdapter is a structural type; declare a tiny real Map-backed adapter inline.
     function memoryKeyring() {
       const store = new Map<string, string>();
       return {
         getPassword: async (s: string, a: string) => store.get(`${s}:${a}`) ?? null,
         setPassword: async (s: string, a: string, p: string) => { store.set(`${s}:${a}`, p); },
         deletePassword: async (s: string, a: string) => store.delete(`${s}:${a}`),
       };
     }
     async function hermeticStorage(): Promise<{ storage: ToolKeyStorage; dir: string }> {
       const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'toolkeys-behavior-'));
       const storage = new ToolKeyStorage({ toolsDir: dir, keyringLoader: async () => memoryKeyring() });
       return { storage, dir };
     }
     ```
     Clean each temp dir in `afterEach` with `fs.rm(dir, { recursive: true, force: true })`.

  2. **Direct-construction mode (BLESSED precedent — `new McpControl(deps)` /
     `new TasksControl({...})`).** `.behavior.test.ts` is T17-EXEMPT, so the control may be deep-imported.
     Because the control file does not exist until P16, import it **dynamically inside each test body** so
     the file PARSES at RED (mirrors P07's RED-note):
     ```ts
     const { ToolKeysControl } = await import('../control/toolKeysControl.js');
     const keys = new ToolKeysControl({ getStorage: () => storage });
     ```
     The `getStorage` closure RETURNS the real hermetic `ToolKeyStorage` — a real closure, NOT a mock.
     Assert through `keys.supported()/status(...)/save(...)/delete(...)/setKeyFile(...)/getKeyFile(...)`.

  3. **RED-anchor via the PUBLIC surface (keeps RED behavioral).** Add ONE positive that drives the live
     agent: `const { agent, cleanup } = await buildAgent('plain-text.jsonl');` then assert
     `agent.tools.keys.supported()` includes `exa` AND `agent.tools.keys !== agent.auth.keys`
     (R-KEYS-DISTINCT). `supported()` is a PURE static-registry projection (no keychain/disk), so it is
     hermetic even through the real singleton. At RED `agent.tools.keys` is `undefined` → a behavioral
     `TypeError` (NOT a module error). Do NOT drive `status/save/...` through the public agent (that would
     hit the non-hermetic singleton storage) — only `supported()` + the distinct-object check.

  4. **No-raw-secret enumeration.** For the mask scenarios, assert over `Object.values(status)` /
     `JSON.stringify(status)` that the full raw key is NOT present (a behavioral guarantee, not
     structure-only).

  - Markers `@plan:PLAN-20260622-COREAPIGAP.P15`, `@requirement:REQ-007`.

### Required scenarios

```
T17a  supported(): hermetic ToolKeysControl → supported() includes an entry with toolName==='exa',
      a non-empty displayName, and a string description (registry projection)
T18   status masked (len>8): save('exa','abcd1234efgh') → status('exa') === {toolName:'exa', hasKey:true,
      maskedKey:'ab********gh'} ; JSON.stringify(status) does NOT contain 'abcd1234efgh' ;
      Object.keys(status) has no 'rawKey'/'key'/'access_token'
T18a  status short (len<=8): save('exa','short') → status('exa').maskedKey === '*****' (fully masked,
      length === 5) ; maskedKey !== 'short'
T18b  invalid tool name: keys.save('not-a-tool','k') REJECTS (storage assertValidToolName throws);
      likewise keys.status('not-a-tool') REJECTS — the throw propagates (NOT swallowed)
T18c  no key, no keyfile: status('exa') === {toolName:'exa', hasKey:false} (no maskedKey key present;
      'maskedKey' not in Object.keys)
T18d  keyfile-only: setKeyFile('exa','/tmp/exa.key') (no stored key) → status('exa') ===
      {toolName:'exa', hasKey:false, keyFile:'/tmp/exa.key'} ; getKeyFile('exa') === '/tmp/exa.key' ;
      then setKeyFile('exa', null) → getKeyFile('exa') === null
T19   distinct: const {agent} = await buildAgent('plain-text.jsonl'); agent.tools.keys.supported()
      includes 'exa' AND agent.tools.keys !== agent.auth.keys (R-KEYS-DISTINCT)
PROP  save/delete round-trip: for a generated registered tool ('exa') + random non-empty key, after
      save(key) status.hasKey===true and after delete() status.hasKey===false ; MIN-2 cases
PROP  mask no-leak: for a generated key of length 9..40 (non-'*' chars), save+status →
      maskedKey.length === key.length, maskedKey starts with key.slice(0,2), ends with key.slice(-2),
      the middle is all '*', maskedKey !== key, and JSON.stringify(status) does not contain the raw key;
      MIN-2 cases
```

### Constraints

- Drive a REAL `ToolKeyStorage` over a temp dir + a real Map-backed `KeyringAdapter`. NEVER `vi.fn()`,
  `vi.spyOn`, `mockResolvedValue`, or `toHaveBeenCalled`.
- The `getStorage: () => storage` closure is a REAL closure returning a real instance (allowed), not a mock.
- The no-leak assertions must inspect real output (`Object.keys`/`Object.values`/`JSON.stringify`) — not a
  structure-only `toHaveProperty`.
- Source `ToolKeyStorage` from the BARE core barrel `@vybestack/llxprt-code-core` (no trailing slash;
  the deep-import guard only flags `@vybestack/llxprt-code-core/<path>`).
- ≥30% property-based (fast-check), MIN-2 distinct property cases.
- Existing `AgentToolControl` members remain callable (do not assert their removal).
- Positive cases fail at RED because `agent.tools.keys` does not exist (public-surface TypeError) and the
  `ToolKeysControl` module does not exist yet (dynamic-import failure in the hermetic tests). The PUBLIC
  positive (T19) guarantees a BEHAVIORAL RED among the positives.

### RED note (important)

The hermetic tests dynamic-import `../control/toolKeysControl.js`, which does not exist until P16; that
import throws `Cannot find module` INSIDE those tests. To keep the whole-file RED behavioral, T19 drives
the PUBLIC `agent.tools.keys.supported()` / distinct-object check, which fails with a `TypeError`
(`agent.tools.keys` is `undefined`) — a behavioral failure. Confirm `/tmp/p15_red.log` shows a
`TypeError`/`AssertionError` among the positives, not SOLELY module-resolution errors. (P16 creates the
control + wiring; the impl-phase verification greps that the dynamic import resolves and the suite is
GREEN.)

## Verification Commands

```bash
set -o pipefail
set -e
F=packages/agents/src/api/__tests__/toolKeys.behavior.test.ts
test -f "$F"

if grep -nE "toHaveBeenCalled" "$F"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "mockResolvedValue|mockReturnValue|vi\.spyOn|vi\.fn\(" "$F"; then echo "FAIL: mock theater (spy/stub)"; exit 1; fi
if grep -nE "not\.toThrow\(\)" "$F"; then echo "FAIL: reverse test"; exit 1; fi

# Real hermetic storage (not a fake) + the six methods exercised (BLOCKING).
grep -qE "new ToolKeyStorage\(" "$F" || { echo "FAIL: not driving a real ToolKeyStorage"; exit 1; }
grep -qE "keyringLoader" "$F" || { echo "FAIL: hermetic keyring seam missing"; exit 1; }
for m in supported status save delete setKeyFile getKeyFile; do
  grep -qE "\.$m\(" "$F" || { echo "FAIL: $m not exercised"; exit 1; }
done

# No-leak assertion must enumerate real output (behavioral, not structure-only).
grep -qE "Object\.(keys|values)|JSON\.stringify" "$F" || { echo "FAIL: no-leak not enumerated"; exit 1; }

# R-KEYS-DISTINCT asserted.
grep -qE "agent\.tools\.keys !== agent\.auth\.keys|agent\.auth\.keys !== agent\.tools\.keys" "$F" || { echo "FAIL: distinct-object check missing"; exit 1; }

# Property-based >= 30% (BLOCKING; MIN-2).
TOTAL=$(grep -cE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
PROP_CASE_FORMS=$(grep -cE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
CLASSIC_PROP_BLOCKS=$(awk '
  /(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 }
  /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } }
  END { print n+0 }' "$F")
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
if [ "$TOTAL" -eq 0 ]; then echo "FAIL: no tests"; exit 1; fi
PCT=$(( PROP * 100 / TOTAL ))
echo "property CASES: $PROP / $TOTAL = ${PCT}%"
if [ "$PROP" -lt 2 ]; then echo "FAIL: <2 property cases"; exit 1; fi
if [ "$PCT" -lt 30 ]; then echo "FAIL: property ${PCT}% < 30%"; exit 1; fi

# RED-state enforcement (positives must include a behavioral failure, not solely module errors).
set +e
npx vitest run "$F" > /tmp/p15_red.log 2>&1
STATUS=$?
set -e
tail -40 /tmp/p15_red.log
if [ "$STATUS" -eq 0 ]; then echo "FAIL: unexpectedly all-green before P16"; exit 1; fi
if ! grep -qiE "TypeError|AssertionError|expected|is not a function|Cannot read" /tmp/p15_red.log; then
  echo "FAIL: RED shows no behavioral failure (only module/compile?)"; exit 1
fi
echo "RED confirmed behavioral (expected until P16)."
```

### Semantic Verification Checklist (BLOCKS progression)

- [ ] Drives a REAL `ToolKeyStorage` over a temp dir + a real Map-backed keyring adapter (no spies).
- [ ] Mask scenarios prove the raw key never appears in the returned status (key/value enumeration).
- [ ] `save→status→delete→status` and `setKeyFile→getKeyFile→clear` round-trips exercised on real storage.
- [ ] Invalid tool name REJECTS (propagated throw), not swallowed.
- [ ] `agent.tools.keys !== agent.auth.keys` (R-KEYS-DISTINCT) asserted via the public surface.
- [ ] ≥30% property; MIN-2; no mock theater; no reverse tests; behavioral RED.

## Success Criteria

- Behavioral RED suite covering masked status, key/keyfile round-trips, invalid-name propagation, the
  distinct-controller guarantee, and the no-raw-secret property — all over a real hermetic storage.

## Failure Recovery

- `git checkout -- "$F"`; rewrite.

## Deferred Implementation Detection (MANDATORY — scoped)

```bash
set -o pipefail
set -e
F=packages/agents/src/api/__tests__/toolKeys.behavior.test.ts
test -f "$F" || { echo "missing test"; exit 1; }
if grep -nE "(TODO|FIXME|HACK|XXX|TEMPORARY|WIP|placeholder|for now|in a real|coming soon)" "$F"; then echo "FAIL: deferred marker"; exit 1; fi
if grep -niE "toThrow\(.*NotYetImplemented|should (not )?be implemented" "$F"; then echo "FAIL: reverse pattern"; exit 1; fi
if grep -nE "\b(it|test|describe)\.skip\b|\bxit\b|\bxdescribe\b" "$F"; then echo "FAIL: skipped test"; exit 1; fi
echo "PASS: no deferred markers."
```

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P15.md`

```markdown
Phase: P15
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment]
```
