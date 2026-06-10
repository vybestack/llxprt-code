# Pseudocode: Storage Package Extraction

Plan ID: PLAN-20260609-ISSUE1590

## Interface Contracts

### Storage package public API

```typescript
interface StoragePackageExports {
  Storage: typeof import('./config/storage.js').Storage;
  SecureStore: typeof import('./secure-store/secure-store.js').SecureStore;
  ProviderKeyStorage: typeof import('./secure-store/provider-key-storage.js').ProviderKeyStorage;
  FileDiscoveryService: typeof import('./services/fileDiscoveryService.js').FileDiscoveryService;
  StandardFileSystemService: typeof import('./services/fileSystemService.js').StandardFileSystemService;
  ConversationFileWriter: typeof import('./conversation/ConversationFileWriter.js').ConversationFileWriter;
}
```

### Logger contract

```typescript
interface StorageLogger {
  debug(message: string | (() => string), context?: unknown): void;
  warn(message: string | (() => string), context?: unknown): void;
  error(message: string | (() => string), context?: unknown): void;
}
```

### Secure store constructor contract

```typescript
interface SecureStoreOptions {
  fallbackDir?: string;
  fallbackPolicy?: 'allow' | 'deny';
  keyringLoader?: () => Promise<KeyringAdapter | null>;
  logger?: StorageLogger;
}
```

### Test-only export contract

```typescript
// Available from '@vybestack/llxprt-code-storage/testing' only
// NOT in root barrel, NOT in core shims
interface TestingExports {
  resetConversationFileWriterForTesting(): void;
}
```

## Numbered Pseudocode

