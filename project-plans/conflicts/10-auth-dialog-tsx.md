# Task: Resolve packages/cli/src/ui/components/AuthDialog.tsx Conflict

## Objective

Resolve the merge conflict in AuthDialog component to support multi-provider authentication while preserving UI improvements from main.

## File

`packages/cli/src/ui/components/AuthDialog.tsx`

## Context

- **multi-provider branch**: Modified to support multiple provider authentication
- **main branch**: UI improvements and better error handling

## Resolution Strategy

1. Keep multi-provider auth flow
2. Apply UI improvements from main
3. Merge error handling enhancements
4. Ensure consistent styling

## Key Items to Preserve

### From multi-provider:

- Provider selection in auth dialog
- Multiple API key inputs
- Provider-specific auth validation
- Dynamic auth based on selected provider

### From main:

- Improved UI layout
- Better error messages
- Accessibility improvements
- Animation enhancements

## Expected Structure

- Should show provider selection
- Dynamic form based on provider
- Clear error messaging
- Smooth transitions

## Commands to Execute

```bash
# After resolution:
git add packages/cli/src/ui/components/AuthDialog.tsx
```

## Validation

1. Component renders correctly
2. Auth works for all providers
3. Error states display properly
4. TypeScript types correct
