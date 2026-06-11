# Plan Remediation After Review 07

Summary: Addressed all seven review 07 blockers:

1. **Moved storage constants in all inventories**: Added `LLXPRT_DIR`, `PROVIDER_ACCOUNTS_FILENAME`, `OAUTH_FILE` to P00a parser `--moved-symbols`, `check-storage-import-boundary.mjs` moved-symbol list, P07 stale-import rg patterns, specification.md, and domain-model.md.

2. **Added `settings.test.ts` as direct consumer**: Added `packages/cli/src/config/settings.test.ts` to P06 CLI test files, specification.md, and domain-model.md consumer touchpoints. Noted the required import split: `LLXPRT_DIR` from storage, `FatalConfigError` from core, with mock-split guidance.

3. **P06 moved-constants subsection**: Added a "Moved Constants" subsection to P06 documenting `LLXPRT_DIR`, `PROVIDER_ACCOUNTS_FILENAME`, `OAUTH_FILE` as moved symbols, listing `settings.test.ts` as a known consumer, and noting the parser inventory hard-STOP gate applies.

4. **Per-subphase verifier phases**: Replaced single phase-level verifiers (P02-V, P03-V, P04-V) with per-subphase verifiers (P02a-V, P02b-V, P02c-V, P03a-V, P03b-V, P03c-V, P04a-V, P04b-V, P04c-V, P04d-V). Updated overview table, execution tracker, and all phase files (P02, P03, P04) with explicit verifier sequence following `dev-docs/COORDINATING.md`: worker → verifier → next worker.

5. **Stubs export complete public API surface**: P02a stubs now export `Storage`, `LLXPRT_DIR`, `PROVIDER_ACCOUNTS_FILENAME`, `OAUTH_FILE`, `FileSystemService`, `StandardFileSystemService`, `FileDiscoveryService`, `FilterFilesOptions`, `FilterReport`. P03a stubs now export `SecureStore`, `SecureStoreError`, `SecureStoreErrorCode` (type), `KeyringAdapter` (type), `SecureStoreOptions` (type), `createDefaultKeyringAdapter`. P04a stubs now export `SESSION_FILE_PREFIX`, `ConversationRecord`, `BaseMessageRecord`, `ToolCallRecord`, `ConversationFileWriter`, `getConversationFileWriter`, `resetConversationFileWriterForTesting`. All with correct signatures but wrong values or "not implemented" throws — ensuring RED is behavioral, not structural.

6. **P03 subphase count fixed**: Changed header from "four sequential subphases" to "three sequential subphases" matching the actual subphases listed (P03a, P03b, P03c).

7. **Deterministic ConversationFileWriter failure test**: Replaced read-only-directory approach with parent-is-regular-file approach in P04b Scenarios 5 and 8, and P06 Scenario 3. Creates a temp directory, writes a regular file inside it, then uses `<tmpdir>/regularfile/conversations` as the log path. Platform-stable and deterministic across macOS/Linux/Windows/CI.
