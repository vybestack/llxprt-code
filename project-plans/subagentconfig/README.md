# Subagent Configuration Management - Implementation Plan

**Plan ID**: PLAN-20250117-SUBAGENTCONFIG  
**Created**: 2025-01-17  
**Status**: Ready for Implementation  

---

## Overview

This plan implements a comprehensive `/subagent` slash command system for creating, managing, and configuring subagent definitions in the LLxprt CLI tool.

### Key Features

- **Auto Mode**: LLM-generated system prompts from user descriptions
- **Manual Mode**: User-provided system prompts inline
- **CRUD Operations**: Create, read, update, delete subagent configs
- **Multi-Level Autocomplete**: Context-aware tab completion
- **Profile Integration**: Subagents reference existing profiles
- **File-Based Storage**: JSON configs in `~/.llxprt/subagents/`

---

## Plan Structure

```
subagentconfig/
├── README.md                 # This file
├── specification.md          # Requirements (REQ-001 through REQ-015)
├── technical-overview.md     # Architecture and patterns
├── analysis/
│   ├── findings.md          # Phase 01 investigation results
│   └── pseudocode/          # Phase 02 line-by-line logic
│       ├── SubagentManager.md
│       ├── SubagentCommand.md
│       └── Integration.md
└── plan/
    ├── 00-overview.md       # Plan summary and success criteria
    ├── 01-analysis.md       # Code investigation phase
    ├── 02-pseudocode.md     # Pseudocode generation phase
    ├── 03-subagentmanager-stub.md
    ├── 04-subagentmanager-tdd.md
    ├── 05-subagentmanager-impl.md
    ├── 06-subagentcommand-stub.md
    ├── 07-subagentcommand-tdd-basic.md
    ├── 08-subagentcommand-impl-basic.md
    ├── 09-advanced-stub.md
    ├── 10-advanced-tdd.md
    ├── 11-advanced-impl.md
    ├── 12-automode-stub.md
    ├── 13-automode-tdd.md
    ├── 14-automode-impl.md
    ├── 15-integration.md
    └── 16-verification.md
```

---

## Implementation Phases

### Phase 1: Analysis (01-02)
**Duration**: ~30 min  
**Deliverable**: Investigation findings and pseudocode

- Deep code analysis of existing patterns
- Pseudocode for all components
- No implementation yet

### Phase 2: SubagentManager Core (03-05)
**Duration**: ~2 hours  
**Deliverable**: Working SubagentManager class

- P03: Stub (15 min)
- P04: TDD with 20+ tests (45 min)
- P05: Implementation following pseudocode (60 min)

### Phase 3: Basic Commands (06-08)
**Duration**: ~2 hours  
**Deliverable**: Working manual mode, list, show, delete

- P06: Command stub (15 min)
- P07: TDD for basic commands (45 min)
- P08: Implementation (60 min)

### Phase 4: Advanced Features (09-11)
**Duration**: ~2 hours  
**Deliverable**: Edit command and autocomplete

- P09: Stub (15 min)
- P10: TDD (45 min)
- P11: Implementation (60 min)

### Phase 5: Auto Mode (12-14)
**Duration**: ~2 hours  
**Deliverable**: LLM-powered prompt generation

- P12: Stub (15 min)
- P13: TDD (45 min)
- P14: Implementation with GeminiClient (60 min)

### Phase 6: Integration & Verification (15-16)
**Duration**: ~1 hour  
**Deliverable**: Production-ready feature

- P15: System integration (30 min)
- P16: Full verification and manual testing (30 min)

**Total Estimated Time**: ~9-10 hours

---

## Quick Start

To implement this plan:

1. **Read First**:
   - `specification.md` - Understand all requirements
   - `technical-overview.md` - Understand architecture
   - `plan/00-overview.md` - Understand phases

2. **Execute Sequentially**:
   ```bash
   # Phase 01
   # Follow plan/01-analysis.md exactly
   
   # Phase 02
   # Follow plan/02-pseudocode.md exactly
   
   # Phase 03
   # Follow plan/03-subagentmanager-stub.md exactly
   
   # ... continue through Phase 16
   ```

3. **DO NOT SKIP PHASES**: Each phase builds on the previous
4. **Follow TDD Cycle**: Stub → Test → Implement for each component
5. **Verify Each Phase**: Run verification commands before proceeding

---

## Critical Rules

### 1. Phase 01 is BLOCKING
**Cannot proceed past Phase 01 until multi-level autocomplete proven achievable.**
- Phase 01 must investigate completion system
- If fullLine not available, Phase 01 must enhance slashCommandProcessor.ts
- If not feasible, PAUSE plan (no fallback allowed)
- REQ-009 must be fully satisfied

