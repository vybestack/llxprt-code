# Top-Level Export Compatibility Evidence

Plan ID: PLAN-20260608-ISSUE1585
Issue: #1585

This document specifies the evidence that MUST be captured proving `packages/core/src/index.ts` re-exports all tool symbols needed by CLI/A2A while package deep exports for moved tools are removed.

## Evidence Collection (During P00a or P03)

### Current Core Top-Level Exports Baseline

```bash
rg -n "export .* from './tools/" packages/core/src/index.ts > project-plans/issue1585/analysis/core-top-level-tool-export-baseline.txt
```

### Current CLI Imports From Core

```bash
rg -n "from '@vybestack/llxprt-code-core'" packages/cli/src -g "*.ts" | rg -i "tool|Tool" > project-plans/issue1585/analysis/cli-tool-imports-baseline.txt
```

### Current A2A Imports From Core

```bash
rg -n "from '@vybestack/llxprt-code-core'" packages/a2a-server/src -g "*.ts" | rg -i "tool|Tool|registry" > project-plans/issue1585/analysis/a2a-tool-imports-baseline.txt
```

## Required Post-P13 Compatibility Proof

After consumer migration (P13), the following MUST be verified:

1. **Core top-level re-exports cover all CLI tool type needs**: Every tool type imported by CLI from `@vybestack/llxprt-code-core` must still resolve after core switches from `'./tools/*'` to `'@vybestack/llxprt-code-tools'` re-exports.

2. **Core top-level re-exports cover all A2A needs**: ToolRegistry and related types imported by A2A from core must still resolve.

3. **No deep exports for moved modules remain**: `rg -n "./tools/" packages/core/package.json` must only show retained infrastructure paths (mcp-client, mcp-client-manager).

4. **Tools deep exports removed from core**: `node -e "const p=require('./packages/core/package.json'); const moved=Object.keys(p.exports||{}).filter(k=>k.startsWith('./tools/') && k !== './tools/mcp-client.js' && k !== './tools/mcp-client-manager.js'); if (moved.length) { console.error('DANGLING DEEP EXPORTS:', moved); process.exit(1); }"`

## Verification Command (P13/P16)

```bash
# Verify CLI tool types still resolve through core
npm run typecheck --workspace @vybestack/llxprt-code
# Verify A2A tool types still resolve through core
npm run typecheck --workspace @vybestack/llxprt-code-a2a-server
# Verify no dangling deep exports in core
node -e "const p=require('./packages/core/package.json'); const moved=Object.keys(p.exports||{}).filter(k=>k.startsWith('./tools/') && k !== './tools/mcp-client.js' && k !== './tools/mcp-client-manager.js'); if (moved.length) { console.error('DANGLING DEEP EXPORTS:', moved); process.exit(1); }"
```