# Domain Analysis: Extract packages/storage

Plan ID: PLAN-20260609-ISSUE1590

## Current Domain Objects

### Storage Paths

- Source: `packages/core/src/config/storage.ts`
- Destination: `packages/storage/src/config/storage.ts`
- Owns deterministic global and project path computations under `.llxprt` and system settings locations.
- **Moved constants**: `LLXPRT_DIR`, `PROVIDER_ACCOUNTS_FILENAME`, `OAUTH_FILE` — these are exported from `storage.ts` and must appear in all moved-symbol inventories.
- External dependencies: Node built-ins only.
- Tests to move: `packages/core/src/config/storage.test.ts` → `packages/storage/src/config/storage.test.ts`.

### File System Service

- Source: `packages/core/src/services/fileSystemService.ts`
- Destination: `packages/storage/src/services/fileSystemService.ts`
- Owns filesystem read/write/existence abstractions for tool/runtime use.
- External dependencies: Node `fs/promises` only.
- Tests to move: `packages/core/src/services/fileSystemService.test.ts` → `packages/storage/src/services/fileSystemService.test.ts`.

### File Discovery Service

- Source: `packages/core/src/services/fileDiscoveryService.ts`
- Destination: `packages/storage/src/services/fileDiscoveryService.ts`
- Owns gitignore and `.llxprtignore` filtering behavior.
- Internal dependencies copied locally:
  - `packages/core/src/utils/gitIgnoreParser.ts` → `packages/storage/src/utils/gitIgnoreParser.ts`
  - `packages/core/src/utils/gitUtils.ts` → `packages/storage/src/utils/gitUtils.ts`
- External dependencies: `ignore` through `gitIgnoreParser.ts`; Node `fs`/`path`.
- Tests to move:
  - `packages/core/src/services/fileDiscoveryService.test.ts` → `packages/storage/src/services/fileDiscoveryService.test.ts`
  - `packages/core/src/utils/gitIgnoreParser.test.ts` → `packages/storage/src/utils/gitIgnoreParser.test.ts`
  - Note: `packages/core/src/utils/gitUtils.test.ts` does not exist — no test file to move for `gitUtils`.
- Core keeps original `gitIgnoreParser.ts` and `gitUtils.ts` for non-storage core utilities (`gitLineChanges`, `grep`, prompts, git service tests). Storage file discovery must import its local copies.

### Secure Store

- Source: `packages/core/src/storage/secure-store.ts`
- Destination: `packages/storage/src/secure-store/secure-store.ts`
- Owns keyring adapter loading, key validation, encrypted file fallback, fallback policy handling, and list/has/delete behavior.
- Exports: `SecureStore`, `SecureStoreError`, `SecureStoreErrorCode` (type-only), `KeyringAdapter` (type-only), `SecureStoreOptions` (type-only), `createDefaultKeyringAdapter`.
- Internal dependencies to remove in moved implementation: `../debug/DebugLogger.js`, `../utils/debugLogger.js`.
- External dependencies: `env-paths`, optional dynamic `@napi-rs/keyring`, Node crypto/fs/path/os.
- Tests to move:
  - `packages/core/src/storage/secure-store.test.ts` → `packages/storage/src/secure-store/secure-store.test.ts`
  - `packages/core/src/storage/secure-store.spec.ts` → `packages/storage/src/secure-store/secure-store.spec.ts`
  - `packages/core/src/storage/secure-store-integration.test.ts` → **SPLIT, not moved wholesale** (see below)
- Storage package must define `StorageLogger` and default `NullStorageLogger`.
- Exact logger behavior: all existing `logger.debug` calls remain debug-level calls through `StorageLogger`; previous `debugLogger.warn` in default keyring loading becomes `logger.warn` only when a logger is provided/defaulted and `process.env.DEBUG` is set, matching the current conditional diagnostic behavior without core dependencies.

#### `secure-store-integration.test.ts` Disposition