01: READ root package conventions from existing workspace packages.
02: CREATE `packages/storage` directory with root `index.ts`, `src/index.ts`, `package.json` (with literal exact export map JSON — see P01), and tsconfig.
03: ADD `packages/storage` to root workspaces. RUN `npm install` before any workspace script.
04: DECLARE storage dependencies: `env-paths`, `ignore`; optional dependency `@napi-rs/keyring`; dev dependencies `typescript: ^5.3.3`, `vitest: ^3.1.1`, `@types/node: ^24.2.1` (read exact versions from existing packages).
05: ADD `@vybestack/llxprt-code-storage` to `packages/core`, `packages/mcp`, `packages/providers`, `packages/cli`, and `packages/a2a-server` dependency metadata where direct imports are used.
05a: CREATE `packages/storage/src/testing.ts` as empty placeholder (populated in P04d). ADD `"./testing": "./dist/src/testing.js"` to storage export map. This is the Tier 3 test-only deep export.
06: COPY `Storage` implementation and tests from core config into storage package. Update test imports. (P02)
07: COPY `FileSystemService` implementation and tests from core services into storage package. Update test imports. (P02)
08: COPY `FileDiscoveryService` implementation and tests into storage package. Update test imports. (P02)
09: COPY `gitIgnoreParser` and `gitUtils` into storage package internal utilities. (P02)
10: UPDATE storage `FileDiscoveryService` imports to use local utility paths. (P02)
11: CREATE `StorageLogger` and `NullStorageLogger` in storage. (P01)
12: COPY `SecureStore` implementation and tests into storage package. (P03)
13: REMOVE core `DebugLogger` and `debugLogger` imports from storage `SecureStore`. Replace with `import { NullStorageLogger } from '../types/logger.js'`. (P03)
14: ADD optional `logger` to `SecureStoreOptions`. (P03)
15: SET `this.logger` to `options.logger ?? new NullStorageLogger()`. PROPAGATE to module-level `_moduleLogger` via private helper. (P03)
16: REPLACE default keyring loader warning with `_moduleLogger.warn(...)` using same `process.env.DEBUG` guard. If called before SecureStore construction, `_moduleLogger` is `NullStorageLogger` and warning is silently suppressed. (P03)
17: COPY `ProviderKeyStorage` implementation and tests into storage package. Update secure store import to `./secure-store.js`. (P03)
18: SPLIT `secure-store-integration.test.ts`: copy to storage, replace `maskKeyForDisplay` import with inline helper, remove core imports. (P03)
19: COPY `sessionTypes` into storage package. (P04)
20: COPY `ConversationFileWriter` into storage package. (P04)
21: REPLACE core debug logger in `ConversationFileWriter` with optional second constructor parameter `logger?: StorageLogger`. Constructor is backward-compatible. (P04)
22: ADD behavioral test for conversation file writer covering: JSONL path/content (read actual file from disk), zero-arg construction, one-arg construction, logger injection with error handling (use concrete StorageLogger recording to array, NOT vi.fn()). (P04)
22a: POPULATE `packages/storage/src/testing.ts` with `export { resetConversationFileWriterForTesting } from './conversation/ConversationFileWriter.js';`. Tests import from `@vybestack/llxprt-code-storage/testing`. (P04d)
23: UPDATE storage barrel exports to expose public APIs and keep git utilities internal. DO NOT export `resetConversationFileWriterForTesting` from barrel. (P02-P04)
24: REPLACE core moved implementation files with exact re-export shims (literal contents specified in P05). Include `SecureStoreErrorCode` as `export type` in secure-store shim. Add `SecureStoreErrorCode` to existing `export type` block in `packages/core/src/index.ts`. (P05)
25: UPDATE `packages/core/src/index.ts` storage-related exports to avoid duplicate exports and preserve public API. (P05)
26: VERIFY `SessionPersistenceService` compiles with `import type { Storage } from '../config/storage.js'` through shim. VERIFY representative core consumers compile. (P05)
27: UPDATE direct cross-package consumers. UPDATE non-core test mocks. CREATE `LoggingProviderWrapper.test.ts` with behavioral assertions against real JSONL output (no mock theater). RECONCILE against P00a-import-inventory.json. (P06)
28: RUN `npm install` to update workspace metadata and lockfile. (P07)
29: RUN per-package build for storage, core, mcp, providers, cli, a2a-server individually, then root `npm run build`. (P07)
30: RUN per-package test/typecheck for all affected packages. (P07)
31: CHECK storage package source contains no imports from core. Run parser-based boundary check (script from P00a). (P07)
32: CHECK package dependency graph has no storage-to-core cycle using cycle detection script (from P00a). (P07)
33: RUN full repository verification suite (`npm run test/lint/typecheck/format/build`). Format: run format, review diff, run format AGAIN (determinism), run `format:check`. Smoke command. (P07)
34: IF verification fails, FIX only the failing behavior and rerun relevant verification before continuing. (P07)

## Line-Level Algorithms for Non-Trivial Behavior

### SecureStore Logger/Keyring Fallback (Lines 12-16)

```
Algorithm: SecureStore constructor
  INPUT: options: SecureStoreOptions
  1. IF options.logger EXISTS THEN
  2.   SET this.logger = options.logger
  3. ELSE
  4.   SET this.logger = NEW NullStorageLogger()
  5. END IF
  6. CALL setSecureStoreModuleLogger(this.logger)
  7. SET this.fallbackDir = options.fallbackDir ?? path.join(os.homedir(), '.llxprt', 'secure-storage')
  8. SET this.fallbackPolicy = options.fallbackPolicy ?? 'allow'
  9. IF options.keyringLoader EXISTS THEN
  10.  SET this.keyringLoader = options.keyringLoader
  11. ELSE
  12.  SET this.keyringLoader = createDefaultKeyringAdapter
  13. END IF
  14. CONTINUE with existing keyring/fallback initialization

Algorithm: setSecureStoreModuleLogger (private, not exported)
  INPUT: logger: StorageLogger
  1. SET _moduleLogger = logger

Algorithm: createDefaultKeyringAdapter
  1. TRY dynamic import('@napi-rs/keyring')
  2. IF module loading fails THEN
  3.   IF process.env.DEBUG is set THEN
  4.     CALL _moduleLogger.warn("Keyring module not available: " + error.message)
  5.   END IF
  6.   RETURN null
  7. END IF
  8. CREATE keyring adapter from loaded module
  9. RETURN adapter
```

