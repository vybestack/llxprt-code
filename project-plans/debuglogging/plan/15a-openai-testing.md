# Phase 15a: OpenAI Provider Testing with User

## Phase ID
`PLAN-20250120-DEBUGLOGGING.P15a`

## Prerequisites
- Phase 15 completed (OpenAI provider integrated)
- Debug logging working in OpenAI provider

## Testing Tasks for User Validation

### User Testing Checklist

1. **Basic Logging Test**
```bash
# User runs:
DEBUG=llxprt:openai:* llxprt chat "test message"

# Verify:
- [ ] Logs appear in ~/.llxprt/debug/
- [ ] No console output (file only)
- [ ] Timestamps correct
- [ ] Namespaces shown
```

2. **Cerebras-Specific Testing**
```bash
# User tests with Cerebras provider:
/provider cerebras
DEBUG=llxprt:openai:cerebras llxprt chat "test"

# Verify:
- [ ] Cerebras API issues logged
- [ ] Double-stringification logged
- [ ] Tool call issues captured
```

3. **Performance Testing**
```bash
# Without debug:
time llxprt chat "complex query"

# With debug disabled:
DEBUG= time llxprt chat "complex query"

# Compare:
- [ ] No performance degradation
- [ ] Zero overhead confirmed
```

4. **Lazy Evaluation Testing**
```bash
# Test expensive operations not evaluated when disabled
DEBUG= llxprt chat "test with tools"

# Verify:
- [ ] No JSON.stringify of large objects
- [ ] No expensive computations
```

5. **File Rotation Testing**
```bash
# Run for extended period
DEBUG=llxprt:openai:* llxprt chat [multiple messages]

# Check:
- [ ] Files rotate daily or by size
- [ ] Old files cleaned up
- [ ] No disk space issues
```

## User Approval Required

**STOP - DO NOT PROCEED TO PHASE 16 WITHOUT USER CONFIRMATION**

User must confirm:
- [ ] OpenAI logging works correctly
- [ ] File output is useful
- [ ] No performance issues
- [ ] Cerebras issues captured
- [ ] Ready to migrate other providers

## Rollback Plan

If issues found:
1. Keep old if(DEBUG) patterns
2. Fix issues in OpenAI implementation
3. Re-test with user
4. Only proceed when approved