The file imports core-owned `../tools/tool-key-storage.js` (`maskKeyForDisplay`). Since `tool-key-storage.ts` must remain in core, the test cannot move wholesale.

- **Action**: Copy the file to `packages/storage/src/secure-store/secure-store-integration.test.ts` and edit the copy:
  - Replace `import { maskKeyForDisplay } from '../tools/tool-key-storage.js'` with an inline `maskKeyForDisplay` helper that replicates the mask logic locally.
  - Remove all other core imports (`debugLogger`, etc.).
  - Verify the storage copy has zero imports from core.
- **Original**: `packages/core/src/storage/secure-store-integration.test.ts` remains in core until P05, where it is deleted (behavior now covered by the storage copy).

### Provider Key Storage

- Source: `packages/core/src/storage/provider-key-storage.ts`
- Destination: `packages/storage/src/secure-store/provider-key-storage.ts`
- Owns provider key name validation, trimming, `SecureStore`-backed CRUD, and singleton access.
- Internal dependencies: local `./secure-store.js`.
- External dependencies: Node path/os only.
- Tests to move: `packages/core/src/storage/provider-key-storage.test.ts` → `packages/storage/src/secure-store/provider-key-storage.test.ts`.

### Session Types

- Source: `packages/core/src/storage/sessionTypes.ts`
- Destination: `packages/storage/src/session/sessionTypes.ts`
- Pure record types/constants for session files.
- No runtime dependency.
- Exported from core root today; core shim must preserve existing names.

### Conversation File Writer

- Source: `packages/core/src/storage/ConversationFileWriter.ts`
- Destination: `packages/storage/src/conversation/ConversationFileWriter.ts`
- Owns JSONL request/response/tool-call logging to `~/.llxprt/conversations` by default.
- Internal dependency to remove in moved implementation: `../utils/debugLogger.js`.
- External dependencies: Node fs/path/os only.
- Direct cross-package consumer: `packages/providers/src/LoggingProviderWrapper.ts`.
- Existing tests: **none found for this file** (verified: `find packages/core -name "*ConversationFileWriter*test*" -o -name "*ConversationFileWriter*spec*"` returns empty). New tests must be written in P04.
- **`getConversationFileWriter` compatibility**: deep export only. It is NOT available from `@vybestack/llxprt-code-core` root barrel — `packages/core/src/index.ts` does not export it. It resolves through the core deep export `@vybestack/llxprt-code-core/storage/ConversationFileWriter.js`. Non-core consumers must import it from `@vybestack/llxprt-code-storage` root or deep export. P06 consumer rewiring for `LoggingProviderWrapper.ts` uses the storage deep export path `@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js` (matching the current deep-import pattern in providers). The P05 `storage-compat.test.ts` identity verification only checks CFW via the deep shim path, NOT via core root barrel.
- **Exact current public signatures (must be preserved)**:
  - `constructor(logPath?: string)` — optional log path, defaults to `~/.llxprt/conversations`.
  - `writeEntry(entry: Record<string, unknown>): void` — appends JSONL with timestamp.
  - `writeRequest(provider: string, messages: unknown[], context?: Record<string, unknown>): void`.
  - `writeResponse(provider: string, response: unknown, metadata?: Record<string, unknown>): void`.
  - `writeToolCall(provider: string, toolName: string, context?: Record<string, unknown>): void`.
  - `getConversationFileWriter(logPath?: string): ConversationFileWriter` — singleton accessor.
- **Additive-only changes in storage**:
  - Constructor gains optional second parameter `logger?: StorageLogger` (backward-compatible: existing callers pass zero or one argument).
  - Error handling uses injected `StorageLogger` instead of `debugLogger`.
  - `resetConversationFileWriterForTesting()` added for test singleton cleanup. Exported from `@vybestack/llxprt-code-storage/testing` deep export only, NOT from root barrel, NOT from core shims.
  - Tests must verify: zero-arg construction (`new ConversationFileWriter()`), one-arg construction (`new ConversationFileWriter(tmpPath)`), and logger injection (`new ConversationFileWriter(tmpPath, testLogger)`) where error handling routes to the injected logger.
