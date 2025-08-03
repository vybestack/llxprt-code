# Windows Multibyte Regression Tests

This document describes the behavioral regression tests added to protect Windows multibyte encoding fixes through upstream merges.

## Test Files Created

### 1. Shell Execution Tests

**File:** `packages/core/src/services/shellExecutionService.windows.multibyte.test.ts`

Tests Windows-specific shell execution behavior with multibyte characters:

- ✅ Handles Japanese text in shell commands without hanging
- ✅ Handles commands with Japanese filenames
- ✅ Handles mixed English and Japanese output
- ✅ Does not escape quotes excessively in commands
- ✅ Handles error output with Japanese text

These tests ensure that:

- Shell commands use `shell: true` on Windows for proper execution
- UTF-8 text is properly decoded even when split across chunks
- Commands are not over-escaped with multiple quotes
- Japanese error messages from Windows are properly displayed

### 2. Unicode Utilities Tests

**File:** `packages/core/src/utils/unicodeUtils.test.ts`

Tests Unicode handling and sanitization functions:

- ✅ Removes Unicode replacement characters (U+FFFD)
- ✅ Detects Unicode replacement characters
- ✅ Ensures JSON-safe strings by removing control characters
- ✅ Cleans common cp932 (Shift-JIS) decoding artifacts
- ✅ Handles real-world scenarios like API keys with encoding issues

These tests protect:

- API communication from failing due to ByteString errors
- Shell output from displaying garbled text
- JSON serialization from failing due to invalid characters

### 3. API Key Sanitization Tests

**File:** `packages/cli/src/providers/providerManagerInstance.test.ts`

Tests centralized API key sanitization:

- ✅ Sanitizes API keys containing Unicode replacement characters
- ✅ Sanitizes API keys with control characters
- ✅ Handles API keys from files with BOM (Byte Order Mark)
- ✅ Warns when sanitization removes characters
- ✅ Applies sanitization to all providers consistently

These tests ensure:

- API keys work across all providers (OpenAI, Anthropic, Gemini)
- Files with encoding issues don't cause authentication failures
- Users are warned when their API key files have encoding problems

## Running the Tests

To run all regression tests:

```bash
npm run test
```

To run specific regression tests:

```bash
# Shell execution tests
cd packages/core && npm run test -- shellExecutionService.windows.multibyte.test.ts

# Unicode utilities tests
cd packages/core && npm run test -- unicodeUtils.test.ts

# API key sanitization tests
cd packages/cli && npm run test -- providerManagerInstance.test.ts
```

## Test Design Principles

1. **Behavioral Testing**: Tests focus on observable behavior rather than implementation details
2. **Platform Awareness**: Windows-specific tests check for the platform when needed
3. **Existing Patterns**: Tests follow the existing vitest framework and mocking patterns
4. **Real-World Scenarios**: Tests include actual encoding issues encountered by users

## Protection Against Regressions

These tests will catch regressions in:

1. Shell command execution hanging with multibyte text
2. API requests failing with "Cannot convert to ByteString" errors
3. Garbled text display in shell output
4. API key loading failures due to file encoding issues

When merging from upstream, these tests ensure that the Windows multibyte fixes remain intact and functional.
