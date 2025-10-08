# Phase 03: SubagentManager Stub Implementation

## Phase ID
`PLAN-20250117-SUBAGENTCONFIG.P03`

## Prerequisites
- Phase 02 completed
- Verification: `grep -r "@plan:PLAN-20250117-SUBAGENTCONFIG.P02" project-plans/subagentconfig/`
- Expected files from previous phase:
  - `project-plans/subagentconfig/analysis/pseudocode/SubagentManager.md`
  - `project-plans/subagentconfig/analysis/pseudocode/SubagentCommand.md`
  - `project-plans/subagentconfig/analysis/pseudocode/Integration.md`

## Implementation Tasks

### Files to Create

#### 1. TypeScript Interface
**File**: `packages/core/src/config/types.ts` (UPDATE)

Add to end of file:

```typescript
/**
 * Subagent configuration stored in ~/.llxprt/subagents/<name>.json
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P03
 * @requirement:REQ-001, REQ-012
 */
export interface SubagentConfig {
  /** Subagent identifier (matches filename without .json) */
  name: string;
  
  /** Reference to profile name in ~/.llxprt/profiles/ */
  profile: string;
  
  /** System prompt text for this subagent */
  systemPrompt: string;
  
  /** ISO 8601 timestamp when subagent was created */
  createdAt: string;
  
  /** ISO 8601 timestamp when subagent was last updated */
  updatedAt: string;
}
```

#### 2. SubagentManager Stub Class
**File**: `packages/core/src/config/subagentManager.ts` (CREATE)

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { SubagentConfig } from './types.js';
import { ProfileManager } from './profileManager.js';

/**
 * Manages subagent configuration files in ~/.llxprt/subagents/
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P03
 * @requirement:REQ-002
 * 
 * Pattern: Follows ProfileManager design
 * Storage: JSON files in baseDir directory
 * Naming: <name>.json
 */
export class SubagentManager {
  private readonly baseDir: string;
  private readonly profileManager: ProfileManager;

  /**
   * @param baseDir Directory where subagent configs are stored (e.g., ~/.llxprt/subagents/)
   * @param profileManager ProfileManager instance for validation
   */
  constructor(baseDir: string, profileManager: ProfileManager) {
    this.baseDir = baseDir;
    this.profileManager = profileManager;
  }

  /**
   * Save or update a subagent configuration
   * 
   * @plan:PLAN-20250117-SUBAGENTCONFIG.P03
   * @requirement:REQ-002
   * @pseudocode SubagentManager.md lines [TO BE FILLED IN P05]
   */
  async saveSubagent(
    name: string,
    profile: string,
    systemPrompt: string,
  ): Promise<void> {
    // STUB: Do nothing, no errors
    return;
  }

