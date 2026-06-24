<!-- @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007 -->
# Phase 16: Tool-Key Storage — Implementation (GREEN)

## Phase ID

`PLAN-20260622-COREAPIGAP.P16`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 15 completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P15.md`
- Pseudocode: `project-plans/issue2143/analysis/pseudocode/tool-keys.md`
  (supported lines 1-11; status 20-34; save 40-43; delete 50-53; setKeyFile 60-67; getKeyFile 70-73)

## Purpose

Make the P15 behavioral RED suite pass by: (1) adding the two projected public types
(`ToolKeyInfo`, `ToolKeyStatus`) + the `AgentToolKeyControl` interface to `agent.ts`, and a NEW
`readonly keys: AgentToolKeyControl` member on the EXISTING `AgentToolControl`; (2) creating a NEW
`control/toolKeysControl.ts` (`ToolKeysControl implements AgentToolKeyControl`) that delegates to the
core `ToolKeyStorage`; (3) wiring it into the EXISTING `ToolControl` so `agent.tools.keys` is live.
Existing members are untouched (REQ-009 non-breaking). `agent.tools.keys` is a DISTINCT object from
`agent.auth.keys` (R-KEYS-DISTINCT). Raw key material never crosses the boundary (R-NO-RAW-SECRETS).

## Implementation Tasks

### Files to Create

#### 1. `packages/agents/src/api/control/toolKeysControl.ts`

Mirror the existing `authKeysControl.ts` shape (a small delegating sub-controller). Import the core
symbols from the BARE barrel `@vybestack/llxprt-code-core` (VALUES: `ToolKeyStorage` type-only,
`getSupportedToolNames`/`getToolKeyEntry`/`maskKeyForDisplay` as values).

```ts
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260622-COREAPIGAP.P16
 * @requirement:REQ-007
 * @pseudocode tool-keys.md steps 1-73
 *
 * Built-in TOOL key storage (Exa, etc.), exposed as `agent.tools.keys`. DISTINCT
 * from `agent.auth.keys` (provider-auth keys). Masked: the raw key never crosses
 * the API boundary (R-NO-RAW-SECRETS). Tool-name validation is owned by
 * ToolKeyStorage.assertValidToolName (invoked inside every storage call); its
 * throw propagates (delegate, do not catch).
 */

import type { ToolKeyStorage } from '@vybestack/llxprt-code-core';
import {
  getSupportedToolNames,
  getToolKeyEntry,
  maskKeyForDisplay,
} from '@vybestack/llxprt-code-core';
import type {
  AgentToolKeyControl,
  ToolKeyInfo,
  ToolKeyStatus,
} from '../agent.js';

/**
 * Dependencies injected into {@link ToolKeysControl}.
 *
 * @plan:PLAN-20260622-COREAPIGAP.P16
 * @requirement:REQ-007
 */
export interface ToolKeysControlDeps {
  /** Resolves the shared ToolKeyStorage (core lazy singleton). Never cached. */
  readonly getStorage: () => ToolKeyStorage;
}

/**
 * The public built-in tool-key control surface (masked).
 *
 * @plan:PLAN-20260622-COREAPIGAP.P16
 * @requirement:REQ-007
 * @pseudocode tool-keys.md steps 1-73
 */
export class ToolKeysControl implements AgentToolKeyControl {
  constructor(private readonly deps: ToolKeysControlDeps) {}

  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007 @pseudocode lines 1-11
  supported(): readonly ToolKeyInfo[] {
    const out: ToolKeyInfo[] = [];
    for (const name of getSupportedToolNames()) {
      const entry = getToolKeyEntry(name);
      if (entry === undefined) {
        continue;
      }
      out.push({
        toolName: entry.toolKeyName,
        displayName: entry.displayName,
        description: entry.description,
      });
    }
    return out;
  }

  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007 @pseudocode lines 20-34
  async status(toolName: string): Promise<ToolKeyStatus> {
    const storage = this.deps.getStorage();
    const rawKey = await storage.getKey(toolName);
    const keyFile = await storage.getKeyfilePath(toolName);
    if (rawKey !== null) {
      return {
        toolName,
        hasKey: true,
        maskedKey: maskKeyForDisplay(rawKey),
        keyFile: keyFile ?? undefined,
      };
    }
    return { toolName, hasKey: false, keyFile: keyFile ?? undefined };
  }

  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007 @pseudocode lines 40-43
  async save(toolName: string, key: string): Promise<void> {
    await this.deps.getStorage().saveKey(toolName, key);
  }

  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007 @pseudocode lines 50-53
  async delete(toolName: string): Promise<void> {
    await this.deps.getStorage().deleteKey(toolName);
  }

  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007 @pseudocode lines 60-67
  async setKeyFile(toolName: string, path: string | null): Promise<void> {
    if (path === null) {
      await this.deps.getStorage().clearKeyfilePath(toolName);
    } else {
      await this.deps.getStorage().setKeyfilePath(toolName, path);
    }
  }

  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007 @pseudocode lines 70-73
  async getKeyFile(toolName: string): Promise<string | null> {
    return this.deps.getStorage().getKeyfilePath(toolName);
  }
}
```

### Files to Modify

#### 2. `packages/agents/src/api/agent.ts` — add projected types + interface, extend `AgentToolControl`

Add the two projected public types near the other tool types (they NEVER include the raw key):

```ts
// @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
export interface ToolKeyInfo {
  readonly toolName: string;
  readonly displayName: string;
  readonly description?: string;
}

