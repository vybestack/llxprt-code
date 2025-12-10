# Message Rendering System Implementation Plan

## Overview

This plan defines a clean, modular message component architecture for the nui TUI application. The goal is to replace the current `[user]`/`[responder]` text prefixes with proper visual decorations using opentui's box border system.

## Current State Analysis

### Existing Code Structure

**`src/ui/components/ChatLayout.tsx`**:

- `renderChatLine(line: ChatLine, theme: ThemeDefinition)` - renders messages with `[role]` prefix
- `renderToolBlock(block: ToolBlock, theme: ThemeDefinition)` - renders tool output in bordered boxes
- `roleColor(role: Role, theme: ThemeDefinition)` - maps roles to theme colors

**`src/hooks/useChatStore.ts`**:

- Defines `Role = "user" | "responder" | "thinking"`
- Defines `ChatLine` and `ToolBlock` interfaces
- Exports types used throughout the app

**`src/features/theme/theme.ts`**:

- `ThemeColors` interface defines all theme color properties
- Currently has `text.user`, `text.responder`, `text.thinking` for message colors

### Identified Issues

1. Messages use text prefixes (`[user]`, `[responder]`) that get copied during text selection
2. No visual distinction between message types beyond color
3. No "system" message type for notifications like "Loaded profile: chutes"
4. No spacing/grouping between messages from different roles

---

## Target Architecture

### Component Hierarchy

```
src/ui/components/messages/
  index.ts                    # Public exports
  types.ts                    # Message types and interfaces
  MessageContainer.tsx        # Groups consecutive messages from same role
  BaseMessage.tsx             # Shared message rendering logic (internal)
  UserMessage.tsx             # User input with left border
  SystemMessage.tsx           # System notifications with distinct border
  ModelMessage.tsx            # AI responses without decoration
  ThinkingMessage.tsx         # Thinking/reasoning with subtle styling
  renderMessage.ts            # Factory function for rendering any message type
```

### Data Model Changes

**Current Role type:**

```typescript
type Role = 'user' | 'responder' | 'thinking';
```

**New MessageRole type:**

```typescript
type MessageRole = 'user' | 'model' | 'system' | 'thinking';
```

Note: `responder` is renamed to `model` for semantic clarity. A migration function will handle backward compatibility.

**New ChatLine interface:**

```typescript
interface ChatLine {
  id: string;
  kind: 'line';
  role: MessageRole;
  text: string;
}
```

### Theme Schema Additions

Add to `ThemeColors` interface in `src/features/theme/theme.ts`:

```typescript
interface ThemeColors {
  // ... existing properties ...

  readonly message: {
    readonly userBorder: string; // Left border for user messages
    readonly systemBorder: string; // Left border for system messages
    readonly systemText: string; // Text color for system messages
    readonly groupSpacing: number; // Vertical gap between message groups (optional, default 1)
  };
}
```

### Component Interfaces

**MessageProps (base interface):**

```typescript
interface MessageProps {
  readonly id: string;
  readonly text: string;
  readonly theme: ThemeDefinition;
}
```

**UserMessageProps:**

```typescript
interface UserMessageProps extends MessageProps {
  // No additional props needed
}
```

**SystemMessageProps:**

```typescript
interface SystemMessageProps extends MessageProps {
  // No additional props needed
}
```

**ModelMessageProps:**

```typescript
interface ModelMessageProps extends MessageProps {
  // No additional props needed
}
```

**ThinkingMessageProps:**

```typescript
interface ThinkingMessageProps extends MessageProps {
  // No additional props needed
}
```

### Visual Design

**UserMessage:**

```tsx
<box
  border={['left']}
  borderColor={theme.colors.message.userBorder}
  customBorderChars={{
    ...EmptyBorder,
    vertical: '┃',
    bottomLeft: '╹',
    topLeft: '╻',
  }}
  style={{ paddingLeft: 1 }}
>
  <text fg={theme.colors.text.user}>{text}</text>
</box>
```

**SystemMessage:**

```tsx
<box
  border={['left']}
  borderColor={theme.colors.message.systemBorder}
  customBorderChars={{
    ...EmptyBorder,
    vertical: '│',
    bottomLeft: '╵',
    topLeft: '╷',
  }}
  style={{ paddingLeft: 1 }}
>
  <text fg={theme.colors.message.systemText}>{text}</text>
</box>
```

**ModelMessage:**

```tsx
<text fg={theme.colors.text.responder}>{text}</text>
```

**ThinkingMessage:**

```tsx
<text fg={theme.colors.text.thinking} style={{ fontStyle: 'italic' }}>
  {text}
</text>
```

### Empty Border Constant

Define a constant for custom border characters:

