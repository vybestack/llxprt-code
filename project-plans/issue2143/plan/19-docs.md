<!-- @plan:PLAN-20260622-COREAPIGAP.P19 @requirement:REQ-010 -->
# Phase 19: Public API Documentation

## Phase ID

`PLAN-20260622-COREAPIGAP.P19`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 18a completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P18a.md`

## Requirements Implemented (Expanded)

### REQ-010: Document every new public capability

**Full Text**: `docs/agent-api.md` MUST document the new public surface added by REQ-001..008 so a
#1595 developer can discover and call it WITHOUT reading source: top-level approval-mode methods, the
`policy`, `tasks` sub-controllers, the extended `hooks` administration, the extended `auth` detailed
metadata, the extended `mcp` OAuth/details, and `tools.keys`; plus the new public enum values
(`ApprovalMode`, `PolicyDecision`) and projected types; plus the six new `COMMAND_API_MAP` rows.
**Behavior**:
- GIVEN: a developer reading only `docs/agent-api.md`
- WHEN: they look up any capability migrated off the `getConfig()` escape hatch
- THEN: they find a code example that imports ONLY from `@vybestack/llxprt-code-agents`, calls the
  documented method, and matches the real shipped signature
**Why This Matters**: "clean & complete public API" includes discoverability. Undocumented surface is
a de-facto escape hatch — #1595 would re-read `-core`. Docs are an acceptance criterion, not a
nicety.

## Background — verified current state

- `docs/agent-api.md` exists (739 lines). Relevant anchors:
  - `## The `Agent` Control Plane` (:176) → `### Top-level: turns/provider/model/history` (:184-209)
    and `### Sub-surfaces` (:222) enumerating the existing controllers.
  - `## Settings & Config Projection` (:495) incl. `### `agent.getConfig()`` (:503).
  - `## Runtime vs App-Service` (:640) and `### `COMMAND_API_MAP`` (:672).
  - `## Recorded Decisions` (:713).
- This phase ADDS documentation; it does not rewrite existing sections. Insert new top-level method
  docs under the `### Top-level:` group, new sub-surface docs under `### Sub-surfaces`, enum/type docs
  in the appropriate reference area, and the six rows under `### COMMAND_API_MAP`.

## Implementation Tasks

### Files to Modify

