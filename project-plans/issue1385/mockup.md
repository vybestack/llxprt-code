# Session Browser — UI Mockup

## Standard Terminal (>= 80 columns)

```
╭──────────────────────────────────────────────────────────────────────────╮
│                                                                          │
│  Session Browser                                                         │
│                                                                          │
│  Search: ▌                          (Tab to navigate)  5 sessions found  │
│                                                                          │
│  Sort: [newest]  oldest  size         (press s to cycle)                 │
│                                                                          │
│  ● #1  2 hours ago    gemini / gemini-2.5-pro                     1.2KB  │
│        "fix the login bug in auth service"                               │
│                                                                          │
│  ○ #2  5 hours ago    anthropic / claude-sonnet-4-20250514           3.8KB  │
│        "add unit tests for the session recording module"                 │
│                                                                          │
│  ○ #3  yesterday      gemini / gemini-2.5-pro                     8.4KB  │
│        "refactor the provider manager to support..."                     │
│                                                                          │
│  ○ #4  2 days ago     anthropic / claude-sonnet-4-20250514          12.1KB  │
│        "implement the new JSONL session format"                          │
│                                                                          │
│  ○ #5  3 days ago     gemini / gemini-2.5-flash              (in use) 0.4KB │
│        "write me a haiku and nothing else"                               │
│                                                                          │
│  Page 1 of 1                                                             │
│                                                                          │
│  ─────────────────────────────────────────────────────────────────────   │
│  Selected: session-a1b2c3d4  (gemini / gemini-2.5-pro, 2 hours ago)     │
│                                                                          │
│  ↑↓ Navigate  Enter Resume  Del Delete  s Sort  Tab Search/Nav  Esc Close│
│                                                                          │
╰──────────────────────────────────────────────────────────────────────────╯
```

## Narrow Terminal (isNarrow)

```
Sessions

Search: ▌
5 sessions found

● 2h ago   gemini-2.5-pro         a1b2c3d4
  "fix the login bug in auth..."

○ 5h ago   claude-sonnet-4-20250514
  "add unit tests for the ses..."

○ 1d ago   gemini-2.5-pro
  "refactor the provider mana..."

○ 2d ago   claude-sonnet-4-20250514
  "implement the new JSONL se..."

○ 3d ago   gemini-2.5-flash (in use)
  "write me a haiku and nothi..."

↑↓ Nav  Enter Resume  Del Delete  s:newest  Esc Close
```

Note: Short session ID suffix (`a1b2c3d4`) shown on selected row only; sort hint (`s:newest`) in controls bar.

## Loading State

```
╭──────────────────────────────────────────────────────────────────────────╮
│                                                                          │
│  Session Browser                                                         │
│                                                                          │
│  Loading sessions...                                                     │
│                                                                          │
╰──────────────────────────────────────────────────────────────────────────╯
```

## Progressive Preview Loading

Sessions appear immediately with metadata; first-message previews fill in asynchronously:

```
│  ● #1  2 hours ago    gemini / gemini-2.5-pro                     1.2KB  │
│        "fix the login bug in auth service"                               │
│                                                                          │
│  ○ #2  5 hours ago    anthropic / claude-sonnet-4-20250514           3.8KB  │
│        Loading...                                                        │
│                                                                          │
│  ○ #3  yesterday      gemini / gemini-2.5-pro                     8.4KB  │
│        Loading...                                                        │
```

## Empty State

```
╭──────────────────────────────────────────────────────────────────────────╮
│                                                                          │
│  No sessions found for this project.                                     │
│  Sessions are created automatically when you start a conversation.       │
│                                                                          │
│  Press Esc to close                                                      │
│                                                                          │
╰──────────────────────────────────────────────────────────────────────────╯
```

## Skipped Sessions Notice

Shown when some session files have unreadable headers:

```
│  Sort: [newest]  oldest  size         (press s to cycle)                 │
│                                                                          │
│  Skipped 2 unreadable session(s).                                        │
│                                                                          │
│  ● #1  2 hours ago    gemini / gemini-2.5-pro                     1.2KB  │
```

## Resuming State

Shown while a resume is in progress (Enter disabled):

```
│  ─────────────────────────────────────────────────────────────────────   │
│  Resuming...                                                             │
│                                                                          │
│  Selected: session-a1b2c3d4  (gemini / gemini-2.5-pro, 2 hours ago)     │
```

## Delete Confirmation (inline)

```
│  ○ #3  yesterday      gemini / gemini-2.5-pro                     8.4KB  │
│        "refactor the provider manager to support..."                     │
│                                                                          │
│  ● #4  2 days ago     anthropic / claude-sonnet-4-20250514          12.1KB  │
│    ╭─ Delete "implement the new JSONL session format" (2 days ago)? ──╮  │
│    │  [Y] Yes  [N] No  [Esc] Cancel                                  │  │
│    ╰──────────────────────────────────────────────────────────────────╯  │
│                                                                          │
│  ○ #5  3 days ago     gemini / gemini-2.5-flash                   0.4KB  │
```

## Active Conversation Warning

Shown when the user already has history in the current session:

```
╭──────────────────────────────────────────────────────────────────────────╮
│                                                                          │
│  Resuming will replace the current conversation. Continue?               │
│                                                                          │
│  [Y] Yes  [N] No                                                         │
│                                                                          │
╰──────────────────────────────────────────────────────────────────────────╯
```

## Error State (inline)

Shown when resume or delete fails (browser stays open):

