# Moved Utility External Dependency Scan Evidence

Plan ID: PLAN-20260608-ISSUE1585
Issue: #1585

This document captures evidence of non-tools utilities being moved to packages/tools and their external dependencies. It extends `analysis/dependency-relocation-final.md` which covers `packages/core/src/tools/**` imports only.

## Scope

The moved-utility external dependency scan covers ALL files classified to move — not just current direct imports under `packages/core/src/tools`. When non-tools utilities are moved (e.g., SchemaValidator, AnsiOutput, pure functions from tool-key-storage, and all MOVE_PURE_UTILITY items from `analysis/non-tools-core-utility-ownership-final.md`), their runtime dependencies MUST also be declared in `packages/tools/package.json`.

## Evidence Collection Commands (P09)

```bash
# 1. Inventory all MOVE_PURE_UTILITY files from non-tools-core-utility-ownership-final.md
cat project-plans/issue1585/analysis/non-tools-core-utility-ownership-final.md | grep "MOVE_PURE_UTILITY" | awk -F'|' '{print $2}' | sed 's/^ //;s/ $//' | while read util; do
  echo "=== $util ==="
  rg -n "^import .* from ['\"][^./]" "packages/core/src/$util" -g "*.ts" 2>/dev/null || echo "(no external imports)"
done > project-plans/issue1585/analysis/moved-utility-external-imports.txt

# 2. Cross-reference against tools package.json dependencies
cat project-plans/issue1585/analysis/moved-utility-external-imports.txt | grep -v "^===" | awk -F"from ['" '{print $2}' | awk -F"'" '{print $1}' | sort -u | while read pkg; do
  node -e "const p=require('./packages/tools/package.json'); const d=Object.keys({...p.dependencies,...(p.devDependencies||{})}); if (!d.includes('$pkg')) { console.error('UNDECLARED IN TOOLS: $pkg'); process.exit(1); }" 2>/dev/null || true
done

# 3. Full post-P11 scan (production code only)
rg -n "^import .* from ['\"][^./]" packages/tools/src -g "*.ts" | rg -v "__tests__|\.test\.|\.spec\.|node:|vitest|@vybestack/llxprt-code-tools" > project-plans/issue1585/analysis/post-p11-external-imports.txt
```

## Known Moved Utilities With External Dependencies

| Utility | External Deps | Already In tools/package.json? |
| --- | --- | --- |
| SchemaValidator | `zod` | Yes |
| fetchWithTimeout, isPrivateIp | `node-fetch` | Yes |
| initializeParser | (none external) | N/A |
| safeJsonStringify | (none external) | N/A |
| gitLineChanges | (none external) | N/A |
| summarizer | (none external) | N/A |
| All other MOVE_PURE_UTILITY items | TBD during P09 scan | TBD |

## P09/P11 Verification

P09 must run the scan above and add any undeclared dependencies to `packages/tools/package.json`.

P11 must re-run the scan after each migration group to catch any newly moved utility dependencies.