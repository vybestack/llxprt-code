# Feature Specification: Extract packages/storage

Plan ID: PLAN-20260609-ISSUE1590

## Purpose

Extract storage and filesystem primitives from `packages/core` into a dedicated `packages/storage` workspace package so storage becomes a foundational leaf package that other packages can depend on without circular dependencies.

## Architectural Decisions

- **Pattern**: package extraction with backwards-compatible core re-export shims.
- **Package boundary**: `packages/storage` must not depend on any other llxprt workspace package and must not import from `packages/core`.
- **Compatibility**: core root exports and existing core deep exports continue to resolve through shim files.
- **Direct migration rule**: non-core packages that directly import moved storage APIs from `@vybestack/llxprt-code-core` must be updated to import those APIs from `@vybestack/llxprt-code-storage`; imports of non-storage core APIs remain on core.
- **Logger decoupling**: storage owns a minimal `StorageLogger` interface and default `NullStorageLogger`. Core debug logging may adapt to it, but storage must not import core debug utilities.
- **Session persistence**: `SessionPersistenceService` stays in core because it depends on core conversation/tool domain types. Only `sessionTypes.ts` moves.
- **Git utilities**: storage receives local internal copies of `gitIgnoreParser.ts` and `gitUtils.ts` for file discovery. Core keeps its original utilities for existing core utility users (`gitLineChanges`, `grep`, prompts, git service tests); storage tests must prove file discovery uses local copies.
- **Conversation file writer**: move to storage because it is storage behavior with only filesystem/logging dependencies; replace core singleton logging with injected/default `StorageLogger`.

## Technical Environment

- **Type**: TypeScript Node.js monorepo package.
- **Runtime**: Node.js >= 20, ESM modules.
- **Testing**: Vitest.
- **Package manager metadata**: npm workspaces in root `package.json`, `file:../storage` workspace dependency in consumers.

## Storage Package Public Interface — API Classification

### Tier 1: Stable Root API (`@vybestack/llxprt-code-storage`)

These symbols are the primary public interface. Import them from the package root:

```typescript
import { Storage, SecureStore, FileDiscoveryService } from '@vybestack/llxprt-code-storage';
```

Root exported names:

- From `src/config/storage.ts`: `LLXPRT_DIR`, `PROVIDER_ACCOUNTS_FILENAME`, `OAUTH_FILE`, `Storage`.
- From `src/services/fileSystemService.ts`: `FileSystemService`, `StandardFileSystemService`, and related exported types from the source file.
- From `src/services/fileDiscoveryService.ts`: `FilterFilesOptions`, `FilterReport`, `FileDiscoveryService`.
- From `src/secure-store/secure-store.ts`: `SecureStore`, `SecureStoreError`, `SecureStoreErrorCode`, `KeyringAdapter`, `SecureStoreOptions`, `createDefaultKeyringAdapter`.
- From `src/secure-store/provider-key-storage.ts`: `KEY_NAME_REGEX`, `ProviderKeyStorage`, `validateKeyName`, `getProviderKeyStorage`, `resetProviderKeyStorage`.
- From `src/session/sessionTypes.ts`: all existing exported session record types/constants, including `SESSION_FILE_PREFIX`, `ConversationRecord`, `BaseMessageRecord`, `ToolCallRecord`.
- From `src/conversation/ConversationFileWriter.ts`: `ConversationFileWriter`, `getConversationFileWriter`.
- From `src/types/logger.ts`: `StorageLogger`, `NullStorageLogger`.

### Tier 2: Compatibility Deep API (deep imports into storage)

These deep exports exist for backward compatibility and explicit-path consumers. They resolve to the same implementations as root imports:

| Deep path | Maps to | Purpose |
|---|---|---|
| `./config/storage.js` | `./dist/src/config/storage.js` | Storage class |
| `./services/fileSystemService.js` | `./dist/src/services/fileSystemService.js` | File system service |
| `./services/fileDiscoveryService.js` | `./dist/src/services/fileDiscoveryService.js` | File discovery service |
| `./storage/secure-store.js` | `./dist/src/secure-store/secure-store.js` | Secure store |
| `./storage/provider-key-storage.js` | `./dist/src/secure-store/provider-key-storage.js` | Provider key storage |
| `./storage/sessionTypes.js` | `./dist/src/session/sessionTypes.js` | Session types |
| `./storage/ConversationFileWriter.js` | `./dist/src/conversation/ConversationFileWriter.js` | Conversation writer |
| `./testing` | `./dist/src/testing.js` | Test-only helpers (Tier 3) |

