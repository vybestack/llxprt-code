# Implementation Plan for Upstream Commit 8ac2c684: Bundle a2a-server

## Summary of Upstream Changes

Upstream commit `8ac2c684` ("chore: bundle a2a-server (#10265)") modifies `esbuild.config.js` to add a2a-server bundling as a standalone executable alongside the main CLI bundle. The key changes are:

1. **Refactored esbuild config into a shared base config** - Extracted common settings (`bundle`, `platform`, `format`, `external`, `loader`, `write`) into a `baseConfig` object
2. **Created separate CLI config** (`cliConfig`) - Extended `baseConfig` with CLI-specific settings (banner, entry point, output, aliases, metafile, plugins)
3. **Created separate a2a-server config** (`a2aServerConfig`) - Extended `baseConfig` with a2a-server-specific settings (different banner pattern, entry point, output, plugins)
4. **Parallel build execution** - Uses `Promise.allSettled()` to run both builds in parallel, with error handling that allows CLI build failure to be fatal while a2a-server failures are only warnings

## Current State in LLxprt

### esbuild.config.js
- Located at `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/esbuild.config.js`
- Currently only builds the main CLI bundle (`bundle/llxprt.js`)
- Has additional features not in upstream:
  - `nodeModulePlugin` to redirect `module` imports to `node:module` (lines 27-34)
  - `conditions: ['production']` flag (line 46)
  - `minify: true` flag (line 79)
  - Sets executable permission on output (`fs.chmodSync('bundle/llxprt.js', 0o755)`) after build completes (line 84)
  - More external dependencies: keytar, UI packages (lines 48-62)
  - `process.env.NODE_ENV: '"production"'` in define block (line 72)
- Uses single `.build().then().catch()` pattern instead of `Promise.allSettled()` (lines 39-89)

### a2a-server Package
- Located at `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/packages/a2a-server/`
- Package name: `@vybestack/llxprt-code-a2a-server`
- Entry point for server: `packages/a2a-server/src/http/server.ts`
- Current build output: `packages/a2a-server/dist/` (TypeScript compilation, not bundled)
- The `server.ts` is designed to be run as a main module (has `isMainModule` check at lines 15-17)
- Does NOT import `module` anywhere in source code (verified via grep), so does NOT need nodeModulePlugin

## Review Feedback Addressed

### 1. Missing nodeModulePlugin for a2a-server - DECISION: NOT NEEDED
**Analysis**: The `nodeModulePlugin` in LLxprt's current config (lines 27-34) redirects bare `import 'module'` to `import 'node:module'`. After searching the a2a-server source code, there are NO imports of the bare `module` specifier - all imports use fully qualified node: prefixes (`node:url`, `node:path`, etc.). The upstream gemini-cli also does NOT use nodeModulePlugin for a2a-server bundling.

**Decision**: Do NOT add nodeModulePlugin to `a2aServerConfig`. It is not needed because:
- a2a-server source does not import bare `module`
- The banner already provides `require` via dynamic import
- Upstream confirms this pattern works without the plugin

### 2. Different banner pattern (async vs sync import) - EXPLANATION
**Why the banners differ**:
- **CLI banner** (line 75): Uses `import * as nodeModule from 'node:module'` - This is a **synchronous static import** that works at the top level of an ES module
- **a2a-server banner**: Uses `const require = (await import('module')).createRequire(import.meta.url)` - This is a **top-level await dynamic import**

**Reason for difference**: The CLI banner establishes `require`, `__filename`, and `__dirname` globals using a static import pattern that's safer for the main CLI entry point. The a2a-server uses top-level await with dynamic import, which is also valid in ESM but represents a slightly different initialization pattern. Both patterns achieve the same goal but upstream chose different approaches.

**LLxprt adaptation**: We will preserve our existing CLI banner pattern (`import * as nodeModule from 'node:module'...`) since it already works and matches our style. For a2a-server, we'll use the upstream async pattern exactly as shown.

### 3. chmod timing issue - CLARIFICATION
**Current behavior** (line 84): `fs.chmodSync('bundle/llxprt.js', 0o755)` runs in the `.then()` callback after build completes.

**New behavior with Promise.allSettled()**: The chmod must run INSIDE the CLI build's `.then()` handler, NOT after Promise.allSettled resolves. This ensures:
1. It runs immediately after CLI build succeeds
2. It runs even if a2a-server build fails (since we use allSettled)
3. The file exists before we try to chmod it