```typescript
export const EmptyBorder = {
  top: ' ',
  bottom: ' ',
  left: ' ',
  right: ' ',
  topLeft: ' ',
  topRight: ' ',
  bottomLeft: ' ',
  bottomRight: ' ',
  horizontal: ' ',
  vertical: ' ',
};
```

---

## Test Specification (Test-First Approach)

### 1. Theme Tests (`src/features/theme/theme.test.ts`)

**Create new file** with the following tests:

```typescript
describe('ThemeColors message properties', () => {
  it('should require message.userBorder property', () => {
    // Verify type requires the property
    // Verify existing themes fail validation without it
  });

  it('should require message.systemBorder property', () => {
    // Verify type requires the property
  });

  it('should require message.systemText property', () => {
    // Verify type requires the property
  });

  it('should accept optional message.groupSpacing property', () => {
    // Verify property is optional
    // Verify defaults to expected value when not present
  });
});

describe('loadThemes', () => {
  it('should load themes with message color properties', () => {
    // Verify loaded themes have message properties
  });
});
```

### 2. Message Type Tests (`src/ui/components/messages/types.test.ts`)

**Create new file:**

```typescript
describe('MessageRole type', () => {
  it('should include user role', () => {
    const role: MessageRole = 'user';
    expect(role).toBe('user');
  });

  it('should include model role', () => {
    const role: MessageRole = 'model';
    expect(role).toBe('model');
  });

  it('should include system role', () => {
    const role: MessageRole = 'system';
    expect(role).toBe('system');
  });

  it('should include thinking role', () => {
    const role: MessageRole = 'thinking';
    expect(role).toBe('thinking');
  });
});

describe('migrateRole', () => {
  it('should convert responder to model', () => {
    expect(migrateRole('responder')).toBe('model');
  });

  it('should pass through user unchanged', () => {
    expect(migrateRole('user')).toBe('user');
  });

  it('should pass through thinking unchanged', () => {
    expect(migrateRole('thinking')).toBe('thinking');
  });

  it('should pass through system unchanged', () => {
    expect(migrateRole('system')).toBe('system');
  });

  it('should pass through model unchanged', () => {
    expect(migrateRole('model')).toBe('model');
  });
});
```

### 3. Message Rendering Tests (`src/ui/components/messages/renderMessage.test.ts`)

**Create new file:**

```typescript
import { describe, it, expect } from 'vitest';
import { getMessageRenderer, MessageRole } from './types';

describe('getMessageRenderer', () => {
  const mockTheme = createMockTheme(); // Helper function

  it('should return UserMessage renderer for user role', () => {
    const renderer = getMessageRenderer('user');
    expect(renderer.displayName || renderer.name).toBe('UserMessage');
  });

  it('should return ModelMessage renderer for model role', () => {
    const renderer = getMessageRenderer('model');
    expect(renderer.displayName || renderer.name).toBe('ModelMessage');
  });

  it('should return SystemMessage renderer for system role', () => {
    const renderer = getMessageRenderer('system');
    expect(renderer.displayName || renderer.name).toBe('SystemMessage');
  });

  it('should return ThinkingMessage renderer for thinking role', () => {
    const renderer = getMessageRenderer('thinking');
    expect(renderer.displayName || renderer.name).toBe('ThinkingMessage');
  });
});

describe('roleColor', () => {
  const mockTheme = createMockTheme();

  it('should return user text color for user role', () => {
    expect(roleColor('user', mockTheme)).toBe(mockTheme.colors.text.user);
  });

  it('should return responder text color for model role', () => {
    expect(roleColor('model', mockTheme)).toBe(mockTheme.colors.text.responder);
  });

  it('should return systemText color for system role', () => {
    expect(roleColor('system', mockTheme)).toBe(
      mockTheme.colors.message.systemText,
    );
  });

  it('should return thinking text color for thinking role', () => {
    expect(roleColor('thinking', mockTheme)).toBe(
      mockTheme.colors.text.thinking,
    );
  });
});
```

### 4. Integration Tests (`src/ui/components/messages/integration.test.ts`)

**Create new file:**

```typescript
describe('Message rendering integration', () => {
  it('should render user message with border decoration', () => {
    // Test that UserMessage produces a box with left border
  });

  it('should render system message with distinct border style', () => {
    // Test that SystemMessage produces a box with left border
    // Verify border style differs from user message
  });

  it('should render model message without border decoration', () => {
    // Test that ModelMessage produces plain text without box wrapper
  });

  it('should use theme colors for all message types', () => {
    // Verify each message type uses appropriate theme color
  });
});
```

### 5. ChatStore Migration Tests (`src/hooks/useChatStore.test.ts`)

**Create new file:**

```typescript
describe('useChatStore role migration', () => {
  it('should accept system role in appendLines', () => {
    // Verify appendLines works with system role
  });

  it('should accept model role in appendLines', () => {
    // Verify appendLines works with model role
  });

  it('should store lines with correct role', () => {
    // Verify stored lines have expected role
  });
});
```

