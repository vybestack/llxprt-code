# Phase 13a: Consumer Migration Verification

## Phase ID

`PLAN-20260608-ISSUE1585.P13a`

## Purpose

Verify provider formatter/ID behavior, forbidden old imports, and package export maps.

## Prerequisites

- Required: P13 completed (consumer imports migrated).

## Verification Tasks

### Step 1: Zero Old Deep Imports

```bash
rg -n "@vybestack/llxprt-code-core/tools/" packages/providers/src -g "*.ts"
# Expected: zero matches for moved modules (may still have mcp-client if that stays)
```

### Step 2: Provider Formatting Behavior Unchanged

```bash
npm run test --workspace @vybestack/llxprt-code-providers
# Specifically check formatting tests
npm run test --workspace @vybestack/llxprt-code-providers -- --grep "format\|normalization\|tool.*id\|double.*escape"
```

### Step 3: A2A Server Early Feedback Check

Run a preliminary A2A server typecheck and test after consumer migration to catch regressions early, rather than deferring to P16:

```bash
npm run typecheck --workspace @vybestack/llxprt-code-a2a-server
npm run test --workspace @vybestack/llxprt-code-a2a-server
```

If A2A server fails, it may indicate that core re-exports are incomplete or tool types changed. Fix in P13 before proceeding.

### Step 4: Package Export Maps

```bash
# Verify core no longer exports moved modules
node -e "const p=require('./packages/core/package.json'); const tools=Object.keys(p.exports||{}).filter(k=>k.startsWith('./tools/')); console.log('Remaining core tools exports:', tools)"
# Expected: only MCP/retained infrastructure exports
# Verify tools exports exist
node -e "const p=require('./packages/tools/package.json'); console.log(Object.keys(p.exports||{}))"
# Verify IToolFormatter export maps to formatters directory
node -e "const p=require('./packages/tools/package.json'); const e=p.exports&&p.exports['./IToolFormatter.js']; if (!e || !e.includes('formatters')) process.exit(1)"
```

### Step 5: Verify CLI/Direct Consumer Classification

```bash
# CLI should have zero direct tools deep imports using rg (consistent syntax)
rg -n "from ['"]@vybestack/llxprt-code-core/tools/" packages/cli -g "*.ts"
# Expected: zero matches
# Verify specific CLI files named in consumer-rewrite-map-final.md
for f in packages/cli/src/zed-integration/zedIntegration.ts packages/cli/src/nonInteractiveCliSupport.ts packages/cli/src/ui/hooks/slashCommandHandlers.ts packages/cli/src/ui/hooks/useToolScheduler.test.ts packages/cli/src/ui/hooks/atCommandProcessor.ts packages/cli/src/ui/types.ts packages/cli/src/types/message-bus-augmentation.d.ts; do
  if [ -f "$f" ]; then
    echo "=== $f ==="
    rg -n "tools|ToolResult|ToolConfirmation" "$f" | head -5
  fi
done
```

### Step 6: Test All Packages

```bash
npm run typecheck
npm run test --workspaces --if-present
```

## Verification Commands

```bash
npm run typecheck && npm run test --workspaces --if-present
rg -n "@vybestack/llxprt-code-core/tools/" packages/providers/src -g "*.ts"
node -e "const p=require('./packages/core/package.json'); const t=Object.keys(p.exports||{}).filter(k=>k.startsWith('./tools/')); console.log(t)"
```

## Semantic Verification Checklist

- [ ] Zero old deep imports for moved modules.
- [ ] Provider formatting behavior unchanged.
- [ ] Core export map only contains retained infrastructure.
- [ ] Tools package has proper subpath exports (IToolFormatter in formatters/).
- [ ] CLI has zero direct tools deep imports.
- [ ] CLI/direct consumer files explicitly verified per consumer-rewrite-map-final.md.

## Success Criteria

- All checks pass.
- Behavior preserved.

## Failure Recovery

Return to P13 to fix missed rewrites.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P13a.md` with verification output.