- New tests to add: `packages/storage/src/conversation/ConversationFileWriter.test.ts` covering custom log path JSONL writes for request/response/tool-call entries, timestamp presence, payload preservation, singleton reuse, and `writeEntry` error logging via a deterministic filesystem failure path (parent directory is a regular file, not a directory — causing `mkdir` to fail inside `writeEntry`). The constructor is NOT the error path under test — it remains backward-compatible and purely initializes state. Tests use a concrete `StorageLogger` that records to an observable array (NOT vi.fn mock call verification).
- Test-only deep export: `packages/storage/src/testing.ts` exports `resetConversationFileWriterForTesting` for test singleton cleanup. Tests import from `@vybestack/llxprt-code-storage/testing`, NOT from the root barrel. Core shims must NOT re-export this symbol.

### Session Persistence Service

- Source: `packages/core/src/storage/SessionPersistenceService.ts`
- Destination: remains in core.
- Owns persistence of conversation history for `--continue`.
- Depends on core domain types: `IContent`, `ToolResultDisplay`, `ToolCallConfirmationDetails`, `DebugLogger`.
- **Exact current import**: `import type { Storage } from '../config/storage.js';` (line 11). After P05, this resolves through the compatibility shim to the moved `Storage` class. No import change needed.
- Its `Storage` import resolves through core compatibility shim; P05 must verify `SessionPersistenceService.test.ts` passes after shim installation.

## Package Boundary

`packages/storage` owns foundational storage and filesystem primitives. It can use Node built-ins and external npm packages (`env-paths`, `ignore`, optional `@napi-rs/keyring`) but must not import any `@vybestack/llxprt-code-*` package or `packages/core` relative path.

`packages/core` continues to own domain-specific session persistence, tool-key storage, auth token stores, debug logging, config construction, and tool implementations. Core depends on storage.

## Existing Files to Move into Storage

### Implementation files

- `packages/core/src/config/storage.ts` → `packages/storage/src/config/storage.ts`
- `packages/core/src/services/fileSystemService.ts` → `packages/storage/src/services/fileSystemService.ts`
- `packages/core/src/services/fileDiscoveryService.ts` → `packages/storage/src/services/fileDiscoveryService.ts`
- `packages/core/src/utils/gitIgnoreParser.ts` → `packages/storage/src/utils/gitIgnoreParser.ts` (internal copy; core original remains)
- `packages/core/src/utils/gitUtils.ts` → `packages/storage/src/utils/gitUtils.ts` (internal copy; core original remains)
- `packages/core/src/storage/secure-store.ts` → `packages/storage/src/secure-store/secure-store.ts`
- `packages/core/src/storage/provider-key-storage.ts` → `packages/storage/src/secure-store/provider-key-storage.ts`
- `packages/core/src/storage/sessionTypes.ts` → `packages/storage/src/session/sessionTypes.ts`
- `packages/core/src/storage/ConversationFileWriter.ts` → `packages/storage/src/conversation/ConversationFileWriter.ts`
- New logger abstraction: `packages/storage/src/types/logger.ts`

### Tests to move into storage

- `packages/core/src/config/storage.test.ts` → `packages/storage/src/config/storage.test.ts`
- `packages/core/src/services/fileSystemService.test.ts` → `packages/storage/src/services/fileSystemService.test.ts`
- `packages/core/src/services/fileDiscoveryService.test.ts` → `packages/storage/src/services/fileDiscoveryService.test.ts`
- `packages/core/src/utils/gitIgnoreParser.test.ts` → `packages/storage/src/utils/gitIgnoreParser.test.ts`
- `packages/core/src/storage/secure-store.test.ts` → `packages/storage/src/secure-store/secure-store.test.ts`
- `packages/core/src/storage/secure-store.spec.ts` → `packages/storage/src/secure-store/secure-store.spec.ts`
- `packages/core/src/storage/secure-store-integration.test.ts` → **SPLIT**: copy to `packages/storage/src/secure-store/secure-store-integration.test.ts` with inline `maskKeyForDisplay` helper replacing core `../tools/tool-key-storage.js` import
- `packages/core/src/storage/provider-key-storage.test.ts` → `packages/storage/src/secure-store/provider-key-storage.test.ts`
- New `packages/storage/src/conversation/ConversationFileWriter.test.ts`.
- New `packages/storage/src/testing.ts` — test-only deep export re-exporting `resetConversationFileWriterForTesting`.
- New `packages/core/src/storage/storage-compat.test.ts` proving root/deep compatibility shims and singleton identity.