- `docs/agent-api.md` — ADD the following (additive; keep existing sections intact). Place each near
  the matching existing section. Every code example imports ONLY from
  `@vybestack/llxprt-code-agents` (NO `@vybestack/llxprt-code-core/...` deep import, NO
  `agent.getConfig()`), and matches the shipped signatures:
  1. **Approval mode** (under the `### Top-level:` group): document
     `agent.getApprovalMode(): ApprovalMode` and `agent.setApprovalMode(mode: ApprovalMode): void`,
     including the untrusted-folder throw ("Cannot enable privileged approval modes in an untrusted
     folder.") and the `ApprovalMode` enum values (`DEFAULT`/`AUTO_EDIT`/`YOLO`).
  2. **`agent.policy`** (under `### Sub-surfaces`): `getRules(): readonly PolicyRuleView[]`,
     `getDefaultDecision(): PolicyDecision`, `isNonInteractive(): boolean`; note `PolicyRuleView`
     projects `argsPattern` to a string (`argsPatternSource`) for JSON-safety.
  3. **`agent.tasks`**: `list()`, `listRunning()`, `get(id)`, `cancel(id)`, `cancelAllRunning()`
     returning the projected `AgentTaskInfo` (note `abortController` is intentionally NOT exposed);
     undefined-safe when no async-task manager.
  4. **`agent.hooks` administration** (extend the existing hooks doc): `listHooks(): readonly
     HookInfo[]`, `getDisabledHooks()`, `setDisabledHooks(names)`, `enable(name)`/`disable(name)`/
     `enableAll()`/`disableAll()`; undefined-safe when no hook system.
  5. **`agent.auth` detailed metadata** (extend the existing auth doc): `detailedStatus(provider)`,
     `getHigherPriorityAuth(provider)`, `listBucketStatuses(provider)` returning MASKED
     `AuthProviderDetail`/`AuthBucketStatus` — explicitly state raw tokens are NEVER returned.
  6. **`agent.mcp` OAuth + details** (extend the existing mcp doc): `authenticate(server):
     Promise<McpServerAuthStatus>` (real OAuth + post-auth tool refresh), `details(opts?):
     Promise<McpDetailStatus>`, and the `refresh(server?)` setTools-parity note.
  7. **`agent.tools.keys`** (under tools): `supported()`, `status(tool)` (masked), `save(tool, key)`,
     `delete(tool)`, `setKeyFile(tool, path|null)`, `getKeyFile(tool)`; state raw secrets are NEVER
     returned (only `maskedKey`).
  8. **Enums & projected types**: a short reference block listing the new public VALUE enums
     (`ApprovalMode`, `PolicyDecision`) and projected types (`PolicyRuleView`, `AgentTaskInfo`,
     `HookInfo`, `AuthProviderDetail`, `AuthBucketStatus`, `McpServerAuthStatus`, `McpDetailStatus`,
     `McpServerDetail`, `McpDetailsOptions`, `McpPromptInfo`, `McpResourceInfo`, `McpBlockedServer`,
     `ToolKeyInfo`, `ToolKeyStatus`), importable from the public root.
  9. **`### COMMAND_API_MAP`** (:672): add the six new `runtime` rows to the documented table
     (`/approval-mode`, `/policies`, `/task`, `/hooks`, `/toolkey`, `/toolkeyfile`) with their Agent
     targets, matching `command-api-map.ts`.
  10. **`## Recorded Decisions`** (:713): append a short decision note that this surface closes the
      #2143 capability gaps as a prerequisite to #1595, with the masked-only / projected-type /
      delegate-don't-cache constraints.

### Constraints

- ADDITIVE: do not delete or rewrite existing sections (the existing `getConfig()` section stays —
  it documents an intentional escape hatch, now narrowed).
- Every example must be COPY-PASTE accurate to the shipped signatures (verify against `agent.ts`).
- No example may import `@vybestack/llxprt-code-core/...` (deep) or call `agent.getConfig()` to reach
  a capability this plan made first-class.
- This is a docs phase: no source/test code changes.

## Verification Commands

```bash
set -o pipefail
set -e
D=docs/agent-api.md

# 1. Each new symbol/method is documented (grep presence).
for SYM in getApprovalMode setApprovalMode "agent.policy" getRules getDefaultDecision isNonInteractive \
           "agent.tasks" listRunning cancelAllRunning AgentTaskInfo \
           listHooks getDisabledHooks setDisabledHooks \
           detailedStatus getHigherPriorityAuth listBucketStatuses \
           "agent.mcp" "authenticate(" "details(" \
           "agent.tools.keys" setKeyFile getKeyFile maskedKey \
           ApprovalMode PolicyDecision PolicyRuleView ToolKeyStatus McpDetailStatus; do
  grep -qF "$SYM" "$D" || { echo "FAIL: doc missing symbol: $SYM"; exit 1; }
done

# 2. Six command rows documented.
for CMD in "/approval-mode" "/policies" "/task" "/hooks" "/toolkey" "/toolkeyfile"; do
  grep -qF "$CMD" "$D" || { echo "FAIL: doc missing command row: $CMD"; exit 1; }
done

# 3. NO example reaches around the public API (no deep core import, no getConfig escape for new caps).
if grep -nE "@vybestack/llxprt-code-core/" "$D"; then echo "FAIL: doc example uses a deep core import"; exit 1; fi
# getConfig may be MENTIONED (its own section) but must not be the documented way to reach a new cap:
# ensure the new-capability examples import from the public root.
grep -qE "from '@vybestack/llxprt-code-agents'" "$D" || { echo "FAIL: examples must import the public root"; exit 1; }

# 4. Existing sections preserved (append-only spot-check).
for SEC in "## The .Agent. Control Plane" "### Sub-surfaces" "### .COMMAND_API_MAP." "## Recorded Decisions" "### .agent.getConfig.."; do
  grep -qE "$SEC" "$D" || { echo "FAIL: existing doc section removed: $SEC"; exit 1; }
done
# Only additions to the doc (no removed content lines beyond pure formatting).
git diff HEAD -- "$D" | grep -E "^-" | grep -vE "^---" | grep -E "^-#|^-\`\`\`|^-\| " \
  && { echo "FAIL: a heading/code-fence/table-row was removed from docs"; exit 1; } || true

# 5. Plan marker present in the doc (HTML comment is fine in markdown).
grep -qE "PLAN-20260622-COREAPIGAP" "$D" || { echo "FAIL: plan marker missing in docs"; exit 1; }

# 6. Lint/format pass for markdown if the repo gates it (no-op otherwise).
npm run format 2>&1 | tail -5 || true
echo "PASS: P19 docs green."
```

### Semantic Verification Checklist

- [ ] All seven capability groups documented with public-root-only examples matching shipped
      signatures.
- [ ] New enums + projected types referenced; six command rows added to the map table.
- [ ] No deep-core import or `getConfig()` escape in any new example.
- [ ] Existing sections (incl. the `getConfig()` section) preserved; append-only.

## Success Criteria

- `docs/agent-api.md` documents the full new surface, public-root-only, append-only; format gate
  green.

## Failure Recovery

- `git checkout -- docs/agent-api.md` and re-apply additively; fix any example whose signature drifts
  from `agent.ts`.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P19.md`

```markdown
Phase: P19
Completed: YYYY-MM-DD HH:MM
Files Created: none
Files Modified: [docs/agent-api.md +N/-0]
Verification: [paste actual output]
Semantic Assessment: [one-line: #1595 dev can discover+call every new cap from docs, public-root only]
```
