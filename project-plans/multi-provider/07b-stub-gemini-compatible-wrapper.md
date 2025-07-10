# Phase 07b – Stub GeminiCompatibleWrapper (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

Create a compilable skeleton for a wrapper that makes any IProvider look like a Gemini content generator, throwing `NotYetImplemented` for all methods.

## Deliverables

- Created `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/adapters/GeminiCompatibleWrapper.ts` with stub implementation
- Created `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/adapters/IStreamAdapter.ts` interface
- Updated exports in `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/index.ts`

## Checklist (implementer)

- [ ] Create the `adapters` directory under `providers`
- [ ] Define `IStreamAdapter` interface with methods:
  - [ ] `adaptStream(providerStream: AsyncIterableIterator<any>): AsyncIterableIterator<GeminiEvent>`
- [ ] Create `GeminiCompatibleWrapper` class that:
  - [ ] Takes an `IProvider` in constructor
  - [ ] Implements methods matching ContentGenerator pattern:
    - [ ] `generateContent()` - throws NotYetImplemented
    - [ ] `generateContentStream()` - throws NotYetImplemented
  - [ ] Has private method `adaptProviderStream()` - throws NotYetImplemented
- [ ] Add proper TypeScript types and imports
- [ ] Export new types from index.ts

## Self-verify

```bash
npm run typecheck
npm run lint
# Verify the stub compiles but throws NotYetImplemented
grep -r "NotYetImplemented" packages/cli/src/providers/adapters/
```

**STOP. Wait for Phase 07b verification.**
