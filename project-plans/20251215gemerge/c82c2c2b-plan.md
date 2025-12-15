# Implementation Plan: c82c2c2b - A2A Server Bin Entry

## Summary of Upstream Changes

Upstream commit `c82c2c2b` ("chore: add a2a server bin (#10592)"):
- Adds `bin` entry to a2a-server package.json pointing to bundled executable
- Changes `main` field from `dist/server.js` to `dist/index.js`
- Adds `#!/usr/bin/env node` shebang to server.ts for CLI execution
- Refactors isMainModule detection to use `path.basename()` comparison
- Moves exception handler INSIDE the `if(isMainModule)` block

**CRITICAL DEPENDENCY:** This commit requires 8ac2c684 (bundle a2a-server) to be implemented first. The bundle process creates `packages/a2a-server/dist/a2a-server.mjs` which is referenced by the bin entry.

**Status:** This plan is executable WHEN 8ac2c684 is completed. Implementation should be blocked until that dependency is satisfied.

## Current State Analysis

### Current LLxprt Files

**packages/a2a-server/package.json:**
- `main`: `"dist/server.js"` (needs update to `dist/index.js`)
- No `bin` field (needs addition)

**packages/a2a-server/src/http/server.ts:**
- Missing shebang line
- Uses `path.resolve()` for isMainModule detection (needs basename() approach)
- Exception handler is OUTSIDE the if(isMainModule) block (needs to move inside)

## Implementation Steps

### Step 1: Update packages/a2a-server/package.json

**Change the `main` field:**
```json
"main": "dist/index.js"
```

**Rationale:** Upstream changed from `dist/server.js` to `dist/index.js` as the package entry point. This makes the package structure more conventional.

**Add the `bin` field:**
```json
"bin": {
  "llxprt-code-a2a-server": "dist/a2a-server.mjs"
}
```

**IMPORTANT:** Rename from upstream's `gemini-cli-a2a-server` to `llxprt-code-a2a-server` to match LLxprt naming conventions.

**Note:** The `dist/a2a-server.mjs` file is created by the bundle process from commit 8ac2c684.

### Step 2: Update packages/a2a-server/src/http/server.ts

**Add shebang at the very top (line 1, before license comment):**
```typescript
#!/usr/bin/env node
```

**Replace the current isMainModule detection logic:**

Current (lines 15-17):
```typescript
const isMainModule =
  path.resolve(process.argv[1]) ===
  path.resolve(url.fileURLToPath(import.meta.url));
```

New:
```typescript
// Check if the module is the main script being run
const isMainModule =
  path.basename(process.argv[1]) ===
  path.basename(url.fileURLToPath(import.meta.url));
```

**Rationale:** Using `path.basename()` compares just the filename portion rather than full paths. This is upstream's approach and matches the bundled executable's structure where the entry point filename may differ from the source file's full path.

**Move the exception handler inside the if(isMainModule) block:**

Current structure (lines 19-32):
```typescript
process.on('uncaughtException', (error) => {
  logger.error('Unhandled exception:', error);
  process.exit(1);
});

if (
  import.meta.url.startsWith('file:') &&
  isMainModule &&
  process.env['NODE_ENV'] !== 'test'
) {
  main().catch((error) => {
    logger.error('[CoreAgent] Unhandled error in main:', error);
    process.exit(1);
  });
}
```

New structure:
```typescript
if (
  import.meta.url.startsWith('file:') &&
  isMainModule &&
  process.env['NODE_ENV'] !== 'test'
) {
  process.on('uncaughtException', (error) => {
    logger.error('Unhandled exception:', error);
    process.exit(1);
  });

  main().catch((error) => {
    logger.error('[CoreAgent] Unhandled error in main:', error);
    process.exit(1);
  });
}
```

**Rationale:** The exception handler should only be registered when the file is being run as the main module. This prevents side effects when the file is imported by other modules or tests.

### Step 3: Verify Bundle Exists

Before testing, verify the dependency is met:

```bash
ls -lh packages/a2a-server/dist/a2a-server.mjs
```

**Expected:** File should exist and be several hundred KB (bundled server code).

