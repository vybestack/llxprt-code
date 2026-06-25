<!-- @plan:PLAN-20260622-COREAPIGAP.P16a @requirement:REQ-007 -->
# Phase 16a: Tool-Key Storage — Pseudocode-Compliance Verification

## Phase ID

`PLAN-20260622-COREAPIGAP.P16a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 16 completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P16.md`

## Purpose

Independent gate. Confirm the P16 implementation matches `analysis/pseudocode/tool-keys.md`
line-by-line, preserves the existing `AgentToolControl` surface (non-breaking), is delegate-only
(no cached storage), NEVER returns raw key material (R-NO-RAW-SECRETS), exposes `agent.tools.keys` as a
DISTINCT controller from `agent.auth.keys` (R-KEYS-DISTINCT), lets `ToolKeyStorage` own tool-name
validation (propagated throw, not caught), and that the P15 tests are genuinely behavioral (real
`ToolKeyStorage` over a temp dir + a real Map-backed keyring adapter, no mock theater, ≥30% property,
no reverse tests).

## Verification Commands

```bash
set -o pipefail
set -e
A=packages/agents/src/api/agent.ts
K=packages/agents/src/api/control/toolKeysControl.ts
T=packages/agents/src/api/control/toolControl.ts
I=packages/agents/src/api/agentImpl.ts
F=packages/agents/src/api/__tests__/toolKeys.behavior.test.ts

# 1. Target test + whole dir GREEN.
npx vitest run "$F" 2>&1 | tail -30
npx vitest run packages/agents/src/api/__tests__/ > /tmp/p16a_all.log 2>&1 || { echo "FAIL: regressions"; tail -60 /tmp/p16a_all.log; exit 1; }

# 2. Project typecheck + lint clean.
npm run typecheck 2>&1 | tail -15
npm run lint 2>&1 | tail -15

# 3. Non-breaking: existing AgentToolControl members still declared.
for m in "list" "setEnabled" "onConfirmationRequest" "respondToConfirmation" "onToolUpdate" "setEditorCallbacks"; do
  grep -qE "$m" "$A" || { echo "FAIL: existing AgentToolControl member $m missing"; exit 1; }
done
grep -qE "readonly keys: AgentToolKeyControl" "$A" || { echo "FAIL: nested keys member missing"; exit 1; }

# 4. All six pseudocode markers present, in the right methods.
for L in "1-11" "20-34" "40-43" "50-53" "60-67" "70-73"; do
  grep -qE "@pseudocode lines $L" "$K" || { echo "FAIL: pseudocode marker $L missing"; exit 1; }
done

# 5. R-NO-RAW-SECRETS: status masks; the raw key is never placed on a returned object.
grep -qE "maskKeyForDisplay\(rawKey\)" "$K" || { echo "FAIL: status not masking"; exit 1; }
if grep -nE "maskedKey: rawKey|key: rawKey|, rawKey[,}]|return rawKey" "$K"; then echo "FAIL: control may return the raw key"; exit 1; fi
# maskedKey omitted on the no-key branch (the false branch must not set maskedKey).
awk '/hasKey: false/{print}' "$K" | grep -qE "maskedKey" && { echo "FAIL: maskedKey present on no-key branch"; exit 1; } || true

# 6. Validation delegated (not re-implemented) and throw NOT caught.
if grep -nE "isValidToolKeyName|catch\b" "$K"; then echo "FAIL: control re-validates or catches (must delegate/propagate)"; exit 1; fi

# 7. Delegation + wiring; no cache.
grep -qE "this\.deps\.getStorage\(\)" "$K" || { echo "FAIL: not resolving storage per call"; exit 1; }
if grep -nE "private .*(storage|cachedStorage)\b" "$K"; then echo "FAIL: cached storage state"; exit 1; fi
grep -qE "this\.keys = new ToolKeysControl\(deps\.keysDeps\)" "$T" || { echo "FAIL: ToolControl not constructing nested keys"; exit 1; }
grep -qE "keysDeps: \{ getStorage: \(\) => getToolKeyStorage\(\) \}" "$I" || { echo "FAIL: agentImpl not wiring the shared singleton"; exit 1; }

# 8. R-KEYS-DISTINCT: a SEPARATE controller class; tools.keys is not aliased to auth.keys.
grep -qE "class ToolKeysControl implements AgentToolKeyControl" "$K" || { echo "FAIL: ToolKeysControl class missing"; exit 1; }
if grep -nE "AuthKeysControl" "$K"; then echo "FAIL: tool keys must not reuse the auth keys controller"; exit 1; fi

# 9. Re-audit P15 tests are behavioral + hermetic-real.
grep -qE "new ToolKeyStorage\(" "$F" || { echo "FAIL: not a real ToolKeyStorage"; exit 1; }
grep -qE "keyringLoader" "$F" || { echo "FAIL: hermetic keyring seam missing"; exit 1; }
if grep -nE "toHaveBeenCalled|mockResolvedValue|mockReturnValue|vi\.fn\(|vi\.spyOn" "$F"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "not\.toThrow\(\)" "$F"; then echo "FAIL: reverse test"; exit 1; fi
grep -qE "agent\.tools\.keys !== agent\.auth\.keys|agent\.auth\.keys !== agent\.tools\.keys" "$F" || { echo "FAIL: distinct-object check missing"; exit 1; }
grep -qE "Object\.(keys|values)|JSON\.stringify" "$F" || { echo "FAIL: no-leak not enumerated"; exit 1; }
TOTAL=$(grep -cE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
PROP_CASE_FORMS=$(grep -cE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
CLASSIC_PROP_BLOCKS=$(awk '/(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 } /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } } END { print n+0 }' "$F")
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
PCT=$(( PROP * 100 / TOTAL ))
echo "property CASES: $PROP / $TOTAL = ${PCT}%"
[ "$PROP" -ge 2 ] && [ "$PCT" -ge 30 ] || { echo "FAIL: property gate"; exit 1; }

# 10. Deferred scan on changed lines.
for X in "$A" "$K" "$T" "$I"; do
  git diff HEAD -- "$X" | grep -E "^\+" | grep -vE "^\+\+\+" \
    | grep -nE "(TODO|FIXME|HACK|STUB|placeholder|for now|in a real)" \
    && { echo "FAIL: deferred marker in $X"; exit 1; } || true
done
echo "PASS: gates green."
```