### Test Helper: Mock Theme

Create a shared test utility:

```typescript
// src/test/mockTheme.ts
export function createMockTheme(): ThemeDefinition {
  return {
    slug: 'test',
    name: 'Test Theme',
    kind: 'dark',
    colors: {
      background: '#000000',
      panel: {
        bg: '#111111',
        border: '#333333',
      },
      text: {
        primary: '#ffffff',
        muted: '#888888',
        user: '#00ff00',
        responder: '#0088ff',
        thinking: '#ff8800',
        tool: '#ff00ff',
      },
      input: {
        fg: '#ffffff',
        bg: '#000000',
        border: '#333333',
        placeholder: '#666666',
      },
      status: {
        fg: '#ffffff',
      },
      accent: {
        primary: '#00ffff',
      },
      diff: {
        addedBg: '#003300',
        addedFg: '#00ff00',
        removedBg: '#330000',
        removedFg: '#ff0000',
      },
      selection: {
        fg: '#000000',
        bg: '#ffffff',
      },
      message: {
        userBorder: '#00ff00',
        systemBorder: '#ffff00',
        systemText: '#ffff00',
      },
    },
  };
}
```

---

## Implementation Order

### Phase 1: Foundation (No Breaking Changes)

1. **Add test helper file**: `src/test/mockTheme.ts`
2. **Write theme tests**: `src/features/theme/theme.test.ts`
3. **Update ThemeColors interface**: Add `message` property group
4. **Update all theme JSON files**: Add `message` colors to each theme

### Phase 2: Message Types Module

5. **Write types tests**: `src/ui/components/messages/types.test.ts`
6. **Create types module**: `src/ui/components/messages/types.ts`
   - Define `MessageRole` type
   - Define `migrateRole()` function
   - Define component interfaces

### Phase 3: Message Components

7. **Write renderMessage tests**: `src/ui/components/messages/renderMessage.test.ts`
8. **Create EmptyBorder constant**: In types.ts or separate constants file
9. **Create BaseMessage**: Internal shared logic
10. **Create UserMessage**: User input with left border
11. **Create SystemMessage**: System notifications with distinct border
12. **Create ModelMessage**: Plain text for AI responses
13. **Create ThinkingMessage**: Subtle styling for reasoning
14. **Create renderMessage factory**: Function to select appropriate component
15. **Create index.ts**: Public exports

### Phase 4: Integration

16. **Write useChatStore tests**: `src/hooks/useChatStore.test.ts`
17. **Update useChatStore**: Accept new roles, use `migrateRole()` for backward compatibility
18. **Update ChatLayout**: Replace `renderChatLine` with new message components
19. **Remove old code**: Delete `[role]` prefix rendering
20. **Write integration tests**: `src/ui/components/messages/integration.test.ts`

### Phase 5: Polish

21. **Add message grouping**: Optional spacing between role changes
22. **Verify all themes**: Ensure all theme files have valid message colors
23. **Manual testing**: Visual verification in terminal

---

## File Changes Summary

### New Files

| File                                               | Purpose                         |
| -------------------------------------------------- | ------------------------------- |
| `src/test/mockTheme.ts`                            | Shared mock theme for tests     |
| `src/features/theme/theme.test.ts`                 | Theme validation tests          |
| `src/ui/components/messages/index.ts`              | Public exports                  |
| `src/ui/components/messages/types.ts`              | Types and interfaces            |
| `src/ui/components/messages/types.test.ts`         | Type tests                      |
| `src/ui/components/messages/constants.ts`          | EmptyBorder and other constants |
| `src/ui/components/messages/BaseMessage.tsx`       | Shared message logic            |
| `src/ui/components/messages/UserMessage.tsx`       | User message component          |
| `src/ui/components/messages/SystemMessage.tsx`     | System message component        |
| `src/ui/components/messages/ModelMessage.tsx`      | Model message component         |
| `src/ui/components/messages/ThinkingMessage.tsx`   | Thinking message component      |
| `src/ui/components/messages/renderMessage.ts`      | Factory function                |
| `src/ui/components/messages/renderMessage.test.ts` | Factory tests                   |
| `src/ui/components/messages/integration.test.ts`   | Integration tests               |
| `src/hooks/useChatStore.test.ts`                   | Chat store tests                |

### Modified Files

| File                               | Changes                                   |
| ---------------------------------- | ----------------------------------------- |
| `src/features/theme/theme.ts`      | Add `message` to ThemeColors interface    |
| `themes/*.json` (15 files)         | Add `message` color properties            |
| `src/hooks/useChatStore.ts`        | Update Role type, add system role support |
| `src/ui/components/ChatLayout.tsx` | Replace renderChatLine, remove prefix     |