// @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
export interface ToolKeyStatus {
  readonly toolName: string;
  readonly hasKey: boolean;
  readonly maskedKey?: string;
  readonly keyFile?: string;
}

// @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
export interface AgentToolKeyControl {
  supported(): readonly ToolKeyInfo[];
  status(toolName: string): Promise<ToolKeyStatus>;
  save(toolName: string, key: string): Promise<void>;
  delete(toolName: string): Promise<void>;
  setKeyFile(toolName: string, path: string | null): Promise<void>;
  getKeyFile(toolName: string): Promise<string | null>;
}
```

Extend the EXISTING `AgentToolControl` (do NOT remove or reorder existing members) by adding the nested
control — mirror how `AgentAuthControl` carries `readonly keys: AgentAuthKeysControl`:

```ts
export interface AgentToolControl {
  list(): readonly ToolInfo[];
  setEnabled(names: readonly string[]): Promise<void>;
  onConfirmationRequest(cb: (req: ToolConfirmation) => void): Unsubscribe;
  respondToConfirmation(confirmationId: string, decision: ToolDecision): void;
  onToolUpdate(cb: (u: ToolUpdate) => void): Unsubscribe;
  setEditorCallbacks(cbs: EditorCallbacks): void;
  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
  readonly keys: AgentToolKeyControl;
}
```

#### 3. `packages/agents/src/api/control/toolControl.ts` — wire the nested `keys`

Mirror `AuthControl` (`authControl.ts:69-72`): take a `keysDeps` field, expose `readonly keys`, construct
the sub-controller in the ctor.

- Add to the `import type { ... } from '../agent.js';` group: `AgentToolKeyControl`.
- Add the sub-controller import:
  ```ts
  import { ToolKeysControl } from './toolKeysControl.js';
  import type { ToolKeysControlDeps } from './toolKeysControl.js';
  ```
- Add to `ToolControlDeps`:
  ```ts
  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
  /** The deps bundle for the constructed ToolKeysControl. */
  readonly keysDeps: ToolKeysControlDeps;
  ```
- Add the field + ctor assignment (the ctor is currently the implicit
  `constructor(private readonly deps: ToolControlDeps) {}` — convert it to a block that assigns `keys`):
  ```ts
  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
  readonly keys: AgentToolKeyControl;

  constructor(private readonly deps: ToolControlDeps) {
    this.keys = new ToolKeysControl(deps.keysDeps);
  }
  ```

#### 4. `packages/agents/src/api/agentImpl.ts` — provide `keysDeps` to `ToolControl`

Add the core-barrel import for the singleton resolver (VALUE import) near the other core imports:

```ts
// @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
import { getToolKeyStorage } from '@vybestack/llxprt-code-core';
```

In the ctor where `toolControlDeps` is assembled (`agentImpl.ts:309-314`), add the `keysDeps` field:

```ts
const toolControlDeps: ToolControlDeps = {
  messageBus: deps.messageBus,
  config: deps.config,
  editorCallbacksHolder: this.editorCallbacksHolder,
  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
  keysDeps: { getStorage: () => getToolKeyStorage() },
};
this.tools = new ToolControl(toolControlDeps);
```

### Constraints

- Do NOT modify the P15 test file.
- Existing `AgentToolControl` members remain byte-identical (REQ-009).
- `status()` returns `maskKeyForDisplay(rawKey)` only; the raw key is NEVER copied onto any returned
  object (R-NO-RAW-SECRETS). `maskedKey` is OMITTED when `hasKey` is false.
- Tool-name validation stays in `ToolKeyStorage.assertValidToolName`; do NOT re-implement it and do NOT
  catch its throw (it must propagate — REQ-007.7).
- NO `~`-expansion / `fs.access` / non-empty checks inside `setKeyFile` — those stay CLI-side.
- No cached `ToolKeyStorage` field — resolve `this.deps.getStorage()` per call (R-DELEGATE).
- `agent.tools.keys` MUST be a different instance than `agent.auth.keys` (R-KEYS-DISTINCT) — guaranteed by
  the separate controller; do not alias.

## Verification Commands

```bash
set -o pipefail
set -e
A=packages/agents/src/api/agent.ts
K=packages/agents/src/api/control/toolKeysControl.ts
T=packages/agents/src/api/control/toolControl.ts
I=packages/agents/src/api/agentImpl.ts
F=packages/agents/src/api/__tests__/toolKeys.behavior.test.ts