### 2. NO NotYetImplemented
Stubs return empty values of correct types:
- `Promise<void>`: Return resolved promise
- `Promise<string[]>`: Return `[]`
- `Promise<boolean>`: Return `false`
- `Promise<SubagentConfig>`: Return empty config object

### 3. Behavioral Tests Only
Tests verify data transformation and business logic:
- [OK] Test: "saveSubagent creates file with correct JSON"
- [ERROR] NOT: "saveSubagent throws NotYetImplemented"

### 4. Use Existing Patterns
- Editor: Follow text-buffer.ts (spawnSync)
- Tests: Mock spawnSync like rest of codebase
- Don't reinvent existing utilities

### 5. Follow Pseudocode Exactly
Implementation phases MUST reference pseudocode line numbers:
```typescript
/**
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P05
 * @requirement:REQ-002
 * @pseudocode SubagentManager.md lines 45-67
 */
```

### 6. Sequential Execution
NO SKIPPING: Must execute 01 → 02 → 03 → ... → 16 in order.
If Phase 01 blocks, entire plan stops.

### 7. Code Markers Required
Every file must include:
```typescript
/**
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P##
 * @requirement:REQ-XXX
 */
```

---

## Requirements Summary

| REQ-ID | Description | Priority | Files |
|--------|-------------|----------|-------|
| REQ-001 | SubagentConfig interface | CRITICAL | types.ts |
| REQ-002 | SubagentManager class | CRITICAL | subagentManager.ts |
| REQ-003 | /subagent save auto | CRITICAL | subagentCommand.ts |
| REQ-004 | /subagent save manual | CRITICAL | subagentCommand.ts |
| REQ-005 | /subagent list | HIGH | subagentCommand.ts |
| REQ-006 | /subagent show | HIGH | subagentCommand.ts |
| REQ-007 | /subagent delete | HIGH | subagentCommand.ts |
| REQ-008 | /subagent edit | MEDIUM | subagentCommand.ts |
| REQ-009 | Multi-level autocomplete | HIGH | subagentCommand.ts |
| REQ-010 | Command registration | CRITICAL | BuiltinCommandLoader.ts |
| REQ-011 | Command structure | CRITICAL | subagentCommand.ts |
| REQ-012 | TypeScript interfaces | CRITICAL | types.ts |
| REQ-013 | Error handling | HIGH | All files |
| REQ-014 | Overwrite confirmation | MEDIUM | subagentCommand.ts |
| REQ-015 | Success messages | LOW | subagentCommand.ts |

---

## Success Criteria

### Functional
- [OK] Users can create subagents with auto mode (LLM)
- [OK] Users can create subagents with manual mode
- [OK] Users can list, show, edit, delete subagents
- [OK] Multi-level autocomplete works
- [OK] Profile validation prevents invalid references
- [OK] Confirmation prompts prevent data loss

### Technical
- [OK] All code includes @plan:markers
- [OK] All code includes @requirement:markers
- [OK] SubagentManager follows ProfileManager pattern
- [OK] TypeScript compiles with strict mode
- [OK] >80% test coverage
- [OK] No phases skipped
- [OK] Pseudocode compliance verified

### Quality
- [OK] Error messages user-friendly
- [OK] Success messages clear
- [OK] Code follows existing conventions
- [OK] Documentation complete
- [OK] No TODO or NotYetImplemented

---

## Files to Create

### New Files (4)
- `packages/core/src/config/subagentManager.ts`
- `packages/core/src/config/test/subagentManager.test.ts`
- `packages/cli/src/ui/commands/subagentCommand.ts`
- `packages/cli/src/ui/commands/test/subagentCommand.test.ts`

### Files to Modify (3)
- `packages/core/src/config/types.ts` (add SubagentConfig)
- `packages/cli/src/services/BuiltinCommandLoader.ts` (register command)
- `packages/core/src/config/index.ts` (export SubagentManager)

---

## Verification

After Phase 16, verify:

```bash
# All plan markers present
grep -r "@plan:PLAN-20250117-SUBAGENTCONFIG" packages/ | wc -l
# Expected: 50+

# All requirement markers present
grep -r "@requirement:REQ-" packages/ | wc -l
# Expected: 20+

# All tests passing
npm test
# Expected: 40+ tests, all pass

# TypeScript compiles
npm run typecheck
# Expected: No errors

# Build succeeds
npm run build
# Expected: Success

# Manual test
npm run dev
/subagent list
/subagent save test defaultprofile manual "test"
# Expected: All commands work
```

---

## Support

For questions or issues during implementation:

1. Check `specification.md` for requirements clarification
2. Check `technical-overview.md` for architecture patterns
3. Check pseudocode files for implementation logic
4. Review ProfileManager and chatCommand as reference patterns

---

## License

Copyright 2025 Vybestack LLC  
SPDX-License-Identifier: Apache-2.0
