# REIMPLEMENT Playbook: 4cfbe4c — Homebrew detection

## Upstream Change Summary

Upstream improved Homebrew installation detection to avoid false positives:

1. **Changed detection method**: From `brew list | grep` to `brew --prefix <package>`
2. **Added path verification**: Compares actual CLI path with Homebrew's resolved path
3. **Prevents false positives**: CLI installed via npm won't be detected as Homebrew if brew list shows the package

<!-- UPSTREAM ORIGINAL — do not copy these identifiers into LLxprt code -->
**Old approach** (upstream, gemini-cli identifiers — reference only):
```typescript
// childProcess.execSync('brew list | grep -q "^gemini-cli$"', { stdio: 'ignore' });
```

**New approach** (upstream, gemini-cli identifiers — reference only):
```typescript
// const brewPrefix = childProcess.execSync('brew --prefix gemini-cli', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
// const brewRealPath = fs.realpathSync(brewPrefix);
// if (realPath.startsWith(brewRealPath)) {
//   return { packageManager: PackageManager.HOMEBREW, ... };
// }
```
<!-- END UPSTREAM ORIGINAL -->

## Gap

Current code returns `HOMEBREW` if the package exists in `brew list`, but does **not** verify that the resolved CLI path is under the Homebrew prefix. This causes false positives for npm installs: if `llxprt-code` was previously installed via Homebrew and later replaced by an npm install, the old brew entry in `brew list` still triggers the Homebrew branch.

The upstream fix addresses this by comparing `realpathSync(process.argv[1])` against `realpathSync(brew --prefix llxprt-code)` — Homebrew is only detected when the running binary lives inside the Homebrew prefix.

## LLxprt Current State

**File**: `packages/cli/src/utils/installationInfo.ts`

LLxprt's Homebrew detection uses the OLD approach:
```typescript
// The package name in homebrew is llxprt-code
childProcess.execSync('brew list -1 | grep -q "^llxprt-code$"', {
  stdio: 'ignore',
});
```

Package name is already correct: `llxprt-code` (not `gemini-cli`)

Tap: `vybestack/homebrew-tap`

## Adaptation Plan

### File-by-File Changes

#### 1. `packages/cli/src/utils/installationInfo.ts`

Replace the Homebrew detection logic:

```typescript
// Check for Homebrew
if (process.platform === 'darwin') {
  try {
    const brewPrefix = childProcess
      .execSync('brew --prefix llxprt-code', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      .trim();
    const brewRealPath = fs.realpathSync(brewPrefix);

    if (realPath.startsWith(brewRealPath)) {
      const updateCommand = 'brew upgrade llxprt-code';
      return {
        packageManager: PackageManager.HOMEBREW,
        isGlobal: true,
        updateCommand,
        updateMessage: isAutoUpdateDisabled
          ? `Please run "${updateCommand}" to update`
          : `Installed via Homebrew. Attempting to automatically update via "${updateCommand}"...`,
      };
    }
  } catch (_error) {
    // Brew is not installed or llxprt-code is not installed via brew.
    // Continue to the next check.
  }

  // ... rest of the checks
}
```

**Key changes**:
1. Use `brew --prefix llxprt-code` instead of `brew list | grep`
2. Verify the CLI is actually running from the Homebrew path
3. Package name stays `llxprt-code`

#### 2. `packages/cli/src/utils/installationInfo.test.ts`

**Test migration notes**:
- All existing `brew list` mock expectations must be replaced with `expect.stringContaining('brew --prefix llxprt-code')`
- `execSync` mocks must return a **string** (not void/Buffer) because the new code uses `{ encoding: 'utf8' }` — adjust mock return types accordingly
- All test paths must use `llxprt-code` and `@vybestack/llxprt-code` identifiers; remove any leftover `gemini-cli` or `google` paths
- The false positive test path for npm should be `/usr/local/lib/node_modules/@vybestack/llxprt-code/dist/index.js`

Update mock implementations:
   ```typescript
   mockedExecSync.mockImplementation((cmd) => {
     if (typeof cmd === 'string' && cmd.includes('brew --prefix llxprt-code')) {
       return '/opt/homebrew/opt/llxprt-code';  // string because encoding: 'utf8'
     }
     throw new Error(`Command failed: ${cmd}`);
   });

   mockedRealPathSync.mockImplementation((p) => {
     if (p === cliPath) return cliPath;
     if (p === '/opt/homebrew/opt/llxprt-code') {
       return '/opt/homebrew/Cellar/llxprt-code/1.0.0';
     }
     return String(p);
   });
   ```

Add test for false positive prevention:
   ```typescript
   it('should NOT detect Homebrew if llxprt-code is installed in brew but running from npm location', () => {
     // Path looks like standard global NPM
     const cliPath = '/usr/local/lib/node_modules/@vybestack/llxprt-code/dist/index.js';
     process.argv[1] = cliPath;

     // Brew prefix succeeds but path doesn't match
     mockedExecSync.mockImplementation((cmd) => {
       if (typeof cmd === 'string' && cmd.includes('brew --prefix llxprt-code')) {
         return '/opt/homebrew/opt/llxprt-code';
       }
       throw new Error(`Command failed: ${cmd}`);
     });

     const info = getInstallationInfo(projectRoot, false);

     expect(info.packageManager).not.toBe(PackageManager.HOMEBREW);
     expect(info.packageManager).toBe(PackageManager.NPM);
   });
   ```

## Files to Read

- `packages/cli/src/utils/installationInfo.ts`
- `packages/cli/src/utils/installationInfo.test.ts`

## Files to Modify

- `packages/cli/src/utils/installationInfo.ts`
- `packages/cli/src/utils/installationInfo.test.ts`

## Specific Verification

1. `npm run test`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run format`
5. `npm run build`
6. `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
7. Manual: Test on macOS with Homebrew installation
8. Manual: Test on macOS with npm installation (should NOT detect as Homebrew)
9. Verify update message uses `brew upgrade llxprt-code`

## LLxprt-Specific Details

- Package name: `llxprt-code`
- Tap: `vybestack/homebrew-tap`
- Update command: `brew upgrade llxprt-code`