### Tier 3: Test-Only / Internal Helpers (via `@vybestack/llxprt-code-storage/testing`)

These are exported from a dedicated test-only deep export path and are **not** part of the stable public API. They may change between minor versions without notice.

- **Deep export path**: `@vybestack/llxprt-code-storage/testing` → `./dist/src/testing.js`
- **Package export map entry**: `"./testing": "./dist/src/testing.js"`
- **Source file**: `packages/storage/src/testing.ts` — re-exports test-only symbols from internal modules.

Available test-only exports:

- `resetConversationFileWriterForTesting()` — resets the `ConversationFileWriter` singleton between tests. Import as: `import { resetConversationFileWriterForTesting } from '@vybestack/llxprt-code-storage/testing';`

**Convention**: This follows the standard pattern used by `@angular/core/testing`, `@nestjs/testing`, etc. — a dedicated test-only entry point clearly separated from the stable public API. The root barrel (`src/index.ts`) does NOT re-export Tier 3 symbols. Core compatibility shims must NOT re-export Tier 3 symbols.

**Package export map addition** (in `packages/storage/package.json` exports):
```json
"./testing": "./dist/src/testing.js"
```

### What Is NOT Public API

- `gitIgnoreParser.ts` and `gitUtils.ts` — internal utilities, not exported from barrel or export map.
- `resetConversationFileWriterForTesting()` — test-only, available via `@vybestack/llxprt-code-storage/testing` deep export only. NOT in root barrel. Core shims must NOT re-export it.
- **Note on `StorageLogger` / `NullStorageLogger`**: These ARE Tier 1 stable root exports (listed above). They are exported from the root barrel for test injection and core adapter construction. The interface is minimal and stable. They are intentionally public — consumers may implement `StorageLogger` to capture logs in tests or adapt core debug logging.

## Integration Points

### Existing Code That Will Use This Feature Through Core Compatibility

- `packages/core/src/index.ts` - re-exports storage package APIs for backward compatibility.
- `packages/core/src/config/storage.ts` - shim re-exporting storage path API.
- `packages/core/src/services/fileSystemService.ts` - shim re-exporting file service API.
- `packages/core/src/services/fileDiscoveryService.ts` - shim re-exporting file discovery API.
- `packages/core/src/storage/secure-store.ts` - shim re-exporting secure store API.
- `packages/core/src/storage/provider-key-storage.ts` - shim re-exporting provider key storage API.
- `packages/core/src/storage/sessionTypes.ts` - shim re-exporting session record types/constants.
- `packages/core/src/storage/ConversationFileWriter.ts` - shim re-exporting conversation file writer API (public symbols only: `ConversationFileWriter`, `getConversationFileWriter`; NOT `resetConversationFileWriterForTesting` since that is test-only). Note: `getConversationFileWriter` is deep-export-only in core — NOT exported from core root barrel. Non-core consumers must import from `@vybestack/llxprt-code-storage` (root barrel or deep export).
- `packages/core/src/storage/SessionPersistenceService.ts` - imports `Storage` type from storage package and remains in core.

### Existing Non-Core Consumers To Update Directly

#### MCP package

- `packages/mcp/src/auth/file-token-store.ts` - `Storage` from storage deep/root export.
- `packages/mcp/src/auth/file-token-store.test.ts` - update mocked import path or use real `Storage` behavior.
- `packages/mcp/src/auth/token-storage/keychain-token-storage.ts` - `createDefaultKeyringAdapter` from storage.
- `packages/mcp/src/auth/token-storage/keychain-token-storage.test.ts` - no mock rewrite needed (mocks `@vybestack/llxprt-code-core/utils/events.js` which is not a moved symbol), but must be verified to pass after the source import change.

#### Providers package

- `packages/providers/src/LoggingProviderWrapper.ts` - `getConversationFileWriter` from storage.
- `packages/providers/src/LoggingProviderWrapper.test.ts` (NEW) - integration/unit test verifying `LoggingProviderWrapper` correctly uses the moved `getConversationFileWriter` from storage. Created in P06 after consumer integration. **Must use behavioral assertions against real observable output** (read JSONL from temp directory, check parsed content) — no mock call verification (vi.fn/toHaveBeenCalled).

#### A2A Server package

- `packages/a2a-server/src/config/config.ts` - `FileDiscoveryService` from storage.

#### Test Utilities package

- `packages/test-utils/src/test-rig.ts` - `LLXPRT_DIR` from storage (imported as a runtime constant for test directory path computation).

