# Current Package Graph Evidence

Plan ID: PLAN-20260608-ISSUE1585
Issue: #1585

This document captures the current package dependency graph that MUST be verified during P00a preflight. The post-extraction dependency direction MUST preserve these invariants.

## Required Invariants (Post-Extraction)

| Invariant | Description | Verification |
| --- | --- | --- |
| tools → no core/cli/providers | packages/tools MUST NOT depend on core, cli, or providers | `rg -n "@vybestack/llxprt-code-core\|@vybestack/llxprt-code-providers\|@vybestack/llxprt-code" packages/tools/package.json` → zero matches |
| core → tools | packages/core MUST depend on tools | `node -e "const p=require('./packages/core/package.json'); if (!p.dependencies?.['@vybestack/llxprt-code-tools']) process.exit(1)"` |
| providers → tools + core | packages/providers depends on both tools and core | `node -e "const p=require('./packages/providers/package.json'); if (!p.dependencies?.['@vybestack/llxprt-code-tools'] || !p.dependencies?.['@vybestack/llxprt-code-core']) process.exit(1)"` |
| cli → core + providers only | packages/cli does NOT directly depend on tools | `node -e "const p=require('./packages/cli/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; if (d['@vybestack/llxprt-code-tools']) process.exit(1)"` |
| No cycles | No package cycle among tools/core/providers/cli/a2a | `npm ls --all --depth=0` shows no circular refs |

## Pre-Extraction Current Graph (Evidence Collection During P00a)

```bash
# Current workspace dependency graph
npm ls --all --depth=0 2>/dev/null | head -40

# Current core→cli dependency
node -e "const p=require('./packages/core/package.json'); console.log('core deps:', Object.keys(p.dependencies||{}).filter(k=>k.startsWith('@vybestack')).join(', '))"

# Current providers dependencies
node -e "const p=require('./packages/providers/package.json'); console.log('providers deps:', Object.keys(p.dependencies||{}).filter(k=>k.startsWith('@vybestack')).join(', '))"

# Current CLI dependencies
node -e "const p=require('./packages/cli/package.json'); console.log('cli deps:', Object.keys(p.dependencies||{}).filter(k=>k.startsWith('@vybestack')).join(', '))"

# Verify no tools package exists yet
ls packages/tools 2>&1
# Expected: does not exist yet
```

**Evidence rule**: P00a MUST run these commands, capture output into `analysis/preflight-results.md`, and verify the current graph matches the expected invariants (minus tools, which doesn't exist yet).