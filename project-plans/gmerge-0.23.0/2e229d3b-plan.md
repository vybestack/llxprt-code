# Reimplement Plan: JIT context memory loading (upstream 2e229d3bb6)

## Upstream Change
Creates a ContextManager service for lazy (just-in-time) memory loading with refresh capability, emits MemoryChanged events, and wires into config for conditional loading based on experimental flag.

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

   **C. Update tests**:
   - Replace individual load tests with refresh test
   - Add MemoryChanged event emission test

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

10. **Add tests**:
    - config.test.ts: Test JIT initialization and delegation
    - client.test.ts: Test getGlobalMemory vs getUserMemory in system instruction
    - contextManager.test.ts: Update to test refresh and event emission
    - memoryCommand.test.ts: Add JIT refresh test

## Verification
- `cd packages/core && npx vitest run src/config/config.test.ts`
- `cd packages/core && npx vitest run src/core/client.test.ts`
- `cd packages/core && npx vitest run src/services/contextManager.test.ts`
- `cd packages/cli && npx vitest run src/ui/commands/memoryCommand.test.ts`
- `npm run typecheck`
- `npm run lint`

## Branding Adaptations
- `.gemini/` → `.llxprt/` in paths
- `GEMINI.md` → `LLXPRT.md` in file names
- `geminiMdFileCount` → keep as-is (internal variable, not user-facing)
- `getGeminiMdFileCount()` → keep as-is (method name, changing would break API)
- Context string: "Gemini CLI" → "LLxprt Code CLI"
