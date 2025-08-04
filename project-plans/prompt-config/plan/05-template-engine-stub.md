# Task 05: TemplateEngine Component - Stub Implementation

## Objective

Create a minimal stub implementation of the TemplateEngine component that compiles with TypeScript strict mode but throws NotYetImplemented for all methods.

## Context

First implementation phase for the TemplateEngine component. This stub will be used to write behavioral tests in the next phase.

## Requirements to Implement

- **[REQ-004]** Template Processing requirements
- **[REQ-010.4]** Variable substitution logging (when DEBUG=1)

## Files to Create

```
packages/core/src/prompt-config/TemplateEngine.ts
packages/core/src/prompt-config/types.ts  # If not already created
```

## Stub Implementation Requirements

### 1. Create types.ts (if needed)

```typescript
import { z } from 'zod';

// Use schemas from specification.md
export const TemplateVariablesSchema = z.object({
  TOOL_NAME: z.string().optional(),
  MODEL: z.string(),
  PROVIDER: z.string()
}).passthrough();

export type TemplateVariables = z.infer<typeof TemplateVariablesSchema>;
```

### 2. Create TemplateEngine.ts

Create a class with these methods, all throwing NotYetImplemented:

```typescript
export class TemplateEngine {
  processTemplate(content: string, variables: TemplateVariables): string {
    throw new Error('NotYetImplemented');
  }

  private detectVariables(content: string): string[] {
    throw new Error('NotYetImplemented');
  }

  private substituteVariable(
    content: string, 
    variable: string, 
    value: string
  ): string {
    throw new Error('NotYetImplemented');
  }
}
```

## Constraints

1. **Maximum 100 lines total** including imports and types
2. **All methods must throw** `new Error('NotYetImplemented')`
3. **Must compile** with strict TypeScript settings
4. **Include all public methods** that will be needed based on pseudocode
5. **No actual logic** beyond throwing errors

## Commands to Run

```bash
cd packages/core

# Create the files
mkdir -p src/prompt-config
touch src/prompt-config/TemplateEngine.ts
touch src/prompt-config/types.ts

# After implementation, verify compilation
npm run typecheck

# Verify no logic exists
grep -v "throw new Error('NotYetImplemented')" src/prompt-config/TemplateEngine.ts | grep -E "return|if|for|while" && echo "FAIL: Logic found"
```

## Deliverables

1. TemplateEngine.ts created with stub methods
2. types.ts created with necessary types
3. Files compile without TypeScript errors
4. All methods throw NotYetImplemented
5. No logic beyond error throwing

## Success Criteria

- TypeScript compilation succeeds
- All methods from pseudocode are stubbed
- No implementation logic present
- File is under 100 lines
- Exports are properly defined