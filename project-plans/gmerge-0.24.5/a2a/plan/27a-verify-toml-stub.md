# Phase 27a: TOML Integration Stub - Verification

## Phase ID

`PLAN-20260302-A2A.P27a`

## Prerequisites

- Required: Phase 27 (TOML Integration Stub) completed
- Expected: agent-toml-loader.ts exists with schemas and stub functions

## Verification Tasks

### 1. File Structure Check

```bash
# File exists
test -f packages/core/src/agents/agent-toml-loader.ts && echo "FOUND" || echo "MISSING"

# Line count (should be ~50 lines)
wc -l packages/core/src/agents/agent-toml-loader.ts
# Expected: 40-60 lines
```

### 2. Schema Verification

```bash
# Remote agent schema
grep -A 10 "RemoteAgentTomlSchema" packages/core/src/agents/agent-toml-loader.ts | grep "agent_card_url.*z.string().url()"
# Expected: URL validation present

# Local agent schema
grep "LocalAgentTomlSchema" packages/core/src/agents/agent-toml-loader.ts
# Expected: Schema defined

# File schema
grep "AgentFileSchema" packages/core/src/agents/agent-toml-loader.ts
# Expected: Schema defined
```

### 3. Function Verification

```bash
# loadAgentsFromToml stub
grep -A 5 "export.*loadAgentsFromToml" packages/core/src/agents/agent-toml-loader.ts | grep "return.*local.*remote"
# Expected: Returns object with local and remote arrays

# inferAgentKind stub
grep -A 3 "export.*inferAgentKind" packages/core/src/agents/agent-toml-loader.ts | grep "return.*'local'"
# Expected: Returns 'local' (stub behavior)
```

### 4. Markers Check

```bash
# Plan markers
grep -c "@plan:PLAN-20260302-A2A.P27" packages/core/src/agents/agent-toml-loader.ts
# Expected: 6+

# Requirement markers
grep "@requirement:" packages/core/src/agents/agent-toml-loader.ts
# Expected: A2A-REG-006, A2A-CFG-003, A2A-CFG-004
```

### 5. Compilation Check

```bash
# TypeScript compile
npm run typecheck
# Expected: Success
```

## Checklist

**File Structure:**
- [ ] agent-toml-loader.ts exists
- [ ] Imports: zod, types, fs, toml

**Schemas Defined:**
- [ ] RemoteAgentTomlSchema with agent_card_url (URL validation)
- [ ] LocalAgentTomlSchema (minimal)
- [ ] AgentFileSchema with local_agents, remote_agents

**Functions Stubbed:**
- [ ] loadAgentsFromToml returns { local: [], remote: [] }
- [ ] inferAgentKind returns 'local'

**Markers:**
- [ ] @plan markers: 6+
- [ ] @requirement markers: 3+

**Compilation:**
- [ ] TypeScript compiles
- [ ] No linter errors

## Success Criteria

All verification commands pass AND all checklist items checked.

## Report Template

Create: `project-plans/gmerge-0.24.5/a2a/plan/.verified/P27a-report.md`

```markdown
# Phase 27a Verification Report

**Date**: [YYYY-MM-DD HH:MM]
**Verifier**: [Your name/agent ID]

## Verification Results

### File Structure
- File exists: YES
- Line count: [X] lines
- Imports: zod, types, fs, toml - ALL PRESENT

### Schemas
- RemoteAgentTomlSchema: DEFINED
  - agent_card_url validation: URL (.url())
- LocalAgentTomlSchema: DEFINED
- AgentFileSchema: DEFINED

### Functions
- loadAgentsFromToml: STUBBED (returns empty arrays)
- inferAgentKind: STUBBED (returns 'local')

### Markers
- @plan markers: [X]
- @requirement markers: [Y]

### Compilation
- TypeScript: PASS

## Status

PASS: TOML loader stub complete. Schemas defined, functions stubbed.

## Next Steps

Proceed to Phase 28: TOML Integration - TDD
```

## Phase Completion

After creating report:

```bash
echo "P27a" >> project-plans/gmerge-0.24.5/a2a/plan/.completed/phases.log
```

Proceed to Phase 28 (TOML Integration TDD).
