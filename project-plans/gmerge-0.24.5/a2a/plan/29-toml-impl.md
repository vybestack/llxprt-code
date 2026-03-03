# Phase 29: TOML Integration - Implementation

## Phase ID

`PLAN-20260302-A2A.P29`

## Prerequisites

- Required: Phase 28a (TOML Integration TDD Verification) completed
- Verification: agent-toml-loader.test.ts exists with ~10-11 FAIL tests
- Expected files: agent-toml-loader.ts (stub), agent-toml-loader.test.ts

## Requirements Implemented

### All TOML Requirements (Full Implementation)

**REQ A2A-REG-006**: TOML file parsing
**REQ A2A-CFG-003**: Zod validation
**REQ A2A-CFG-004**: Kind inference from agent_card_url
**REQ A2A-SEC-001**: HTTPS enforcement (via Zod refinement)

**Why This Matters**: Implements full TOML parsing with Zod validation, enabling users to configure remote agents via TOML files without writing code. Completes MVP feature parity with upstream gemini-cli.

## Implementation Tasks

### File to Modify

**`packages/core/src/agents/agent-toml-loader.ts`** — Implement full TOML parsing

### Implementation Strategy

Replace stubs with full implementation following policy/toml-loader.ts pattern:

```typescript
/**
 * Agent TOML loader for local and remote agent definitions.
 * @plan PLAN-20260302-A2A.P29
 * @requirement A2A-REG-006, A2A-CFG-003, A2A-CFG-004
 */

import { z } from 'zod';
import type { LocalAgentDefinition, RemoteAgentDefinition, AgentInputs } from './types.js';
import fs from 'node:fs/promises';
import toml from '@iarna/toml';

/**
 * Zod schema for remote agent TOML entry.
 * @plan PLAN-20260302-A2A.P29
 * @requirement A2A-CFG-003, A2A-SEC-001
 */
const RemoteAgentTomlSchema = z.object({
  kind: z.literal('remote').optional(),
  name: z.string(),
  display_name: z.string().optional(),
  description: z.string().optional(),
  agent_card_url: z.string().url()
    .refine((url) => url.startsWith('https://'), {
      message: 'agent_card_url must use HTTPS protocol for security'
    }),
}).strict();

/**
 * Zod schema for local agent TOML entry (minimal for MVP).
 * @plan PLAN-20260302-A2A.P29
 */
const LocalAgentTomlSchema = z.object({
  kind: z.literal('local').optional(),
  name: z.string(),
  display_name: z.string().optional(),
  description: z.string().optional(),
  // Full local agent fields (promptConfig, etc.) are future work
  // For MVP, local agents are still registered programmatically
}).strict();

/**
 * Schema for agent TOML file structure.
 * @plan PLAN-20260302-A2A.P29
 */
const AgentFileSchema = z.object({
  local_agents: z.array(LocalAgentTomlSchema).optional(),
  remote_agents: z.array(RemoteAgentTomlSchema).optional(),
}).strict();

/**
 * Load agent definitions from TOML file.
 * @plan PLAN-20260302-A2A.P29
 * @requirement A2A-REG-006
 */
export async function loadAgentsFromToml(
  filePath: string
): Promise<{ local: LocalAgentDefinition[]; remote: RemoteAgentDefinition[] }> {
  // Read and parse TOML
  const fileContent = await fs.readFile(filePath, 'utf-8');
  const parsed = toml.parse(fileContent);
  
  // Validate against schema
  const validated = AgentFileSchema.parse(parsed);
  
  // Transform remote agents
  const remoteAgents: RemoteAgentDefinition[] = (validated.remote_agents || []).map(entry => ({
    kind: 'remote' as const,
    name: entry.name,
    displayName: entry.display_name,
    description: entry.description,
    agentCardUrl: entry.agent_card_url,
    inputConfig: { inputs: {} } as AgentInputs, // Default empty inputs
  }));
  
  // Transform local agents
  const localAgents: LocalAgentDefinition[] = (validated.local_agents || []).map(entry => ({
    kind: 'local' as const,
    name: entry.name,
    displayName: entry.display_name,
    description: entry.description,
    inputConfig: { inputs: {} } as AgentInputs,
    // These would come from TOML in full implementation:
    promptConfig: { systemPrompt: '' },
    modelConfig: { model: 'gemini-2.0-flash-exp', temp: 0.7, top_p: 1.0 },
    runConfig: { max_time_minutes: 5 },
  }));
  
  return { local: localAgents, remote: remoteAgents };
}

/**
 * Infer agent kind from TOML entry.
 * If agent_card_url is present → remote, otherwise → local.
 * @plan PLAN-20260302-A2A.P29
 * @requirement A2A-CFG-004
 */
export function inferAgentKind(entry: any): 'local' | 'remote' {
  return entry.agent_card_url ? 'remote' : 'local';
}
```