```
│  ─────────────────────────────────────────────────────────────────────   │
│  Error: Session is in use by another process.                            │
│                                                                          │
│  Selected: session-e5f6g7h8  (gemini / gemini-2.5-flash, 3 days ago)    │
│                                                                          │
│  ↑↓ Navigate  Enter Resume  Del Delete  s Sort  Tab Search/Nav  Esc Close│
```

## Session Disappeared (after list load)

```
│  ─────────────────────────────────────────────────────────────────────   │
│  Session no longer exists. Refreshing list...                            │
│                                                                          │
```

## Search Active (with filter results)

```
╭──────────────────────────────────────────────────────────────────────────╮
│                                                                          │
│  Session Browser                                                         │
│                                                                          │
│  Search: ▌auth                      (Tab to navigate)  1 session found   │
│                                                                          │
│  Sort: [newest]  oldest  size         (press s to cycle)                 │
│                                                                          │
│  ● #1  2 hours ago    gemini / gemini-2.5-pro                     1.2KB  │
│        "fix the login bug in auth service"                               │
│                                                                          │
│  Page 1 of 1                                                             │
│                                                                          │
│  ─────────────────────────────────────────────────────────────────────   │
│  Selected: session-a1b2c3d4  (gemini / gemini-2.5-pro, 2 hours ago)     │
│                                                                          │
│  ↑↓ Navigate  Enter Resume  Del Delete  s Sort  Tab Search/Nav  Esc Close│
│                                                                          │
╰──────────────────────────────────────────────────────────────────────────╯
```

## No Search Results

```
╭──────────────────────────────────────────────────────────────────────────╮
│                                                                          │
│  Session Browser                                                         │
│                                                                          │
│  Search: ▌xyzzy                     (Tab to navigate)  0 sessions found  │
│                                                                          │
│  No sessions match "xyzzy"                                               │
│                                                                          │
│  Esc Close                                                               │
│                                                                          │
╰──────────────────────────────────────────────────────────────────────────╯
```

## No User Message Fallback

When a session has no user message (e.g. system-only or tool-only content):

```
│  ○ #3  yesterday      gemini / gemini-2.5-pro                     0.2KB  │
│        (no user message)                                                 │
```

## Pagination (when > 20 sessions)

```
  Page 2 of 3                                          PgUp/PgDn to page
```

## Visual Element Mapping

| Element                  | Source                          | Color / Style                      |
|--------------------------|---------------------------------|------------------------------------|
| Box border               | `borderStyle="round"`           | `SemanticColors.border.default`    |
| Title "Session Browser"  | `<Text bold>`                   | `SemanticColors.text.primary`      |
| Search input cursor      | `▌`                             | `SemanticColors.text.accent`       |
| Search text              | Typed characters                | `SemanticColors.text.primary`      |
| Helper text "(Tab to...)"| Parenthetical hints             | `SemanticColors.text.secondary`    |
| Active sort label        | `[newest]` bracketed            | `SemanticColors.text.accent`       |
| Inactive sort labels     | plain text                      | `SemanticColors.text.secondary`    |
| Selected item bullet     | `●`                             | `SemanticColors.text.accent`       |
| Unselected item bullet   | `○`                             | `SemanticColors.text.primary`      |
| Index `#1`               | 1-based numeric                 | `SemanticColors.text.secondary`    |
| Relative time            | e.g. "2 hours ago"              | `SemanticColors.text.primary`      |
| Provider / model         | From session header             | `SemanticColors.text.secondary`    |
| File size                | Right-aligned                   | `SemanticColors.text.secondary`    |
| Lock indicator           | `(in use)` inline               | `SemanticColors.status.warning`    |
| First message preview    | Quoted, truncated               | `SemanticColors.text.secondary`    |
| Preview fallback         | `(no user message)` italic      | `SemanticColors.text.secondary`    |
| Preview loading          | `Loading...`                    | `SemanticColors.text.secondary`    |
| Selected detail line     | Bottom of list                  | `SemanticColors.text.secondary`    |
| Error text               | Inline above controls           | `SemanticColors.status.error`      |
| Controls bar             | Bottom row                      | `SemanticColors.text.secondary`    |
| Delete confirmation      | Inline nested box               | `SemanticColors.text.primary`      |

## Responsive Behavior Summary

| Terminal Width | Layout                                                        |
|----------------|---------------------------------------------------------------|
| Wide (not narrow) | Full: rounded border, sort bar, two-line rows, detail line    |
| Narrow (`isNarrow`) | Narrow: no border, compact two-line rows (abbreviated metadata + truncated preview), no sort bar, sort hint in controls, short ID on selected row, abbreviated controls |

Width threshold is determined by `useResponsive().isNarrow`, not a hardcoded value. Column references (e.g. "80 columns") in mockups above are illustrative only.

## Truncation Rules (narrow mode)

| Element           | Narrow behavior                                          |
|-------------------|----------------------------------------------------------|
| Provider name     | Hidden; show model only                                  |
| Model name        | Truncated to 20 chars with "..."                         |
| First message     | Truncated to 30 chars with "..."                         |
| Session ID        | Short 8-char prefix shown on selected row                |
| Relative time     | Abbreviated: "2h ago", "1d ago", "3w ago"                |
| Sort bar          | Hidden; sort hint in controls bar (e.g. `s:newest`)      |
| Detail line       | Hidden; short session ID on selected row instead         |
| File size         | Hidden                                                   |