---

## Theme Color Recommendations

For each theme, add `message` properties. Example for dracula theme:

```json
{
  "message": {
    "userBorder": "#8be9fd",
    "systemBorder": "#f1fa8c",
    "systemText": "#f1fa8c"
  }
}
```

**Color Guidelines:**

- `userBorder`: Match or complement `text.user` color
- `systemBorder`: Use `accent.warning` or a distinct notification color
- `systemText`: Same as `systemBorder` for consistency

---

## Risks and Edge Cases

### Risk 1: OpenTUI Border Support

**Risk:** The `border={["left"]}` syntax and `customBorderChars` may behave differently than expected in opentui/react vs opentui/solid.

**Mitigation:**

- Test border rendering early in Phase 3
- Have fallback to simpler border style if custom chars don't work
- Consider using standard `borderStyle: "single"` with only left border if needed

### Risk 2: Backward Compatibility

**Risk:** Existing code uses `"responder"` role which needs migration.

**Mitigation:**

- `migrateRole()` function handles conversion transparently
- Keep `"responder"` as valid input that gets converted to `"model"`
- Run migration at data boundary (useChatStore)

### Risk 3: Theme File Updates

**Risk:** Missing `message` properties in theme files could cause runtime errors.

**Mitigation:**

- Add optional defaults in theme loading code
- Validate all theme files in CI
- Provide clear error messages for missing properties

### Risk 4: Text Selection

**Risk:** Box borders might still interfere with text selection in some terminals.

**Mitigation:**

- Test in multiple terminals (iTerm2, Terminal.app, Windows Terminal)
- Document known limitations
- Border characters are separate from content, should not be selected

### Edge Case: Empty Messages

Handle messages with empty or whitespace-only text:

- Render minimal height (1 line)
- Still show border decoration for user/system
- Don't collapse message entirely

### Edge Case: Multi-line Messages

Messages can span multiple lines. Ensure:

- Border extends full height of message
- Text wraps properly within border
- No visual artifacts at line breaks

### Edge Case: Very Long Messages

For messages exceeding viewport:

- Let scrollbox handle scrolling (already implemented)
- Border should extend through all lines
- Consider lazy rendering for performance (future optimization)

---

## Success Criteria

1. All tests pass (existing + new)
2. User messages have visible left border that doesn't appear in clipboard on select
3. System messages have distinct visual style from user messages
4. Model messages render as plain text without decoration
5. No `[user]` or `[responder]` text prefixes visible
6. All 15 theme files include valid message colors
7. Backward compatibility: existing `"responder"` role still works

---

## Example Usage After Implementation

```typescript
// In ChatLayout or similar
import { renderMessage, migrateRole } from "./messages";

function ScrollbackView(props: ScrollbackProps): JSX.Element {
  return (
    <scrollbox ...>
      <box flexDirection="column" style={{ gap: 0, width: "100%" }}>
        {props.lines.map((entry) =>
          entry.kind === "line"
            ? renderMessage(migrateRole(entry.role), entry.id, entry.text, props.theme)
            : renderToolBlock(entry, props.theme)
        )}
      </box>
    </scrollbox>
  );
}
```

---

## Appendix: Theme File Locations

All theme files to update:

1. `/Users/acoliver/projects/llxprt-code-branches/newui/nui/themes/ansi-light.json`
2. `/Users/acoliver/projects/llxprt-code-branches/newui/nui/themes/ansi.json`
3. `/Users/acoliver/projects/llxprt-code-branches/newui/nui/themes/atom-one-dark.json`
4. `/Users/acoliver/projects/llxprt-code-branches/newui/nui/themes/ayu-light.json`
5. `/Users/acoliver/projects/llxprt-code-branches/newui/nui/themes/ayu.json`
6. `/Users/acoliver/projects/llxprt-code-branches/newui/nui/themes/default-light.json`
7. `/Users/acoliver/projects/llxprt-code-branches/newui/nui/themes/default.json`
8. `/Users/acoliver/projects/llxprt-code-branches/newui/nui/themes/dracula.json`
9. `/Users/acoliver/projects/llxprt-code-branches/newui/nui/themes/github-dark.json`
10. `/Users/acoliver/projects/llxprt-code-branches/newui/nui/themes/github-light.json`
11. `/Users/acoliver/projects/llxprt-code-branches/newui/nui/themes/googlecode.json`
12. `/Users/acoliver/projects/llxprt-code-branches/newui/nui/themes/green-screen.json`
13. `/Users/acoliver/projects/llxprt-code-branches/newui/nui/themes/no-color.json`
14. `/Users/acoliver/projects/llxprt-code-branches/newui/nui/themes/shades-of-purple.json`
15. `/Users/acoliver/projects/llxprt-code-branches/newui/nui/themes/xcode.json`