## Consumer Touchpoints

### Direct non-core consumers to update

#### MCP package

- `packages/mcp/src/auth/file-token-store.ts`
- `packages/mcp/src/auth/file-token-store.test.ts`
- `packages/mcp/src/auth/token-storage/keychain-token-storage.ts`
- `packages/mcp/src/auth/token-storage/keychain-token-storage.test.ts` (no mock rewrite needed; mocks non-storage core symbol)

#### Providers package

- `packages/providers/src/LoggingProviderWrapper.ts`
- `packages/providers/src/LoggingProviderWrapper.test.ts` (NEW — must be created in P06 to verify providers→storage dependency)

#### A2A Server package

- `packages/a2a-server/src/config/config.ts`

#### Test Utilities package

- `packages/test-utils/src/test-rig.ts` — imports `LLXPRT_DIR` for test directory path computation

#### CLI package - source files

- `packages/cli/src/auth/proxy/credential-proxy-server.ts`
- `packages/cli/src/auth/proxy/credential-store-factory.ts`
- `packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts`
- `packages/cli/src/config/environmentLoader.ts`
- `packages/cli/src/config/extension.ts`
- `packages/cli/src/config/extensions/settingsStorage.ts`
- `packages/cli/src/config/interactiveContext.ts`
- `packages/cli/src/config/paths.ts`
- `packages/cli/src/config/sandboxProfiles.ts`
- `packages/cli/src/config/settingsLoader.ts`
- `packages/cli/src/ui/components/Notifications.tsx`

- `packages/cli/src/extensions/extensionAutoUpdater.ts`
- `packages/cli/src/nonInteractiveCliCommands.ts`
- `packages/cli/src/providers/providerAliases.ts`
- `packages/cli/src/services/FileCommandLoader.ts`
- `packages/cli/src/ui/commands/keyCommand.ts`
- `packages/cli/src/ui/hooks/atCompletionUtils.ts`
- `packages/cli/src/ui/hooks/slashCommandProcessorSupport.ts`
- `packages/cli/src/ui/hooks/useLogger.ts`
- `packages/cli/src/ui/hooks/useRewind.ts`
- `packages/cli/src/ui/hooks/useShellHistory.ts`
- `packages/cli/src/ui/utils/rewindFileOps.ts`
- `packages/cli/src/utils/cleanup.ts`
- `packages/cli/src/utils/persistentState.ts`
- `packages/cli/src/utils/sessionUtils.ts`
- `packages/cli/src/utils/skillUtils.ts`
- `packages/cli/src/zed-integration/fileSystemService.ts`

#### CLI package - test files