  /**
   * Load a subagent configuration from disk
   * 
   * @plan:PLAN-20250117-SUBAGENTCONFIG.P03
   * @requirement:REQ-002
   * @pseudocode SubagentManager.md lines [TO BE FILLED IN P05]
   */
  async loadSubagent(name: string): Promise<SubagentConfig> {
    // STUB: Return dummy config
    return {
      name: '',
      profile: '',
      systemPrompt: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * List all subagent names
   * 
   * @plan:PLAN-20250117-SUBAGENTCONFIG.P03
   * @requirement:REQ-002
   * @pseudocode SubagentManager.md lines [TO BE FILLED IN P05]
   */
  async listSubagents(): Promise<string[]> {
    // STUB: Return empty array
    return [];
  }

  /**
   * Delete a subagent configuration
   * 
   * @plan:PLAN-20250117-SUBAGENTCONFIG.P03
   * @requirement:REQ-002
   * @pseudocode SubagentManager.md lines [TO BE FILLED IN P05]
   * 
   * @returns true if deleted, false if not found
   */
  async deleteSubagent(name: string): Promise<boolean> {
    // STUB: Return false (not found)
    return false;
  }

  /**
   * Check if a subagent configuration exists
   * 
   * @plan:PLAN-20250117-SUBAGENTCONFIG.P03
   * @requirement:REQ-002
   * @pseudocode SubagentManager.md lines [TO BE FILLED IN P05]
   */
  async subagentExists(name: string): Promise<boolean> {
    // STUB: Return false
    return false;
  }

  /**
   * Validate that a profile exists in ProfileManager
   * 
   * @plan:PLAN-20250117-SUBAGENTCONFIG.P03
   * @requirement:REQ-002
   * @pseudocode SubagentManager.md lines [TO BE FILLED IN P05]
   */
  async validateProfileReference(profileName: string): Promise<boolean> {
    // STUB: Return false
    return false;
  }

  /**
   * Get full path to subagent config file
   * 
   * @plan:PLAN-20250117-SUBAGENTCONFIG.P03
   * @requirement:REQ-002
   * @pseudocode SubagentManager.md lines [TO BE FILLED IN P05]
   */
  private getSubagentPath(name: string): string {
    // STUB: Return empty string
    return '';
  }

  /**
   * Ensure subagent directory exists, create if not
   * 
   * @plan:PLAN-20250117-SUBAGENTCONFIG.P03
   * @requirement:REQ-002
   * @pseudocode SubagentManager.md lines [TO BE FILLED IN P05]
   */
  private async ensureDirectory(): Promise<void> {
    // STUB: Do nothing
    return;
  }
}
```

### Required Code Markers

Every method MUST include:
```typescript
/**
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P03
 * @requirement:REQ-XXX
 * @pseudocode SubagentManager.md lines [TO BE FILLED IN P05]
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250117-SUBAGENTCONFIG.P03" packages/core/src/config/ | wc -l
# Expected: 10+ occurrences (one per method + class header)

# Check requirement markers
grep -r "@requirement:REQ-002" packages/core/src/config/subagentManager.ts | wc -l
# Expected: 9+ occurrences

# Check TypeScript compiles
npm run typecheck
# Expected: No errors

# Check no forbidden patterns
grep -r "NotYetImplemented\|TODO\|throw new Error" packages/core/src/config/subagentManager.ts
# Expected: No matches

# Check interface exists
grep -q "interface SubagentConfig" packages/core/src/config/types.ts
# Expected: Match found
```

### Manual Verification Checklist

- [ ] SubagentConfig interface added to types.ts
- [ ] SubagentManager class created
- [ ] All methods from REQ-002 present
- [ ] All methods are stubs (no implementation)
- [ ] All stubs return correct types (not throw errors)
- [ ] Constructor accepts baseDir and ProfileManager
- [ ] Private methods included (getSubagentPath, ensureDirectory)
- [ ] All methods have @plan:markers
- [ ] All methods have @requirement:markers
- [ ] TypeScript compiles without errors
- [ ] No NotYetImplemented or TODO markers
- [ ] No error throwing in stubs

## Success Criteria

- SubagentConfig interface defined
- SubagentManager class created with all methods
- All methods are stubs returning empty/dummy values
- TypeScript compiles with strict mode
- All @plan:and @requirement:markers present
- Maximum 150 lines in subagentManager.ts
- No tests yet (that's Phase 04)

## Failure Recovery

If TypeScript compilation fails:

1. Check import paths (use .js extension)
2. Check interface exports in types.ts
3. Verify ProfileManager import
4. Ensure all method return types match signatures

If stub is too complex:

1. Remove any logic
2. Return simplest valid value for type
3. Ensure no errors are thrown

## Phase Completion Marker

Create: `project-plans/subagentconfig/.completed/P03.md`

Contents:
```markdown
# Phase 03: SubagentManager Stub Complete

**Completed**: [TIMESTAMP]

## Files Created
- packages/core/src/config/subagentManager.ts ([LINE_COUNT] lines)

## Files Modified
- packages/core/src/config/types.ts (Added SubagentConfig interface)

## Methods Created
- constructor(baseDir, profileManager)
- saveSubagent(name, profile, systemPrompt): Promise<void>
- loadSubagent(name): Promise<SubagentConfig>
- listSubagents(): Promise<string[]>
- deleteSubagent(name): Promise<boolean>
- subagentExists(name): Promise<boolean>
- validateProfileReference(profileName): Promise<boolean>
- getSubagentPath(name): string (private)
- ensureDirectory(): Promise<void> (private)

## Verification
```
$ npm run typecheck
[OK] No errors

$ grep -c "@plan:PLAN-20250117-SUBAGENTCONFIG.P03" packages/core/src/config/subagentManager.ts
10

$ grep -c "@requirement:REQ-002" packages/core/src/config/subagentManager.ts
9
```

## Next Phase
Ready for Phase 04: SubagentManager TDD
```

---

**CRITICAL**: This phase creates ONLY stubs. No implementation. No tests. Stubs return empty values, never throw errors. Implementation happens in Phase 05, tests in Phase 04.
