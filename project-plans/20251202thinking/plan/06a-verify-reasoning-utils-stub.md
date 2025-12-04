# Phase 06a: Verify reasoningUtils Stub

## Phase ID

`PLAN-20251202-THINKING.P06a`

## Prerequisites

- Required: Phase 06 completed
- Verification: `cat project-plans/20251202thinking/.completed/P06.md`

## Verification Tasks

### 1. File Exists

```bash
ls -la packages/core/src/providers/reasoning/reasoningUtils.ts
```

**Expected**: File exists

### 2. All Functions Present

```bash
grep "^export function" packages/core/src/providers/reasoning/reasoningUtils.ts
```

**Expected output**:

```
export function extractThinkingBlocks(content: IContent): ThinkingBlock[]
export function filterThinkingForContext(contents: IContent[], policy: StripPolicy): IContent[]
export function thinkingToReasoningField(blocks: ThinkingBlock[]): string | undefined
export function estimateThinkingTokens(blocks: ThinkingBlock[]): number
export function removeThinkingFromContent(content: IContent): IContent
```

### 3. Plan Markers Present

```bash
grep -c "@plan.*THINKING.P06" packages/core/src/providers/reasoning/reasoningUtils.ts
```

**Expected**: 5 or more

### 4. Requirement Markers Present

```bash
grep "@requirement.*REQ-THINK-002" packages/core/src/providers/reasoning/reasoningUtils.ts
```

**Expected**: Multiple matches

### 5. Stubs Throw Correctly

```bash
grep "throw new Error" packages/core/src/providers/reasoning/reasoningUtils.ts | wc -l
```

**Expected**: 5 (one per function)

### 6. TypeScript Compiles

```bash
npm run typecheck
```

**Expected**: No errors

## Semantic Verification Checklist

- [ ] All function signatures match pseudocode
- [ ] StripPolicy type exported
- [ ] Import from IContent works
- [ ] Stubs are explicit (throw, not return empty)

## Success Criteria

- Stub file ready for TDD tests

## Holistic Functionality Assessment (MANDATORY)

Before marking this phase complete, the verifier MUST write a detailed assessment.

### Assessment Template

When creating the completion marker file (`project-plans/20251202thinking/.completed/P06a.md`), include:

```markdown
## Holistic Functionality Assessment

### What was implemented?
[Describe the stub file structure in your own words]

### Does it satisfy the requirements?
[Confirm all function signatures are present and match requirements]

### What is the data flow?
[Not applicable for stubs - instead explain: Are stubs truly unimplemented (throw errors)?]

### What could go wrong?
[Identify any issues with the stub setup that could cause problems for TDD]

### Verdict
[PASS/FAIL with explanation]
```

### Verification Gate

**DO NOT create the completion marker until you can answer all assessment questions with specific evidence from the code.**

## Phase Completion Marker

Create: `project-plans/20251202thinking/.completed/P06a.md`
