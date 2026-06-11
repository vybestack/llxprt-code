# Isolated Package Evidence: No Duplicate Production Files

Plan ID: PLAN-20260608-ISSUE1585
Issue: #1585

This document specifies the evidence that MUST be verified after P15 cleanup to prove there are no duplicate production files in both `packages/core` and `packages/tools` (except for the approved retained core files), and no `packages/tools` imports from core source.

## Required Post-P15 Evidence

### 1. No Duplicate Production Files

After P15 removes moved files from core, there MUST NOT be any production TypeScript file that exists in both `packages/core/src/tools/` and `packages/tools/src/` (except the approved retained allowlist).

```bash
# Find files that exist in both core/tools and packages/tools (excluding tests)
comm -12 \
  <(find packages/core/src/tools -type f -name '*.ts' ! -name '*.test.ts' ! -name '*.spec.ts' | sed 's|packages/core/src/tools/||' | sort) \
  <(find packages/tools/src -type f -name '*.ts' ! -name '*.test.ts' ! -name '*.spec.ts' | sed 's|packages/tools/src/||' | sort)
# Expected: zero matches (no duplicate filenames in both packages)
# Exception: tool-key-storage.ts may appear if pure functions have same filename but different content
# This is acceptable because core retains the class implementation while tools gets the pure functions
```

### 2. No packages/tools Import From Core Source

```bash
# No imports from core source paths in tools
rg -n "from.*packages/core/src\|from.*@vybestack/llxprt-code-core" packages/tools/src -g "*.ts"
# Expected: zero matches
```

### 3. No packages/tools Import From Core via Deep Paths

```bash
# No @vybestack/llxprt-code-core deep imports in tools
rg -n "@vybestack/llxprt-code-core" packages/tools/src -g "*.ts"
# Expected: zero matches
```

### 4. Retained Core Tools File List Matches Allowlist

```bash
find packages/core/src/tools -type f -name '*.ts' | sort
# Must match approved retained-file list exactly:
# - mcp-client.ts
# - mcp-client-manager.ts
# - tool-key-storage.ts
# - mcp-client.test.ts (if exists)
# - mcp-client-manager.test.ts (if exists)
# - tool-key-storage.test.ts (if exists)
# - mcp-tool.ts (ONLY if classified STAY_CORE_INFRASTRUCTURE)
# - lsp-diagnostics-helper.ts (ONLY if classified STAY_CORE_INFRASTRUCTURE)
# Any other STAY_CORE_INFRASTRUCTURE/STAY_UNTIL_FUTURE_PKG with explicit rationale
```

## P15a Verification

P15a MUST run all the commands above and record output in the completion artifact.