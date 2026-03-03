# Phase 28: TOML Integration - TDD

## Phase ID

`PLAN-20260302-A2A.P28`

## Prerequisites

- Required: Phase 27a (TOML Integration Stub Verification) completed
- Verification: agent-toml-loader.ts exists with schemas and stubs
- Expected: Schemas defined, functions return empty/default

## Requirements Implemented

### REQ A2A-REG-006: TOML Loading Tests
### REQ A2A-CFG-003: Zod Validation Tests
### REQ A2A-CFG-004: Kind Inference Tests

**Test Scenarios**:
1. Parse TOML with remote agent → RemoteAgentDefinition
2. Parse TOML with local agent → LocalAgentDefinition
3. Kind inference: agent_card_url present → remote
4. Kind inference: no agent_card_url → local
5. Zod validation rejects invalid URLs
6. Zod validation rejects missing required fields

**Why This Matters**: Tests verify TOML parsing, kind inference, and Zod validation work correctly. These tests will FAIL against P27 stubs and PASS after P29 implementation.

## Implementation Tasks

### Files to Create

**`packages/core/src/agents/__tests__/agent-toml-loader.test.ts`** — TOML loader tests

```typescript
/**
 * Tests for agent TOML loader.
 * @plan PLAN-20260302-A2A.P28
 * @requirement A2A-REG-006, A2A-CFG-003, A2A-CFG-004
 */

import { describe, it, expect } from 'vitest';
import { loadAgentsFromToml, inferAgentKind } from '../agent-toml-loader.js';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Agent TOML Loader', () => {
  // Helper to create temp TOML file
  async function createTempToml(content: string): Promise<string> {
    const tempDir = join(tmpdir(), 'llxprt-test-' + Date.now());
    await mkdir(tempDir, { recursive: true });
    const filePath = join(tempDir, 'agents.toml');
    await writeFile(filePath, content, 'utf-8');
    return filePath;
  }
  
  /**
   * @plan PLAN-20260302-A2A.P28
   * @requirement A2A-REG-006
   * @scenario Parse remote agent from TOML
   */
  describe('Remote Agent Parsing', () => {
    it('should parse remote agent with agent_card_url', async () => {
      const tomlContent = `
[[remote_agents]]
name = "test-remote"
description = "Test remote agent"
agent_card_url = "https://example.com/agent-card"
`;
      
      const filePath = await createTempToml(tomlContent);
      const result = await loadAgentsFromToml(filePath);
      await unlink(filePath);
      
      expect(result.remote).toHaveLength(1);
      expect(result.remote[0]).toMatchObject({
        kind: 'remote',
        name: 'test-remote',
        description: 'Test remote agent',
        agentCardUrl: 'https://example.com/agent-card'
      });
    });
    
    it('should parse display_name from TOML', async () => {
      const tomlContent = `
[[remote_agents]]
name = "test-remote"
display_name = "Test Remote Agent"
agent_card_url = "https://example.com/card"
`;
      
      const filePath = await createTempToml(tomlContent);
      const result = await loadAgentsFromToml(filePath);
      await unlink(filePath);
      
      expect(result.remote[0]?.displayName).toBe('Test Remote Agent');
    });
    
    it('should enforce HTTPS for agent_card_url', async () => {
      const tomlContent = `
[[remote_agents]]
name = "insecure-remote"
agent_card_url = "http://example.com/card"
`;
      
      const filePath = await createTempToml(tomlContent);
      
      // Should throw validation error for non-HTTPS URL
      await expect(loadAgentsFromToml(filePath)).rejects.toThrow(/https/i);
      await unlink(filePath);
    });
  });
  
  /**
   * @plan PLAN-20260302-A2A.P28
   * @requirement A2A-REG-006
   * @scenario Parse local agent from TOML
   */
  describe('Local Agent Parsing', () => {
    it('should parse local agent without agent_card_url', async () => {
      const tomlContent = `
[[local_agents]]
name = "test-local"
description = "Test local agent"
`;
      
      const filePath = await createTempToml(tomlContent);
      const result = await loadAgentsFromToml(filePath);
      await unlink(filePath);
      
      expect(result.local).toHaveLength(1);
      expect(result.local[0]).toMatchObject({
        kind: 'local',
        name: 'test-local',
        description: 'Test local agent'
      });
    });
  });
  
  /**
   * @plan PLAN-20260302-A2A.P28
   * @requirement A2A-CFG-004
   * @scenario Kind inference from agent_card_url presence
   */
  describe('Kind Inference', () => {
    it('should infer remote kind when agent_card_url is present', () => {
      const entry = {
        name: 'test',
        agent_card_url: 'https://example.com/card'
      };
      
      const kind = inferAgentKind(entry);
      expect(kind).toBe('remote');
    });
    
    it('should infer local kind when agent_card_url is absent', () => {
      const entry = {
        name: 'test',
        description: 'Local agent'
      };
      
      const kind = inferAgentKind(entry);
      expect(kind).toBe('local');
    });
    
    it('should override explicit kind if agent_card_url present', () => {
      const entry = {
        kind: 'local',  // Explicit but wrong
        name: 'test',
        agent_card_url: 'https://example.com/card'
      };
      
      const kind = inferAgentKind(entry);
      // Presence of agent_card_url → remote (overrides explicit kind)
      expect(kind).toBe('remote');
    });
  });
  
  /**
   * @plan PLAN-20260302-A2A.P28
   * @requirement A2A-CFG-003
   * @scenario Zod validation
   */
  describe('Validation', () => {
    it('should reject invalid URL format for agent_card_url', async () => {
      const tomlContent = `
