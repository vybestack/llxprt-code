# Reimplement Plan: .llxprtignore support for SearchText (upstream 58fd00a3df)

## Upstream Change
Adds `.geminiignore` support to the ripgrep search tool, allowing users to exclude files from search results using ignore patterns.

## LLxprt Adaptation

**CRITICAL CONTEXT**: LLxprt already has comprehensive .llxprtignore infrastructure via `FileDiscoveryService` and `GitIgnoreParser` with `extraPatterns` support. This infrastructure:
- Loads `.llxprtignore` patterns from project root
- Combines with `.gitignore` patterns (with .llxprtignore taking precedence)
- Supports nested .gitignore files but only root-level .llxprtignore
- Is used across all file-based tools (ls, read-many-files, glob, etc.)

**Goal**: Extend existing infrastructure to support SearchText (ripGrep) tool, leveraging ripgrep's native `--ignore-file` flag for performance.

**Branding Clarification**: 
- **Internal classes**: `GitIgnoreParser` remains unchanged (it's a generic parser that handles both .gitignore and .llxprtignore files via `extraPatterns` parameter)
- **File names**: `.llxprtignore` (LLxprt branding)
- **Config methods**: `getFileFilteringRespectLlxprtIgnore()` (LLxprt branding)
- **Service classes**: `FileDiscoveryService` (generic name, handles both ignore types)
- **Rationale**: The upstream Gemini code uses `GeminiIgnoreParser` which we've already renamed to `GitIgnoreParser` in LLxprt. This parser is generic and handles any ignore file via the `extraPatterns` constructor parameter, making it reusable for both .gitignore and .llxprtignore files.

## LLxprt Files to Modify
- packages/core/src/tools/ripGrep.ts — Integrate FileDiscoveryService to provide .llxprtignore path to ripgrep
- packages/core/src/tools/ripGrep.test.ts — Add behavioral tests for .llxprtignore integration
- integration-tests/ripgrep-real.test.ts — Add mock for getFileFilteringRespectLlxprtIgnore (note: Llxprt branding)

**NOT REQUIRED**: 
- NO new GeminiIgnoreParser class (reuse existing GitIgnoreParser)
- NO geminiIgnoreParser.ts changes (doesn't exist in LLxprt)
- NO geminiIgnoreParser.test.ts changes (doesn't exist in LLxprt)

## Nested .llxprtignore Scope

**EXPLICIT ARCHITECTURAL LIMITATION**: 

This implementation only supports **root-level `.llxprtignore` files**, matching the current LLxprt architecture as implemented in `FileDiscoveryService`. 

**What IS supported**:
- Root-level `.llxprtignore` file (e.g., `<projectRoot>/.llxprtignore`)
- Nested `.gitignore` files (e.g., `<projectRoot>/src/subdir/.gitignore`)
- Combined rules from root `.llxprtignore` + all nested `.gitignore` files

**What IS NOT supported**:
- Nested `.llxprtignore` files (e.g., `<projectRoot>/src/subdir/.llxprtignore`)
- Only the `.llxprtignore` at project root is loaded via `FileDiscoveryService.getLlxprtIgnorePatterns()`

**Rationale**: 
- Upstream Gemini also only supports root-level `.geminiignore`
- This is consistent with all other LLxprt tools (ls, read-many-files, glob, etc.)
- Extending to nested `.llxprtignore` would require significant changes to `GitIgnoreParser` and `FileDiscoveryService`
- If needed in the future, this can be addressed as a separate enhancement with its own plan

## TDD Mandate

**MANDATORY TEST-FIRST DEVELOPMENT** (per dev-docs/RULES.md):

### RED-GREEN-REFACTOR CYCLE (STRICT):

1. **RED Phase**: Write behavioral tests FIRST for .llxprtignore patterns being respected by SearchText
   - Run: `cd packages/core && npx vitest run src/tools/ripGrep.test.ts`
   - **EXPECTED**: Tests FAIL (RED) 
   - **STOP** if tests pass prematurely — this indicates tests are not testing the right thing

2. **GREEN Phase**: Implement minimal code to make tests pass
   - Run: `cd packages/core && npx vitest run src/tools/ripGrep.test.ts`
   - **EXPECTED**: Tests PASS (GREEN) [OK]
   - **STOP** if tests still fail — debug before refactoring

3. **REFACTOR Phase**: Assess if refactoring adds value
   - Only refactor if it improves clarity/maintainability
   - Run tests after each refactor to ensure GREEN
   - Do NOT add speculative abstractions

4. **COMMIT**: Feature + tests together, refactoring separately

### Test Requirements:
- Tests must verify **behavior** (search results exclude .llxprtignore patterns), NOT implementation details (method calls, internal structure)
- No production code may be written without a failing test
- Tests must use Arrange-Act-Assert pattern
- Single assertion per test (one behavior per test)
- Test names must describe behavior in plain English

## Steps

### TEST-FIRST: Write Behavioral Tests (RED Phase)

1. **Add behavioral tests to ripGrep.test.ts** (packages/core/src/tools/ripGrep.test.ts):

   **Test Setup**: Create temporary `.llxprtignore` file with patterns, verify SearchText excludes matching files.

   **A. Test: .llxprtignore enabled and patterns exist**:
   ```typescript
   it('should exclude files matching .llxprtignore patterns when enabled', async () => {
     // Arrange: Create .llxprtignore with pattern
     const llxprtIgnorePath = path.join(tempRootDir, '.llxprtignore');
     await fs.writeFile(llxprtIgnorePath, 'ignored.log');
     
     // Create test file that should be ignored
     await fs.writeFile(path.join(tempRootDir, 'ignored.log'), 'secret data');
     await fs.writeFile(path.join(tempRootDir, 'visible.txt'), 'secret data');
     
     const configWithLlxprtIgnore = {
       getTargetDir: () => tempRootDir,
       getWorkspaceContext: () => createMockWorkspaceContext(tempRootDir),
       getDebugMode: () => false,
       getFileFilteringRespectLlxprtIgnore: () => true,
     } as unknown as Config;
     const tool = new RipGrepTool(configWithLlxprtIgnore);

     // Mock ripgrep to verify --ignore-file flag is passed
     mockSpawn.mockImplementationOnce(
       createMockSpawn({
         outputData:
           JSON.stringify({
             type: 'match',
             data: {
               path: { text: 'visible.txt' },
               line_number: 1,
               lines: { text: 'secret data\n' },
             },
           }) + '\n',
         exitCode: 0,
       }),
     );

     // Act: Search for pattern
     const params: RipGrepToolParams = { pattern: 'secret' };
     const invocation = tool.build(params);
     const result = await invocation.execute(abortSignal);

     // Assert: Verify --ignore-file flag was passed to ripgrep
     expect(mockSpawn).toHaveBeenCalledWith(
       expect.anything(),
       expect.arrayContaining(['--ignore-file', llxprtIgnorePath]),
       expect.anything(),
     );
     
     // Assert: Verify result only includes visible.txt, not ignored.log
     expect(result.llmContent).toContain('visible.txt');
     expect(result.llmContent).not.toContain('ignored.log');
   });
   ```

   **B. Test: .llxprtignore disabled**:
   ```typescript
   it('should not use .llxprtignore when respectLlxprtIgnore is disabled', async () => {
     // Arrange: Create .llxprtignore
     const llxprtIgnorePath = path.join(tempRootDir, '.llxprtignore');
     await fs.writeFile(llxprtIgnorePath, 'ignored.log');
     
     const configWithoutLlxprtIgnore = {
       getTargetDir: () => tempRootDir,
       getWorkspaceContext: () => createMockWorkspaceContext(tempRootDir),
       getDebugMode: () => false,
       getFileFilteringRespectLlxprtIgnore: () => false,
     } as unknown as Config;
     const tool = new RipGrepTool(configWithoutLlxprtIgnore);

     mockSpawn.mockImplementationOnce(
       createMockSpawn({
         outputData: '',
         exitCode: 1,
       }),
     );

     // Act
     const params: RipGrepToolParams = { pattern: 'secret' };
     const invocation = tool.build(params);
     await invocation.execute(abortSignal);

     // Assert: --ignore-file should NOT be in args
     expect(mockSpawn).toHaveBeenCalledWith(
       expect.anything(),
       expect.not.arrayContaining(['--ignore-file']),
       expect.anything(),
     );
   });
   ```

   **C. Test: Empty .llxprtignore**:
   ```typescript
   it('should not add --ignore-file flag when .llxprtignore is empty', async () => {
     // Arrange: Create empty .llxprtignore
     await fs.writeFile(path.join(tempRootDir, '.llxprtignore'), '');
     
     const config = {
       getTargetDir: () => tempRootDir,
       getWorkspaceContext: () => createMockWorkspaceContext(tempRootDir),
       getDebugMode: () => false,
       getFileFilteringRespectLlxprtIgnore: () => true,
     } as unknown as Config;
     const tool = new RipGrepTool(config);

     mockSpawn.mockImplementationOnce(
       createMockSpawn({
         outputData: '',
         exitCode: 1,
       }),
     );

     // Act
     const params: RipGrepToolParams = { pattern: 'test' };
     const invocation = tool.build(params);
     await invocation.execute(abortSignal);

     // Assert: No --ignore-file flag when file is empty
     expect(mockSpawn).toHaveBeenCalledWith(
       expect.anything(),
       expect.not.arrayContaining(['--ignore-file']),
       expect.anything(),
     );
   });
   ```

   **D. Test: .llxprtignore with only comments**:
   ```typescript
   it('should not add --ignore-file flag when .llxprtignore only has comments', async () => {
     // Arrange: Create .llxprtignore with only comments
     await fs.writeFile(
       path.join(tempRootDir, '.llxprtignore'),
       '# This is a comment\n# Another comment\n',
     );
     
     const config = {
       getTargetDir: () => tempRootDir,
       getWorkspaceContext: () => createMockWorkspaceContext(tempRootDir),
       getDebugMode: () => false,
       getFileFilteringRespectLlxprtIgnore: () => true,
     } as unknown as Config;
     const tool = new RipGrepTool(config);

     mockSpawn.mockImplementationOnce(
       createMockSpawn({
         outputData: '',
         exitCode: 1,
       }),
     );

     // Act
     const params: RipGrepToolParams = { pattern: 'test' };
     const invocation = tool.build(params);
     await invocation.execute(abortSignal);

     // Assert: No --ignore-file flag when only comments
     expect(mockSpawn).toHaveBeenCalledWith(
       expect.anything(),
       expect.not.arrayContaining(['--ignore-file']),
       expect.anything(),
     );
   });
   ```

   **RUN TESTS**: `cd packages/core && npx vitest run src/tools/ripGrep.test.ts`
   **EXPECTED**: All new tests FAIL (RED phase) [OK]

### IMPLEMENTATION: Minimal Code to Pass Tests (GREEN Phase)

2. **Update ripGrep.ts** (packages/core/src/tools/ripGrep.ts):

   **A. Add import for FileDiscoveryService**:
   ```typescript
   import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
   ```

   **B. Add FileDiscoveryService field to RipGrepTool class**:
   ```typescript
   export class RipGrepTool extends BaseDeclarativeTool<
     RipGrepToolParams,
     ToolResult
   > {
     static readonly Name = 'search_file_content';
     private readonly fileDiscoveryService: FileDiscoveryService;  // ADD THIS

     constructor(
       private readonly config: Config,
       _messageBus?: MessageBus,
     ) {
       super(
         RipGrepTool.Name,
         // ... rest of constructor
       );
       this.fileDiscoveryService = new FileDiscoveryService(  // ADD THIS
         config.getTargetDir(),
       );
     }
   ```

   **C. Pass FileDiscoveryService to invocation**:
   ```typescript
   protected override createInvocation(
     params: RipGrepToolParams,
     _messageBus?: MessageBus,
   ): ToolInvocation<RipGrepToolParams, ToolResult> {
     return new GrepToolInvocation(
       this.config,
       this.fileDiscoveryService,  // ADD THIS
       params,
     );
   }
   ```

   **D. Update GrepToolInvocation constructor**:
   ```typescript
   class GrepToolInvocation extends BaseToolInvocation<
     RipGrepToolParams,
     ToolResult
   > {
     constructor(
       private readonly config: Config,
       private readonly fileDiscoveryService: FileDiscoveryService,  // ADD THIS
       params: RipGrepToolParams,
     ) {
       super(params);
     }
   ```

   **E. Add .llxprtignore to ripgrep args** (in performRipgrepSearch method, after excludes):
   ```typescript
   // After adding excludes via --glob (around line 343)
   excludes.forEach((exclude) => {
     rgArgs.push('--glob', `!${exclude}`);
   });

   // Add .llxprtignore support (ripgrep natively handles .gitignore)
   if (this.config.getFileFilteringRespectLlxprtIgnore()) {
     const llxprtIgnorePath = this.getLlxprtIgnorePath();
     if (llxprtIgnorePath) {
       rgArgs.push('--ignore-file', llxprtIgnorePath);
     }
   }

   rgArgs.push('--threads', '4');
   ```

   **F. Add helper method to get .llxprtignore path** (add to GrepToolInvocation class):
   ```typescript
   /**
    * Returns the path to .llxprtignore file if it exists and has patterns.
    * Only returns path if patterns are non-empty (excluding comments/blank lines).
    * 
    * NOTE: FileDiscoveryService.getLlxprtIgnorePatterns() already filters out
    * empty lines and comments, so we just check if array is non-empty.
    */
   private getLlxprtIgnorePath(): string | null {
     const patterns = this.fileDiscoveryService.getLlxprtIgnorePatterns();
     if (patterns.length === 0) {
       return null;
     }
     const ignoreFilePath = path.join(this.config.getTargetDir(), '.llxprtignore');
     // Check file exists before returning path (defensive check)
     return fs.existsSync(ignoreFilePath) ? ignoreFilePath : null;
   }
   ```

   **Note**: Need to add `import * as fs from 'fs';` at top of file if not already present.

   **RUN TESTS AGAIN**: `cd packages/core && npx vitest run src/tools/ripGrep.test.ts`
   **EXPECTED**: All new tests PASS (GREEN phase)

### REFACTOR Phase (Optional)

3. **Review and refactor** only if it adds clear value:
   - Extract duplicate test setup into helper functions
   - Simplify getLlxprtIgnorePath() if possible
   - Add JSDoc comments if behavior is unclear

### INTEGRATION TEST UPDATE

4. **Update integration test** (integration-tests/ripgrep-real.test.ts):

   **A. Update MockConfig**:
   ```typescript
   class MockConfig {
     getDebugMode() {
       return true;
     }

     getFileFilteringRespectLlxprtIgnore() {  // ADD THIS (note: LLxprt branding)
       return true;
     }
   }
   ```

   **RUN INTEGRATION TESTS**: `npx vitest run integration-tests/ripgrep-real.test.ts`
   **EXPECTED**: All tests PASS

## Full Verification Sequence

**MANDATORY BEFORE COMMITTING** (per .llxprt/LLXPRT.md):

Run all commands from project root (`/Users/acoliver/projects/llxprt/branch-1/llxprt-code`):

### 1. Unit Tests (Targeted)
```bash
cd packages/core && npx vitest run src/tools/ripGrep.test.ts
```
**Expected**: All tests pass, including new .llxprtignore tests

### 2. Integration Tests (Targeted)
```bash
npx vitest run integration-tests/ripgrep-real.test.ts
```
**Expected**: All tests pass

### 3. Full Test Suite
```bash
npm run test
```
**Expected**: All tests pass across all packages

### 4. Type Checking
```bash
npm run typecheck
```
**Expected**: No type errors

### 5. Linting
```bash
npm run lint
```
**Expected**: No lint errors. If there are auto-fixable issues, they will be fixed automatically.

### 6. Formatting
```bash
npm run format
```
**Expected**: All files formatted. If changes are made, review and commit them.

### 7. Build
```bash
npm run build
```
**Expected**: Build succeeds without errors

### 8. Smoke Test (CLI loads successfully)
```bash
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```
**Expected**: CLI starts, loads profile, generates haiku, exits cleanly

### 9. Manual Verification (Behavioral Test)

Create a temporary test project to verify .llxprtignore behavior:

```bash
# Create test directory
mkdir -p /tmp/llxprt-ignore-test
cd /tmp/llxprt-ignore-test

# Create .llxprtignore with pattern
echo "*.log" > .llxprtignore

# Create test files
echo "secret data here" > test.log
echo "secret data here" > test.txt

# Run SearchText from llxprt-code CLI
# (adjust path as needed)
# Expected: Results include test.txt, exclude test.log
```

Verify:
- SearchText results include `test.txt` with "secret data here"
- SearchText results do NOT include `test.log`
- If `.llxprtignore` is deleted or `*.log` pattern is removed, `test.log` appears in results

### 10. Cleanup
```bash
rm -rf /tmp/llxprt-ignore-test
```

**All steps must pass before committing. Do not skip any step.**

## Implementation Notes

- **Reuses existing infrastructure**: `FileDiscoveryService` already handles `.llxprtignore` loading via `GitIgnoreParser`
- **No new parser needed**: Unlike upstream which created new `GeminiIgnoreParser`, LLxprt extends existing `GitIgnoreParser` with `extraPatterns`
- **Branding consistency**: Config method is `getFileFilteringRespectLlxprtIgnore()` (not Gemini)
- **Scope limitation**: Only root-level `.llxprtignore` supported (matches current architecture)
- **Performance optimization**: Uses ripgrep's native `--ignore-file` flag instead of filtering results post-search
