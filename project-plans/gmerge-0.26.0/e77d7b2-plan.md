# REIMPLEMENT Playbook: e77d7b2 — Prevent OOM crash by limiting file search

## Upstream Change Summary

This commit prevents out-of-memory crashes by adding limits to file search operations. The changes:

1. Adds `maxFileCount` and `searchTimeout` to `FileFilteringOptions` and `ConfigParameters`
2. Adds `maxFiles` parameter to `crawl()` function in crawler
3. Truncates file list when `maxFiles` limit is hit
4. Skips caching for truncated results (to avoid incomplete caches)
5. Adds timeout handling in `useAtCompletion` for search operations
6. Sets default limits: 20,000 files, 5 second timeout
7. Updates `FileSearch` and `RecursiveFileSearch` to pass limits to crawler
8. Adds tests for truncation behavior

**Files changed upstream:**
- `packages/cli/src/ui/hooks/useAtCompletion.ts`
- `packages/core/src/config/config.ts`
- `packages/core/src/config/constants.ts`
- `packages/core/src/utils/filesearch/crawler.test.ts`
- `packages/core/src/utils/filesearch/crawler.ts`
- `packages/core/src/utils/filesearch/fileSearch.test.ts`
- `packages/core/src/utils/filesearch/fileSearch.ts`

## LLxprt Current State

### `packages/core/src/config/constants.ts`

LLxprt has `FileFilteringOptions` interface:
```typescript
export interface FileFilteringOptions {
  respectGitIgnore: boolean;
  respectGeminiIgnore: boolean;
  // MISSING: maxFileCount?: number;
  // MISSING: searchTimeout?: number;
}
```

### `packages/core/src/utils/filesearch/fileSearch.ts`

> **LLxprt file path note:** The actual implementation is `packages/core/src/utils/filesearch/fileSearch.ts`, NOT `packages/cli/src/utils/fileSearch.ts`. Always operate on the core package path.

LLxprt has `FileSearchOptions` interface:
```typescript
export interface FileSearchOptions {
  projectRoot: string;
  ignoreDirs: string[];
  useGitignore: boolean;
  useGeminiignore: boolean;
  cache: boolean;
  cacheTtl: number;
  enableRecursiveFileSearch: boolean;
  disableFuzzySearch: boolean;
  maxDepth?: number;
  // MISSING: maxFiles?: number;
}
```

### `packages/core/src/utils/filesearch/crawler.ts`

LLxprt has `CrawlOptions` interface:
```typescript
export interface CrawlOptions {
  crawlDirectory: string;
  cwd: string;
  maxDepth?: number;
  // MISSING: maxFiles?: number;
  ignore: Ignore;
  cache: boolean;
  cacheTtl: number;
}
```

## Adaptation Plan

### 1. Modify `packages/core/src/config/constants.ts`

Add fields to `FileFilteringOptions`:
```typescript
export interface FileFilteringOptions {
  respectGitIgnore: boolean;
  respectGeminiIgnore: boolean;
  maxFileCount?: number;   // ADD
  searchTimeout?: number;  // ADD
}

export const DEFAULT_MEMORY_FILE_FILTERING_OPTIONS: FileFilteringOptions = {
  respectGitIgnore: false,
  respectGeminiIgnore: true,
  maxFileCount: 20000,   // ADD
  searchTimeout: 5000,   // ADD
};

export const DEFAULT_FILE_FILTERING_OPTIONS: FileFilteringOptions = {
  respectGitIgnore: true,
  respectGeminiIgnore: true,
  maxFileCount: 20000,   // ADD
  searchTimeout: 5000,   // ADD
};
```

### 2. Modify `packages/core/src/utils/filesearch/crawler.ts`

Add to `CrawlOptions`:
```typescript
export interface CrawlOptions {
  crawlDirectory: string;
  cwd: string;
  maxDepth?: number;
  maxFiles?: number;  // ADD
  ignore: Ignore;
  cache: boolean;
  cacheTtl: number;
}
```