[[remote_agents]]
name = "bad-url"
agent_card_url = "not-a-url"
`;
      
      const filePath = await createTempToml(tomlContent);
      await expect(loadAgentsFromToml(filePath)).rejects.toThrow(/url/i);
      await unlink(filePath);
    });
    
    it('should reject remote agent without name', async () => {
      const tomlContent = `
[[remote_agents]]
agent_card_url = "https://example.com/card"
`;
      
      const filePath = await createTempToml(tomlContent);
      await expect(loadAgentsFromToml(filePath)).rejects.toThrow(/name/i);
      await unlink(filePath);
    });
    
    it('should reject remote agent without agent_card_url', async () => {
      const tomlContent = `
[[remote_agents]]
name = "no-url"
`;
      
      const filePath = await createTempToml(tomlContent);
      await expect(loadAgentsFromToml(filePath)).rejects.toThrow(/agent_card_url/i);
      await unlink(filePath);
    });
  });
  
  /**
   * @plan PLAN-20260302-A2A.P28
   * @requirement A2A-REG-006
   * @scenario Multiple agents
   */
  describe('Multiple Agents', () => {
    it('should parse both local and remote agents from same file', async () => {
      const tomlContent = `
[[local_agents]]
name = "local-1"
description = "First local agent"

[[remote_agents]]
name = "remote-1"
agent_card_url = "https://example.com/agent1"

[[remote_agents]]
name = "remote-2"
agent_card_url = "https://example.com/agent2"
`;
      
      const filePath = await createTempToml(tomlContent);
      const result = await loadAgentsFromToml(filePath);
      await unlink(filePath);
      
      expect(result.local).toHaveLength(1);
      expect(result.remote).toHaveLength(2);
    });
  });
});
```

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 28 of 33 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 27a completed: agent-toml-loader.ts exists with stubs.

YOUR TASK:
Create test file `packages/core/src/agents/__tests__/agent-toml-loader.test.ts` with TOML parsing tests.

TEST SCENARIOS (12 tests total):

**Remote Agent Parsing** (3 tests):
1. Parse remote agent with agent_card_url
2. Parse display_name from TOML
3. Enforce HTTPS for agent_card_url (reject http://)

**Local Agent Parsing** (1 test):
1. Parse local agent without agent_card_url

**Kind Inference** (3 tests):
1. Infer remote when agent_card_url present
2. Infer local when agent_card_url absent
3. Override explicit kind if agent_card_url present

**Validation** (3 tests):
1. Reject invalid URL format
2. Reject remote agent without name
3. Reject remote agent without agent_card_url

**Multiple Agents** (1 test):
1. Parse both local and remote from same file

KEY NOTES:
- Use temp files for TOML content (helper: createTempToml)
- Clean up temp files after each test (unlink)
- Tests should FAIL against P27 stub (returns empty arrays)
- All tests have @plan PLAN-20260302-A2A.P28 markers

DELIVERABLES:
- agent-toml-loader.test.ts created (~180 lines)
- 12 tests total
- Tests FAIL against stub (expected)

DO NOT:
- Implement parsing in loader (that's P29)
```

## Verification Commands

### Automated Checks

```bash
# Test file exists
test -f packages/core/src/agents/__tests__/agent-toml-loader.test.ts && echo "FOUND" || echo "MISSING"

# Count tests
grep -c "^[[:space:]]*it('should" packages/core/src/agents/__tests__/agent-toml-loader.test.ts
# Expected: 12

# Plan markers
grep -c "@plan:PLAN-20260302-A2A.P28" packages/core/src/agents/__tests__/agent-toml-loader.test.ts
# Expected: 12+

# Requirement markers
grep -c "@requirement:A2A-" packages/core/src/agents/__tests__/agent-toml-loader.test.ts
# Expected: 12+

# Run tests (SHOULD FAIL against stub)
npm test -- packages/core/src/agents/__tests__/agent-toml-loader.test.ts
# Expected: Most tests FAIL (stub returns empty arrays)
```

## Success Criteria

- Test file created with 12 tests
- All markers present
- Tests compile and run (most fail against stub)

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P28.md`

Contents:
```markdown
Phase: P28
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Created: packages/core/src/agents/__tests__/agent-toml-loader.test.ts (~180 lines)

Tests Added: 12
  - Remote agent parsing: 3 tests
  - Local agent parsing: 1 test
  - Kind inference: 3 tests
  - Validation: 3 tests
  - Multiple agents: 1 test

Test Results Against Stub: Most FAIL (expected)

Next Phase: P28a (Verification of P28)
```