- `packages/cli/test/ui/commands/authCommand-logout.test.ts`
- `packages/cli/src/auth/__tests__/codex-oauth-provider.test.ts`
- `packages/cli/src/auth/oauth-manager.refresh-race.spec.ts`
- `packages/cli/src/auth/proxy/__tests__/e2e-credential-flow.test.ts`
- `packages/cli/src/auth/proxy/__tests__/integration.test.ts`
- `packages/cli/src/auth/proxy/__tests__/platform-matrix.test.ts`
- `packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts`
- `packages/cli/src/integration-tests/oauth-timing.integration.test.ts`
- `packages/cli/src/integration-tests/__tests__/oauth-buckets.integration.spec.ts`
- `packages/cli/src/providers/providerAliases.modelDefaults.test.ts`
- `packages/cli/src/runtime/__tests__/authKeyName.test.ts`
- `packages/cli/src/services/FileCommandLoader.test.ts`
- `packages/cli/src/ui/commands/keyCommand.subcommands.test.ts`
- `packages/cli/src/ui/commands/memoryCommand.test.ts`
- `packages/cli/src/ui/commands/test/useSlashCompletion.schema.test.ts`
- `packages/cli/src/ui/hooks/atCommandProcessor.test.ts`
- `packages/cli/src/ui/hooks/useRewind.test.ts`
- `packages/cli/src/ui/hooks/useSlashCompletion.test.ts`
- `packages/cli/src/ui/utils/rewindFileOps.test.ts`
- `packages/cli/src/utils/sessionCleanup.integration.test.ts`
- `packages/cli/src/utils/sessionCleanup.test.ts`
- `packages/cli/src/zed-integration/fileSystemService.test.ts`

#### CLI package - test files importing moved constants

- `packages/cli/src/config/settings.test.ts` — imports `LLXPRT_DIR` (moved constant) from core alongside `FatalConfigError` (non-moved). Split the import: `LLXPRT_DIR` from `@vybestack/llxprt-code-storage`, `FatalConfigError` stays from `@vybestack/llxprt-code-core`. Check whether the test's `vi.mock('@vybestack/llxprt-code-core', ...)` factory provides `LLXPRT_DIR` and split if needed.

#### CLI package - test files that mock storage symbols from core

- `packages/cli/src/config/extensions/settingsStorage.test.ts` — `vi.mock('@vybestack/llxprt-code-core', ...)` mocks `SecureStore`; rewrite to `vi.mock('@vybestack/llxprt-code-storage', ...)`.
- `packages/cli/src/utils/persistentState.test.ts` — `vi.mock('@vybestack/llxprt-code-core', ...)` mocks `Storage`; rewrite to `vi.mock('@vybestack/llxprt-code-storage', ...)`.
- `packages/cli/src/config/config.integration.test.ts` — `vi.mock('@vybestack/llxprt-code-core', ...)` mocks `FileDiscoveryService`; split mock to target storage for `FileDiscoveryService`.
- `packages/cli/src/ui/hooks/useShellHistory.test.ts` — `vi.mock('@vybestack/llxprt-code-core', ...)` mocks `Storage` via local class; rewrite to `vi.mock('@vybestack/llxprt-code-storage', ...)`.
- `packages/cli/src/ui/utils/rewindFileOps.test.ts` — `vi.mock('@vybestack/llxprt-code-core', ...)` mocks `coreEvents` (non-storage), but imports `ConversationRecord`/`BaseMessageRecord`/`ToolCallRecord` types from core; update type imports to storage. Root mock stays targeting core.

### Core-owned code that continues using relative shim imports

After P05 installs shims, these core files continue using relative imports that resolve through shims to the moved storage implementations:

- `packages/core/src/auth/keyring-token-store.ts` — imports `SecureStore`, `createDefaultKeyringAdapter` via relative path.
- `packages/core/src/config/configConstructor.ts` — imports `Storage`, `FileSystemService`, `FileDiscoveryService` via relative path.
- `packages/core/src/config/configBaseCore.ts` — imports `Storage` via relative path.
- `packages/core/src/tools/tool-key-storage.ts` — imports `SecureStore` via relative path.
- `packages/core/src/hooks/trustedHooks.ts` — imports `Storage` via relative path.
- `packages/core/src/skills/skillManager.ts` — imports `FileDiscoveryService` via relative path.

These are not "consumers to update" — they continue using relative imports which resolve through shims. P05 must verify they compile and their tests pass.