test -f "$K" || { echo "FAIL: toolKeysControl.ts not created"; exit 1; }

# Interface extended, existing members preserved.
grep -qE "interface AgentToolKeyControl" "$A" || { echo "FAIL: AgentToolKeyControl missing"; exit 1; }
grep -qE "readonly keys: AgentToolKeyControl" "$A" || { echo "FAIL: nested keys not on AgentToolControl"; exit 1; }
grep -qE "interface ToolKeyInfo" "$A" || { echo "FAIL: ToolKeyInfo missing"; exit 1; }
grep -qE "interface ToolKeyStatus" "$A" || { echo "FAIL: ToolKeyStatus missing"; exit 1; }
grep -qE "respondToConfirmation\(confirmationId: string, decision: ToolDecision\): void" "$A" || { echo "FAIL: existing AgentToolControl member changed"; exit 1; }

# All six pseudocode markers present on the control.
for L in "1-11" "20-34" "40-43" "50-53" "60-67" "70-73"; do
  grep -qE "@pseudocode lines $L" "$K" || { echo "FAIL: pseudocode marker $L missing"; exit 1; }
done

# Delegation seam present; mask applied; raw key never returned.
grep -qE "maskKeyForDisplay\(rawKey\)" "$K" || { echo "FAIL: status not masking"; exit 1; }
grep -qE "getToolKeyStorage\(\)" "$I" || { echo "FAIL: agentImpl not wiring singleton"; exit 1; }
grep -qE "this\.keys = new ToolKeysControl\(deps\.keysDeps\)" "$T" || { echo "FAIL: ToolControl not constructing nested keys"; exit 1; }

# R-NO-RAW-SECRETS: the control must NOT spread the raw key or return it.
if grep -nE "maskedKey: rawKey|key: rawKey|rawKey," "$K"; then echo "FAIL: control may be returning the raw key"; exit 1; fi
# No re-implemented validation / no catch of the storage throw.
if grep -nE "isValidToolKeyName|catch\b" "$K"; then echo "FAIL: control re-validates or catches (must delegate/propagate)"; exit 1; fi
# No cached storage field.
if grep -nE "private .*(storage|cachedStorage)\b" "$K"; then echo "FAIL: cached storage state"; exit 1; fi

# RED-note dynamic import now resolves (file exists) and suite is GREEN.
npx vitest run "$F" 2>&1 | tail -30
npx vitest run "$F" > /tmp/p16_green.log 2>&1 || { echo "FAIL: P15 suite not green"; tail -40 /tmp/p16_green.log; exit 1; }

# Whole dir still green (non-breaking).
npx vitest run packages/agents/src/api/__tests__/ > /tmp/p16_all.log 2>&1 || { echo "FAIL: regressions"; tail -60 /tmp/p16_all.log; exit 1; }

npm run typecheck 2>&1 | tail -15
npm run lint 2>&1 | tail -15
```

### Deferred Implementation Detection (MANDATORY — scoped to changed lines)

```bash
set -o pipefail
set -e
for F in packages/agents/src/api/agent.ts packages/agents/src/api/control/toolKeysControl.ts packages/agents/src/api/control/toolControl.ts packages/agents/src/api/agentImpl.ts; do
  git diff HEAD -- "$F" | grep -E "^\+" | grep -vE "^\+\+\+" \
    | grep -nE "(TODO|FIXME|HACK|STUB|placeholder|for now|in a real)" \
    && { echo "FAIL: deferred marker in $F"; exit 1; } || true
done
echo "PASS: no deferred markers in changed lines."
```

## Success Criteria

- P15 suite GREEN; whole `__tests__` dir GREEN; typecheck + lint clean.
- `agent.tools.keys` exposes the six masked methods, delegating to the shared `ToolKeyStorage`; raw key
  never returned; existing `AgentToolControl` members unchanged; `agent.tools.keys` distinct from
  `agent.auth.keys`.

## Failure Recovery

- `git checkout -- packages/agents/src/api/agent.ts packages/agents/src/api/control/toolControl.ts packages/agents/src/api/agentImpl.ts`
- `rm -f packages/agents/src/api/control/toolKeysControl.ts`

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P16.md` (same field schema as P08).
