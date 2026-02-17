# Pseudocode: Resume Progress Overlay

## Interface Contracts

```typescript
// INPUTS
interface ResumeProgressOverlayProps {
  isResuming: boolean;  // Controlled by useSessionBrowser.isResuming
}

// OUTPUTS
// Renders a React/Ink component showing "Resuming..." when active

// DEPENDENCIES
// - Text from Ink
// - SemanticColors from ../colors
```

## Integration Points

```
Line 10: RENDERED inside SessionBrowserDialog
         - Placed above the detail line, below the session list
         - Controlled by browser.isResuming state

Line 15: BLOCKS ALL KEYBOARD INPUT when visible
         - The blocking is handled by useSessionBrowser.handleKeypress (line 187)
         - This component only handles rendering, not input blocking
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Put keyboard blocking logic in this component
[OK] DO: Keyboard blocking is in useSessionBrowser.handleKeypress

[ERROR] DO NOT: Make this a separate dialog or overlay that covers the browser
[OK] DO: Render inline within the browser component
```

## Component

```
10: FUNCTION ResumeProgressOverlay(props: ResumeProgressOverlayProps): ReactElement | null
11:   IF NOT props.isResuming THEN
12:     RETURN null
13:   END IF
14:
15:   RETURN (
16:     <Text color={SemanticColors.text.secondary}>Resuming...</Text>
17:   )
18: END FUNCTION
```

## Notes

This is an intentionally minimal component. The complexity of resume progress lives in:
1. `useSessionBrowser` — manages `isResuming` state and blocks keyboard input
2. `SessionBrowserDialog` — renders the overlay in the correct layout position
3. `performResume` — does the actual async work

The overlay is just a visual indicator. Its simplicity is a feature.