### ConversationFileWriter Singleton/Reset/Default Path/Error Logging (Lines 20-22a)

```
Algorithm: ConversationFileWriter constructor
  INPUT: logPath?: string, logger?: StorageLogger
  1. IF logPath IS provided AND truthy THEN
  2.   SET this.logPath = logPath
  3. ELSE
  4.   SET this.logPath = path.join(os.homedir(), '.llxprt', 'conversations')
  5. END IF
  6. SET this.currentLogFile = path.join(this.logPath, 'conversation-' + new Date().toISOString().split('T')[0] + '.jsonl')
  7. IF logger IS provided THEN
  8.   SET this.logger = logger
  9. ELSE
  10.  SET this.logger = NEW NullStorageLogger()
  11. END IF
  12. ENSURE directory this.logPath exists (fs.mkdirSync recursive)

Algorithm: writeEntry
  INPUT: entry: Record<string, unknown>
  1. SET line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() })
  2. TRY fs.appendFileSync(this.currentLogFile, line + '\n')
  3. CATCH error
  4.   CALL this.logger.error("Failed to write log entry:", error)
  5.   // Do NOT rethrow — existing behavior swallows errors
  6. END TRY

Algorithm: getConversationFileWriter (singleton)
  INPUT: logPath?: string
  1. IF _singletonInstance IS null THEN
  2.   SET _singletonInstance = NEW ConversationFileWriter(logPath)
  3. END IF
  4. RETURN _singletonInstance

Algorithm: resetConversationFileWriterForTesting
  1. SET _singletonInstance = null
  // Exported only from @vybestack/llxprt-code-storage/testing (Tier 3)
```

### Core Shim Export Identity (Line 24)

```
Algorithm: Shim identity verification
  FOR each core shim file:
    1. IMPORT { Symbol } from core shim path
    2. IMPORT { Symbol } from storage package path
    3. ASSERT: core shim Symbol === storage package Symbol (strict reference equality)
    4. IF using export * re-export THEN identity is guaranteed by module system
    5. IF using named re-export THEN identity is guaranteed by module system
  END FOR
  This proves shims are transparent pass-throughs, not copies.
```

### Parser-Boundary Checks (Line 31)

```
Algorithm: Storage import boundary check
  FOR each .ts file in packages/storage/src/:
    1. PARSE file with TypeScript compiler
    2. FOR each import declaration:
      3. IF module specifier contains '@vybestack/llxprt-code-core' OR 'packages/core' THEN
      4.   FAIL: storage imports core
      5. END IF
    6. END FOR
  END FOR
```

## Integration Points

Line 24: Core compatibility shims ensure existing core root/deep imports continue to work.
Line 27: Direct cross-package imports prove storage package is reachable outside core.
Line 31: Leaf package check enforces issue requirement that storage depends on no llxprt packages.
Line 33: Smoke command proves runtime can still start after package extraction.

## Anti-Pattern Warnings

[ERROR] DO NOT create `StorageV2`, `SecureStoreNew`, or duplicate public APIs.
[ERROR] DO NOT leave moved implementation in core while also adding storage implementation, except for explicit shim files.
[ERROR] DO NOT import core debug utilities into storage.
[ERROR] DO NOT export `resetConversationFileWriterForTesting` from the root barrel or core shims — only from `@vybestack/llxprt-code-storage/testing`.
[ERROR] DO NOT use mock call verification (vi.fn/toHaveBeenCalled) for behavioral tests — use real observable output (disk reads, array contents).
[ERROR] DO NOT delete `packages/storage` if it already exists — adapt the plan instead.
[OK] Use compatibility shims in core to preserve public exports.
[OK] Use concrete logger implementations that record to observable arrays for error-path tests.
[OK] Mock filesystem/keyring infrastructure in tests while testing real storage classes.
