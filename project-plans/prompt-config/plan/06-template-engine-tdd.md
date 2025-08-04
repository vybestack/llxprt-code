# Task 06: TemplateEngine Component - TDD Phase

## Objective

Write comprehensive BEHAVIORAL tests for the TemplateEngine component that verify actual template processing behavior, not implementation details.

## Context

Tests must verify real input→output transformations based on [REQ-004] Template Processing requirements. Reference behavioral-test-examples.md for patterns.

## Requirements to Test

- **[REQ-004.1]** System SHALL support {{VARIABLE_NAME}} syntax
- **[REQ-004.2]** System SHALL substitute TOOL_NAME, MODEL, and PROVIDER variables
- **[REQ-004.3]** Malformed variables SHALL be left as-is in output
- **[REQ-004.4]** Variable substitution SHALL occur during file loading
- **[REQ-010.4]** When DEBUG=1, system SHALL log variable substitutions

## File to Create

```
packages/core/test/prompt-config/TemplateEngine.spec.ts
```

## Required Behavioral Tests

### 1. Basic Variable Substitution

```typescript
describe('TemplateEngine', () => {
  let engine: TemplateEngine;

  beforeEach(() => {
    engine = new TemplateEngine();
  });

  it('should substitute known variables with actual values', () => {
    /**
     * @requirement REQ-004.1, REQ-004.2
     * @scenario Template contains MODEL and PROVIDER variables
     * @given Template: "You are running on {{PROVIDER}} using model {{MODEL}}"
     * @when processTemplate() called with variables
     * @then Returns: "You are running on anthropic using model claude-3-opus"
     */
    const template = 'You are running on {{PROVIDER}} using model {{MODEL}}';
    const variables = {
      PROVIDER: 'anthropic',
      MODEL: 'claude-3-opus'
    };
    
    const result = engine.processTemplate(template, variables);
    
    expect(result).toBe('You are running on anthropic using model claude-3-opus');
  });
```

### 2. Optional Variable Handling

Test TOOL_NAME which is optional:

```typescript
  it('should handle optional TOOL_NAME variable', () => {
    /**
     * @requirement REQ-004.2
     * @scenario Template with optional TOOL_NAME
     * @given Template with TOOL_NAME variable
     * @when Variable provided in context
     * @then Substitutes the tool name
     */
    const template = 'Use the {{TOOL_NAME}} tool carefully';
    const variables = {
      PROVIDER: 'gemini',
      MODEL: 'gemini-pro',
      TOOL_NAME: 'ReadFile'
    };
    
    const result = engine.processTemplate(template, variables);
    
    expect(result).toBe('Use the ReadFile tool carefully');
  });

  it('should handle missing optional variables', () => {
    /**
     * @requirement REQ-004.2
     * @scenario Template with optional variable not provided
     * @given Template with TOOL_NAME but no value provided
     * @when processTemplate called
     * @then Replaces with empty string
     */
    const template = 'Tool: {{TOOL_NAME}} for {{PROVIDER}}';
    const variables = {
      PROVIDER: 'ollama',
      MODEL: 'llama2'
    };
    
    const result = engine.processTemplate(template, variables);
    
    expect(result).toBe('Tool:  for ollama');
  });
```

### 3. Malformed Variable Handling

```typescript
  it('should leave malformed variables unchanged', () => {
    /**
     * @requirement REQ-004.3
     * @scenario Template contains malformed variable syntax
     * @given Various malformed patterns
     * @when processTemplate called
     * @then Malformed parts remain unchanged
     */
    const template = 'Valid {{MODEL}} but {{BROKEN and {{UNCLOSED';
    const variables = {
      MODEL: 'gpt-4',
      PROVIDER: 'openai'
    };
    
    const result = engine.processTemplate(template, variables);
    
    expect(result).toBe('Valid gpt-4 but {{BROKEN and {{UNCLOSED');
  });

  it('should handle nested brackets without processing inner content', () => {
    /**
     * @requirement REQ-004.3
     * @scenario Nested variable brackets
     * @given Template with {{{{VAR}}}}
     * @when processTemplate called
     * @then Only outer brackets processed
     */
    const template = 'Nested {{{{MODEL}}}} here';
    const variables = {
      MODEL: 'claude',
      PROVIDER: 'anthropic'
    };
    
    const result = engine.processTemplate(template, variables);
    
    // Should process outer brackets, leaving {{claude}}
    expect(result).toBe('Nested {{claude}} here');
  });
```

### 4. Edge Cases