### Line-by-Line Compliance Table (fill in, fold into marker)

| Pseudocode lines | Method | Implemented at (file:line) | Matches? |
| --- | --- | --- | --- |
| 1-11 | supported (registry projection; skip undefined entries) | toolKeysControl.ts:___ | |
| 20-34 | status (masked; maskedKey ONLY when hasKey; keyFile ?? undefined; raw key never returned) | toolKeysControl.ts:___ | |
| 40-43 | save (delegate saveKey; validation propagates) | toolKeysControl.ts:___ | |
| 50-53 | delete (delegate deleteKey) | toolKeysControl.ts:___ | |
| 60-67 | setKeyFile (null → clearKeyfilePath; else setKeyfilePath) | toolKeysControl.ts:___ | |
| 70-73 | getKeyFile (delegate getKeyfilePath) | toolKeysControl.ts:___ | |
| wiring | ToolControl constructs `keys = new ToolKeysControl(deps.keysDeps)`; agentImpl provides `keysDeps: { getStorage: () => getToolKeyStorage() }` | toolControl.ts:___ / agentImpl.ts:___ | |

## Holistic Functionality Assessment (MANDATORY — into marker)

- **What was implemented**: the six-method masked `ToolKeysControl` delegating to core `ToolKeyStorage`,
  nested under the existing `ToolControl` as `agent.tools.keys`, wired to the shared
  `getToolKeyStorage()` singleton.
- **Satisfies REQ-007?**: supported / status / save / delete / setKeyFile / getKeyFile present and
  delegating; existing `AgentToolControl` members intact (non-breaking)?
- **Data flow**: live `this.deps.getStorage()` every call; `status` masks via `maskKeyForDisplay`;
  `maskedKey` omitted when no key; `setKeyFile(null)` clears.
- **Security (R-NO-RAW-SECRETS)**: no path returns the raw key; the P15 test enumerates real output to
  prove the raw key never appears. Verdict on leak risk with evidence.
- **Distinctness (R-KEYS-DISTINCT)**: `agent.tools.keys` is a separate `ToolKeysControl` instance, not an
  alias of `agent.auth.keys` — confirmed by the public-surface `!==` check. Evidence (file:line).
- **Validation ownership (REQ-007.7)**: invalid tool name throw originates in `ToolKeyStorage` and
  propagates uncaught through the control.
- **Risks**: any cached storage; any path that surfaces the raw key; any change to existing members; any
  re-implemented validation; any CLI-side path logic leaking into `setKeyFile`.
- **Verdict**: PASS/FAIL with file:line evidence.

## Success Criteria

- All gates pass; compliance table complete; non-breaking + no-raw-secrets + keys-distinct confirmed;
  holistic verdict PASS.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P16a.md` including the completed compliance table + holistic
assessment.
