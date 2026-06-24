<!-- @plan:PLAN-20260621-COREAPIREMED.P22 @requirement:REQ-007 -->
# Phase 22: Documentation — docs/agent-api.md

## Phase ID

`PLAN-20260621-COREAPIREMED.P22`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 21a completed (PASS)
- Verification: `test -f project-plans/issue1594remediate/.completed/P21a.md`

## Requirements Implemented (Expanded)

### REQ-007: Documentation of the remediated surface

**Full Text**: `docs/agent-api.md` MUST document the remediation additions: `fromConfig` (Config
adoption + ownership semantics), the Agent settings/config projection (`getConfig`,
`getEphemeralSetting`, `setEphemeralSetting`, `getEphemeralSettings`), the real
`getCurrentSequenceModel`, the promoted public `AgentClientContract` type, and read-only
`getRuntimeId()`. It MUST state that these import from `@vybestack/llxprt-code-agents` (NOT `-core`)
and document the no-deep-import boundary for #1595.
**Behavior**:
- GIVEN: a #1595 developer reading the docs
- WHEN: they look up how to adopt the CLI's Config and drive turns
- THEN: they find accurate, copy-pasteable examples using ONLY public imports
**Why This Matters**: docs are the contract surface #1595 implementers rely on; inaccurate docs
re-introduce deep imports.

## Implementation Tasks

### Files to Modify

- `docs/agent-api.md` — ADD sections (do not rewrite existing #1594 content):
  - "Adopting an existing Config (`fromConfig`)" — example building a Config then
    `const agent = await fromConfig({ config });`; note the supplied Config is caller-owned (NOT
    disposed by `agent.dispose()`), contrasted with `createAgent` (which disposes its own).
  - "Settings & config projection" — `agent.getConfig()`, `agent.getEphemeralSetting(key)`,
    `agent.setEphemeralSetting(key, value)`, `agent.getEphemeralSettings()`; note normalization +
    side effects are delegated to Config.
  - "Current sequence model" — `agent.getCurrentSequenceModel()` returns the bound client's model
    (nullable) and reflects rebinds.
  - "Public client contract" — `import type { AgentClientContract } from '@vybestack/llxprt-code-agents'`.
  - "Runtime identity" — `agent.getRuntimeId()` (read-only).
  - "Import boundary for #1595" — only the public root + `/internals.js` + `/app-service.js`.
  - All examples MUST be drawn from the passing harness so they are provably correct.
  - Marker comment block `@plan:PLAN-20260621-COREAPIREMED.P22 @requirement:REQ-007` at the top of
    each added section (HTML comment).

### Constraints

- Examples must use ONLY public imports (mirror the harness).
- No invented APIs — every documented symbol exists and is exercised by a test.

## Verification Commands

```bash
set -e
test -f docs/agent-api.md
for s in "fromConfig" "getEphemeralSetting" "setEphemeralSetting" "getEphemeralSettings" "getConfig" "getCurrentSequenceModel" "AgentClientContract" "getRuntimeId"; do
  grep -q "$s" docs/agent-api.md || { echo "MISSING doc for $s"; exit 1; }
done
grep -q "@vybestack/llxprt-code-agents" docs/agent-api.md || { echo "MISSING package name"; exit 1; }
# No deep-import examples in docs
grep -nE "from '[^']*(/src/|core/src|providers/src)" docs/agent-api.md && { echo "FAIL: deep-import example in docs"; exit 1; } || true
grep -q "@plan:PLAN-20260621-COREAPIREMED.P22" docs/agent-api.md || { echo "MISSING plan marker"; exit 1; }
```

### Semantic Verification Checklist

- [ ] Every documented symbol exists in the code and is covered by a test.
- [ ] `fromConfig` ownership semantics documented (caller-owned Config NOT disposed).
- [ ] No deep-import examples; all examples use the public root/subpaths.
- [ ] Existing #1594 doc content preserved (additive).

## Success Criteria

- docs/agent-api.md accurately documents all remediation additions with public-only examples.

## Failure Recovery

- `git checkout -- docs/agent-api.md`; re-add sections from the passing harness.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P22.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P22
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```