**Implementation**:
```javascript
esbuild.build(cliConfig).then((result) => {
  fs.chmodSync('bundle/llxprt.js', 0o755);
  if (process.env.DEV === 'true' && result.metafile) {
    writeFileSync('./bundle/esbuild.json', JSON.stringify(result.metafile, null, 2));
  }
  return result;
})
```

**Error handling**: If chmod fails, the promise will reject and be caught by the allSettled handler, which will exit with code 1 for CLI failures. This is correct behavior.

### 4. Missing chmod for a2a-server bundle - DECISION: NOT REQUIRED FOR NOW
**Analysis**:
- Upstream does NOT set executable permissions on `a2a-server.mjs`
- The file has `.mjs` extension, not a shebang-based executable
- Typically run via `node packages/a2a-server/dist/a2a-server.mjs`, not as a direct executable
- LLxprt's acceptance criteria in original plan said "a2a-server bundle is executable" but this was incorrect

**Decision**: Do NOT add chmod for a2a-server.mjs. Remove the "a2a-server bundle is executable" item from acceptance criteria and replace with "a2a-server bundle can be run via node command".

**Future consideration**: If users need `./a2a-server.mjs` to work directly, we can add:
- Shebang: `#!/usr/bin/env node` in banner
- chmod after build: `fs.chmodSync('packages/a2a-server/dist/a2a-server.mjs', 0o755)`

### 5. Missing metafile specification for a2a-server - DECISION: NOT NEEDED
**Analysis**:
- Upstream includes `metafile: true` only for CLI config (for bundle analysis)
- a2a-server config has NO metafile specification
- The metafile is used in CLI build to write `bundle/esbuild.json` for DEV mode analysis
- a2a-server is a secondary build, doesn't need bundle analysis

**Decision**: Do NOT add `metafile: true` to `a2aServerConfig`. This matches upstream and avoids unnecessary overhead.

### 6. Incomplete error handling for Promise.allSettled - COMPLETE SPECIFICATION

**Current implementation** (lines 82-89): Simple `.then().catch()` with error logging and exit.

**New implementation**: Promise.allSettled handles both builds with proper error differentiation:

```javascript
Promise.allSettled([
  esbuild.build(cliConfig).then((result) => {
    fs.chmodSync('bundle/llxprt.js', 0o755);
    if (process.env.DEV === 'true' && result.metafile) {
      writeFileSync('./bundle/esbuild.json', JSON.stringify(result.metafile, null, 2));
    }
    return result;
  }),
  esbuild.build(a2aServerConfig),
]).then((results) => {
  const [cliResult, a2aResult] = results;

  // CLI build failure is FATAL - exit immediately
  if (cliResult.status === 'rejected') {
    console.error('llxprt.js build failed:', cliResult.reason);
    process.exit(1);
  }

  // a2a-server build failure is WARNING ONLY - do not exit
  if (a2aResult.status === 'rejected') {
    console.warn('a2a-server build failed:', a2aResult.reason);
  }

  // Both succeeded or a2a failed non-fatally - success
  // Note: we do NOT add a .catch() because Promise.allSettled NEVER rejects
});
```

**Error handling behavior**:
1. If CLI build fails → Error logged, process exits with code 1
2. If a2a-server build fails → Warning logged, process continues (exit 0)
3. If both fail → CLI error logged, process exits with code 1
4. No `.catch()` needed because `Promise.allSettled` never rejects
5. chmod failure in CLI .then() → Promise rejects → Caught by allSettled → CLI failure path

## Detailed Implementation Steps

### Step 1: Import writeFileSync at top of file

**Location**: After line 10 (after existing imports)

**Add**:
```javascript
import { writeFileSync } from 'node:fs';
```

### Step 2: Create shared base config object

**Location**: Replace lines 39-81 (the current single build config)

**Action**: Extract common settings into `baseConfig`:

```javascript
const baseConfig = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  conditions: ['production'],  // LLxprt-specific: keep this
  external: [
    '@lydell/node-pty',
    'node-pty',
    '@lydell/node-pty-darwin-arm64',
    '@lydell/node-pty-darwin-x64',
    '@lydell/node-pty-linux-x64',
    '@lydell/node-pty-win32-arm64',
    '@lydell/node-pty-win32-x64',
    'keytar',
    'node:module',
    // UI package uses opentui which has Bun-specific imports that esbuild can't handle
    // Keep it external - it will be dynamically imported at runtime when --experimental-ui is used
    '@vybestack/llxprt-ui',
    '@vybestack/opentui-core',
    '@vybestack/opentui-react',
  ],
  loader: { '.node': 'file' },
  write: true,
};
```

