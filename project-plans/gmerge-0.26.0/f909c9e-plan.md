# REIMPLEMENT Playbook: f909c9e — Add source tracking to policy rules

## Upstream Change Summary

This commit adds a `source?: string` field to `PolicyRule` to track where each rule came from. The changes:

1. Adds `source?: string` field to `PolicyRule` interface
2. Sets source for all rules created from TOML files (format: "User: filename" or "Default: filename")
3. Sets source for rules created from settings (e.g., "Settings (MCP Trusted)")
4. Sets source for dynamic rules (e.g., "Dynamic (Confirmed)")
5. Updates policies list command to display source in output
6. Updates tests to verify source tracking

**Files changed upstream:**
- `packages/cli/src/ui/commands/policiesCommand.test.ts`
- `packages/cli/src/ui/commands/policiesCommand.ts`
- `packages/core/src/policy/config.ts`
- `packages/core/src/policy/toml-loader.test.ts`
- `packages/core/src/policy/toml-loader.ts`
- `packages/core/src/policy/types.ts`

> **LLxprt file path note:** The primary implementation file is `packages/core/src/policy/policy-engine.ts` (hyphenated), NOT `packages/core/src/policy/policyEngine.ts` (camelCase). Verify the actual filename before editing.

## LLxprt Current State

### `packages/core/src/policy/types.ts`

LLxprt has this file. Current `PolicyRule` interface:
```typescript
export interface PolicyRule {
  name?: string;
  toolName?: string;
  argsPattern?: RegExp;
  decision: PolicyDecision;
  priority?: number;
  allowRedirection?: boolean;
  // MISSING: source?: string;
}
```

### Other Files

Need to verify existence and current state of:
- `packages/core/src/policy/policy-engine.ts` (**hyphenated** — do NOT assume camelCase)
- `packages/core/src/policy/config.ts`
- `packages/core/src/policy/toml-loader.ts`
- `packages/cli/src/ui/commands/policiesCommand.ts`

## Adaptation Plan

### 1. Modify `packages/core/src/policy/types.ts`

Add `source` field to `PolicyRule`:
```typescript
export interface PolicyRule {
  name?: string;
  toolName?: string;
  argsPattern?: RegExp;
  decision: PolicyDecision;
  priority?: number;
  allowRedirection?: boolean;
  
  /**
   * Origin of the rule's source.
   * e.g. "Default: defaults.toml", "User: my-policies.toml",
   * "Settings (MCP Trusted)", "Dynamic (Confirmed)", etc.
   */
  source?: string;  // ADD THIS
}
```

### 2. Modify `packages/core/src/policy/toml-loader.ts`

Add source when creating rules from TOML. The label format depends on the tier:
- Default tier → `Default: <filename>`
- User tier → `User: <filename>`
- Admin tier → `Admin: <filename>`

```typescript
const rule: PolicyRule = {
  toolName,
  decision,
  priority: transformPriority(rule.priority, tier),
  modes: rule.modes,
  allowRedirection: rule.allow_redirection,
  source: `${tierName.charAt(0).toUpperCase() + tierName.slice(1)}: ${file}`,  // ADD THIS
};
```

Use only the basename of the file path (not the full absolute path) as the `<file>` portion.

### 3. Modify `packages/core/src/policy/config.ts`

Add `source` to **all** rule creation paths. The complete set of required labels:

| Rule creation path | Source label |
|---|---|
| TOML default tier | `Default: <file>` |
| TOML user tier | `User: <file>` |
| TOML admin tier | `Admin: <file>` |
| Settings MCP excluded | `Settings (MCP Excluded)` |
| Settings tools excluded | `Settings (Tools Excluded)` |
| Settings tools allowed | `Settings (Tools Allowed)` |
| Settings MCP trusted | `Settings (MCP Trusted)` |
| Settings MCP allowed | `Settings (MCP Allowed)` |
| Dynamic confirmed rule | `Dynamic (Confirmed)` |
| Legacy YOLO migration | `Legacy (YOLO)` |
| Legacy AUTO_EDIT migration | `Legacy (AUTO_EDIT)` |
| Legacy --allowed-tools migration | `Legacy (--allowed-tools)` |

Examples for each settings-derived path in `config.ts`:

For MCP excluded servers:
```typescript
rules.push({
  toolName: `${serverName}__*`,
  decision: PolicyDecision.DENY,
  priority: 2.9,
  source: 'Settings (MCP Excluded)',  // ADD THIS
});
```

