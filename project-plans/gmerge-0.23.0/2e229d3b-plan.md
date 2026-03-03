# Reimplement Plan: JIT context memory loading (upstream 2e229d3bb6)

> **TEST BASELINE: There are ZERO pre-existing test failures (809 test files, 12,824 tests, all passing). Any test failure after implementation is caused by your changes and MUST be fixed before the batch is complete. Do not skip, defer, or assume failures are pre-existing.**


## Upstream Change
Creates a ContextManager service for lazy (just-in-time) memory loading with refresh capability, emits MemoryChanged events, and wires into config for conditional loading based on experimental flag.

## ContextManager API Contract

The ContextManager provides lazy-loaded memory management with the following public interface:

```typescript
class ContextManager {
  constructor(config: Config);
  
  // Refresh all memory (global + environment), emit MemoryChanged event
  async refresh(): Promise<void>;
  
  // Return global memory content (from ~/.llxprt/.LLXPRT_SYSTEM)
  getGlobalMemory(): string;
  
  // Return environment memory content (from workspace .llxprt/LLXPRT.md + MCP)
  getEnvironmentMemory(): string;
  
  // Return set of all loaded file paths
  getLoadedPaths(): Set<string>;
}
```

**Behavior Guarantees:**
- `refresh()` clears all cached data, reloads from disk, emits MemoryChanged event with fileCount
- Missing or nonexistent files return empty string, never throw
- Memory is lazy-loaded: not initialized until `refresh()` is called
- All methods are synchronous except `refresh()`
- Thread-safe: loadedPaths is cleared atomically before reload

## LLxprt Files to Modify
- packages/core/src/services/contextManager.ts — Implement refresh() method and event emission
- packages/core/src/config/config.ts — Add JIT check, initialize ContextManager, delegate getters
- packages/core/src/core/client.ts — Use getGlobalMemory for system instruction when JIT enabled
- packages/core/src/utils/events.ts — Update MemoryChangedPayload interface
- packages/core/src/utils/environmentContext.ts — Include environment memory in context
- packages/core/src/utils/memoryDiscovery.ts — Update event emission payload
- packages/cli/src/config/config.ts — Conditionally skip memory loading when JIT enabled
- packages/cli/src/ui/commands/memoryCommand.ts — Support JIT refresh via ContextManager
- packages/core/src/index.ts — Export ContextManager

## Steps

### MANDATORY: Test-Driven Development (TDD)

**NO PRODUCTION CODE MAY BE WRITTEN WITHOUT A FAILING TEST FIRST. Follow RED-GREEN-REFACTOR strictly.**

#### Phase 1: Write Behavioral Tests (RED)

Create `packages/core/src/services/contextManager.test.ts` with tests for:

1. **Lazy Loading**:
   - Constructor does NOT load any files (getLoadedPaths() returns empty Set)
   - getGlobalMemory() returns empty string before refresh()
   - getEnvironmentMemory() returns empty string before refresh()

2. **Refresh Behavior**:
   - refresh() loads global memory from ~/.llxprt/.LLXPRT_SYSTEM
   - refresh() loads environment memory from workspace .llxprt/LLXPRT.md
   - refresh() clears previous data before reloading (loadedPaths reset)
   - refresh() emits MemoryChanged event with correct fileCount

3. **Missing/Nonexistent Files** (CRITICAL):
   - Missing ~/.llxprt/.LLXPRT_SYSTEM returns empty string, NOT throw
   - Missing workspace .llxprt/LLXPRT.md returns empty string, NOT throw
   - Nonexistent workspace directory returns empty string, NOT throw

4. **Getter Methods**:
   - getGlobalMemory() returns cached content after refresh
   - getEnvironmentMemory() returns cached content after refresh
   - getLoadedPaths() returns Set of all loaded file paths

5. **Integration**:
   - Multiple refresh() calls work correctly
   - Event emission happens exactly once per refresh

#### Phase 2: Run Tests — Confirm RED

```bash
cd packages/core && npx vitest run src/services/contextManager.test.ts
```

**ALL TESTS MUST FAIL.** If any pass, the test is invalid.

