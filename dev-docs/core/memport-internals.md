# Memory Import Internals

Implementation record for the memory import processor. For the user-facing
guide, see [docs/core/memport.md](../../docs/core/memport.md).

## Status and authority

Authoritative for the internal API surface, import tree structure, and
cross-product comparison. Updated alongside changes to the listed source files.

## Context

The memory import processor resolves `@file.md` directives in `LLXPRT.md`
files. It supports two output formats — `tree` (nested inline with hierarchy
preserved) and `flat` (each file delimited by markers) — selected by the
`ui.memoryImportFormat` setting (default: `tree`).

## Source and test locations

- Processor: `packages/core/src/utils/memoryImportProcessor.ts`
- Discovery (calls `processImports`): `packages/core/src/utils/memoryDiscovery.ts`
- Settings schema: `packages/cli/src/config/settings-schema/schema-ui.ts`
  (`memoryImportFormat`)
- Tests: `packages/core/src/utils/memoryImportProcessor.test.ts`,
  `packages/core/src/utils/memoryImportProcessor.issue391.test.ts`

## API reference

### `processImports(content, basePath, debugMode?, importState?, projectRoot?, importFormat?)`

Processes import statements in `LLXPRT.md` content.

**Parameters:**

- `content` (string): the content to process for imports.
- `basePath` (string): the directory path where the current file is located.
- `debugMode` (boolean, optional): enables verbose logging. Default: `false`.
- `importState` (ImportState, optional): state tracking for circular import
  prevention and depth limiting.
- `projectRoot` (string, optional): the project root for path validation.
  Auto-detected via `findProjectRoot` if omitted.
- `importFormat` (`'flat' | 'tree'`, optional): output format. Default: `'tree'`.

**Returns:** `Promise<ProcessImportsResult>` — the processed content and the
import tree.

### `ProcessImportsResult`

```typescript
interface ProcessImportsResult {
  content: string; // The processed content with imports resolved
  importTree: MemoryFile; // Tree structure showing the import hierarchy
}
```

### `MemoryFile`

```typescript
interface MemoryFile {
  path: string; // The file path
  imports?: MemoryFile[]; // Direct imports, in the order they were imported
}
```

### `validateImportPath(importPath, basePath, allowedDirectories)`

Validates that an import path is safe and within allowed directories. Rejects
URL-based paths (`file://`, `http://`, `https://`) and paths that resolve outside
the allowed directories.

**Parameters:**

- `importPath` (string): the import path to validate.
- `basePath` (string): the base directory for resolving relative paths.
- `allowedDirectories` (string[]): array of allowed directory paths.

**Returns:** `boolean` — whether the import path is valid.

### `findProjectRoot(startDir)`

Finds the project root by searching for a `.git` directory upwards from the
given start directory. Implemented as an **async** function using non-blocking
file system APIs.

**Parameters:**

- `startDir` (string): the directory to start searching from.

**Returns:** `Promise<string>` — the project root directory (or the start
directory if no `.git` is found).

## Import tree structure

The processor returns an import tree showing the hierarchy of imported files.
This structure is internal — it is not surfaced to the user through any CLI
command (`/memory show` displays processed content, `/memory list` displays file
paths). The tree is primarily useful for debugging import chains during
development.

Example tree:

```
Memory Files
 L project: LLXPRT.md
            L a.md
              L b.md
                L c.md
              L d.md
                L e.md
                  L f.md
            L included.md
```

The tree preserves the order files were imported and shows the complete import
chain.

## Debug mode

Debug logging for the import processor is enabled by passing `debugMode: true`
as the third argument to `processImports`. This is a programmatic parameter —
there is no user-facing flag or command that enables import-specific debug
output. The general `--debug` flag and `DEBUG` / `LLXPRT_DEBUG` environment
variables control the global debug system but do not toggle the import
processor's `debugMode` argument independently.

When debug mode is on, the processor emits warnings for:

- Maximum depth exceeded
- Missing files
- Circular imports detected
- Path validation failures

## Comparison to Claude Code's `/memory` (`claude.md`) approach

Claude Code's `/memory` feature produces a flat, linear document by
concatenating all included files, marking file boundaries with comments and path
names. It does not explicitly present an import hierarchy, though the LLM
receives all file contents and paths sufficient to reconstruct the hierarchy.

LLxprt Code's processor builds an explicit import tree (`MemoryFile`) and
supports both `tree` and `flat` output formats. The tree is mainly for clarity
during development; it has limited relevance to LLM consumption.
