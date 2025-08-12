# Phase 12: Provider Integration Stub

## Objective

Create stub for integrating providers with settings service.

## Worker Task

```bash
claude --dangerously-skip-permissions -p "
Create stub for provider integration with settings service.

Update packages/core/src/providers/BaseProvider.ts:
- Add onSettingsChange method
- Method throws new Error('NotYetImplemented')
- Include TypeScript types

Update packages/cli/src/providers/providerManagerInstance.ts:
- Add settingsService property
- Add registerSettingsListener method  
- Methods throw new Error('NotYetImplemented')

Requirements:
1. Must compile with strict TypeScript
2. Minimal changes to existing code
3. All new methods are stubs

Output status to workers/phase-12.json
"
```

## Verification

```bash
# Check compilation
npm run typecheck

# Verify stubs added
grep "NotYetImplemented" packages/core/src/providers/BaseProvider.ts
grep "NotYetImplemented" packages/cli/src/providers/providerManagerInstance.ts
```