```typescript
  it('should handle empty template', () => {
    /**
     * @requirement REQ-004.1
     * @scenario Empty template string
     * @given Empty string template
     * @when processTemplate called
     * @then Returns empty string
     */
    const result = engine.processTemplate('', { MODEL: 'test', PROVIDER: 'test' });
    expect(result).toBe('');
  });

  it('should handle template with no variables', () => {
    /**
     * @requirement REQ-004.1
     * @scenario Template without any variables
     * @given Plain text template
     * @when processTemplate called
     * @then Returns unchanged template
     */
    const template = 'This is plain text with no variables';
    const result = engine.processTemplate(template, { MODEL: 'test', PROVIDER: 'test' });
    expect(result).toBe(template);
  });

  it('should handle variables at start and end of template', () => {
    /**
     * @requirement REQ-004.1
     * @scenario Variables at boundaries
     * @given Template starting and ending with variables
     * @when processTemplate called
     * @then All variables substituted correctly
     */
    const template = '{{PROVIDER}} is the provider and model is {{MODEL}}';
    const variables = { PROVIDER: 'azure', MODEL: 'gpt-35-turbo' };
    
    const result = engine.processTemplate(template, variables);
    
    expect(result).toBe('azure is the provider and model is gpt-35-turbo');
  });
```

### 5. Complex Templates

```typescript
  it('should handle multiple occurrences of same variable', () => {
    /**
     * @requirement REQ-004.1
     * @scenario Same variable appears multiple times
     * @given Template with repeated variables
     * @when processTemplate called
     * @then All occurrences substituted
     */
    const template = '{{MODEL}} is great. I repeat, {{MODEL}} is great!';
    const variables = { MODEL: 'claude-3', PROVIDER: 'anthropic' };
    
    const result = engine.processTemplate(template, variables);
    
    expect(result).toBe('claude-3 is great. I repeat, claude-3 is great!');
  });

  it('should handle adjacent variables', () => {
    /**
     * @requirement REQ-004.1
     * @scenario Variables with no space between
     * @given {{VAR1}}{{VAR2}}
     * @when processTemplate called
     * @then Both substituted correctly
     */
    const template = '{{PROVIDER}}{{MODEL}}';
    const variables = { PROVIDER: 'google/', MODEL: 'palm2' };
    
    const result = engine.processTemplate(template, variables);
    
    expect(result).toBe('google/palm2');
  });
```

### 6. Special Characters in Values

```typescript
  it('should handle special characters in variable values', () => {
    /**
     * @requirement REQ-004.1
     * @scenario Variable values contain special characters
     * @given Values with quotes, brackets, etc
     * @when processTemplate called
     * @then Values inserted as-is
     */
    const template = 'Model: {{MODEL}}';
    const variables = { 
      MODEL: 'model-with-"quotes"-and-{brackets}',
      PROVIDER: 'test'
    };
    
    const result = engine.processTemplate(template, variables);
    
    expect(result).toBe('Model: model-with-"quotes"-and-{brackets}');
  });
```

### 7. Debug Logging Test

```typescript
  it('should log substitutions when DEBUG=1', () => {
    /**
     * @requirement REQ-010.4
     * @scenario DEBUG environment variable is set
     * @given DEBUG=1 and template with variables
     * @when processTemplate called
     * @then Logs variable substitutions
     */
    const originalDebug = process.env.DEBUG;
    process.env.DEBUG = '1';
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    
    try {
      const template = 'Provider: {{PROVIDER}}';
      const variables = { PROVIDER: 'anthropic', MODEL: 'claude' };
      
      engine.processTemplate(template, variables);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('PROVIDER')
      );
    } finally {
      process.env.DEBUG = originalDebug;
      consoleSpy.mockRestore();
    }
  });
```

## Test Count Requirement

Must create 15-20 behavioral tests covering:
- ✓ Basic substitution (multiple variables)
- ✓ Optional variable handling
- ✓ Malformed syntax handling
- ✓ Edge cases (empty, no variables, boundaries)
- ✓ Complex templates (repeated, adjacent)
- ✓ Special characters
- ✓ Debug logging

## Commands to Run

```bash
cd packages/core

# Run tests (all should fail with NotYetImplemented)
npm test TemplateEngine.spec.ts

# Verify test count
grep -c "it(" test/prompt-config/TemplateEngine.spec.ts  # Should be 15+

# Verify no mock testing
grep "toHaveBeenCalled\|mockResolvedValue" test/prompt-config/TemplateEngine.spec.ts && echo "FAIL: Mock testing detected"
```

## Success Criteria

- 15-20 behavioral tests created
- All tests fail with NotYetImplemented
- Tests verify actual output values
- No mock verification tests
- All REQ tags covered with tests