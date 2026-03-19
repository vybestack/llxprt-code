# Phase 27: TOML Integration - Stub

## Phase ID

`PLAN-20260302-A2A.P27`

## Prerequisites

- Required: Phase 26a (Execution Dispatch Verification) completed
- Verification: createInvocation dispatch works, all tests pass
- Expected files: Policy TOML loader pattern exists (packages/core/src/policy/toml-loader.ts)

## Requirements Implemented

### REQ A2A-REG-006: TOML Loading Stub

**Full EARS Text**: The system shall load remote agent definitions from TOML files with `kind = "remote"` and `agent_card_url` fields.

**Behavior Specification**:
- GIVEN: A TOML file with agent definitions
- WHEN: System loads the file during initialization
- THEN: Remote agents with agent_card_url are recognized as kind='remote'
- AND: Local agents without agent_card_url are recognized as kind='local'

**Why This Matters**: Per requirements.md A2A-REG-006 and upstream commit 848e8485c, TOML loading is MVP (not post-MVP). Without it, users must programmatically register remote agents, which is not feature-parity with gemini-cli.

### REQ A2A-CFG-003: Zod Schema Stub

**TOML entries must be validated via Zod schemas before registration.**

### REQ A2A-CFG-004: Kind Inference Stub

**If agent_card_url is present, kind is inferred as 'remote' even without explicit kind field.**

## Implementation Tasks

### Files to Create

**`packages/core/src/agents/agent-toml-loader.ts`** — Agent TOML loader (stub)

```typescript
/**
 * Agent TOML loader for local and remote agent definitions.
 * @plan PLAN-20260302-A2A.P27
 * @requirement A2A-REG-006, A2A-CFG-003, A2A-CFG-004
 */

import { z } from 'zod';
import type { LocalAgentDefinition, RemoteAgentDefinition } from './types.js';
import fs from 'node:fs/promises';
import toml from '@iarna/toml';

/**
 * Zod schema for remote agent TOML entry.
 * @plan PLAN-20260302-A2A.P27
 * @requirement A2A-CFG-003
 */
const RemoteAgentTomlSchema = z.object({
  kind: z.literal('remote').optional(), // Optional - inferred from agent_card_url
  name: z.string(),
  display_name: z.string().optional(),
  description: z.string().optional(),
  agent_card_url: z.string().url(), // MUST be valid URL
  // inputConfig assumed present - no validation in stub
});

/**
 * Zod schema for local agent TOML entry (minimal stub).
 * @plan PLAN-20260302-A2A.P27
 */
const LocalAgentTomlSchema = z.object({
  kind: z.literal('local').optional(),
  name: z.string(),
  display_name: z.string().optional(),
  description: z.string().optional(),
  // Full local agent schema in P29
});

/**
 * Schema for agent TOML file structure.
 * @plan PLAN-20260302-A2A.P27
 */
const AgentFileSchema = z.object({
  local_agents: z.array(LocalAgentTomlSchema).optional(),
  remote_agents: z.array(RemoteAgentTomlSchema).optional(),
});

/**
 * Load agent definitions from TOML file.
 * @plan PLAN-20260302-A2A.P27
 * @requirement A2A-REG-006
 */
export async function loadAgentsFromToml(
  filePath: string
): Promise<{ local: LocalAgentDefinition[]; remote: RemoteAgentDefinition[] }> {
  // STUB: Return empty arrays
  // P29 will implement full parsing
  return { local: [], remote: [] };
}

/**
 * Infer agent kind from TOML entry.
 * If agent_card_url is present → remote, otherwise → local.
 * @plan PLAN-20260302-A2A.P27
 * @requirement A2A-CFG-004
 */
export function inferAgentKind(entry: unknown): 'local' | 'remote' {
  // STUB: Always return 'local'
  // P29 will implement proper type narrowing and check:
  // if (typeof entry === 'object' && entry !== null && 'agent_card_url' in entry) return 'remote';
  return 'local';
}
```

