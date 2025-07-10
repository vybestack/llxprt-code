# Task: Resolve packages/cli/package.json Conflict

## Objective

Resolve the merge conflict in `packages/cli/package.json`, ensuring all CLI-specific dependencies from both branches are preserved.

## File

`packages/cli/package.json`

## Context

- **multi-provider branch**: Added provider-related dependencies (OpenAI SDK, Anthropic SDK, etc.)
- **main branch**: Updated existing dependencies and possibly added new CLI features

## Resolution Strategy

1. Open the conflicted file
2. Merge dependencies section to include ALL dependencies from both branches
3. For duplicate dependencies, use the newer version
4. Preserve all scripts from both branches
5. Ensure peerDependencies and devDependencies are properly merged

## Key Items to Preserve

### From multi-provider:

- `@anthropic-ai/sdk` or similar provider SDKs
- OpenAI-related packages
- Any tokenizer dependencies
- Provider-specific type definitions

### From main:

- Updated React/Ink versions
- New CLI utilities
- Updated testing frameworks
- Performance improvements

## Commands to Execute

```bash
# Examine the specific conflict
cat packages/cli/package.json | grep -A 10 -B 10 "<<<<"

# After manual resolution:
git add packages/cli/package.json
```

## Validation

1. JSON validity: `npx json -f packages/cli/package.json -c 'true'`
2. No missing dependencies that would break imports
3. Version compatibility between related packages
