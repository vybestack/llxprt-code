# Reimplementation Plan: Show Profile Name on Change in Chat History

**Upstream SHA**: `ab11b2c27`
**Upstream subject**: Show model in history (#13034)
**LLxprt approach**: Show active profile name on change (not model name)

## Why Different from Upstream

Upstream shows the model name using their model router (dynamic routing between models mid-conversation). LLxprt doesn't have a model router. The model is already visible in the Footer at all times. What's more useful for multi-provider is showing when the **profile** changes between turns.

## What to Implement

When `activeProfileName` changes between turns, insert a small history item showing the profile switch. Don't show it every turn — only on change.

## Implementation Approach (TDD)

Following strict TDD ordering per dev-docs/RULES.md:

### Phase 1: RED (Write Failing Tests)

Create comprehensive tests that currently fail:

1. **Test: Profile change inserts history item**
   - Given a conversation with profile "default"
   - When activeProfileName changes to "openai" before next submitQuery
   - Then a HistoryItemProfile should be inserted with profileName "openai"

2. **Test: No spurious insert on first turn**
   - Given lastProfileName starts undefined
   - When first submitQuery runs with activeProfileName "default"
   - Then NO HistoryItemProfile is inserted (just initialization)

3. **Test: No insert when profile unchanged**
   - Given a conversation with activeProfileName "default"
   - When submitQuery runs again with activeProfileName still "default"
   - Then NO HistoryItemProfile is inserted

4. **Test: No insert when setting disabled**
   - Given showProfileChangeInChat setting is false
   - When activeProfileName changes from "default" to "openai"
   - Then NO HistoryItemProfile is inserted

5. **Test: No insert for null/empty profile names**
   - Given activeProfileName is null or empty string
   - When profile changes to null/empty
   - Then NO HistoryItemProfile is inserted

### Phase 2: GREEN (Minimal Implementation)

Implement just enough to make tests pass:

#### 2.1. Add HistoryItemProfile Type

**File**: `packages/cli/src/ui/types.ts`

Add new type BEFORE the HistoryItemWithoutId union (around line 220):
```typescript
export type HistoryItemProfile = HistoryItemBase & {
  type: 'profile';
  profileName: string;
};
```

Add to `HistoryItemWithoutId` union (around line 226):
```typescript
export type HistoryItemWithoutId =
  | HistoryItemUser
  | HistoryItemUserShell
  | HistoryItemGemini
  | HistoryItemGeminiContent
  | HistoryItemInfo
  | HistoryItemError
  | HistoryItemWarning
  | HistoryItemAbout
  | HistoryItemHelp
  | HistoryItemToolGroup
  | HistoryItemStats
  | HistoryItemModelStats
  | HistoryItemToolStats
  | HistoryItemCacheStats
  | HistoryItemLBStats
  | HistoryItemQuit
  | HistoryItemCompression
  | HistoryItemOAuthURL
  | HistoryItemExtensionsList
  | HistoryItemToolsList
  | HistoryItemMcpStatus
  | HistoryItemChatList
  | HistoryItemProfile;  // ADD THIS LINE
```

#### 2.2. Add Setting

**File**: `packages/cli/src/config/settingsSchema.ts`

Add to `ui.properties` object (around line 620, after other ui settings):
```typescript
showProfileChangeInChat: {
  type: 'boolean',
  label: 'Show Profile Changes In Chat',
  category: 'UI',
  requiresRestart: false,
  default: true,
  description: 'Show a message in chat when the active profile changes.',
  showInDialog: true,
},
```

#### 2.3. Wire activeProfileName + showProfileChangeInChat to useGeminiStream

**Context**: useGeminiStream currently does NOT receive activeProfileName as a parameter. Must add it.

**File**: Find where useGeminiStream is CALLED (likely in AppContainer or similar)

Add `activeProfileName` and `showProfileChangeInChat` to the hook call:
```typescript
const { streamingState, submitQuery, ... } = useGeminiStream(
  geminiClient,
  history,
  addItem,
  config,
  settings,
  onDebugMessage,
  handleSlashCommand,
  shellModeActive,
  getPreferredEditor,
  onAuthError,
  performMemoryRefresh,
  onEditorClose,
  onCancelSubmit,
  setShellInputFocused,
  terminalWidth,
  terminalHeight,
  onTodoPause,
  onEditorOpen,
  activeProfileName,  // ADD THIS
  showProfileChangeInChat,  // ADD THIS
);
```

**File**: `packages/cli/src/ui/hooks/useGeminiStream.ts`

Update signature (around line 140):
```typescript
export const useGeminiStream = (
  geminiClient: GeminiClient,
  history: HistoryItem[],
  addItem: UseHistoryManagerReturn['addItem'],
  config: Config,
  settings: LoadedSettings,
  onDebugMessage: (message: string) => void,
  handleSlashCommand: (
    cmd: PartListUnion,
  ) => Promise<SlashCommandProcessorResult | false>,
  shellModeActive: boolean,
  getPreferredEditor: () => EditorType | undefined,
  onAuthError: () => void,
  performMemoryRefresh: () => Promise<void>,
  onEditorClose: () => void,
  onCancelSubmit: () => void,
  setShellInputFocused: (value: boolean) => void,
  terminalWidth?: number,
  terminalHeight?: number,
  onTodoPause?: () => void,
  onEditorOpen: () => void = () => {},
  activeProfileName: string | null = null,  // ADD THIS
  showProfileChangeInChat: boolean = true,  // ADD THIS
) => {
```

Add ref for tracking (near other refs around line 150):
```typescript
const lastProfileNameRef = useRef<string | null | undefined>(undefined);
```

In `submitQuery` function, BEFORE sending to Gemini (around line 450, after user message is added):
```typescript
// Track profile changes
if (!options?.isContinuation && showProfileChangeInChat) {
  // Initialize on first turn without inserting
  if (lastProfileNameRef.current === undefined) {
    lastProfileNameRef.current = activeProfileName;
  } else if (
    activeProfileName &&
    activeProfileName !== lastProfileNameRef.current
  ) {
    // Profile changed - insert history item
    addItem(
      {
        type: 'profile',
        profileName: activeProfileName,
      },
      userMessageTimestamp,
    );
    lastProfileNameRef.current = activeProfileName;
  }
}
```

#### 2.4. Add Rendering

**File**: `packages/cli/src/ui/components/HistoryItemDisplay.tsx`

Add rendering case AFTER the `chat_list` case (around line 170):
```typescript
{itemForDisplay.type === 'profile' && (
  <Box>
    <Text dimColor>
      Switched to profile: {itemForDisplay.profileName}
    </Text>
  </Box>
)}
```

**Note**: Use `dimColor` (existing convention in InfoMessage) instead of `SemanticColors.text.secondary` which is NOT used in HistoryItemDisplay.

### Phase 3: Verify

1. Run tests: `npm test -- --grep "profile change"`
2. Lint: `npm run lint`
3. Typecheck: `npm run typecheck`
4. Build: `npm run build`
5. Manual verification:
   - Start llxprt with default profile
   - Submit a query
   - Run `/profile load openai` (or switch profiles via UI)
   - Submit another query
   - Verify "Switched to profile: openai" message appears
   - Verify no message on subsequent queries with same profile
   - Verify footer still shows model independently

## What NOT to Implement

- [ERROR] NO `AppEvent.ProfileChanged` — not needed, direct history insertion is sufficient
- [ERROR] NO `ModelMessage.tsx` component (upstream's approach)
- [ERROR] NO `GeminiEventType.ModelInfo` event type
- [ERROR] NO model router integration
- [ERROR] NO `showModelInfoInChat` setting (show profile, not model)

## Key Fixes from Review

1. [OK] **TDD ordering**: Tests first (Phase 1), then implementation (Phase 2)
2. [OK] **Correct type location**: HistoryItemProfile goes in `ui/types.ts` where HistoryItem union is defined
3. [OK] **No ProfileChanged event**: Direct history insertion in submitQuery hook
4. [OK] **activeProfileName wiring**: Must be passed explicitly to useGeminiStream
5. [OK] **Spurious startup message**: lastProfileName starts undefined, initialized on first turn WITHOUT emitting
6. [OK] **null/empty guard**: Check `activeProfileName &&` before inserting
7. [OK] **Rendering style**: Use `dimColor` prop (existing pattern) not SemanticColors
8. [OK] **Settings wiring**: Must read showProfileChangeInChat from settings/config and pass to hook
