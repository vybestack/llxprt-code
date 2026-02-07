# StickyHeader Integration Plan

**Branch:** `20260129gmerge`
**Prerequisite:** Interactive Shell Feature (for full integration)
**Priority:** MEDIUM - Depends on Interactive Shell for full feature parity

---

## Current State

| Component | Status |
|-----------|--------|
| `StickyHeader.tsx` | DONE - Created in Batch 3 (commit e0d9a129a) |
| `@jrichman/ink@6.4.8` | DONE - Has `sticky` prop support |
| `useAlternateBuffer` hook | NOT NEEDED - LLxprt defaults to alternate buffer |
| `ToolMessage.tsx` integration | PENDING |
| `ToolGroupMessage.tsx` integration | PENDING |

---

## StickyHeader Component (Already Done)

Location: `packages/cli/src/ui/components/StickyHeader.tsx`

```typescript
export interface StickyHeaderProps {
  children: React.ReactNode;
  width: number;
  isFirst: boolean;
  borderColor: string;
  borderDimColor: boolean;
}
```

Uses Ink's `sticky` and `stickyChildren` props from `@jrichman/ink@6.4.8`.

---

## Integration Dependencies

### Minimal Integration (Without Interactive Shell)
Can be done now, but will need updates when Interactive Shell is added:

1. Add props to `ToolMessage.tsx`:
   - `isFirst: boolean`
   - `borderColor: string`
   - `borderDimColor: boolean`

2. Wrap header content in `<StickyHeader>` 

3. Update `ToolGroupMessage.tsx` to pass props

### Full Integration (With Interactive Shell)
Requires Interactive Shell feature first:

1. All minimal integration changes, plus:
2. `AnsiOutputText` for rendering shell output
3. `ShellInputPrompt` for focused shell input
4. Shell focus state (`activeShellPtyId`, `embeddedShellFocused`)
5. Focus hints ("ctrl+f to focus")

---

## Implementation Plan

### Option A: Minimal Now, Full Later

**Phase 1: Minimal Integration (Now)**
1. Update `ToolMessage.tsx`:
   - Add `isFirst`, `borderColor`, `borderDimColor` props
   - Import and use `StickyHeader` component
   - Keep existing LLxprt-specific features (ctrl+r toggle, subcommand display)
   - Skip shell focus features (no AnsiOutputText, no ShellInputPrompt)

2. Update `ToolGroupMessage.tsx`:
   - Calculate `isFirst` for each tool
   - Pass border props to each ToolMessage

3. Update callers to provide new props

**Phase 2: Full Integration (After Interactive Shell)**
1. Add AnsiOutputText rendering
2. Add ShellInputPrompt
3. Add shell focus state and hints
4. Full feature parity with upstream

### Option B: Wait for Interactive Shell

Do Interactive Shell first, then integrate StickyHeader with full features.

---

## Recommended Approach: Option A

Reason: StickyHeader provides immediate UX value (headers stay visible when scrolling long tool output). The interactive shell features can be added incrementally later.

---

## Minimal Integration Changes

### `ToolMessage.tsx`

```diff
+ import { StickyHeader } from '../StickyHeader.js';

  export interface ToolMessageProps extends IndividualToolCallDisplay {
    availableTerminalHeight?: number;
    terminalWidth: number;
    emphasis?: TextEmphasis;
    renderOutputAsMarkdown?: boolean;
+   isFirst: boolean;
+   borderColor: string;
+   borderDimColor: boolean;
  }

  // In the render:
- return (
-   <Box paddingX={1} paddingY={0} flexDirection="column">
-     <Box minHeight={1}>
-       <ToolStatusIndicator status={status} name={name} />
-       <ToolInfo ... />
-       {emphasis === 'high' && <TrailingIndicator />}
-     </Box>
-     {/* ... rest of content ... */}
-   </Box>
- );

+ return (
+   <>
+     <StickyHeader
+       width={terminalWidth}
+       isFirst={isFirst}
+       borderColor={borderColor}
+       borderDimColor={borderDimColor}
+     >
+       <ToolStatusIndicator status={status} name={name} />
+       <ToolInfo ... />
+       {emphasis === 'high' && <TrailingIndicator />}
+     </StickyHeader>
+     <Box
+       width={terminalWidth}
+       borderStyle="round"
+       borderColor={borderColor}
+       borderDimColor={borderDimColor}
+       borderTop={false}
+       borderBottom={false}
+       paddingX={1}
+       flexDirection="column"
+     >
+       {/* ... content ... */}
+     </Box>
+   </>
+ );
```

### `ToolGroupMessage.tsx`

```diff
  // Pass isFirst to first tool, false to rest
  {tools.map((tool, index) => (
    <ToolMessage
      key={tool.id}
      {...tool}
+     isFirst={index === 0}
+     borderColor={borderColor}
+     borderDimColor={borderDimColor}
      terminalWidth={terminalWidth}
      ...
    />
  ))}
```

---

## Testing

- [ ] Tool headers stay visible when scrolling long output
- [ ] First tool in group shows top border
- [ ] Subsequent tools don't show top border (connected appearance)
- [ ] Border colors match theme
- [ ] Existing features still work (ctrl+r toggle, AST validation display, diff renderer)

---

## Estimated Effort

**Minimal Integration:** 2-3 hours
**Full Integration (after Interactive Shell):** 1-2 hours additional

---

## Notes

- The StickyHeader component is already battle-tested in upstream
- LLxprt has unique features in ToolMessage (ctrl+r toggle, subcommand inference) that must be preserved
- Border colors come from theme - need to verify color constants match
