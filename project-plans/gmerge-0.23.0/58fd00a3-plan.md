# Reimplement Plan: .llxprtignore support for SearchText (upstream 58fd00a3df)

## Upstream Change
Adds `.geminiignore` support to the ripgrep search tool, allowing users to exclude files from search results using ignore patterns.

## LLxprt Files to Modify
- packages/core/src/tools/ripGrep.ts — Add .llxprtignore support via GeminiIgnoreParser
- packages/core/src/utils/geminiIgnoreParser.ts — Add getIgnoreFilePath and hasPatterns methods
- packages/core/src/utils/geminiIgnoreParser.test.ts — Add tests for new methods
- integration-tests/ripgrep-real.test.ts — Add mock for getFileFilteringRespectGeminiIgnore

## Steps

1. **Update geminiIgnoreParser.ts** (packages/core/src/utils/geminiIgnoreParser.ts):

   **A. Add to interface**:
   ```typescript
   export interface GeminiIgnoreFilter {
     isIgnored(filePath: string): boolean;
     getPatterns(): string[];
     getIgnoreFilePath(): string | null;  // ADD THIS
     hasPatterns(): boolean;  // ADD THIS
   }
   ```

   **B. Add methods to class**:
   ```typescript
   /**
    * Returns the path to .llxprtignore file if it exists and has patterns.
    * Useful for tools like ripgrep that support --ignore-file flag.
    */
   getIgnoreFilePath(): string | null {
     if (!this.hasPatterns()) {
       return null;
     }
     return path.join(this.projectRoot, '.llxprtignore');
   }

   /**
    * Returns true if .llxprtignore exists and has patterns.
    */
   hasPatterns(): boolean {
     if (this.patterns.length === 0) {
       return false;
     }
     const ignoreFilePath = path.join(this.projectRoot, '.llxprtignore');
     return fs.existsSync(ignoreFilePath);
   }
   ```

2. **Update geminiIgnoreParser.test.ts**:

   **A. Add test for getIgnoreFilePath when patterns exist**:
   ```typescript
   it('should return ignore file path when patterns exist', () => {
     const parser = new GeminiIgnoreParser(projectRoot);
     expect(parser.getIgnoreFilePath()).toBe(
       path.join(projectRoot, '.llxprtignore'),
     );
   });
   ```

   **B. Add test for hasPatterns**:
   ```typescript
   it('should return true for hasPatterns when patterns exist', () => {
     const parser = new GeminiIgnoreParser(projectRoot);
     expect(parser.hasPatterns()).toBe(true);
   });

   it('should return false for hasPatterns when .llxprtignore is deleted', async () => {
     const parser = new GeminiIgnoreParser(projectRoot);
     await fs.rm(path.join(projectRoot, '.llxprtignore'));
     expect(parser.hasPatterns()).toBe(false);
     expect(parser.getIgnoreFilePath()).toBeNull();
   });
   ```

   **C. Add tests for empty/comment-only files**:
   ```typescript
   describe('when .llxprtignore is empty', () => {
     beforeEach(async () => {
       await createTestFile('.llxprtignore', '');
     });

     it('should return null for getIgnoreFilePath', () => {
       const parser = new GeminiIgnoreParser(projectRoot);
       expect(parser.getIgnoreFilePath()).toBeNull();
     });

     it('should return false for hasPatterns', () => {
       const parser = new GeminiIgnoreParser(projectRoot);
       expect(parser.hasPatterns()).toBe(false);
     });
   });

   describe('when .llxprtignore only has comments', () => {
     beforeEach(async () => {
       await createTestFile(
         '.llxprtignore',
         '# This is a comment\n# Another comment\n',
       );
     });

     it('should return null for getIgnoreFilePath', () => {
       const parser = new GeminiIgnoreParser(projectRoot);
       expect(parser.getIgnoreFilePath()).toBeNull();
     });

     it('should return false for hasPatterns', () => {
       const parser = new GeminiIgnoreParser(projectRoot);
       expect(parser.hasPatterns()).toBe(false);
     });
   });
   ```

   **D. Update tests for no .llxprtignore**:
   ```typescript
   describe('when .llxprtignore does not exist', () => {
     it('should return null for getIgnoreFilePath when no patterns exist', () => {
       const parser = new GeminiIgnoreParser(projectRoot);
       expect(parser.getIgnoreFilePath()).toBeNull();
     });

     it('should return false for hasPatterns when no patterns exist', () => {
       const parser = new GeminiIgnoreParser(projectRoot);
       expect(parser.hasPatterns()).toBe(false);
     });
   });
   ```

3. **Update ripGrep.ts** (packages/core/src/tools/ripGrep.ts):

   **A. Add GeminiIgnoreParser field to tool class**:
   ```typescript
   export class RipGrepTool extends BaseDeclarativeTool<
     RipGrepToolParams,
     ToolResult
   > {
     static readonly Name = GREP_TOOL_NAME;
     private readonly geminiIgnoreParser: GeminiIgnoreParser;  // ADD THIS

     constructor(
       private readonly config: Config,
       messageBus?: MessageBus,
     ) {
       super(
         GREP_TOOL_NAME,
         // ... rest of constructor
       );
       this.geminiIgnoreParser = new GeminiIgnoreParser(config.getTargetDir());  // ADD THIS
     }
   ```

   **B. Pass parser to invocation**:
   ```typescript
   build(
     params: RipGrepToolParams,
     messageBus?: MessageBus,
     _toolName?: string,
   ): ToolInvocation<RipGrepToolParams, ToolResult> {
     return new GrepToolInvocation(
       this.config,
       this.geminiIgnoreParser,  // ADD THIS
       params,
       messageBus,
       _toolName,
     );
   }
   ```

   **C. Update GrepToolInvocation constructor**:
   ```typescript
   class GrepToolInvocation extends BaseToolInvocation<
     RipGrepToolParams,
     ToolResult
   > {
     constructor(
       private readonly config: Config,
       private readonly geminiIgnoreParser: GeminiIgnoreParser,  // ADD THIS
       params: RipGrepToolParams,
       messageBus?: MessageBus,
       _toolName?: string,
     ) {
       super(params, messageBus, _toolName);
     }
   ```

   **D. Add .llxprtignore to ripgrep args** (in buildRipgrepArgs, around line 395):
   ```typescript
   // After adding excludes via --glob
   excludes.forEach((exclude) => {
     rgArgs.push('--glob', `!${exclude}`);
   });

   if (this.config.getFileFilteringRespectGeminiIgnore()) {
     // Add .llxprtignore support (ripgrep natively handles .gitignore)
     const llxprtIgnorePath = this.geminiIgnoreParser.getIgnoreFilePath();
     if (llxprtIgnorePath) {
       rgArgs.push('--ignore-file', llxprtIgnorePath);
     }
   }
   ```