### Step 3: Create CLI-specific config object

**Location**: Immediately after `baseConfig`

**Add**:
```javascript
const cliConfig = {
  ...baseConfig,
  entryPoints: ['packages/cli/index.ts'],
  outfile: 'bundle/llxprt.js',  // LLxprt branding
  plugins: [nodeModulePlugin],  // LLxprt-specific: redirects bare 'module' imports
  alias: {
    'is-in-ci': path.resolve(__dirname, 'packages/cli/src/patches/is-in-ci.ts'),
  },
  define: {
    'process.env.CLI_VERSION': JSON.stringify(pkg.version),
    'process.env.NODE_ENV': '"production"',  // LLxprt-specific: production mode
  },
  banner: {
    js: `import * as nodeModule from 'node:module'; const require = nodeModule.createRequire(import.meta.url); globalThis.__filename = require('url').fileURLToPath(import.meta.url); globalThis.__dirname = require('path').dirname(globalThis.__filename);`,
  },
  metafile: true,  // For bundle analysis in DEV mode
  minify: true,    // LLxprt-specific: minification
};
```

### Step 4: Create a2a-server-specific config object

**Location**: Immediately after `cliConfig`

**Add**:
```javascript
const a2aServerConfig = {
  ...baseConfig,
  entryPoints: ['packages/a2a-server/src/http/server.ts'],
  outfile: 'packages/a2a-server/dist/a2a-server.mjs',
  // NO nodeModulePlugin - a2a-server doesn't import bare 'module'
  // NO metafile - not needed for secondary build
  banner: {
    // Different banner pattern - uses top-level await with dynamic import
    js: `const require = (await import('module')).createRequire(import.meta.url); globalThis.__filename = require('url').fileURLToPath(import.meta.url); globalThis.__dirname = require('path').dirname(globalThis.__filename);`,
  },
  define: {
    'process.env.CLI_VERSION': JSON.stringify(pkg.version),
    'process.env.NODE_ENV': '"production"',
  },
  minify: true,  // LLxprt-specific: minification
};
```

### Step 5: Replace single build with Promise.allSettled() parallel builds

**Location**: Replace lines 82-89 (current `.build().then().catch()` chain)

**Replace with**:
```javascript
Promise.allSettled([
  esbuild.build(cliConfig).then((result) => {
    // chmod must run INSIDE the CLI build's .then() handler
    // This ensures it runs after build completes but before allSettled resolution
    fs.chmodSync('bundle/llxprt.js', 0o755);

    // Write metafile for bundle analysis in DEV mode
    if (process.env.DEV === 'true' && result.metafile) {
      writeFileSync('./bundle/esbuild.json', JSON.stringify(result.metafile, null, 2));
    }

    return result;
  }),
  esbuild.build(a2aServerConfig),
]).then((results) => {
  const [cliResult, a2aResult] = results;

  // CLI build failure is FATAL - must exit
  if (cliResult.status === 'rejected') {
    console.error('llxprt.js build failed:', cliResult.reason);
    process.exit(1);
  }

  // a2a-server build failure is NON-FATAL - warn only
  // This allows CLI bundle to succeed even if a2a-server fails
  if (a2aResult.status === 'rejected') {
    console.warn('a2a-server build failed:', a2aResult.reason);
  }

  // No .catch() needed - Promise.allSettled never rejects
});
```

## Complete File Structure

After changes, `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/esbuild.config.js` will have this structure:

```
Lines 1-10:   License header and imports (existing)
Line 11:      NEW: import { writeFileSync } from 'node:fs';
Lines 12-25:  Setup code (__filename, __dirname, pkg, esbuild import) (existing)
Lines 27-34:  nodeModulePlugin definition (existing, unchanged)
Lines 36-38:  Comment header (existing or new)
Lines 40-59:  NEW: baseConfig object
Lines 61-77:  NEW: cliConfig object
Lines 79-92:  NEW: a2aServerConfig object
Lines 94-115: NEW: Promise.allSettled() with dual builds
```

## Files to Modify

| File | Location | Action | Lines Modified |
|------|----------|--------|----------------|
| `esbuild.config.js` | `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/esbuild.config.js` | **Modify** | Add import at line 11, replace lines 39-89 with new config structure |