For tools excluded:
```typescript
rules.push({
  toolName: tool,
  decision: PolicyDecision.DENY,
  priority: 2.4,
  source: 'Settings (Tools Excluded)',  // ADD THIS
});
```

For tools allowed:
```typescript
rules.push({
  toolName,
  decision: PolicyDecision.ALLOW,
  priority: 2.3,
  source: 'Settings (Tools Allowed)',  // ADD THIS
});
```

For MCP trusted:
```typescript
rules.push({
  toolName: `${serverName}__*`,
  decision: PolicyDecision.ALLOW,
  priority: 2.2,
  source: 'Settings (MCP Trusted)',  // ADD THIS
});
```

For MCP allowed:
```typescript
rules.push({
  toolName: `${serverName}__*`,
  decision: PolicyDecision.ALLOW,
  priority: 2.1,
  source: 'Settings (MCP Allowed)',  // ADD THIS
});
```

For dynamic rules (confirmed):
```typescript
rules.push({
  toolName,
  decision: PolicyDecision.ALLOW,
  priority: 2.95,
  argsPattern: new RegExp(pattern),
  source: 'Dynamic (Confirmed)',  // ADD THIS
});
```

For legacy migration rules (wherever YOLO/AUTO_EDIT/--allowed-tools are migrated to policy rules):
```typescript
// Legacy YOLO
source: 'Legacy (YOLO)',
// Legacy AUTO_EDIT
source: 'Legacy (AUTO_EDIT)',
// Legacy --allowed-tools
source: 'Legacy (--allowed-tools)',
```

### 4. Modify `packages/cli/src/ui/commands/policiesCommand.ts`

**Important:** LLxprt uses a tier-grouped display format for `/policies` output — do NOT blindly copy upstream's flat list formatting. Read the existing `policiesCommand.ts` first to understand the current output structure, then append `[Source: <source>]` to each rule line within that structure.

The pattern to add is:
```typescript
if (rule.source) {
  content += ` [Source: ${rule.source}]`;  // ADD to existing rule line rendering
}
```

Ensure the append happens at the end of the per-rule line, after any existing `[Priority: ...]` suffix, preserving the existing tier grouping and numbering.

### 5. Update Tests

Add tests for all four source attribution categories:

**TOML source attribution** — `packages/core/src/policy/toml-loader.test.ts`:
```typescript
expect(result.rules[0].source).toBe('User: tier2.toml');
expect(result.rules[0].source).toBe('Default: defaults.toml');
expect(result.rules[0].source).toBe('Admin: admin.toml');
```

**Settings source attribution** — `packages/core/src/policy/config.ts` tests:
```typescript
// Each settings-derived rule should carry the correct label
expect(rule.source).toBe('Settings (MCP Trusted)');
expect(rule.source).toBe('Settings (MCP Excluded)');
expect(rule.source).toBe('Settings (Tools Excluded)');
expect(rule.source).toBe('Settings (Tools Allowed)');
expect(rule.source).toBe('Settings (MCP Allowed)');
```

**Dynamic source attribution**:
```typescript
expect(rule.source).toBe('Dynamic (Confirmed)');
```

**`/policies` output** — `packages/cli/src/ui/commands/policiesCommand.test.ts`:
```typescript
// Rule line should include [Source: ...] suffix
expect(content).toContain('[Source: User: test.toml]');
expect(content).toContain('[Source: Settings (MCP Trusted)]');
```

> Adapt expected strings to match LLxprt's actual tier-grouped output format rather than a flat numbered list.

## Files to Read

1. `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/core/src/policy/types.ts`
2. `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/core/src/policy/config.ts`
3. `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/core/src/policy/toml-loader.ts`
4. `/Users/acoliver/projects/llxprt/branch-1/llxprt-code/packages/cli/src/ui/commands/policiesCommand.ts`

## Files to Modify

1. `packages/core/src/policy/types.ts` - Add source field
2. `packages/core/src/policy/toml-loader.ts` - Set source for TOML rules
3. `packages/core/src/policy/config.ts` - Set source for settings-derived rules
4. `packages/cli/src/ui/commands/policiesCommand.ts` - Display source
5. Test files - Add source to test fixtures and expectations

## Specific Verification

1. TypeScript compilation: `npm run typecheck`
2. All tests pass: `npm run test`
3. Policy list command shows source:
   - `/policies list` should show `[Source: ...]` for each rule

## Notes

This change improves transparency by showing users where each policy rule came from, making it easier to debug policy decisions and understand the precedence of different rule sources.
