# Phase 08a: Verify reasoningUtils Implementation

## Phase ID

`PLAN-20251202-THINKING.P08a`

## Prerequisites

- Required: Phase 08 completed
- Verification: `cat project-plans/20251202thinking/.completed/P08.md`

## Verification Tasks

### 1. All Tests Pass

```bash
npm test -- --run packages/core/src/providers/reasoning/reasoningUtils.test.ts
```

**Expected**: All tests pass

### 2. No Stubs Remain

```bash
grep "throw new Error" packages/core/src/providers/reasoning/reasoningUtils.ts
```

**Expected**: No matches

### 3. TypeScript Compiles

```bash
npm run typecheck
```

**Expected**: No errors

### 4. Lint Passes

```bash
npm run lint -- packages/core/src/providers/reasoning/
```

**Expected**: No errors

### 5. Plan Markers Present

```bash
grep "@plan.*THINKING.P08" packages/core/src/providers/reasoning/reasoningUtils.ts
```

**Expected**: Multiple matches

## Semantic Verification

### extractThinkingBlocks Behavior

```bash
# Test in Node REPL or write quick script
node -e "
const { extractThinkingBlocks } = require('./packages/core/dist/providers/reasoning/reasoningUtils');
const content = { speaker: 'ai', blocks: [{ type: 'thinking', thought: 'test' }, { type: 'text', text: 'hi' }] };
console.log(JSON.stringify(extractThinkingBlocks(content)));
"
```

**Expected**: `[{"type":"thinking","thought":"test"}]`

### filterThinkingForContext Behavior

Manual verification: Run the test suite and verify assertions match expected behavior.

## Integration Verification

- [ ] Functions are exported correctly
- [ ] Types align with IContent definitions
- [ ] No circular dependencies

## Success Criteria

- All tests pass
- Implementation matches pseudocode
- Ready for OpenAI provider integration

## Holistic Functionality Assessment (MANDATORY)

Before marking this phase complete, the verifier MUST write a detailed assessment.

### Assessment Template

When creating the completion marker file (`project-plans/20251202thinking/.completed/P08a.md`), include:

```markdown
## Holistic Functionality Assessment

### What was implemented?
[Describe in your own words what the reasoningUtils code actually does - not what markers say, but what you observed by reading the code. For example: "The reasoningUtils module provides 4 utility functions that operate on IContent blocks to extract, filter, and convert ThinkingBlock instances."]

### Does it satisfy the requirements?
For each requirement (REQ-THINK-002.1 through REQ-THINK-002.4), explain HOW the implementation satisfies it:

- **REQ-THINK-002.1 (extractThinkingBlocks)**: [Cite specific code location, e.g., "Lines 75-83 in reasoningUtils.ts iterate through content.blocks and filter for type === 'thinking'"]
- **REQ-THINK-002.2 (filterThinkingForContext)**: [Explain how the three policies work and cite code]
- **REQ-THINK-002.3 (thinkingToReasoningField)**: [Explain how blocks are joined and cite code]
- **REQ-THINK-002.4 (estimateThinkingTokens)**: [Explain the estimation algorithm and cite code]

### What is the data flow?
Trace one complete usage path:

Example: "When OpenAIProvider needs to filter thinking from context history:
1. Input: Array of IContent with mixed blocks
2. filterThinkingForContext(contents, 'allButLast') called (line X)
3. Function finds last content with thinking blocks (lines Y-Z)
4. Returns new array with thinking stripped from all but last (line A)
5. Output: Modified IContent array ready for API serialization"

### What could go wrong?
[Identify edge cases, error conditions, or integration risks you observed:
- What happens if blocks array is empty?
- What if no content has thinking blocks when using 'allButLast'?
- What if ThinkingBlock.thought is very long?
- What if input array is mutated during processing?]

### Verdict
[PASS/FAIL with explanation. If PASS, explain why you're confident the implementation is complete and correct. If FAIL, explain what's missing or broken.]
```

### Verification Gate

**DO NOT create the completion marker until you can answer all assessment questions with specific evidence from the code.**

The verifier must demonstrate they:
1. Actually read the implementation (not just ran grep commands)
2. Understand how it works (can explain the mechanism)
3. Verified it satisfies requirements (with code citations)
4. Considered failure modes (identified risks)

## Phase Completion Marker

Create: `project-plans/20251202thinking/.completed/P08a.md`