4. **Update ripGrep.test.ts** (packages/core/src/tools/ripGrep.test.ts):

   **A. Add getFileFilteringRespectGeminiIgnore to mock configs**:
   ```typescript
   const mockConfig = {
     getTargetDir: () => tempRootDir,
     getWorkspaceContext: () => createMockWorkspaceContext(tempRootDir),
     getDebugMode: () => false,
     getFileFilteringRespectGeminiIgnore: () => true,  // ADD THIS
   } as unknown as Config;
   ```

   **B. Add test for .llxprtignore enabled**:
   ```typescript
   it('should add .llxprtignore when enabled and patterns exist', async () => {
     const llxprtIgnorePath = path.join(tempRootDir, '.llxprtignore');
     await fs.writeFile(llxprtIgnorePath, 'ignored.log');
     const configWithLlxprtIgnore = {
       getTargetDir: () => tempRootDir,
       getWorkspaceContext: () => createMockWorkspaceContext(tempRootDir),
       getDebugMode: () => false,
       getFileFilteringRespectGeminiIgnore: () => true,
     } as unknown as Config;
     const llxprtIgnoreTool = new RipGrepTool(configWithLlxprtIgnore);

     mockSpawn.mockImplementationOnce(
       createMockSpawn({
         outputData:
           JSON.stringify({
             type: 'match',
             data: {
               path: { text: 'ignored.log' },
               line_number: 1,
               lines: { text: 'secret log entry\n' },
             },
           }) + '\n',
         exitCode: 0,
       }),
     );

     const params: RipGrepToolParams = { pattern: 'secret' };
     const invocation = llxprtIgnoreTool.build(params);
     await invocation.execute(abortSignal);

     expect(mockSpawn).toHaveBeenLastCalledWith(
       expect.anything(),
       expect.arrayContaining(['--ignore-file', llxprtIgnorePath]),
       expect.anything(),
     );
   });
   ```

   **C. Add test for .llxprtignore disabled**:
   ```typescript
   it('should skip .llxprtignore when disabled', async () => {
     const llxprtIgnorePath = path.join(tempRootDir, '.llxprtignore');
     await fs.writeFile(llxprtIgnorePath, 'ignored.log');
     const configWithoutLlxprtIgnore = {
       getTargetDir: () => tempRootDir,
       getWorkspaceContext: () => createMockWorkspaceContext(tempRootDir),
       getDebugMode: () => false,
       getFileFilteringRespectGeminiIgnore: () => false,
     } as unknown as Config;
     const llxprtIgnoreTool = new RipGrepTool(configWithoutLlxprtIgnore);

     mockSpawn.mockImplementationOnce(
       createMockSpawn({
         outputData:
           JSON.stringify({
             type: 'match',
             data: {
               path: { text: 'ignored.log' },
               line_number: 1,
               lines: { text: 'secret log entry\n' },
             },
           }) + '\n',
         exitCode: 0,
       }),
     );

     const params: RipGrepToolParams = { pattern: 'secret' };
     const invocation = llxprtIgnoreTool.build(params);
     await invocation.execute(abortSignal);

     expect(mockSpawn).toHaveBeenLastCalledWith(
       expect.anything(),
       expect.not.arrayContaining(['--ignore-file', llxprtIgnorePath]),
       expect.anything(),
     );
   });
   ```

5. **Update integration test** (integration-tests/ripgrep-real.test.ts):
   ```typescript
   class MockConfig {
     getDebugMode() {
       return true;
     }

     getFileFilteringRespectGeminiIgnore() {  // ADD THIS
       return true;
     }
   }
   ```

## Verification
- `cd packages/core && npx vitest run src/utils/geminiIgnoreParser.test.ts`
- `cd packages/core && npx vitest run src/tools/ripGrep.test.ts`
- `npx vitest run integration-tests/ripgrep-real.test.ts`
- `npm run typecheck`
- `npm run lint`
- Manual test: Create `.llxprtignore` with pattern `*.log`, verify search excludes .log files

## Branding Adaptations
- `.geminiignore` → `.llxprtignore` in file names
- `GeminiIgnoreParser` → keep class name as-is (internal implementation)
- `geminiIgnoreParser` → keep variable name as-is (or rename to `llxprtIgnoreParser` for consistency, but not required)
- Comments: "geminiignore" → "llxprtignore"
- Test file names: keep as geminiIgnoreParser.test.ts (follows existing pattern)

## Notes
- The GeminiIgnoreParser class name is kept for consistency with existing codebase
- The actual file it reads is `.llxprtignore` (branding applied at file level)
- Config method `getFileFilteringRespectGeminiIgnore()` can be kept as-is or renamed to `getFileFilteringRespectLlxprtIgnore()`
