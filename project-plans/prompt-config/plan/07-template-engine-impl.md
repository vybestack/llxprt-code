# Task 07: TemplateEngine Component - Implementation

## Objective

Implement the TemplateEngine component to make ALL behavioral tests pass, following the pseudocode from analysis/pseudocode/template-engine.md.

## Context

Now implement the actual template processing logic to satisfy all tests written in phase 06. Do NOT modify any tests.

## Requirements to Implement

- **[REQ-004.1]** System SHALL support {{VARIABLE_NAME}} syntax
- **[REQ-004.2]** System SHALL substitute TOOL_NAME, MODEL, and PROVIDER variables  
- **[REQ-004.3]** Malformed variables SHALL be left as-is in output
- **[REQ-004.4]** Variable substitution SHALL occur during file loading
- **[REQ-010.4]** When DEBUG=1, system SHALL log variable substitutions

## Implementation Guidelines

Follow the pseudocode exactly from `analysis/pseudocode/template-engine.md`:

1. Process template character by character
2. Detect {{ and }} brackets
3. Extract variable names
4. Substitute with values from variables map
5. Handle malformed templates gracefully
6. Log substitutions when DEBUG=1

## Key Implementation Points

### Variable Detection
- Find opening {{ 
- Find matching }}
- Extract variable name between brackets
- Trim whitespace from variable name

### Substitution Logic
- If variable exists in map: substitute value
- If variable missing: substitute empty string
- If malformed (no closing }}): leave as-is

### Debug Logging
```typescript
if (process.env.DEBUG === '1') {
  console.log(`Template substitution: ${variableName} -> ${value}`);
}
```

## Commands to Run

```bash
cd packages/core

# Run tests to see failures
npm test TemplateEngine.spec.ts

# After implementation, all tests should pass
npm test TemplateEngine.spec.ts

# Verify compilation
npm run typecheck

# Verify linting
npm run lint

# Check test coverage
npm test -- --coverage TemplateEngine.spec.ts
```

## Implementation Constraints

1. **Do NOT modify tests** - Implementation must satisfy existing tests
2. **Follow pseudocode** - Don't deviate from the algorithm
3. **No console.log** except for DEBUG logging
4. **No TODO comments**
5. **Handle all edge cases** tested

## Success Criteria

- All tests pass
- TypeScript compiles without errors
- Linting passes
- No test modifications
- >90% code coverage
- No debug code (except DEBUG env logging)