#### Phase 3: Implement Minimal Code (GREEN)

Write ONLY enough code to make each failing test pass:
- Implement one method at a time
- Run tests after each change
- Do NOT add features not covered by tests

```bash
cd packages/core && npx vitest run src/services/contextManager.test.ts
```

**ALL TESTS MUST PASS.** Do not proceed until GREEN.

#### Phase 4: Refactor (If Valuable)

- Assess: Does refactoring improve clarity or performance measurably?
- If yes: Refactor while keeping tests GREEN
- If no: Move to next feature
- Keep tests passing throughout

### Implementation Steps

1. **Update ContextManager** (packages/core/src/services/contextManager.ts):

   **A. Replace loadGlobalMemory and loadEnvironmentMemory with refresh**:
   ```typescript
   import { coreEvents, CoreEvent } from '../utils/events.js';

   /**
    * Refreshes the memory by reloading global and environment memory.
    */
   async refresh(): Promise<void> {
     this.loadedPaths.clear();
     await this.loadGlobalMemory();
     await this.loadEnvironmentMemory();
     this.emitMemoryChanged();
   }

   private async loadGlobalMemory(): Promise<void> {
     const result = await loadGlobalMemory(this.config.getDebugMode());
     this.markAsLoaded(result.files.map((f) => f.path));
     this.globalMemory = concatenateInstructions(
       result.files.map((f) => ({ filePath: f.path, content: f.content })),
       this.config.getWorkingDir(),
     );
   }

   private async loadEnvironmentMemory(): Promise<void> {
     const result = await loadEnvironmentMemory(
       [...this.config.getWorkspaceContext().getDirectories()],
       this.config.getExtensionLoader(),
       this.config.getDebugMode(),
     );
     this.markAsLoaded(result.files.map((f) => f.path));
     const envMemory = concatenateInstructions(
       result.files.map((f) => ({ filePath: f.path, content: f.content })),
       this.config.getWorkingDir(),
     );
     const mcpInstructions =
       this.config.getMcpClientManager()?.getMcpInstructions() || '';
     this.environmentMemory = [envMemory, mcpInstructions.trimStart()]
       .filter(Boolean)
       .join('\n\n');
   }

   private emitMemoryChanged(): void {
     coreEvents.emit(CoreEvent.MemoryChanged, {
       fileCount: this.loadedPaths.size,
     });
   }
   ```

   **B. Remove reset() method**:
   - Delete the `reset()` method (no longer needed with refresh)

   **C. Update tests** (already written in TDD phase above):
   - Verify all behavioral tests pass
   - Add integration tests with Config if needed
   - Test edge cases: empty files, malformed content, concurrent refresh calls

2. **Update Config** (packages/core/src/config/config.ts):

   **A. Initialize ContextManager and call refresh** (in initialize method):
   ```typescript
   if (this.experimentalJitContext) {
     this.contextManager = new ContextManager(this);
     await this.contextManager.refresh();
   }
   ```

   **B. Delegate getUserMemory when JIT enabled**:
   ```typescript
   getUserMemory(): string {
     if (this.experimentalJitContext && this.contextManager) {
       return [
         this.contextManager.getGlobalMemory(),
         this.contextManager.getEnvironmentMemory(),
       ]
         .filter(Boolean)
         .join('\n\n');
     }
     return this.userMemory;
   }
   ```

   **C. Add getGlobalMemory method**:
   ```typescript
   getGlobalMemory(): string {
     if (this.experimentalJitContext && this.contextManager) {
       return this.contextManager.getGlobalMemory();
     }
     return this.userMemory;
   }

   getEnvironmentMemory(): string {
     if (this.experimentalJitContext && this.contextManager) {
       return this.contextManager.getEnvironmentMemory();
     }
     return '';
   }
   ```

   **D. Delegate getGeminiMdFileCount and getGeminiMdFilePaths**:
   ```typescript
   getGeminiMdFileCount(): number {
     if (this.experimentalJitContext && this.contextManager) {
       return this.contextManager.getLoadedPaths().size;
     }
     return this.geminiMdFileCount;
   }

   getGeminiMdFilePaths(): string[] {
     if (this.experimentalJitContext && this.contextManager) {
       return Array.from(this.contextManager.getLoadedPaths());
     }
     return this.geminiMdFilePaths;
   }
   ```

   **E. Add isJitContextEnabled getter**:
   ```typescript
   isJitContextEnabled(): boolean {
     return !!this.experimentalJitContext;
   }

   getContextManager(): ContextManager | undefined {
     return this.contextManager;
   }
   ```