### Implementation Notes

1. **Zod Schemas**: Define structure for validation (not used in stub)
2. **Kind Inference**: Function signature exists but returns 'local' (stub)
3. **TOML Parsing**: imports exist but loadAgentsFromToml returns empty (stub)
4. **URL Validation**: RemoteAgentTomlSchema uses `.url()` for agent_card_url

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 27 of 33 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 26a completed: dispatch tests all pass.

YOUR TASK:
Create stub file `packages/core/src/agents/agent-toml-loader.ts` with Zod schemas and stub functions.

STRUCTURE:

1. **Imports**:
   - z from 'zod'
   - LocalAgentDefinition, RemoteAgentDefinition from './types.js'
   - fs from 'node:fs/promises'
   - toml from '@iarna/toml'

2. **Schemas** (define, don't use yet):
   - RemoteAgentTomlSchema: z.object with kind (optional), name, display_name (optional), description (optional), agent_card_url (z.string().url())
   - LocalAgentTomlSchema: minimal z.object with kind, name, display_name, description
   - AgentFileSchema: z.object with local_agents, remote_agents arrays

3. **Functions** (stubs):
   - loadAgentsFromToml(filePath): return { local: [], remote: [] }
   - inferAgentKind(entry: unknown): return 'local' (uses unknown + type narrowing)

DELIVERABLES:
- agent-toml-loader.ts created (~50 lines)
- Schemas defined with Zod
- Functions stubbed (return empty/default)
- All markers: @plan PLAN-20260302-A2A.P27

DO NOT:
- Implement parsing logic (that's P29)
- Add tests (tests in P28)
```

## Verification Commands

### Automated Checks

```bash
# File exists
test -f packages/core/src/agents/agent-toml-loader.ts && echo "FOUND" || echo "MISSING"

# Schemas defined
grep "RemoteAgentTomlSchema" packages/core/src/agents/agent-toml-loader.ts
grep "LocalAgentTomlSchema" packages/core/src/agents/agent-toml-loader.ts
grep "AgentFileSchema" packages/core/src/agents/agent-toml-loader.ts
# Expected: All 3 found

# Functions exported
grep "export.*loadAgentsFromToml" packages/core/src/agents/agent-toml-loader.ts
grep "export.*inferAgentKind" packages/core/src/agents/agent-toml-loader.ts
# Expected: Both exported

# Check inferAgentKind uses unknown (not any)
grep "inferAgentKind(entry: unknown)" packages/core/src/agents/agent-toml-loader.ts
# Expected: Found (type-safe parameter)

# Plan markers
grep -c "@plan PLAN-20260302-A2A.P27" packages/core/src/agents/agent-toml-loader.ts
# Expected: 6+ (schemas + functions)

# Requirement markers
grep -c "@requirement A2A-" packages/core/src/agents/agent-toml-loader.ts
# Expected: 3+ (A2A-REG-006, A2A-CFG-003, A2A-CFG-004)

# Type check
npm run typecheck
# Expected: Success
```

## Success Criteria

- File created with Zod schemas
- Functions stubbed (return empty/default)
- All markers present
- TypeScript compiles

## Failure Recovery

If this phase fails:

1. Rollback:
   ```bash
   rm -f packages/core/src/agents/agent-toml-loader.ts
   ```
2. Fix issues and retry
3. Cannot proceed to Phase 27a until stub is complete

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P27.md`

Contents:
```markdown
Phase: P27
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Created: packages/core/src/agents/agent-toml-loader.ts (~50 lines)

Components:
  - RemoteAgentTomlSchema (Zod)
  - LocalAgentTomlSchema (Zod)
  - AgentFileSchema (Zod)
  - loadAgentsFromToml() stub
  - inferAgentKind() stub

Verification: Compiles successfully
Next Phase: P27a (Verification of P27)
```