- Root `package.json`: add `packages/storage` workspace.
- `packages/core/package.json`: add `@vybestack/llxprt-code-storage`; update export map with new shim paths for moved APIs.
- `packages/mcp/package.json`: add `@vybestack/llxprt-code-storage`.
- `packages/providers/package.json`: add `@vybestack/llxprt-code-storage`.
- `packages/a2a-server/package.json`: add `@vybestack/llxprt-code-storage` if direct import is updated.
- `packages/test-utils/package.json`: add `@vybestack/llxprt-code-storage` if direct import is updated.
- `packages/cli/package.json`: add `@vybestack/llxprt-code-storage` if direct imports are updated.

### Core export map: existing vs. new entries

Core currently has these **existing** deep export-map entries for storage-related paths (verified present in `packages/core/package.json` exports at preflight):

- `./config/storage.js` → `./dist/src/config/storage.js` (EXISTING — keep, shim replaces implementation at same path)
- `./storage/secure-store.js` → `./dist/src/storage/secure-store.js` (EXISTING — keep)
- `./storage/ConversationFileWriter.js` → `./dist/src/storage/ConversationFileWriter.js` (EXISTING — keep)

No other storage-related deep exports exist in core. The following paths are verified ABSENT from core export map.

P05 must **add** these new deep export-map entries:

- `./services/fileSystemService.js` → `./dist/src/services/fileSystemService.js` (NEW — verified absent from core export map)
- `./services/fileDiscoveryService.js` → `./dist/src/services/fileDiscoveryService.js` (NEW — verified absent from core export map)
- `./storage/provider-key-storage.js` → `./dist/src/storage/provider-key-storage.js` (NEW — verified absent from core export map)
- `./storage/sessionTypes.js` → `./dist/src/storage/sessionTypes.js` (NEW — verified absent from core export map)

## Edge Cases

- `SecureStoreOptions` gains optional logger without breaking existing construction call sites.
- The default secure store logger must not leak secrets and must not require core debug dependencies.
- `createDefaultKeyringAdapter` still dynamically imports optional `@napi-rs/keyring`; storage package must declare it as an optional dependency.
- `ProviderKeyStorage` singleton moves to storage. Tests that reset singleton through core re-export must still affect the same singleton.
- `ConversationFileWriter` singleton moves to storage. Provider code should use the storage singleton directly.
- Core utility copies for git ignore remain only for non-storage core use. Storage file discovery must use storage-local utilities.
- Shims must preserve `.js` import paths under core package exports.

## Verification Commands

- `npm install`
- `npm run test --workspace @vybestack/llxprt-code-storage`
- `npm run typecheck --workspace @vybestack/llxprt-code-storage`
- `npm run build --workspace @vybestack/llxprt-code-storage`
- `npm run test --workspace @vybestack/llxprt-code-core`
- `npm run test --workspace @vybestack/llxprt-code-mcp`
- `npm run test --workspace @vybestack/llxprt-code-providers`
- `npm run test --workspace @vybestack/llxprt-code`
- `npm run test --workspace @vybestack/llxprt-code-a2a-server`
- `npm run test`
- `npm run lint`
- `npm run typecheck`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"`

## Preflight Checks Needed

- Confirm `packages/storage` does not already exist.
- Confirm root workspace list and package script conventions from existing packages.
- Confirm root build order or package dependency handling.
- Confirm target source/test files exist.
- Confirm `env-paths`, `ignore`, and `@napi-rs/keyring` dependency locations.
- Confirm all current core deep exports that need storage shims, distinguishing existing entries from new ones:
  - Existing: `./config/storage.js`, `./storage/secure-store.js`, `./storage/ConversationFileWriter.js`
  - New (to add): `./services/fileSystemService.js`, `./services/fileDiscoveryService.js`, `./storage/provider-key-storage.js`, `./storage/sessionTypes.js`
- Confirm all root and deep non-core consumers of moved APIs using TypeScript parser-based import inventory (see P00a).
- Confirm no planned storage source imports from `packages/core`.
- Confirm core `gitIgnoreParser.ts`/`gitUtils.ts` are still required outside file discovery and therefore remain in core.
