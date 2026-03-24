# Playbook: Add Settings-Defined Subagents in LLxprt

**Upstream SHA:** `92e31e3c4ae`
**Upstream Subject:** feat(core, cli): Add support for agents in settings.json. (#16433)
**Upstream Stats:** settings + config + CLI integration; reimplement for LLxprt
**Batch:** B48 (REIMPLEMENT, FULL verification)

> **Note:** This document is a pre-implementation playbook. No code has been written or verified yet. All code snippets are prescriptive guidance for the implementer, not evidence of landed changes.

## What Upstream Does

Upstream adds the ability to declare agent definitions directly inside `settings.json` (at project, user, or admin scope). This lets teams commit shared agent configurations to repos without requiring separate agent files. The upstream intent:

1. `settings.json` gains a `agents` section with inline agent definitions.
2. Config loading validates those definitions and normalizes them into the runtime agent type.
3. The runtime discovers settings-defined agents alongside file-backed and extension-provided agents.
4. CLI listing/show/delegation works transparently with settings-defined agents.

## Why REIMPLEMENT in LLxprt

1. LLxprt already has a `subagents` section in `packages/cli/src/config/settingsSchema.ts` (lines ~1134–1164) that controls subagent behavior (`asyncEnabled`, `maxAsync`). The correct adaptation is to add inline subagent definitions inside this existing section.
2. LLxprt uses `/subagent`, `SubagentManager`, JSON-backed subagent configs, and `task()` semantics — not upstream `/agents`, `AgentRegistry`, or markdown-frontmatter agents.
3. Batch B46 (`aa524625503`) already adds `source?: 'user' | 'extension'` and `sourceExtension?` to `SubagentConfig` plus in-memory merge infrastructure on `SubagentManager`. This batch extends that same infrastructure with a `'settings'` source.
4. The new settings shape must live under the existing `subagents` key, not a new top-level `agents` key.
5. Settings-based subagents need clear precedence relative to user-disk and extension-provided subagents.

## LLxprt File Existence Map

**Present and relevant (confirm before implementation):**
- `packages/cli/src/config/settingsSchema.ts` — contains `subagents` section (lines ~1134–1164) with `asyncEnabled` and `maxAsync` properties.
- `packages/core/src/config/config.ts` — central config; has `getSubagentManager()`/`setSubagentManager()`, settings loading, `createToolRegistry()`, `initialize()`.
- `packages/core/src/config/subagentManager.ts` — canonical `SubagentManager` class. After B46 lands, will have `extensionSubagents: Map`, `registerExtensionSubagents()`, `clearExtensionSubagents()`, `removeExtensionSubagents()`, `_listDiskSubagents()`, `_loadDiskSubagent()`, `_diskSubagentExists()`.
- `packages/core/src/config/types.ts` — `SubagentConfig` interface. After B46 lands, will have `source?: 'user' | 'extension'` and `sourceExtension?: string`.
- `packages/cli/src/ui/commands/subagentCommand.ts` — `/subagent` command with list/show/create/edit/delete. After B46 lands, will show extension provenance.
- `packages/cli/src/ui/components/SubagentManagement/` — UI components for subagent management.
- `packages/core/src/prompt-config/subagent-delegation.ts` — subagent enumeration for prompt construction.
- `packages/core/src/core/subagentOrchestrator.ts` — runtime delegation via `subagentManager.loadSubagent()`.
- `packages/core/src/config/test/subagentManager.test.ts` — existing SubagentManager tests (B46 adds extension-related tests).
- `packages/cli/src/ui/commands/test/subagentCommand.test.ts` — existing /subagent command tests.
- `packages/core/src/tools/task.ts` — reads `subagents.asyncEnabled` from global settings.
- `packages/core/src/tools/tool-registry.ts` — reads `subagents.asyncEnabled` from global settings.

**Absent and should stay absent:**
- Upstream `/agents` registry files, `AgentRegistry`, `DelegateToAgentTool`.
- Any rename from `subagents` to `agents`.

## Dependency on B46

This batch **must** land after B46 (`aa524625503` — extension-provided subagents). B46 introduces:
- `SubagentConfig.source` and `SubagentConfig.sourceExtension` fields.
- In-memory merge infrastructure on `SubagentManager` (`extensionSubagents` map, `_listDiskSubagents()`, `_loadDiskSubagent()`, `_diskSubagentExists()`).
- Provenance display in `/subagent` command.

**Gate:** Preflight check #2 and #3 (below) must pass before any code is written. If either fails, B46 has not landed and this batch cannot proceed.

## Preflight Checks

Run these before writing any code. Stop and re-read this playbook if any output differs from expectations.

```bash
# 1. Confirm existing subagents schema section structure
grep -n "subagents\|asyncEnabled\|maxAsync" \
  packages/cli/src/config/settingsSchema.ts
# Expected: subagents object with asyncEnabled (boolean) and maxAsync (number) properties

# 2. Confirm SubagentConfig has source field (from B46)
grep -n "source\|sourceExtension" packages/core/src/config/types.ts
# Expected: source?: 'user' | 'extension', sourceExtension?: string

# 3. Confirm SubagentManager has in-memory merge infrastructure (from B46)
grep -n "extensionSubagents\|_listDiskSubagents\|_loadDiskSubagent\|registerExtensionSubagents" \
  packages/core/src/config/subagentManager.ts
# Expected: extensionSubagents Map, private _listDiskSubagents(), _loadDiskSubagent(), public registerExtensionSubagents()

# 4. Confirm config loading reads settings
grep -n "getSettings\|loadSettings\|settingsService" packages/core/src/config/config.ts | head -20
# Expected: settings loading infrastructure exists

# 5. Confirm no existing settings-backed subagent definitions
grep -rn "definitions\|subagents\.\w*\." packages/cli/src/config/settingsSchema.ts
# Expected: only asyncEnabled and maxAsync under subagents — no definitions/configs

# 6. Confirm how existing code reads subagents settings
grep -rn "subagents.*asyncEnabled\|subagentsSettings\|subagents\.async" \
  packages/core/src packages/cli/src --include="*.ts" | head -15
# Expected: reads subagents.asyncEnabled from globalSettings['subagents']
```

## Design Decisions

### D1: Settings shape — `subagents.definitions` map

Add a `definitions` property inside the existing `subagents` settings section. Each key is the subagent name, each value is `{ profile, systemPrompt }`:

```json
{
  "subagents": {
    "asyncEnabled": true,
    "maxAsync": 5,
    "definitions": {
      "code-reviewer": {
        "profile": "default",
        "systemPrompt": "You are a meticulous code reviewer..."
      },
      "test-writer": {
        "profile": "default",
        "systemPrompt": "You write comprehensive tests..."
      }
    }
  }
}
```

**Rationale:** An object map (not an array) is natural for named subagents and matches how MCP servers are configured in LLxprt settings (`mcpServers` uses a map keyed by server name). The `name` field is the key itself. Only `profile` and `systemPrompt` are needed — `createdAt`/`updatedAt` are synthetic for settings-backed subagents.

### D2: Extend `SubagentConfig.source` union with `'settings'`

After B46, `source` is `'user' | 'extension'`. Extend to `'user' | 'extension' | 'settings'`. Settings-defined subagents carry `source: 'settings'`. No `sourceExtension` needed for settings-defined subagents.

### D3: Precedence (resolution) vs listing order

**Precedence** governs `loadSubagent()`, `subagentExists()`, and `deleteSubagent()` name-collision resolution. When the same subagent name exists in multiple tiers, the highest-precedence tier wins:

1. **User disk** (`~/.llxprt/subagents/*.json`) — highest priority. User explicitly created/edited.
2. **Settings-defined** (`settings.json subagents.definitions`) — middle priority. Team-shared or project-scoped config.
3. **Extension-provided** (in-memory from extensions) — lowest priority.

**Listing order** is separate. `listSubagents()` returns the deduplicated union of all three tiers sorted **alphabetically by name**. The sort is deterministic and independent of tier. Precedence only determines which tier's config is returned when a name appears in multiple tiers.

### D4: Settings-defined subagents are read-only through `/subagent` UI

Like extension subagents (D6 in B46), settings-defined subagents cannot be edited or deleted through `/subagent edit` or `/subagent delete` unless a user disk override exists for that name. Specifically:

- **Settings-only (no user disk file):** `/subagent edit` and `/subagent delete` reject with: "Cannot edit/delete settings-defined subagent 'foo'. Modify it in settings.json instead."
- **User disk override exists:** `/subagent edit` and `/subagent delete` operate on the user disk file. Deleting the user override causes the settings version to become visible again.
- The UI shows provenance: `[settings]` or `[settings, user override]`.

### D5: Settings-defined subagents skip profile validation at load time

Like extension subagents (B46 risk #4), profile references in settings definitions are NOT validated at load time. If a referenced profile doesn't exist, the subagent still appears in listings. The profile mismatch surfaces as a runtime error when `task()` tries to use it. This prevents startup failures from a missing profile.

### D6: Synthetic timestamps for settings-defined subagents

Settings-defined subagents don't have natural `createdAt`/`updatedAt` values. Use a fixed sentinel: `createdAt: '1970-01-01T00:00:00.000Z'`, `updatedAt: '1970-01-01T00:00:00.000Z'`. This makes it clear these aren't user-created timestamps and avoids misleading dates.

## Files to Modify

| File | Change |
|------|--------|
| `packages/core/src/config/types.ts` | Extend `source` union: `'user' \| 'extension' \| 'settings'` |
| `packages/cli/src/config/settingsSchema.ts` | Add `definitions` property to the `subagents` section with correct schema shape |
| `packages/core/src/config/subagentManager.ts` | Add `settingsSubagents: Map`, `registerSettingsSubagents()`, `clearSettingsSubagents()`, `hasSettingsSubagent()`; modify `loadSubagent()`, `listSubagents()`, `subagentExists()`, `deleteSubagent()` to include settings tier in resolution |
| `packages/core/src/config/config.ts` | In `initialize()`, after extension subagent registration, read `subagents.definitions` from settings and call `subagentManager.registerSettingsSubagents()` |
| `packages/cli/src/ui/commands/subagentCommand.ts` | Show `[settings]` provenance; block edit/delete for settings-only subagents |

## Files to Create

None. All changes fit in existing files.

## Implementation Steps

### Step 1: Extend SubagentConfig source union

In `packages/core/src/config/types.ts`, change the `source` field:

```typescript
/** Provenance: 'user' (default, disk-backed), 'extension', or 'settings' */
source?: 'user' | 'extension' | 'settings';
```

No other changes to this file.

### Step 2: Add `definitions` to settings schema

In `packages/cli/src/config/settingsSchema.ts`, add a `definitions` property inside the existing `subagents.properties` block, after `maxAsync`. This follows the exact same `additionalProperties` map convention used by `mcpServers` (line ~432) and `customThemes` (line ~498) — an outer object typed `'object'` with `additionalProperties` describing the value shape:

```typescript
definitions: {
  type: 'object',
  label: 'Subagent Definitions',
  category: 'Subagents',
  requiresRestart: true,
  default: {} as Record<string, { profile: string; systemPrompt: string }>,
  description:
    'Inline subagent definitions keyed by name. Each value must contain profile and systemPrompt.',
  showInDialog: false,
  additionalProperties: {
    type: 'object',
    ref: 'SubagentDefinition',
  },
},
```

This mirrors the `mcpServers` pattern exactly: `type: 'object'` + `ref` pointing to the value schema. The `ref: 'SubagentDefinition'` tag is used by the JSON Schema generator; the runtime validation comes from `registerSettingsSubagents()` in Step 3b which validates each entry's `profile` and `systemPrompt` fields.

Also update the parent `subagents` entry: change `requiresRestart: false` to `requiresRestart: true` since the new `definitions` child requires restart. (Alternatively, leave the parent as `false` since `requiresRestart` on the child `definitions` property is sufficient — match whichever pattern `mcpServers` uses at the parent level. Currently `mcpServers` is a top-level key with `requiresRestart: true` directly, so `definitions` having `requiresRestart: true` is the correct match.)

### Step 3: Add settings-subagent infrastructure to SubagentManager

In `packages/core/src/config/subagentManager.ts`:

**3a.** Add a private in-memory map for settings-defined subagents (parallel to the `extensionSubagents` map from B46):

```typescript
private settingsSubagents: Map<string, SubagentConfig> = new Map();
```

**3b.** Add a public method to register settings-defined subagents:

```typescript
/**
 * Register subagents defined in settings.json.
 * Called during initialization after settings are loaded.
 */
registerSettingsSubagents(
  definitions: Record<string, { profile: string; systemPrompt: string }>,
): void {
  this.settingsSubagents.clear();
  const sentinel = '1970-01-01T00:00:00.000Z';
  for (const [name, def] of Object.entries(definitions)) {
    // Validate name format (same regex as user subagents)
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      debugLogger(
        `Settings subagent '${name}' has invalid name, skipping.`,
      );
      continue;
    }
    if (!def.profile || !def.systemPrompt) {
      debugLogger(
        `Settings subagent '${name}' missing profile or systemPrompt, skipping.`,
      );
      continue;
    }
    this.settingsSubagents.set(name, {
      name,
      profile: def.profile,
      systemPrompt: def.systemPrompt,
      createdAt: sentinel,
      updatedAt: sentinel,
      source: 'settings',
    });
  }
}
```

**3c.** Add a public method to clear settings-defined subagents (for re-initialization):

```typescript
clearSettingsSubagents(): void {
  this.settingsSubagents.clear();
}
```

**3d.** Modify `listSubagents()` to include settings subagents in the resolution order (user > settings > extension):

```typescript
async listSubagents(): Promise<string[]> {
  const userSubagents = await this._listDiskSubagents();
  const settingsNames = [...this.settingsSubagents.keys()].filter(
    (name) => !userSubagents.includes(name),
  );
  const extensionNames = [...this.extensionSubagents.keys()].filter(
    (name) => !userSubagents.includes(name) && !this.settingsSubagents.has(name),
  );
  // Deduplicated union, alphabetically sorted (D3: sort is deterministic, independent of tier)
  return [...userSubagents, ...settingsNames, ...extensionNames].sort();
}
```

**Note:** B46 must have landed (enforced by the preflight gate). The existing `listSubagents()` already uses `_listDiskSubagents()` and `extensionSubagents` — modify it to insert `settingsSubagents` between user and extension tiers in the deduplication logic (sort order is always alphabetical).

**3e.** Modify `loadSubagent()` to check settings tier between disk and extension:

```typescript
async loadSubagent(name: string): Promise<SubagentConfig> {
  // 1. User disk (highest priority)
  try {
    const config = await this._loadDiskSubagent(name);
    return { ...config, source: 'user' };
  } catch {
    // Fall through
  }
  // 2. Settings-defined (middle priority)
  const settingsSubagent = this.settingsSubagents.get(name);
  if (settingsSubagent) {
    return settingsSubagent;
  }
  // 3. Extension-provided (lowest priority)
  const extSubagent = this.extensionSubagents.get(name);
  if (extSubagent) {
    return extSubagent;
  }
  throw new Error(ERROR_MESSAGES.SUBAGENT_NOT_FOUND.replace('{name}', name));
}
```

**3f.** Modify `subagentExists()` to check settings tier:

```typescript
async subagentExists(name: string): Promise<boolean> {
  const diskExists = await this._diskSubagentExists(name);
  if (diskExists) return true;
  if (this.settingsSubagents.has(name)) return true;
  return this.extensionSubagents.has(name);
}
```

**3g.** Modify `deleteSubagent()` to block deletion of settings-only subagents:

```typescript
async deleteSubagent(name: string): Promise<boolean> {
  // Check if this is a settings-defined subagent without a user disk override
  if (this.settingsSubagents.has(name)) {
    const diskExists = await this._diskSubagentExists(name);
    if (!diskExists) {
      throw new Error(
        `Cannot delete settings-defined subagent '${name}'. Modify it in settings.json instead.`,
      );
    }
    // User has a disk override — delete the override (settings version resurfaces)
  }
  // Check extension subagents (B46 logic already handles this)
  if (this.extensionSubagents.has(name)) {
    const diskExists = await this._diskSubagentExists(name);
    if (!diskExists) {
      throw new Error(
        `Cannot delete extension-provided subagent '${name}'. It is managed by extension '${this.extensionSubagents.get(name)!.sourceExtension}'.`,
      );
    }
  }
  return this._deleteDiskSubagent(name);
}
```

**3h.** `saveSubagent()` does NOT need changes — saving always writes to disk, creating a user override.

**3i.** Add a public read-only query for the `/subagent` command to detect override status (referenced in Step 5b):

```typescript
/** Returns true if a settings-defined subagent with this name exists (regardless of disk override). */
hasSettingsSubagent(name: string): boolean {
  return this.settingsSubagents.has(name);
}
```

### Step 4: Wire settings subagents at startup

In `packages/core/src/config/config.ts`, in `initialize()`, **after** the extension-subagent registration block added by B46, add:

```typescript
// Register settings-defined subagents (after extension subagents, before first user prompt)
const subagentMgr = this.getSubagentManager();
if (subagentMgr) {
  const settings = this.getSettings();
  const subagentsSettings = settings?.['subagents'] as
    | Record<string, unknown>
    | undefined;
  const definitions = subagentsSettings?.['definitions'] as
    | Record<string, { profile: string; systemPrompt: string }>
    | undefined;
  if (definitions && typeof definitions === 'object') {
    subagentMgr.registerSettingsSubagents(definitions);
  }
}
```

The exact settings-reading pattern must match how existing code reads `subagents.asyncEnabled` — see `packages/core/src/tools/task.ts` lines ~774 and `packages/core/src/core/prompts.ts` lines ~378 for the canonical pattern. Use `this.getSettings()` or the equivalent accessor available in `initialize()`.

**Important:** Registration order does not affect precedence. Precedence is determined solely by the lookup order in `loadSubagent()` (user-disk → settings → extension). Settings subagents are registered after extension subagents here because settings are read after extensions initialize — this is an initialization-sequence constraint, not a priority statement.

### Step 5: Update /subagent command for settings provenance

In `packages/cli/src/ui/commands/subagentCommand.ts`:

**5a.** In the list handler, show provenance for settings-defined subagents:
- User subagents: display as today.
- Settings subagents: append `[settings]`.
- User override of settings subagent: append `[settings, user override]`.

This follows the same pattern B46 uses for extension provenance (`[ext: extensionName]`).

**5b.** Override detection contract. The `/subagent` command determines provenance and override status through two `SubagentManager` calls — no direct filesystem access:

1. Call `subagentManager.loadSubagent(name)` → read `config.source` (one of `'user'`, `'settings'`, `'extension'`).
2. If `source === 'settings'`: the loaded config is from settings (no user override exists, because user-disk has higher precedence and would have returned `source: 'user'`).
3. If `source === 'user'`: check whether a settings-tier definition also exists by calling `subagentManager.hasSettingsSubagent(name)` (public method added in Step 3i). If `true`, this is a user override of a settings definition → label `[settings, user override]`. If `false`, this is a plain user subagent.

The edit/delete guard logic in the command handler:
- If `config.source === 'settings'` (i.e., no disk override): reject with "Cannot edit/delete settings-defined subagent 'foo'. Modify it in settings.json instead."
- If `config.source === 'user'`: allow edit/delete (operates on the disk file). `SubagentManager.deleteSubagent()` already handles the delete case (Step 3g).

**5c.** In show handler, include provenance information using the same two-call check sequence from 5b.

### Step 6: Tests

**6a.** Add tests to `packages/core/src/config/test/subagentManager.test.ts`:

| Test | Description |
|------|-------------|
| `registerSettingsSubagents` populates map | Call with valid definitions, verify `settingsSubagents` map is populated |
| `registerSettingsSubagents` skips invalid names | Names with spaces/special chars are skipped with debug log |
| `registerSettingsSubagents` skips missing fields | Entries missing `profile` or `systemPrompt` are skipped |
| `clearSettingsSubagents` empties map | After registering, clearing empties the map |
| `listSubagents` includes settings subagents | Returns union of user + settings + extension, sorted, no duplicates |
| `listSubagents` deduplicates correctly | Same name in user and settings: appears once |
| `loadSubagent` user wins over settings | User disk file takes precedence over settings definition |
| `loadSubagent` settings wins over extension | Settings definition takes precedence over extension |
| `loadSubagent` falls back to settings | When no disk file exists, returns settings subagent |
| `subagentExists` returns true for settings | Settings-only subagent returns true |
| `deleteSubagent` blocks for settings-only | Throws error for settings-only subagent with no disk override |
| `deleteSubagent` allows user override deletion | When user disk file overrides a settings subagent, deletion succeeds |
| Settings subagent has `source: 'settings'` | Loaded config has correct source field |
| Settings subagent has sentinel timestamps | `createdAt` and `updatedAt` are `1970-01-01T00:00:00.000Z` |
| `hasSettingsSubagent` returns true for registered name | After `registerSettingsSubagents`, `hasSettingsSubagent(name)` returns true |
| `hasSettingsSubagent` returns false after clear | After `clearSettingsSubagents`, returns false |

**6b.** Add/update tests in `packages/cli/src/ui/commands/test/subagentCommand.test.ts`:

| Test | Description |
|------|-------------|
| `/subagent list` shows settings provenance | Settings subagents labeled `[settings]` |
| `/subagent show` works for settings subagents | Shows config details plus `[settings]` provenance |
| `/subagent edit` blocks settings-only | Error message: "Modify it in settings.json instead" |
| `/subagent delete` blocks settings-only | Error message: "Modify it in settings.json instead" |

**6c.** Verify existing orchestrator tests still pass — `subagentOrchestrator.test.ts` should transparently resolve settings subagents through the unchanged `loadSubagent()` call interface.

## Scope Boundaries

- **IN SCOPE:** `settings.json` gains `subagents.definitions` map → config loading parses definitions → SubagentManager serves them at middle priority (user > settings > extension) → `/subagent` UI shows them with `[settings]` provenance → `task()` delegation can target them → edit/delete blocked for settings-only subagents.
- **OUT OF SCOPE:** Extension-provided subagents — that is batch B46 (`aa524625503`). Do NOT re-do extension subagent work.
- **OUT OF SCOPE:** Upstream `/agents` command, `AgentRegistry`, `DelegateToAgentTool`, markdown-frontmatter parsing.
- **OUT OF SCOPE:** `@subagent` suggestion UX — that is batch B17 (`18dd399cb57`).
- **OUT OF SCOPE:** Admin-scope enforcement of subagent settings — that can be a follow-up if needed.

## Verification

FULL verification required for batch B48:

```bash
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

Also run targeted tests:

```bash
npx vitest run packages/core/src/config/test/subagentManager.test.ts
npx vitest run packages/cli/src/ui/commands/test/subagentCommand.test.ts
npx vitest run packages/core/src/core/subagentOrchestrator.test.ts
```

## Execution Risks

1. **B46 dependency.** This batch assumes B46 has landed, providing `SubagentConfig.source`, in-memory merge infrastructure, and `_listDiskSubagents()` / `_loadDiskSubagent()` / `_diskSubagentExists()` private methods. If B46 has not landed, those must be built first — significantly expanding scope.
2. **Settings reading pattern.** The exact way to read `subagents.definitions` from settings depends on how `config.ts` exposes loaded settings during `initialize()`. Match the existing pattern used for `subagents.asyncEnabled` in `packages/core/src/tools/task.ts` and `packages/core/src/core/prompts.ts`.
3. **Schema validation integration.** The `settingsSchema.ts` shape must correctly validate the `definitions` map. If LLxprt uses JSON Schema validation on settings load, the `additionalProperties` pattern must match the validator's expectations. Check how `mcpServers` or similar map-type settings are validated.
4. **Three-tier precedence correctness.** User > settings > extension must hold in `loadSubagent()`, `listSubagents()`, and `subagentExists()`. Off-by-one in the resolution chain creates subtle bugs. Test all seven combinations (user-only, settings-only, extension-only, user+settings, user+extension, settings+extension, user+settings+extension).
5. **Existing settings consumers.** Code that reads `subagents` settings (e.g., `task.ts` reading `subagents.asyncEnabled`) must not break when `definitions` is present alongside `asyncEnabled` and `maxAsync`. Verify that casting `globalSettings['subagents']` to `Record<string, unknown>` still works.
6. **Avoid accidentally making settings subagents writable.** `saveSubagent()` writes to disk, creating a user override. This is correct behavior. But verify that no code path accidentally writes back to `settings.json`.
7. **`requiresRestart: true` on `definitions`.** Settings-defined subagent changes require a restart because SubagentManager only reads them during `initialize()`. This is consistent with `mcpServers` requiring restart.
