# Phase 03a: Verify ThinkingBlock Changes

## Phase ID

`PLAN-20251202-THINKING.P03a`

## Prerequisites

- Required: Phase 03 completed
- Verification: `cat project-plans/20251202thinking/.completed/P03.md`

## Verification Tasks

### 1. Interface Structure Verification

```bash
# Show the full ThinkingBlock interface
grep -A 15 "interface ThinkingBlock" packages/core/src/services/history/IContent.ts
```

**Expected output must include**:

- `type: 'thinking'`
- `thought: string`
- `isHidden?: boolean`
- `sourceField?: 'reasoning_content' | 'thinking' | 'thought'`
- `signature?: string`

### 2. Backward Compatibility Check

**CRITICAL**: This check verifies that existing code creating ThinkingBlocks still compiles after adding optional properties.

```bash
# Find all existing ThinkingBlock creation sites
grep -rn "type: 'thinking'" packages/core/src/

# Find all places that construct ThinkingBlocks
grep -rn -A 3 "\\bthinking\\b.*:" packages/core/src/services/history/ContentConverters.ts

# Verify TypeScript compiles with existing code (no changes needed to existing calls)
npm run typecheck
```

**Expected**:
- All existing code that creates `{ type: 'thinking', thought: '...' }` still compiles
- No TypeScript errors about missing sourceField or signature (they're optional)
- Existing tests still pass

**Why This Matters**: Adding optional properties should NOT break existing code. If typecheck fails, the properties aren't truly optional.

### 3. Type Export Verification

```bash
# Ensure ThinkingBlock is exported
grep "export.*ThinkingBlock" packages/core/src/services/history/IContent.ts
```

**Expected**: ThinkingBlock is exported (or part of exported ContentBlock union)

### 4. Compilation Check

```bash
npm run typecheck
```

**Expected**: No type errors

### 5. Plan Markers Present

```bash
grep "@plan.*THINKING.P03" packages/core/src/services/history/IContent.ts
grep "@requirement.*REQ-THINK-001" packages/core/src/services/history/IContent.ts
```

**Expected**: Both markers present

## Semantic Verification Checklist

- [ ] sourceField property allows 'reasoning_content', 'thinking', 'thought'
- [ ] signature property is string type
- [ ] Both new properties are optional (have `?`)
- [ ] No existing code is broken by the change
- [ ] Interface is correctly documented

## Success Criteria

- All verification commands produce expected output
- No compilation errors
- Backward compatibility maintained

## Holistic Functionality Assessment (MANDATORY)

Before marking this phase complete, the verifier MUST write a detailed assessment.

### Assessment Template

When creating the completion marker file (`project-plans/20251202thinking/.completed/P03a.md`), include:

```markdown
## Holistic Functionality Assessment

### What was implemented?
[Describe the ThinkingBlock interface changes in your own words. For example: "Added two optional metadata fields to ThinkingBlock: sourceField to track API field origin, and signature for future cryptographic verification."]

### Does it satisfy the requirements?
For REQ-THINK-001.1 and REQ-THINK-001.2, explain HOW:

- **REQ-THINK-001.1 (sourceField)**: [Cite line in IContent.ts where sourceField is defined with correct type union]
- **REQ-THINK-001.2 (signature)**: [Cite line where signature is defined as optional string]

### What is the data flow?
[Explain how these fields will be used: "sourceField will be set by parsers (e.g., parseStreamingReasoningDelta sets it to 'reasoning_content'), then read by serializers (e.g., thinkingToReasoningField) to ensure round-trip compatibility."]

### What could go wrong?
[Identify risks:
- Are the properties truly optional (backward compatibility)?
- Is the sourceField union complete (covers all API field names)?
- Could signature field be misused or cause security issues?]

### Verdict
[PASS/FAIL. If PASS, confirm backward compatibility verified. If FAIL, explain what's broken.]
```

### Verification Gate

**DO NOT create the completion marker until you can answer all assessment questions with specific evidence from the code.**

## Phase Completion Marker

Create: `project-plans/20251202thinking/.completed/P03a.md`
