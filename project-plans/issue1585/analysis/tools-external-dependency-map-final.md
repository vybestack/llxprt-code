# Tools External Dependency Map Final: Complete Per-File Classification For ALL Moved Files

Plan ID: PLAN-20260608-ISSUE1585
Issue: #1585
Generated: 2026-06-08 (review-08 required artifact)

This document provides the complete external import classification for every file classified to move into `packages/tools`, including tools-bound files, moved utilities, and service/helper files. It is generated from actual source imports and must be re-verified before P11 execution.

## Generation Commands (Run During P09)

```bash
# 1. Generate per-file external import list for all tools-bound production files
rg -n "^import .* from ['\"][^./]" packages/core/src/tools -g "*.ts" | \
  rg -v "__tests__|\.test\.|\.spec\." | sort > project-plans/issue1585/analysis/tools-external-imports-raw.txt

# 2. Generate per-file external import list for all MOVE_PURE_UTILITY files
#    (use moved-non-tools-utils.txt produced during P09 classification)
cat project-plans/issue1585/analysis/moved-non-tools-utils.txt 2>/dev/null | \
  xargs rg -n "^import .* from ['\"][^./]" 2>/dev/null | sort > project-plans/issue1585/analysis/moved-utility-external-imports-raw.txt

# 3. Combined: all external imports across all moved production files
cat project-plans/issue1585/analysis/tools-external-imports-raw.txt \
    project-plans/issue1585/analysis/moved-utility-external-imports-raw.txt | sort -u > project-plans/issue1585/analysis/all-moved-external-imports-raw.txt
```

## Classification Schema

Every non-relative import in every moved production file MUST be classified as one of:

| Classification | Description | Action |
| --- | --- | --- |
| `RUNTIME` | Import used in production code path | MUST be in `packages/tools/package.json` dependencies |
| `TYPE_ONLY` | `import type` only — erased at compile | If from npm package, must still be in dependencies |
| `TEST_ONLY` | Used only in `*.test.ts` or `*.spec.ts` files | Must be in devDependencies, NOT dependencies |
| `STDLIB` | Node.js built-in (`node:fs`, `node:path`, etc.) | No action needed |
| `MONOREPO_LOCAL` | Import from `@vybestack/llxprt-code-tools` (self-reference) | No action needed |
| `FORBIDDEN` | Import from core/providers/cli | MUST NOT exist — build must fail |

## Known External Runtime Dependencies (Pre-Classified)

Based on current analysis of `packages/core/src/tools` and the `MOVE_PURE_UTILITY` list from `analysis/non-tools-core-utility-ownership-final.md`:

| Package | Version | Used By (Tools Files) | Used By (Moved Utility Files) | Classification |
| --- | --- | --- | --- | --- |
| `@ast-grep/napi` | `^0.40.5` | ast-grep.ts, structural-analysis.ts, ast-edit/*.ts | | RUNTIME |
| `@google/genai` | `1.30.0` | read-file.ts, read_line_range.ts, read-many-files.ts, memoryTool.ts, tool-registry.ts, mcp-tool.ts, todo-*.ts, ToolFormatter.test.ts | | RUNTIME |
| `cheerio` | `^1.1.2` | direct-web-fetch.ts | | RUNTIME |
| `diff` | `^8.0.3` | edit.ts, apply-patch.ts, delete_line_range.ts, insert_at_line.ts, write-file.ts, modifiable-tool.ts, memoryTool.ts, ast-edit-invocation.ts | | RUNTIME |
| `fast-glob` | `^3.3.3` | ast-grep.ts, structural-analysis.ts | | RUNTIME |
| `glob` | `^12.0.0` | glob.ts, read-many-files.ts, grep.ts | | RUNTIME |
| `html-to-text` | `^9.0.5` | google-web-fetch.ts | | RUNTIME |
| `node-fetch` | `^3.3.2` | codesearch.ts, direct-web-fetch.ts, exa-web-search.ts | | RUNTIME |
| `shell-quote` | `^1.8.3` | tool-registry.ts | | RUNTIME |
| `turndown` | `^7.2.2` | direct-web-fetch.ts | | RUNTIME |
| `zod` | `^3.25.76` | activate-skill.ts, todo-schemas.ts | | RUNTIME |
| `zod-to-json-schema` | `^3.25.1` | activate-skill.ts | | RUNTIME |

## Moved Utility External Dependencies (To Be Completed During P09)

When P09 classifies utilities with `MOVE_PURE_UTILITY`, scan their external imports and add any new packages discovered to the table above and to `packages/tools/package.json` dependencies.

### Expected Moved Utility Scan

These MOVE_PURE_UTILITY files from `analysis/non-tools-core-utility-ownership-final.md` may introduce additional external dependencies:

| Utility File | Known External Imports | Classification |
| --- | --- | --- |
| `utils/schemaValidator.ts` | `zod` (already in deps) | RUNTIME (already declared) |
| `utils/fetch.ts` | `node-fetch` (already in deps) | RUNTIME (already declared) |
| `utils/shell-parser.ts` | (parses shell without external deps — verify) | P09 verification needed |
| All other utils | (typically pure Node.js stdlib or no deps) | P09 verification needed |

**P09 obligation**: After classifying every utility as MOVE_PURE_UTILITY, run the external import scan and add any newly-discovered packages to both this table and `packages/tools/package.json`.

## Conditional MCP Dependency

| Package | Version | Used By (Conditional) | Classification | Condition |
| --- | --- | --- | --- | --- |
| `@modelcontextprotocol/sdk` | `^1.0.0` | mcp-tool.ts (if it moves) | RUNTIME | Only if `analysis/mcp-tool-decision.md` classifies mcp-tool.ts as MOVE_AFTER_INTERFACE |

## Post-P11 Verification

After all P11 migration groups complete, run the full transitive external import scan to verify complete dependency coverage:

```bash
# Full post-move external import scan (production code only)
rg -n "^import .* from ['\"][^./]" packages/tools/src -g "*.ts" | rg -v "__tests__|\.test\.|\.spec\." | sort
```

Every external package in the production scan MUST be listed in `packages/tools/package.json` dependencies. Any missing package is a defect that must be fixed before P11 completion.