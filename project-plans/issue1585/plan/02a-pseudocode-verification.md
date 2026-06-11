# Phase 02a: Pseudocode Verification

## Phase ID

`PLAN-20260608-ISSUE1585.P02a`

## Purpose

Verify pseudocode has explicit interfaces, integration points, anti-pattern warnings, and no implementation code.

## Prerequisites

- Required: P02 completed with updated pseudocode files.
- Artifacts from P02: three updated pseudocode files.

## Requirements Implemented

### REQ-API-001

## Verification Tasks

### Step 1: Verify Interface Coverage

```bash
grep -c "IToolHost\|IToolRegistryHost\|IToolMessageBus\|IShellExecutionService\|ISubagentService\|IAsyncTaskService\|ISkillService\|IMcpToolService\|IIdeService\|ILspService\|IStorageService\|IToolKeyStorage\|ITodoService" project-plans/issue1585/analysis/pseudocode/package-boundary.md
```

All 15 tools-owned interface files must be referenced (13 primary interfaces + ISettingsService + IPromptRegistryService).

### Step 2: Verify Consumer Migration Precision

```bash
grep -c "toolFormatDetection\|reasoningUtils\|messageConversion\|AnthropicProvider\|OpenAIResponseParser" project-plans/issue1585/analysis/pseudocode/consumer-migration.md
```

At least 5 distinct consumer files must be named.

### Step 3: Verify Release Edits Precision

```bash
grep -c "release\.yml\|release-process\.test\.js\|build_sandbox\.js\|Dockerfile\|package-lock\.json\|packages/tools/package\.json" project-plans/issue1585/analysis/pseudocode/release-updates.md
```

At least 6 distinct release files must be named.

### Step 4: Verify No Implementation Code

```bash
# Should be zero or very low
grep -c "export class\|export function\|async execute\|return {" project-plans/issue1585/analysis/pseudocode/*.md
```

## Verification Commands

```bash
# Typecheck still passes (no code changed)
npm run typecheck
```

## Semantic Verification Checklist

- [ ] All 15 tools-owned interface files are named in pseudocode.
- [ ] Exact provider files are named in consumer migration.
- [ ] All 7 release files are named in release updates.
- [ ] No implementation code appears in pseudocode.
- [ ] No code changed (pseudocode verification, no code markers required).

## Success Criteria

- Pseudocode is precise enough to implement without ambiguity.
- Anti-pattern warnings are present for all forbidden implementations.

## Failure Recovery

Return to P02 to add missing details.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P02a.md` with interface coverage and precision assessment.