### Key Implementation Details

1. **HTTPS Enforcement**: `.refine()` on agent_card_url to reject http://
2. **Kind Inference**: Check for agent_card_url presence
3. **TOML Parsing**: toml.parse() + Zod validation
4. **Field Mapping**: snake_case (TOML) → camelCase (TypeScript)
5. **Default inputConfig**: Empty inputs for both agent types (MVP)
6. **Local Agent Limitation**: Full promptConfig/modelConfig/runConfig from TOML is future work (MVP only supports remote agents via TOML)

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 29 of 33 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 28a completed: tests exist and most fail against stub.

YOUR TASK:
Implement full TOML parsing in `packages/core/src/agents/agent-toml-loader.ts` to make all 12 tests pass.

REFERENCE PATTERN:
See `packages/core/src/policy/toml-loader.ts` for TOML parsing pattern.

KEY IMPLEMENTATIONS:

1. **RemoteAgentTomlSchema** (replace existing):
   - Add .refine() to agent_card_url: `url => url.startsWith('https://')`
   - Error message: 'agent_card_url must use HTTPS protocol for security'

2. **loadAgentsFromToml** (replace stub):
   - Read file: `await fs.readFile(filePath, 'utf-8')`
   - Parse TOML: `toml.parse(fileContent)`
   - Validate: `AgentFileSchema.parse(parsed)`
   - Transform remote_agents array:
     - Map to RemoteAgentDefinition
     - Convert display_name → displayName
     - Convert agent_card_url → agentCardUrl
     - Set kind: 'remote'
     - Default inputConfig: { inputs: {} }
   - Transform local_agents array (minimal for MVP):
     - Map to LocalAgentDefinition
     - Set kind: 'local'
     - Stub promptConfig, modelConfig, runConfig
   - Return { local, remote }

3. **inferAgentKind** (replace stub):
   - Return: `entry.agent_card_url ? 'remote' : 'local'`

DELIVERABLES:
- agent-toml-loader.ts fully implemented (~120 lines)
- All 12 tests PASS
- @plan markers updated to P29
- No TODO comments

DO NOT:
- Change test file (tests already written)
- Implement full local agent TOML parsing (future work)
```

## Verification Commands

### Automated Checks

```bash
# Run ALL tests (MUST PASS)
npm test -- packages/core/src/agents/__tests__/agent-toml-loader.test.ts
# Expected: 12/12 PASS

# Check HTTPS enforcement
grep -A 3 "agent_card_url.*z.string().url()" packages/core/src/agents/agent-toml-loader.ts | grep "refine.*https://"
# Expected: HTTPS refine check found

# Check TOML parsing
grep "toml.parse" packages/core/src/agents/agent-toml-loader.ts
# Expected: Parse call present

# Check Zod validation
grep "AgentFileSchema.parse" packages/core/src/agents/agent-toml-loader.ts
# Expected: Validation call present

# Check kind inference implementation
grep -A 2 "export function inferAgentKind" packages/core/src/agents/agent-toml-loader.ts | grep "agent_card_url.*remote"
# Expected: Inference logic present

# Type check
npm run typecheck
# Expected: Success

# Check plan marker updated
grep -c "@plan:PLAN-20260302-A2A.P29" packages/core/src/agents/agent-toml-loader.ts
# Expected: 6+ (updated from P27)

# No TODO
grep -E "(TODO|FIXME|HACK|STUB)" packages/core/src/agents/agent-toml-loader.ts
# Expected: NO MATCHES
```

## Success Criteria

- All 12 tests PASS (0 FAIL)
- HTTPS enforcement works (http:// URLs rejected)
- Kind inference correct (agent_card_url → remote)
- TOML parsing + Zod validation works
- @plan markers updated to P29
- No TODO comments

## Failure Recovery

If this phase fails:

1. Review test failures:
   - Parsing fails → check toml.parse + Zod validation
   - HTTPS test fails → check .refine() logic
   - Kind inference fails → check inferAgentKind implementation
   - Field mapping fails → check snake_case to camelCase conversion

2. Fix issues and re-run tests

3. Cannot proceed to Phase 29a until all tests pass

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P29.md`

Contents:
```markdown
Phase: P29
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Modified: packages/core/src/agents/agent-toml-loader.ts (~120 lines total)

Implementation:
  - Full TOML parsing (toml.parse + Zod validation)
  - HTTPS enforcement via .refine()
  - Kind inference from agent_card_url
  - Field mapping: snake_case → camelCase
  - Remote agent transformation complete
  - Local agent transformation minimal (MVP)

Test Results: All 12 tests PASS

Verification: [paste npm test output]

Next Phase: P29a (Verification of P29)
```