#### CLI package - source files

- `packages/cli/src/auth/proxy/credential-proxy-server.ts` - `ProviderKeyStorage` type from storage.
- `packages/cli/src/auth/proxy/credential-store-factory.ts` - `ProviderKeyStorage` and `getProviderKeyStorage` from storage.
- `packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts` - `getProviderKeyStorage` from storage.
- `packages/cli/src/config/environmentLoader.ts` - `FileDiscoveryService` from storage.
- `packages/cli/src/config/extension.ts` - `Storage` from storage.
- `packages/cli/src/config/extensions/settingsStorage.ts` - `SecureStore` from storage while retaining `debugLogger` from core.
- `packages/cli/src/config/interactiveContext.ts` - `FileDiscoveryService` from storage.
- `packages/cli/src/config/paths.ts` - `Storage` from storage.
- `packages/cli/src/config/sandboxProfiles.ts` - `Storage` from storage.
- `packages/cli/src/config/settingsLoader.ts` - `Storage` from storage.
- `packages/cli/src/extensions/extensionAutoUpdater.ts` - `Storage` from storage.
- `packages/cli/src/ui/components/Notifications.tsx` - `Storage` from storage while retaining `debugLogger` from core.

- `packages/cli/src/nonInteractiveCliCommands.ts` - `Storage` from storage.
- `packages/cli/src/providers/providerAliases.ts` - `Storage` from storage while retaining `debugLogger` from core.
- `packages/cli/src/services/FileCommandLoader.ts` - `Storage` from storage while retaining `debugLogger` from core.
- `packages/cli/src/ui/commands/keyCommand.ts` - `SecureStoreError` from storage.
- `packages/cli/src/ui/hooks/atCompletionUtils.ts` - `FileDiscoveryService` type from storage.
- `packages/cli/src/ui/hooks/slashCommandProcessorSupport.ts` - `Storage` from storage.
- `packages/cli/src/ui/hooks/useLogger.ts` - `Storage` type from storage.
- `packages/cli/src/ui/hooks/useRewind.ts` - `ConversationRecord` and `BaseMessageRecord` types from storage.
- `packages/cli/src/ui/hooks/useShellHistory.ts` - `Storage` from storage while retaining `isNodeError` and `debugLogger` from core.
- `packages/cli/src/ui/utils/rewindFileOps.ts` - `ConversationRecord` and `BaseMessageRecord` types from storage.
- `packages/cli/src/utils/cleanup.ts` - `Storage` from storage.
- `packages/cli/src/utils/persistentState.ts` - `Storage` from storage while retaining `DebugLogger` from core.
- `packages/cli/src/utils/sessionUtils.ts` - `SESSION_FILE_PREFIX` and `ConversationRecord` from storage.
- `packages/cli/src/utils/skillUtils.ts` - `Storage` from storage.
- `packages/cli/src/zed-integration/fileSystemService.ts` - `FileSystemService` type from storage.

#### CLI package - test files