3. **Update client.ts** (packages/core/src/core/client.ts):
   - Find updateSystemInstruction method (around line 182):
     ```typescript
     const systemMemory = this.config.isJitContextEnabled()
       ? this.config.getGlobalMemory()
       : this.config.getUserMemory();
     const systemInstruction = getCoreSystemPrompt(this.config, systemMemory);
     ```
   
   - Find initChat method (around line 203):
     ```typescript
     const systemMemory = this.config.isJitContextEnabled()
       ? this.config.getGlobalMemory()
       : this.config.getUserMemory();
     const systemInstruction = getCoreSystemPrompt(this.config, systemMemory);
     ```

4. **Update events.ts** (packages/core/src/utils/events.ts):
   - Change MemoryChangedPayload:
     ```typescript
     export interface MemoryChangedPayload {
       fileCount: number;
     }
     ```

5. **Update environmentContext.ts** (packages/core/src/utils/environmentContext.ts):
   - Add environment memory to context string (around line 73):
     ```typescript
     const environmentMemory = config.getEnvironmentMemory();

     const context = `
     This is the LLxprt Code CLI. We are setting up the context for our chat.
     Today's date is ${today} (formatted according to the user's locale).
     My operating system is: ${platform}
     The project's temporary directory is: ${tempDir}
     ${directoryContext}

     ${environmentMemory}
     `.trim();
     ```

6. **Update memoryDiscovery.ts** (packages/core/src/utils/memoryDiscovery.ts):
   - Find refreshServerHierarchicalMemory function (end of function):
     ```typescript
     coreEvents.emit(CoreEvent.MemoryChanged, { fileCount: result.fileCount });
     ```

7. **Update CLI config.ts** (packages/cli/src/config/config.ts):
   - Find memory loading section (around line 438):
     ```typescript
     const experimentalJitContext = settings.experimental?.jitContext ?? false;

     let memoryContent = '';
     let fileCount = 0;
     let filePaths: string[] = [];

     if (!experimentalJitContext) {
       const result = await loadServerHierarchicalMemory(
         cwd,
         [],
         debugMode,
         serverProvider,
         sandboxMemoryFileFiltering,
         projectMemoryFileFiltering,
         memoryFileFiltering,
         settings.context?.discoveryMaxDirs,
       );
       memoryContent = result.memoryContent;
       fileCount = result.fileCount;
       filePaths = result.filePaths;
     }
     ```

8. **Update memoryCommand.ts** (packages/cli/src/ui/commands/memoryCommand.ts):
   - Update refresh subcommand action (around line 90):
     ```typescript
     try {
       const config = context.services.config;
       if (config) {
         let memoryContent = '';
         let fileCount = 0;

         if (config.isJitContextEnabled()) {
           await config.getContextManager()?.refresh();
           memoryContent = config.getUserMemory();
           fileCount = config.getGeminiMdFileCount();
         } else {
           const result = await refreshServerHierarchicalMemory(config);
           memoryContent = result.memoryContent;
           fileCount = result.fileCount;
         }

         await config.updateSystemInstructionIfInitialized();

         return {
           type: 'message',
           messageType: 'info',
           content: `Memory refreshed successfully. Loaded ${memoryContent.length} characters from ${fileCount} file(s).`,
         };
       }
     ```

9. **Export ContextManager** (packages/core/src/index.ts):
   - Add: `export { ContextManager } from './services/contextManager.js';`