## Test/Verification Steps

Execute these commands in order from `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/`:

### 1. Clean previous builds
```bash
rm -f bundle/llxprt.js
rm -f packages/a2a-server/dist/a2a-server.mjs
```

### 2. Run the bundle command
```bash
npm run bundle
```

**Expected output**:
- No errors for CLI build
- Warning message if a2a-server build fails (non-fatal)
- Exit code 0 (unless CLI build fails)

### 3. Verify both outputs exist
```bash
ls -la bundle/llxprt.js
ls -la packages/a2a-server/dist/a2a-server.mjs
```

**Expected results**:
- `bundle/llxprt.js` exists with executable permissions (755)
- `packages/a2a-server/dist/a2a-server.mjs` exists (permissions don't matter)

### 4. Test CLI bundle functionality
```bash
node bundle/llxprt.js --version
```

**Expected output**: Version number printed (e.g., "0.6.1")

### 5. Test a2a-server bundle functionality
```bash
node packages/a2a-server/dist/a2a-server.mjs --help 2>&1 | head -5
```

**Expected output**: Server starts or shows help (depends on implementation)

### 6. Test DEV mode metafile generation
```bash
DEV=true npm run bundle
ls -la bundle/esbuild.json
```

**Expected result**: `bundle/esbuild.json` exists and contains bundle analysis JSON

### 7. Run lint and typecheck
```bash
npm run lint
npm run typecheck
```

**Expected result**: No errors (esbuild.config.js is JavaScript, won't be type-checked)

### 8. Test error handling - CLI failure
```bash
# Temporarily break CLI config to test error handling
# (Manual test - modify entryPoints to invalid path, run bundle, verify exit 1)
```

### 9. Test error handling - a2a-server failure
```bash
# Temporarily break a2a-server config to test non-fatal warning
# (Manual test - modify entryPoints to invalid path, run bundle, verify exit 0 with warning)
```

## Acceptance Criteria

- [ ] `bundle/llxprt.js` is generated and functional
- [ ] `bundle/llxprt.js` has executable permissions (755)
- [ ] `packages/a2a-server/dist/a2a-server.mjs` exists after `npm run bundle`
- [ ] a2a-server bundle can be run via `node packages/a2a-server/dist/a2a-server.mjs`
- [ ] Non-blocking build: a2a-server build failure produces warning but does not prevent CLI build or cause exit code 1
- [ ] Blocking build: CLI build failure produces error and causes exit code 1
- [ ] LLxprt branding preserved (`llxprt.js` not `gemini.js`)
- [ ] LLxprt-specific features preserved:
  - [ ] `nodeModulePlugin` in CLI config
  - [ ] `conditions: ['production']` in base config
  - [ ] `minify: true` in both configs
  - [ ] `process.env.NODE_ENV: '"production"'` in define blocks
  - [ ] `keytar` and UI packages in external list
- [ ] DEV mode metafile generation works (`DEV=true npm run bundle` creates `bundle/esbuild.json`)
- [ ] chmod runs immediately after CLI build, inside the build's .then() handler
- [ ] Both builds run in parallel via Promise.allSettled()
- [ ] No lint errors
- [ ] No typecheck errors

## Implementation Notes

1. **Order matters**: The chmod must be inside the CLI build's `.then()`, not after `Promise.allSettled()` resolves
2. **No .catch() needed**: `Promise.allSettled()` never rejects, so no catch handler is needed
3. **Plugin differences**: CLI needs nodeModulePlugin (redirects bare 'module' imports), a2a-server does not
4. **Banner patterns**: Different but both valid - CLI uses sync import, a2a-server uses async import
5. **Exit behavior**: Only CLI build failures are fatal; a2a-server failures are warnings
6. **Metafile**: Only CLI config includes `metafile: true` for bundle analysis
7. **Permissions**: Only CLI bundle gets chmod to 755; a2a-server stays as-is
8. **External deps**: Keep all LLxprt-specific externals (keytar, UI packages) in the shared baseConfig

## Risk Assessment

**Low Risk**: This is a straightforward refactoring that:
- Preserves all existing CLI functionality
- Adds parallel a2a-server bundling without affecting CLI
- Uses battle-tested `Promise.allSettled()` pattern from upstream
- Maintains all LLxprt-specific customizations
- Has comprehensive error handling

**Testing is key**: The error handling paths (CLI failure, a2a-server failure) should be manually tested to verify exit codes and warning messages.