Update `crawl()` function:
```typescript
export async function crawl(options: CrawlOptions): Promise<string[]> {
  // ... existing code
  
  const maxFiles = options.maxFiles ?? Infinity;
  let fileCount = 0;
  let truncated = false;

  let results: string[];
  try {
    results = await new fdir()
      .crawl(options.crawlDirectory)
      .withRelativePaths()
      .withDirs()
      .withPathSeparator('/')
      .filter((path, isDirectory) => {
        if (!isDirectory) {
          fileCount++;
          if (fileCount > maxFiles) {
            truncated = true;
            return false;
          }
        }
        return true;
      })
      .exclude((_, dirPath) => {
        if (fileCount > maxFiles) {
          truncated = true;
          return true;
        }
        // ... existing exclusion logic
      })
      // ... rest
    
    // ... path transformation
    
    // Only cache if not truncated
    if (options.cache && !truncated) {
      // ... caching logic
    }
    
    return results;
  } catch (error) {
    // ... error handling
  }
}
```

### 3. Modify `packages/core/src/utils/filesearch/fileSearch.ts`

> **Correct path:** `packages/core/src/utils/filesearch/fileSearch.ts` (core package, not cli).

Add to `FileSearchOptions`:
```typescript
export interface FileSearchOptions {
  // ... existing fields
  maxFiles?: number;  // ADD
}
```

Update `RecursiveFileSearch.initialize()`:
```typescript
this.allFiles = await crawl({
  crawlDirectory: this.options.projectRoot,
  cwd: this.options.projectRoot,
  ignore: this.ignore,
  cache: this.options.cache,
  cacheTtl: this.options.cacheTtl,
  maxDepth: this.options.maxDepth,
  maxFiles: this.options.maxFiles ?? 20000,  // ADD with default
});
```

> **Decision checkpoint — directory-mode maxFiles:** Upstream does not apply `maxFiles` in directory-mode crawls (only in recursive/file-search mode). Either match upstream exactly (no cap in directory mode) for behavioral parity, or apply the same 20,000 cap for stronger OOM protection. **Document the chosen behavior explicitly in a comment** at the call site.

### 4. Modify `packages/core/src/config/config.ts`

Add to `ConfigParameters.fileFiltering`:
```typescript
fileFiltering?: {
  respectGitIgnore?: boolean;
  respectGeminiIgnore?: boolean;
  enableRecursiveFileSearch?: boolean;
  disableFuzzySearch?: boolean;
  maxFileCount?: number;   // ADD
  searchTimeout?: number;  // ADD
};
```

Update Config class to store and expose these values.

Add getter:
```typescript
getFileFilteringOptions(): { ...; maxFileCount: number; searchTimeout: number } {
  return {
    respectGitIgnore: this.fileFiltering.respectGitIgnore,
    respectGeminiIgnore: this.fileFiltering.respectGeminiIgnore,
    maxFileCount: this.fileFiltering.maxFileCount,
    searchTimeout: this.fileFiltering.searchTimeout,
  };
}
```

### 5. Modify `packages/cli/src/ui/hooks/useAtCompletion.ts`

Add import:
```typescript
import { setTimeout as setTimeoutPromise } from 'node:timers/promises';
```

Add constant:
```typescript
const DEFAULT_SEARCH_TIMEOUT_MS = 5000;
```

Pass maxFiles to FileSearchFactory:
```typescript
const searcher = FileSearchFactory.create({
  // ... existing options
  maxFiles: config?.getFileFilteringOptions()?.maxFileCount,
});
```

Add timeout handling in search function:
```typescript
const timeoutMs =
  config?.getFileFilteringOptions()?.searchTimeout ??
  DEFAULT_SEARCH_TIMEOUT_MS;

// Timeout handler
(async () => {
  try {
    await setTimeoutPromise(timeoutMs, undefined, {
      signal: controller.signal,
    });
    controller.abort();
  } catch {
    // ignore
  }
})();

try {
  const results = await fileSearch.current.search(state.pattern, {
    signal: controller.signal,
  });
  // ... handle results
} catch (error) {
  if (!(error instanceof Error && error.name === 'AbortError')) {
    dispatch({ type: 'ERROR' });
  }
} finally {
  controller.abort();
}
```

