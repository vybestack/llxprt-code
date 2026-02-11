# Reimplementation Plan: Extension Command Handler Tests + Test Refactoring

**Upstream SHA**: `638dd2f6c`
**Upstream subject**: Improve test code coverage for cli/command/extensions package (#12994)
**Also covers**: LLxprt-originated test quality improvement (inspired by upstream 1d1bdc57c `it.each` patterns)

## Why Different from Upstream

Upstream tests `ExtensionManager` class methods. LLxprt uses standalone functions (`disableExtension()`, `enableExtension()`, etc.) from `packages/cli/src/config/extension.ts`. Tests must target LLxprt's actual architecture.

## Current State

Existing test files in `packages/cli/src/commands/extensions/`:
- `install.test.ts` — 173 lines (exists, uses source-type pattern suitable for `it.each`)
- `new.test.ts` — 73 lines (exists)
- `uninstall.test.ts` — 21 lines (minimal success-only test)
- `validate.test.ts` — 124 lines (exists, scenario-rich with filesystem mutations—only name validation subset suitable for `it.each`)
- **MISSING**: `disable.test.ts`, `enable.test.ts`, `link.test.ts`, `list.test.ts`

## Actual Handler Signatures

```typescript
// disable.ts
export async function handleDisable(args: { name: string; scope?: string })

// enable.ts
export async function handleEnable(args: { name: string; scope?: string })

// link.ts
export async function handleLink(args: { path: string })

// list.ts
export async function handleList()

// uninstall.ts
export async function handleUninstall(args: { name: string })
```

## Files to Create

### 1. `packages/cli/src/commands/extensions/disable.test.ts` (NEW)

**Handler signature**: `handleDisable({ name, scope? })`  
**Mock path**: `../../config/extension.js`  
**Key behavior**: `disableExtension()` is **synchronous** (called inside async wrapper)

**Tests required**:
1. **Scope defaulting**: Without `scope` arg → defaults to `SettingScope.User`
2. **Workspace scope**: With `scope: 'workspace'` → calls with `SettingScope.Workspace`
3. **Success message**: Logs `Extension "{name}" successfully disabled for scope "{scope}".`
4. **FatalConfigError wrapping**: Any error from `disableExtension()` wrapped in `FatalConfigError`
5. **Invalid scope validation**: Test yargs `.check()` rejects invalid scope values (not user/workspace)

**Mock pattern**:
```typescript
const mockDisableExtension = vi.fn();
vi.mock('../../config/extension.js', () => ({
  disableExtension: mockDisableExtension,
}));
```

**Critical assertions**:
- Verify `disableExtension(args.name, SettingScope.User)` when no scope provided
- Verify error wrapped in `FatalConfigError`
- Verify yargs validation throws on invalid scope

---

### 2. `packages/cli/src/commands/extensions/enable.test.ts` (NEW)

**Handler signature**: `handleEnable({ name, scope? })`  
**Mock path**: `../../config/extension.js`  
**Key behavior**: `enableExtension()` is **async**

**CRITICAL LOGGING BRANCH**:
- **With scope**: logs `Extension "{name}" successfully enabled for scope "{scope}".`
- **Without scope**: logs `Extension "{name}" successfully enabled in all scopes.`
  - NOTE: Despite help text saying "all scopes", code actually only calls `enableExtension(name, SettingScope.User)` when no scope provided

**Tests required**:
1. **No scope arg → User scope**: Verify `enableExtension(name, SettingScope.User)` called and "all scopes" message
2. **Workspace scope**: Verify `enableExtension(name, SettingScope.Workspace)` called with scope message
3. **FatalConfigError wrapping**: Any error from `enableExtension()` wrapped in `FatalConfigError`
4. **Invalid scope validation**: Test yargs `.check()` rejects invalid scope values

**Mock pattern**:
```typescript
const mockEnableExtension = vi.fn().mockResolvedValue(undefined);
vi.mock('../../config/extension.js', () => ({
  enableExtension: mockEnableExtension,
}));
```

**Critical assertions**:
- Assert correct console.log message branch (with vs without scope)
- Verify FatalConfigError wrapping on error

---

### 3. `packages/cli/src/commands/extensions/link.test.ts` (NEW)

**Handler signature**: `handleLink({ path })`  
**Mock path**: `../../config/extension.js`  
**Key behavior**: Handler passes `requestConsentNonInteractive` to `installOrUpdateExtension`

**Tests required**:
1. **Success path with extension found**: 
   - Metadata: `{ source: args.path, type: 'link' }`
   - Second arg: `requestConsentNonInteractive`
   - Third arg: `process.cwd()`
   - `loadExtensionByName` returns extension object
   - Logs: `Extension "{extension.name}" linked successfully and enabled.`

2. **Success with fallback name**:
   - If `loadExtensionByName` returns `null`, use returned `extensionName` from `installOrUpdateExtension`
   - Logs: `Extension "{extensionName}" linked successfully and enabled.`

3. **Error handling**:
   - Any error → `console.error(getErrorMessage(error))` + `process.exit(1)`
   - **NOT thrown as exception**

**Mock pattern**:
```typescript
const mockInstallOrUpdateExtension = vi.fn().mockResolvedValue('extension-name');
const mockLoadExtensionByName = vi.fn().mockReturnValue({ name: 'extension-name' });
const mockRequestConsentNonInteractive = vi.fn();

vi.mock('../../config/extension.js', () => ({
  installOrUpdateExtension: mockInstallOrUpdateExtension,
  loadExtensionByName: mockLoadExtensionByName,
  requestConsentNonInteractive: mockRequestConsentNonInteractive,
}));
```

**Critical assertions**:
- Verify `installOrUpdateExtension(metadata, requestConsentNonInteractive, process.cwd())` called
- Verify metadata: `{ source: args.path, type: 'link' }`
- Verify fallback name used when `loadExtensionByName` returns nullish
- Verify error path: `console.error` + `process.exit(1)` (NOT throw)

---

### 4. `packages/cli/src/commands/extensions/list.test.ts` (NEW)

**Handler signature**: `handleList()` (no args)  
**Mock path**: `../../config/extension.js`  
**Key behavior**: Calls `toOutputString(extension, process.cwd())` per extension

**Tests required**:
1. **Empty list**: 
   - `loadUserExtensions()` returns `[]`
   - Logs: `No extensions installed.`

2. **Non-empty list**:
   - `loadUserExtensions()` returns array of extensions
   - Calls `toOutputString(extension, process.cwd())` for each extension
   - Joins output with `

`

3. **Error handling**:
   - Any error → `console.error(getErrorMessage(error))` + `process.exit(1)`

**Mock pattern**:
```typescript
const mockLoadUserExtensions = vi.fn().mockReturnValue([]);
const mockToOutputString = vi.fn().mockReturnValue('Extension output');

vi.mock('../../config/extension.js', () => ({
  loadUserExtensions: mockLoadUserExtensions,
  toOutputString: mockToOutputString,
}));
```

**Critical assertions**:
- Verify `toOutputString(extension, process.cwd())` called per extension
- Verify empty list message
- Verify join with `

` for multiple extensions
- **NOTE**: `it.each` has low value here—only 2 main scenarios (empty vs non-empty)

---

## Files to Modify

### 5. `packages/cli/src/commands/extensions/uninstall.test.ts` (EXPAND)

**Current state**: 21 lines, single happy-path test  
**Handler signature**: `handleUninstall({ name })`  
**Actual behavior**: 
- Success: calls `uninstallExtension(name, false)`, logs success
- Failure: logs `error.message`, calls `process.exit(1)`

**Tests to add**:
1. **Success path**: Verify `uninstallExtension(args.name, false)` called with success log
2. **Extension not found**: Error logged, `process.exit(1)` called
3. **Permission denied**: Error logged, `process.exit(1)` called

**No `it.each` needed**: Only 3 distinct scenarios, error cases have same structure

---

### 6. `packages/cli/src/commands/extensions/install.test.ts` (REFACTOR)

**Current pattern**: Repeated source-type success cases (http, https, git, sso, local)  
**Good fit for `it.each`**: Convert source-type success tests to table

**Refactor approach**:
```typescript
it.each([
  { source: 'http://google.com', name: 'http-extension', type: 'http source' },
  { source: 'https://google.com', name: 'https-extension', type: 'https source' },
  { source: 'git@some-url', name: 'git-extension', type: 'git source' },
  { source: 'sso://google.com', name: 'sso-extension', type: 'sso source' },
  { source: '/some/path', name: 'local-extension', type: 'local path', needsStat: true },
])('should install an extension from a $type', async ({ source, name, needsStat }) => {
  if (needsStat) {
    mockStat.mockResolvedValue({} as Stats);
  }
  mockInstallOrUpdateExtension.mockResolvedValue(name);
  mockLoadExtensionByName.mockReturnValue({ name } as unknown as GeminiCLIExtension);
  
  await handleInstall({ source });
  
  expect(consoleLogSpy).toHaveBeenCalledWith(
    `Extension "${name}" installed successfully and enabled.`,
  );
});
```

**Keep separate**: 
- stat ENOENT test (distinct error path)
- install rejection test (distinct error path)
- yargs validation test

---

### 7. `packages/cli/src/commands/extensions/validate.test.ts` (SELECTIVE REFACTOR)

**Current state**: 124 lines, scenario-rich with filesystem mutations  
**NOT a full `it.each` candidate**: Tests involve creating temp dirs, writing files, complex validations

**Only refactor**: Invalid name validation subset

**Refactor approach**:
```typescript
it.each([
  { name: 'INVALID_NAME', error: 'Invalid extension name: "INVALID_NAME". Only letters (a-z, A-Z), numbers (0-9), and dashes (-) are allowed.' },
  { name: 'invalid name!', error: 'Invalid extension name: "invalid name!". Only letters' },
  { name: 'invalid@name', error: 'Invalid extension name: "invalid@name". Only letters' },
  { name: '', error: 'Invalid extension name: "". Only letters' },
])('should throw an error if the extension name is invalid: $name', async ({ name, error }) => {
  createExtension({
    extensionsDir: tempWorkspaceDir,
    name,
    version: '1.0.0',
  });

  await handleValidate({ path: name });
  
  expect(debugLoggerErrorSpy).toHaveBeenCalledWith(
    expect.stringContaining(error),
  );
  expect(processSpy).toHaveBeenCalledWith(1);
});
```

**Keep separate**: 
- Valid extension test (success path)
- Version format warning test (warning branch)
- Missing context files test (filesystem validation)

---

## Test Pattern to Follow

### Mock Pattern for Standalone Functions

```typescript
vi.mock('../../config/extension.js', () => ({
  disableExtension: vi.fn(),
  enableExtension: vi.fn(),
  loadUserExtensions: vi.fn().mockReturnValue([]),
  toOutputString: vi.fn(),
  installOrUpdateExtension: vi.fn(),
  loadExtensionByName: vi.fn(),
  requestConsentNonInteractive: vi.fn(),
  uninstallExtension: vi.fn(),
}));
```

### Error Handling Pattern

Most handlers use `console.error` + `process.exit(1)` (NOT throw):
```typescript
try {
  // ... operation
} catch (error) {
  console.error(getErrorMessage(error));
  process.exit(1);
}
```

**Exception**: `disable.ts` and `enable.ts` throw `FatalConfigError`

### Spy Setup Pattern

```typescript
let consoleLogSpy: MockInstance;
let consoleErrorSpy: MockInstance;
let processSpy: MockInstance;

beforeEach(() => {
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  processSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});

afterEach(() => {
  vi.clearAllMocks();
});
```

## Verification
- `npm run test -- --filter extensions`
- `npm run lint && npm run typecheck`
- All new tests pass, no existing tests broken