10. **Add remaining tests** (following TDD for each file):
    
    **config.test.ts** (RED → GREEN → REFACTOR):
    
    Write tests FIRST:
    - Test JIT initialization when experimental flag enabled
    - Test ContextManager.refresh() called during initialize()
    - Test getUserMemory() delegates to ContextManager when JIT enabled
    - Test getGlobalMemory() delegates to ContextManager when JIT enabled
    - Test getEnvironmentMemory() delegates to ContextManager when JIT enabled
    - Test getGeminiMdFileCount() delegates to ContextManager when JIT enabled
    - Test getGeminiMdFilePaths() delegates to ContextManager when JIT enabled
    - Test fallback to userMemory when JIT disabled
    - Test missing files handled gracefully (no throw)
    
    **RED**: `cd packages/core && npx vitest run src/config/config.test.ts` — All tests MUST FAIL
    
    **GREEN**: Implement minimal code to pass tests — All tests MUST PASS
    
    **REFACTOR**: Improve if valuable, keep tests GREEN
    
    ---
    
    **client.test.ts** (RED → GREEN → REFACTOR):
    
    Write tests FIRST:
    - Test updateSystemInstruction uses getGlobalMemory() when JIT enabled
    - Test updateSystemInstruction uses getUserMemory() when JIT disabled
    - Test initChat uses getGlobalMemory() when JIT enabled
    - Test initChat uses getUserMemory() when JIT disabled
    
    **RED**: `cd packages/core && npx vitest run src/core/client.test.ts` — All tests MUST FAIL
    
    **GREEN**: Implement minimal code to pass tests — All tests MUST PASS
    
    **REFACTOR**: Improve if valuable, keep tests GREEN
    
    ---
    
    **memoryCommand.test.ts** (RED → GREEN → REFACTOR):
    
    Write tests FIRST:
    - Test refresh subcommand calls ContextManager.refresh() when JIT enabled
    - Test refresh subcommand calls refreshServerHierarchicalMemory when JIT disabled
    - Test refresh subcommand reports correct file count
    - Test refresh subcommand updates system instruction
    - Test error handling when refresh fails
    
    **RED**: `cd packages/cli && npx vitest run src/ui/commands/memoryCommand.test.ts` — All tests MUST FAIL
    
    **GREEN**: Implement minimal code to pass tests — All tests MUST PASS
    
    **REFACTOR**: Improve if valuable, keep tests GREEN

## Verification (Full Verification Sequence)

**MUST run all verification steps in order. Do NOT skip any step.**

### Step 1: Unit Tests (from package directories)

```bash
cd packages/core && npx vitest run src/services/contextManager.test.ts
cd packages/core && npx vitest run src/config/config.test.ts
cd packages/core && npx vitest run src/core/client.test.ts
cd packages/cli && npx vitest run src/ui/commands/memoryCommand.test.ts
```

**All tests MUST pass. Fix failures before proceeding.**

### Step 2: Full Test Suite (from project root)

```bash
npm run test
```

**All tests MUST pass. Zero failures, zero skipped tests.**

### Step 3: Type Safety (from project root)

```bash
npm run typecheck
```

**Zero TypeScript errors. Any error is a blocker.**

### Step 4: Code Quality (from project root)

```bash
npm run lint
```

**Zero linting warnings. Fix all issues.**

```bash
npm run format
```

**Code properly formatted. Commit formatted code.**

### Step 5: Build (from project root)

```bash
npm run build
```

**Clean build with no errors or warnings.**

### Step 6: Integration Test (from project root)

```bash
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

**Should execute without errors and produce a haiku.**

### Final Checklist

- [ ] All unit tests pass
- [ ] Full test suite passes
- [ ] Zero TypeScript errors
- [ ] Zero linting warnings
- [ ] Code is formatted
- [ ] Build succeeds
- [ ] Integration test succeeds
- [ ] All changes committed
- [ ] Ready for PR

## Branding Adaptations
- `.gemini/` → `.llxprt/` in paths
- `GEMINI.md` → `LLXPRT.md` in file names
- `geminiMdFileCount` → keep as-is (internal variable, not user-facing)
- `getGeminiMdFileCount()` → keep as-is (method name, changing would break API)
- Context string: "Gemini CLI" → "LLxprt Code CLI"