### 6. Add Tests

Update `packages/core/src/utils/filesearch/crawler.test.ts`:
```typescript
it('should detect truncation when maxFiles is hit', async () => {
  tmpDir = await createTmpDir({
    'file1.js': '',
    'file2.js': '',
    'file3.js': '',
  });

  const paths = await crawl({
    crawlDirectory: tmpDir,
    cwd: tmpDir,
    ignore,
    cache: false,
    cacheTtl: 0,
    maxFiles: 2,
  });

  const files = paths.filter((p) => p !== '.' && !p.endsWith('/'));
  expect(files.length).toBe(2);
});
```

Add truncation caching test:
```typescript
it('should NOT write to cache when results are truncated', async () => {
  // Setup: create more files than maxFiles
  // Run crawl with cache: true and maxFiles: 2
  // Run again with maxFiles: 3 (cache miss expected — truncated result was not cached)
  // Assert second run returns more files (proving no stale truncated cache was used)
});
```

Update `packages/core/src/utils/filesearch/fileSearch.test.ts`:
```typescript
it('should respect default maxFiles budget of 20000 in RecursiveFileSearch', async () => {
  const crawlSpy = vi.spyOn(crawler, 'crawl');
  
  // ... setup
  
  await fileSearch.initialize();

  expect(crawlSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      maxFiles: 20000,
    }),
  );
});
```

Add CLI hook tests in `packages/cli/src/ui/hooks/useAtCompletion.test.ts`:
```typescript
it('should abort file search on timeout and not dispatch ERROR', async () => {
  // Mock file search to hang (never resolve within timeout)
  // Assert: dispatch is NOT called with { type: 'ERROR' }
  // Assert: AbortError is swallowed silently
});

it('should handle AbortError from search without dispatching ERROR', async () => {
  // Mock file search to throw an AbortError
  // Assert: dispatch is NOT called with { type: 'ERROR' }
  // (AbortError = intentional cancellation, not a real error)
});
```

## Files to Read

1. `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/core/src/config/constants.ts`
2. `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/core/src/utils/filesearch/crawler.ts`
3. `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/core/src/utils/filesearch/fileSearch.ts` (**core** package, NOT cli)
4. `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/core/src/config/config.ts`
5. `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/ui/hooks/useAtCompletion.ts`
6. `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/config/settingsSchema.ts` (verify if fileFiltering config is consumed here)
7. Check `packages/a2a-server/src/config/` — if it consumes the shared config, ensure `maxFileCount`/`searchTimeout` propagate correctly

## Files to Modify

1. `packages/core/src/config/constants.ts` - Add maxFileCount and searchTimeout
2. `packages/core/src/utils/filesearch/crawler.ts` - Add maxFiles support
3. `packages/core/src/utils/filesearch/fileSearch.ts` - Pass maxFiles to crawler (**core** package)
4. `packages/core/src/config/config.ts` - Store and expose file filtering limits
5. `packages/cli/src/ui/hooks/useAtCompletion.ts` - Add timeout handling
6. `packages/cli/src/config/settingsSchema.ts` - Add maxFileCount/searchTimeout fields (if present)
7. Test files - Add tests for truncation, caching, and CLI hook abort behavior

## Specific Verification

1. TypeScript compilation: `npm run typecheck`
2. All tests pass: `npm run test`
3. Large directories don't crash with OOM
4. File search completes or times out gracefully
5. Verify `packages/cli/src/config/settingsSchema.ts` accepts new fields without type errors
6. If `packages/a2a-server/src/config/` consumes shared config, verify no type errors there either

## Notes

This is a critical fix for stability. Projects with tens of thousands of files could previously cause the CLI to run out of memory during file search operations. The limits provide a safety boundary while still supporting large projects.