**If missing:** Implement commit 8ac2c684 first (bundle a2a-server). Do not proceed with testing until this dependency is satisfied.

### Step 4: Build and Test

```bash
npm run build
npm run bundle
```

**Expected build output:**
- No TypeScript errors
- Bundle process completes successfully
- File `packages/a2a-server/dist/a2a-server.mjs` is regenerated

### Step 5: Functional Verification

**Test 1: Direct execution of bundled file**
```bash
node packages/a2a-server/dist/a2a-server.mjs &
SERVER_PID=$!
sleep 2
ps -p $SERVER_PID
kill $SERVER_PID
```

**Expected behavior:**
- Server starts without errors
- Process runs in background
- `ps` confirms process is running
- Server logs indicate successful startup (check ~/.llxprt/debug/)

**Test 2: No import side effects**
```bash
node --loader ts-node/esm -e "import('./packages/a2a-server/dist/src/http/server.js').then(() => console.log('Import successful'))"
```

**Expected behavior:**
- Import completes successfully
- Server does NOT start
- No "Unhandled exception" handler registered
- Only prints "Import successful"

**Note:** Test uses the compiled `.js` file from `dist/`, not the `.ts` source. The TypeScript source cannot be dynamically imported without a TypeScript loader.

**Test 3: Verify package.json main field**
```bash
node -e "import('./packages/a2a-server/dist/index.js').then(() => console.log('Package import successful'))"
```

**Expected behavior:**
- Package imports via new `dist/index.js` entry point
- No errors about missing files

**Note:** Test uses file path syntax, not package name syntax. The package would need to be installed to node_modules to use package name imports.

## Files to Modify

| File | Lines | Change |
|------|-------|--------|
| `packages/a2a-server/package.json` | 12 | Change `main` from `"dist/server.js"` to `"dist/index.js"` |
| `packages/a2a-server/package.json` | After line 12 | Add `"bin": { "llxprt-code-a2a-server": "dist/a2a-server.mjs" }` |
| `packages/a2a-server/src/http/server.ts` | 1 (new) | Add `#!/usr/bin/env node` |
| `packages/a2a-server/src/http/server.ts` | 15-17 | Replace `path.resolve()` logic with `path.basename()` comparison |
| `packages/a2a-server/src/http/server.ts` | 19-32 | Move `process.on('uncaughtException')` inside `if(isMainModule)` block |

## Acceptance Criteria

- [ ] Dependency 8ac2c684 (bundle a2a-server) is completed and verified
- [ ] `packages/a2a-server/package.json` has `"main": "dist/index.js"`
- [ ] `packages/a2a-server/package.json` has `"bin": { "llxprt-code-a2a-server": "dist/a2a-server.mjs" }`
- [ ] Bin entry uses `llxprt-code-a2a-server` (not `gemini-cli-a2a-server`)
- [ ] `server.ts` starts with `#!/usr/bin/env node` shebang on line 1
- [ ] `isMainModule` uses `path.basename()` comparison, not `path.resolve()` or `.endsWith()`
- [ ] Exception handler is registered INSIDE the `if(isMainModule)` block
- [ ] Bundle produces `packages/a2a-server/dist/a2a-server.mjs`
- [ ] Running `node packages/a2a-server/dist/a2a-server.mjs` starts the server successfully
- [ ] Importing `server.js` from dist does NOT start the server or register exception handlers
- [ ] Package can be imported via `dist/index.js` entry point
- [ ] `npm run build && npm run bundle` completes without errors
- [ ] All three functional verification tests pass

## Risk Assessment

**Low Risk:** This is primarily configuration and conditional execution logic.

**Potential Issues:**
1. If `dist/index.js` doesn't exist, package imports will fail
2. If bundle (8ac2c684) not implemented, bin entry will point to non-existent file
3. Exception handler location matters for test isolation

**Mitigation:**
- Block implementation until 8ac2c684 is verified complete
- Check that `dist/index.js` exists after build
- Run comprehensive tests to ensure no import side effects

## Dependencies

**Blocked By:**
- 8ac2c684 (bundle a2a-server) - MUST be completed first

**Blocks:**
- None identified
