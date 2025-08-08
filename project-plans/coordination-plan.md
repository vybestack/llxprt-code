# Coordination Plan for Theme & Responsive UI Implementation

## Overview

This document outlines how to coordinate multiple subagents to implement both the semantic color system and responsive UI features for llxprt. The implementation follows a test-first approach with independent verification.

## Implementation Order

### Phase 1: Parallel Infrastructure (Week 1)
Run these tasks in parallel as they don't depend on each other:

1. **Theme Task 1**: Semantic Color Infrastructure
   - Agent: `typescript-coder`
   - Input: `project-plans/themeimprove/task-1-semantic-infrastructure.md`
   - Output: Semantic color system foundation

2. **Responsive Task 1**: Responsive Infrastructure  
   - Agent: `typescript-coder`
   - Input: `project-plans/responsiveui/task-1-responsive-infrastructure.md`
   - Output: Breakpoint system and utilities

### Phase 2: Component Updates (Week 2)
After Phase 1 verification, run these in sequence:

3. **Theme Task 2**: Core Component Migration
   - Agent: `typescript-coder`
   - Input: `project-plans/themeimprove/task-2-core-components.md`
   - Dependencies: Theme Task 1 complete
   - Output: TodoPanel, Dialogs using semantic colors

4. **Responsive Task 2**: TodoPanel Responsive
   - Agent: `typescript-coder`  
   - Input: `project-plans/responsiveui/task-2-todopanel-responsive.md`
   - Dependencies: Responsive Task 1 complete
   - Output: Responsive TodoPanel

5. **Responsive Task 3**: Dialogs Responsive
   - Agent: `typescript-coder`
   - Input: `project-plans/responsiveui/task-3-dialogs-responsive.md`
   - Dependencies: Responsive Task 1 complete
   - Can run parallel with Task 4

6. **Responsive Task 4**: Footer and Tools
   - Agent: `typescript-coder`
   - Input: `project-plans/responsiveui/task-4-footer-tools.md`  
   - Dependencies: Responsive Task 1 complete
   - Can run parallel with Task 3

### Phase 3: Verification (Ongoing)
After each implementation task:

7. **Theme Verification**
   - Agent: `typescript-code-reviewer`
   - Input: `project-plans/themeimprove/task-3-verification.md`
   - Verify: Theme implementation meets requirements

8. **Responsive Verification**
   - Agent: `typescript-code-reviewer`
   - Input: `project-plans/responsiveui/task-5-verification.md`
   - Verify: Responsive implementation meets requirements

## Coordination Commands

### Phase 1 Launch (Parallel)
```typescript
// Launch both infrastructure tasks
const themeTask = Task({
  description: "Implement semantic colors",
  prompt: readFile("project-plans/themeimprove/task-1-semantic-infrastructure.md"),
  subagent_type: "typescript-coder"
});

const responsiveTask = Task({
  description: "Implement responsive system", 
  prompt: readFile("project-plans/responsiveui/task-1-responsive-infrastructure.md"),
  subagent_type: "typescript-coder"
});

// Wait for both to complete
await Promise.all([themeTask, responsiveTask]);
```

### Verification After Each Task
```typescript
// After implementation completes
const verification = Task({
  description: "Verify implementation",
  prompt: readFile("appropriate-verification-task.md"),
  subagent_type: "typescript-code-reviewer"
});
```

## Communication Between Phases

### Success Criteria for Moving Forward
1. Implementation task completes without errors
2. All tests pass
3. Verification agent approves implementation
4. No RULES.md violations

### Information to Pass Between Tasks
- List of completed files
- Any API changes made
- Known issues or limitations
- Test file locations

## Handling Failures

### If Implementation Fails
1. Review agent output for errors
2. Check if prerequisites were met
3. Verify task instructions are clear
4. Re-run with additional context if needed

### If Verification Fails  
1. Create fix task with verification feedback
2. Run focused fix with same agent type
3. Re-verify after fixes
4. Document any compromises made

## Integration Testing

After all tasks complete:
1. Run full test suite
2. Manual testing at all breakpoints
3. Theme switching verification
4. Performance testing
5. Create integration test suite

## Final Checklist

- [ ] All infrastructure tasks complete
- [ ] All component migrations complete  
- [ ] All verifications passed
- [ ] Integration tests written
- [ ] Documentation updated
- [ ] No regressions in existing features
- [ ] RULES.md compliance throughout

## Notes for Coordinator

- Keep tasks focused and independent when possible
- Provide full context in each task prompt
- Don't assume agents retain information between tasks
- Verify prerequisites before launching dependent tasks
- Document any deviations from plan