- `packages/cli/test/ui/commands/authCommand-logout.test.ts` - `SecureStore` and `KeyringAdapter` from storage.
- `packages/cli/src/auth/__tests__/codex-oauth-provider.test.ts` - `SecureStore` and `KeyringAdapter` from storage.
- `packages/cli/src/auth/oauth-manager.refresh-race.spec.ts` - `SecureStore` and `KeyringAdapter` from storage.
- `packages/cli/src/auth/proxy/__tests__/e2e-credential-flow.test.ts` - `ProviderKeyStorage` from storage.
- `packages/cli/src/auth/proxy/__tests__/integration.test.ts` - `ProviderKeyStorage` from storage.
- `packages/cli/src/auth/proxy/__tests__/platform-matrix.test.ts` - `ProviderKeyStorage` from storage.
- `packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts` - `ProviderKeyStorage` from storage.
- `packages/cli/src/integration-tests/oauth-timing.integration.test.ts` - `SecureStore` and `KeyringAdapter` from storage.
- `packages/cli/src/integration-tests/__tests__/oauth-buckets.integration.spec.ts` - `SecureStore` and `KeyringAdapter` from storage.
- `packages/cli/src/providers/providerAliases.modelDefaults.test.ts` - dynamic `Storage` import from storage.
- `packages/cli/src/runtime/__tests__/authKeyName.test.ts` - `ProviderKeyStorage`, `SecureStore`, and `KeyringAdapter` from storage.
- `packages/cli/src/services/FileCommandLoader.test.ts` - `Storage` from storage.
- `packages/cli/src/ui/commands/keyCommand.subcommands.test.ts` - `ProviderKeyStorage`, `SecureStore`, and `KeyringAdapter` from storage.
- `packages/cli/src/ui/commands/memoryCommand.test.ts` - `FileDiscoveryService` from storage.
- `packages/cli/src/ui/commands/test/useSlashCompletion.schema.test.ts` - `FileDiscoveryService` from storage.
- `packages/cli/src/ui/hooks/atCommandProcessor.test.ts` - `FileDiscoveryService` and `StandardFileSystemService` from storage.
- `packages/cli/src/ui/hooks/useRewind.test.ts` - `ConversationRecord` and `BaseMessageRecord` from storage.
- `packages/cli/src/ui/hooks/useSlashCompletion.test.ts` - `FileDiscoveryService` from storage.
- `packages/cli/src/ui/utils/rewindFileOps.test.ts` - `ConversationRecord`, `BaseMessageRecord`, and `ToolCallRecord` from storage.
- `packages/cli/src/utils/sessionCleanup.integration.test.ts` - `SESSION_FILE_PREFIX` from storage while retaining non-storage core imports from core.
- `packages/cli/src/utils/sessionCleanup.test.ts` - `SESSION_FILE_PREFIX` from storage.
- `packages/cli/src/zed-integration/fileSystemService.test.ts` - `FileSystemService` type from storage.
- `packages/cli/src/config/settings.test.ts` - `LLXPRT_DIR` from storage while retaining `FatalConfigError` from core. The import must be split: `import { LLXPRT_DIR } from '@vybestack/llxprt-code-storage'` and `import { FatalConfigError } from '@vybestack/llxprt-code-core'`. If the test's `vi.mock('@vybestack/llxprt-code-core', ...)` factory provides `LLXPRT_DIR`, the mock must be split so storage symbols target `@vybestack/llxprt-code-storage`.

#### CLI package - test files that mock/dynamically import storage symbols from core

These test files use `vi.mock('@vybestack/llxprt-code-core', ...)` to mock moved storage symbols. P06 must update both the mock path and factory:

- `packages/cli/src/config/extensions/settingsStorage.test.ts` - mocks `SecureStore` from core; rewrite mock to target `@vybestack/llxprt-code-storage`.
- `packages/cli/src/utils/persistentState.test.ts` - mocks `Storage` from core; rewrite mock to target `@vybestack/llxprt-code-storage`.
- `packages/cli/src/config/config.integration.test.ts` - mocks `FileDiscoveryService` from core; split mock to target `@vybestack/llxprt-code-storage` for `FileDiscoveryService` and keep `@vybestack/llxprt-code-core` for non-storage symbols like `createToolRegistry`.
- `packages/cli/src/ui/hooks/useShellHistory.test.ts` - mocks `Storage` from core via `vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => { ... class Storage { ... } ... })`; rewrite mock to target `@vybestack/llxprt-code-storage`. The source file `useShellHistory.ts` must also update its `Storage` import to come from storage.
- `packages/cli/src/ui/utils/rewindFileOps.test.ts` - mocks `coreEvents` from core (non-storage), but imports `ConversationRecord`, `BaseMessageRecord`, `ToolCallRecord` types from core; update type imports to `@vybestack/llxprt-code-storage`. The root mock targeting core remains because it only overrides `coreEvents` (non-storage).

### Core Export Map Changes in P05

Core currently has these **existing** deep export-map entries for storage-related paths (do NOT remove):

- `./config/storage.js` → `./dist/src/config/storage.js`
- `./storage/secure-store.js` → `./dist/src/storage/secure-store.js`
- `./storage/ConversationFileWriter.js` → `./dist/src/storage/ConversationFileWriter.js`

P05 must **add** these new deep export-map entries for backward compatibility:

- `./services/fileSystemService.js` → `./dist/src/services/fileSystemService.js` (new: enables deep-path import of `FileSystemService` from core)
- `./services/fileDiscoveryService.js` → `./dist/src/services/fileDiscoveryService.js` (new: enables deep-path import of `FileDiscoveryService` from core)
- `./storage/provider-key-storage.js` → `./dist/src/storage/provider-key-storage.js` (new: enables deep-path import of `ProviderKeyStorage` from core)
- `./storage/sessionTypes.js` → `./dist/src/storage/sessionTypes.js` (new: enables deep-path import of `SESSION_FILE_PREFIX` and session types from core)

### Existing Code To Be Replaced

