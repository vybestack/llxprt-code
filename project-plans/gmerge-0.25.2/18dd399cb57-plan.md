# Playbook: Support @subagent Suggestions

**Upstream SHA:** `18dd399cb57`
**Upstream Subject:** Support @ suggestions for subagents (#16201)
**Upstream Stats:** ~4 files, moderate insertions

## What Upstream Does

Upstream adds `@agent` autocompletion suggestions in the input field. When the user types `@`, in addition to file paths and MCP resources, the suggestion list now includes available agents. This is a **suggestion/completion-layer only** change — it does NOT modify command processing or delegation behavior. The implementation:
1. Queries the `AgentRegistry` for available agents.
2. Adds agent names as `Suggestion` items with an "agent" description.
3. Merges agent suggestions with file/resource suggestions, with agents shown at a lower priority.

## Why REIMPLEMENT in LLxprt

1. **LLxprt does NOT use upstream's `/agents` or `AgentRegistry` architecture.** LLxprt uses `/subagent`, `SubagentManager`, and `task()` for subagent delegation.
2. `packages/cli/src/ui/hooks/useAtCompletion.ts` (a React hook, not an LLxprt HookSystem hook) currently supports only file path suggestions and MCP resource suggestions (via `buildResourceCandidates()` at line 103). There is no subagent suggestion support.
3. `SubagentManager` (in `packages/core/src/config/subagentManager.ts`, line 269) exposes `listSubagents(): Promise<string[]>` which returns available subagent names — this is the LLxprt equivalent of querying the `AgentRegistry`.
4. The `Suggestion` interface (in `SuggestionsDisplay.tsx`, line 11) has `label`, `value`, `description?`, `matchedIndex?` — subagent suggestions should use this interface with `description: 'subagent'`.
5. **Scope note:** This commit is suggestion-only. The `@subagentname` text stays in the user's message as-is for the model to interpret (same as upstream). No changes to `atCommandProcessor.ts` or `task()` delegation are in scope.

## Terminology Note

File paths like `ui/hooks/useAtCompletion.ts` refer to **React hooks** (custom hook functions), not LLxprt's `HookSystem` (the event-driven hook subsystem in `packages/core`). This commit does not touch LLxprt HookSystem.

## LLxprt File Existence Map

**Present (verified):**
- [OK] `packages/cli/src/ui/hooks/useAtCompletion.ts` — React hook (322 lines); file + resource suggestions; uses `AsyncFzf` for fuzzy search
- [OK] `packages/cli/src/ui/hooks/useAtCompletion.test.ts` — Existing tests (574 lines); uses `renderHook`/`waitFor`, temp dirs, mock Config
- [OK] `packages/cli/src/ui/components/SuggestionsDisplay.tsx` — `Suggestion` interface (line 11), `MAX_SUGGESTIONS_TO_SHOW = 8` (line 27)
- [OK] `packages/core/src/config/subagentManager.ts` — `SubagentManager` class; `listSubagents()` at line 269 returns `Promise<string[]>`; `subagentExists()` at line 363
- [OK] `packages/core/src/config/config.ts` — `getSubagentManager()` (line 660) returns `SubagentManager | undefined`

**Not modified (out of scope for this commit):**
- `packages/cli/src/ui/hooks/atCommandProcessor.ts` — `@subagentname` stays as text in the user's prompt for the model to interpret; no command-processing changes needed.
- `packages/cli/src/ui/components/SuggestionsDisplay.tsx` — The `description` field already renders in the UI; `description: 'subagent'` will display automatically.

**Must NOT create:**
- No new files — changes fit in existing files.

## Files to Modify / Create

### 1. Modify: `packages/cli/src/ui/hooks/useAtCompletion.ts`

Add subagent suggestion candidates alongside file and resource candidates. Follow the exact same pattern already used for MCP resource suggestions.

#### A. Add `SubagentSuggestionCandidate` interface (after `ResourceSuggestionCandidate` at line 98):

```typescript
interface SubagentSuggestionCandidate {
  searchKey: string;
  suggestion: Suggestion;
}
```

#### B. Add `buildSubagentCandidates()` function (after `buildResourceCandidates()`, around line 135):

`SubagentManager.listSubagents()` is async (filesystem I/O). Rather than adding a separate `useEffect`/`useRef` for async loading, cache subagent candidates inside the existing search worker effect (lines 228-320) where async is already expected. This keeps the architecture simple: build candidates on each search, same as `buildResourceCandidates()` is called synchronously on each search today.

However, since `listSubagents()` is async while `buildResourceCandidates()` is sync, the builder must also be async:

```typescript
async function buildSubagentCandidates(
  config?: Config,
): Promise<SubagentSuggestionCandidate[]> {
  const subagentManager = config?.getSubagentManager?.();
  if (!subagentManager) {
    return [];
  }

  try {
    const names = await subagentManager.listSubagents();
    return names.map((name) => ({
      searchKey: name.toLowerCase(),
      suggestion: {
        label: name,
        value: name,
        description: 'subagent',
      },
    }));
  } catch {
    return [];
  }
}
```

#### C. Add `searchSubagentCandidates()` function (after `searchResourceCandidates()`, around line 162):

Mirror the `searchResourceCandidates` pattern exactly, including `limit: MAX_SUGGESTIONS_TO_SHOW * 3`:

```typescript
async function searchSubagentCandidates(
  pattern: string,
  candidates: SubagentSuggestionCandidate[],
): Promise<Suggestion[]> {
  if (candidates.length === 0) {
    return [];
  }

  const normalizedPattern = pattern.toLowerCase();
  if (!normalizedPattern) {
    return candidates
      .slice(0, MAX_SUGGESTIONS_TO_SHOW)
      .map((candidate) => candidate.suggestion);
  }

  const fzf = new AsyncFzf(candidates, {
    selector: (candidate: SubagentSuggestionCandidate) => candidate.searchKey,
  });
  const results = await fzf.find(normalizedPattern, {
    limit: MAX_SUGGESTIONS_TO_SHOW * 3,
  });
  return results.map(
    (result: { item: SubagentSuggestionCandidate }) => result.item.suggestion,
  );
}
```

#### D. Merge subagent results in the search worker (inside `search()` around lines 291-300):

After the existing resource suggestion search (line 292-295), add:

```typescript
// Build and search subagent candidates
const subagentCandidates = await buildSubagentCandidates(config);
const subagentSuggestions = await searchSubagentCandidates(
  state.pattern ?? '',
  subagentCandidates,
);
```

Then update the dispatch payload (currently line 297-300) to merge all three:

```typescript
dispatch({
  type: 'SEARCH_SUCCESS',
  payload: [...fileSuggestions, ...resourceSuggestions, ...subagentSuggestions],
});
```

Priority order: files first, then MCP resources, then subagents (lowest priority — matches upstream behavior).

### 2. Add/Update Tests: `packages/cli/src/ui/hooks/useAtCompletion.test.ts`

Add a new `describe('Subagent Suggestions', ...)` block. Follow the existing test patterns — use mock Config with `getSubagentManager` returning a mock `SubagentManager` whose `listSubagents()` returns test names.

**Test cases:**

1. **Subagent names appear in suggestions when SubagentManager is available.** Create a config mock with `getSubagentManager` returning `{ listSubagents: () => Promise.resolve(['codeanalyzer', 'deepthinker', 'typescriptexpert']) }`. Search with empty pattern. Assert subagent suggestions appear with `description: 'subagent'`.

2. **Subagent suggestions are filtered by pattern.** Search with pattern `'deep'`. Assert only `deepthinker` appears.

3. **Subagent suggestions appear after file suggestions.** Create a temp dir with a file, configure subagents, search with a pattern matching both. Assert files come before subagent suggestions in the array.

4. **No subagent suggestions when SubagentManager is unavailable.** Use a config without `getSubagentManager`. Assert only file suggestions appear (existing behavior preserved).

5. **Graceful handling when listSubagents() rejects.** Mock `listSubagents` to reject. Assert file/resource suggestions still work normally.

## Preflight Checks

```bash
# Verify useAtCompletion has no subagent support yet
grep -n "subagent\|SubagentManager" packages/cli/src/ui/hooks/useAtCompletion.ts
# Expected: no matches

# Verify SubagentManager.listSubagents exists (expect line 269)
grep -n "listSubagents" packages/core/src/config/subagentManager.ts

# Verify config.getSubagentManager exists (expect line 660)
grep -n "getSubagentManager" packages/core/src/config/config.ts

# Verify Suggestion interface has description field (expect line 11-16)
grep -A5 "interface Suggestion" packages/cli/src/ui/components/SuggestionsDisplay.tsx

# Verify existing resource suggestion pattern we're mirroring
grep -n "ResourceSuggestionCandidate\|searchResourceCandidates\|buildResourceCandidates" packages/cli/src/ui/hooks/useAtCompletion.ts
```

## Implementation Steps

1. **Read** `packages/cli/src/ui/hooks/useAtCompletion.ts` fully — note the `ResourceSuggestionCandidate` interface (line 98), `buildResourceCandidates()` (line 103), `searchResourceCandidates()` (line 137), and the search worker effect (lines 228-320) where results are merged at line 297-300.
2. **Read** `packages/core/src/config/subagentManager.ts` — confirm `listSubagents()` at line 269 returns `Promise<string[]>`.
3. **Read** `packages/cli/src/ui/hooks/useAtCompletion.test.ts` — understand existing test patterns (mock Config, `renderHook`, `waitFor`, temp dirs).
4. **Add** `SubagentSuggestionCandidate` interface in `useAtCompletion.ts` (after `ResourceSuggestionCandidate`).
5. **Add** `buildSubagentCandidates()` async function in `useAtCompletion.ts` (after `buildResourceCandidates()`).
6. **Add** `searchSubagentCandidates()` async function in `useAtCompletion.ts` (after `searchResourceCandidates()`).
7. **Merge** subagent results into the dispatch payload inside the search worker, after file and resource results.
8. **Add tests** in `useAtCompletion.test.ts` for the 5 test cases described above.
9. **Run verification.**

## Verification

```bash
npm run typecheck
npm run lint
npm run test -- --reporter=verbose packages/cli/src/ui/hooks/useAtCompletion
npm run format
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

## Execution Notes / Risks

- **Async loading.** `listSubagents()` is async (reads filesystem directory). It is called inside the search worker effect which is already async. If no `SubagentManager` is configured, `buildSubagentCandidates()` returns `[]` immediately. If `listSubagents()` rejects, the catch returns `[]` (non-fatal, file/resource suggestions still work).
- **Name collision.** A subagent name could match a file path. Both will appear in suggestions with different `description` values (`undefined` for files, `'subagent'` for subagents). The user picks which they want. Files appear first in the merged list (higher priority), subagents last.
- **Performance.** `listSubagents()` reads a directory on every search. Subagent directories are small (typically <20 files). If this becomes a bottleneck, caching can be added in a follow-up — not needed for correctness.
- **Do NOT** import or reference `AgentRegistry`, `DelegateToAgentTool`, `/agents` command, or any upstream agent infrastructure.
- **Do NOT** modify `atCommandProcessor.ts` — the `@subagentname` text in the user's message is left as-is for the model to interpret. The model already knows how to use `task()` via its system prompt.
- **Do NOT** change `task()` semantics — this is a UI suggestion convenience only.
- **Preserve** the existing file and MCP resource suggestion behavior — subagent suggestions are purely additive.
- **The `description: 'subagent'` field** on suggestions provides visual differentiation in the suggestion list without needing `SuggestionsDisplay.tsx` component changes.
- **Config access:** `useAtCompletion` already receives `config: Config | undefined` as a prop (line 167). Use `config?.getSubagentManager?.()` to access the subagent manager. The `?.` chain handles the case where `getSubagentManager` doesn't exist on the config interface (it's on the `Config` class but may not be on all mock/partial configs).