- `packages/core/src/config/storage.ts` implementation replaced with compatibility shim.
- `packages/core/src/services/fileSystemService.ts` implementation replaced with compatibility shim.
- `packages/core/src/services/fileDiscoveryService.ts` implementation replaced with compatibility shim.
- `packages/core/src/storage/secure-store.ts` implementation replaced with compatibility shim.
- `packages/core/src/storage/provider-key-storage.ts` implementation replaced with compatibility shim.
- `packages/core/src/storage/sessionTypes.ts` implementation replaced with compatibility shim.
- `packages/core/src/storage/ConversationFileWriter.ts` implementation replaced with compatibility shim (public symbols only: `ConversationFileWriter`, `getConversationFileWriter`; NOT `resetConversationFileWriterForTesting`).

### User Access Points

- Existing CLI commands and runtime flows continue to use storage through core configuration objects and direct storage package imports.
- MCP token storage continues to read/write from the same `Storage` paths.
- Provider conversation logging continues to write the same JSONL log format.
- New package imports are available for future package extraction work.

### Migration Requirements

- No persistent data format migration is required.
- File paths produced by `Storage`, `SecureStore`, `ProviderKeyStorage`, `FileDiscoveryService`, and `ConversationFileWriter` must remain behaviorally identical unless explicitly validated by tests.
- Workspace dependency metadata and lockfile must be updated by `npm install`.

## Formal Requirements

[REQ-PKG-001] Create `packages/storage` as a workspace package with package metadata, export map, build, test, lint, typecheck, root `index.ts`, source `src/index.ts`, and TypeScript config consistent with the monorepo.

[REQ-LEAF-001] `packages/storage` must not depend on any other `@vybestack/llxprt-code-*` workspace package and must not import from `packages/core`.

[REQ-STORAGE-001] Move the `Storage` class and constants from `packages/core/src/config/storage.ts` into `packages/storage/src/config/storage.ts` while preserving path behavior.

[REQ-FILES-001] Move `FileSystemService`, `StandardFileSystemService`, `FileDiscoveryService`, and related types into `packages/storage`, with internal git ignore utilities copied locally so file discovery remains functional.

[REQ-SECURE-001] Move `SecureStore`, `SecureStoreError`, `KeyringAdapter`, `createDefaultKeyringAdapter`, and related secure storage types into `packages/storage` while preserving keyring/fallback behavior and removing core debug dependencies.

[REQ-PROVIDERKEY-001] Move `ProviderKeyStorage`, `validateKeyName`, `getProviderKeyStorage`, and `resetProviderKeyStorage` into `packages/storage` while preserving singleton and CRUD behavior.

[REQ-SESSIONTYPES-001] Move session record types and constants from `packages/core/src/storage/sessionTypes.ts` into `packages/storage/src/session/sessionTypes.ts`.

[REQ-CONVLOG-001] Move `ConversationFileWriter` and `getConversationFileWriter` into `packages/storage/src/conversation/ConversationFileWriter.ts` while preserving JSONL format and default log path.

[REQ-COMPAT-001] Preserve existing core root exports and core deep exports for moved APIs through shim files and core package export-map entries.

[REQ-INT-001] Update direct non-core consumers to import moved storage APIs from `@vybestack/llxprt-code-storage`.

[REQ-NOCYCLE-001] Ensure no package dependency cycle is introduced between storage, core, mcp, providers, cli, a2a-server, and test-utils.

[REQ-TEST-001] Moved storage tests pass in `packages/storage`; compatibility and consuming package tests pass.

## Constraints

- Do not delete or modify `.llxprt/`.
- Do not create `StorageV2`, `SecureStoreNew`, or parallel replacement APIs.
- Do not move `SessionPersistenceService` unless preflight proves it can be moved without storage depending on core; current expectation is that it stays in core.
- Do not mock the storage component under test. Mock only infrastructure such as filesystem/keyring adapters where necessary.
- Do not leave TODO/FIXME/HACK/STUB markers in implementation phases.

## Acceptance Criteria Mapping

- "All relevant code lives in packages/storage" maps to REQ-STORAGE-001, REQ-FILES-001, REQ-SECURE-001, REQ-PROVIDERKEY-001, REQ-SESSIONTYPES-001, REQ-CONVLOG-001.
- "Clean public interface with no circular dependencies" maps to REQ-PKG-001, REQ-LEAF-001, REQ-NOCYCLE-001.
- "All tests pass in the new package" maps to REQ-TEST-001.
- "Existing imports updated to use the new package" maps to REQ-COMPAT-001 and REQ-INT-001.
