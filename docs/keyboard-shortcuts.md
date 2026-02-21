# Keyboard Shortcuts

Default keyboard shortcuts for editing, navigation, and UI control.

> **macOS note:** Where you see `Ctrl`, use `Cmd` on macOS for most shortcuts. Exceptions are noted — some shortcuts (like `Ctrl+C` to cancel) use `Ctrl` on all platforms.

**Quick tips:**

- **Esc** clears the current input. Prefer this over `Ctrl+C`, which cancels the active request and quits if pressed again.
- **Ctrl+F** toggles focus between the embedded shell and the LLxprt prompt when a shell is attached.
- **!** on an empty prompt enters shell mode directly.

<!-- KEYBINDINGS-AUTOGEN:START -->

## Basic Controls

| Action                                       | Keys    |
| -------------------------------------------- | ------- |
| Confirm the current selection or choice.     | `Enter` |
| Dismiss dialogs or cancel the current focus. | `Esc`   |

## Cursor Movement

| Action                                    | Keys                   |
| ----------------------------------------- | ---------------------- |
| Move the cursor to the start of the line. | `Ctrl + A`<br />`Home` |
| Move the cursor to the end of the line.   | `Ctrl + E`<br />`End`  |

## Editing

| Action                                                                | Keys                                      |
| --------------------------------------------------------------------- | ----------------------------------------- |
| Delete from the cursor to the end of the line.                        | `Ctrl + K`                                |
| Delete from the cursor to the start of the line.                      | `Ctrl + U`                                |
| Clear all text in the input field (when the input prompt is focused). | `Ctrl + C`                                |
| Delete the previous word.                                             | `Ctrl + Backspace`<br />`Cmd + Backspace` |

## Screen Control

| Action                                       | Keys               |
| -------------------------------------------- | ------------------ |
| Clear the terminal screen and redraw the UI. | `Ctrl + L`         |
| Refresh keypress handling.                   | `Ctrl + Shift + R` |

## Scrolling

| Action                   | Keys                 |
| ------------------------ | -------------------- |
| Scroll up one line.      | `Shift + Up Arrow`   |
| Scroll down one line.    | `Shift + Down Arrow` |
| Scroll to the beginning. | `Home`               |
| Scroll to the end.       | `End`                |
| Scroll up one page.      | `Page Up`            |
| Scroll down one page.    | `Page Down`          |

## History & Search

| Action                                       | Keys                  |
| -------------------------------------------- | --------------------- |
| Show the previous entry in history.          | `Ctrl + P (no Shift)` |
| Show the next entry in history.              | `Ctrl + N (no Shift)` |
| Start reverse search through history.        | `Ctrl + R`            |
| Insert the selected reverse-search match.    | `Enter (no Ctrl)`     |
| Accept a suggestion while reverse searching. | `Tab`                 |

## Navigation

| Action                           | Keys                                        |
| -------------------------------- | ------------------------------------------- |
| Move selection up in lists.      | `Up Arrow (no Shift)`                       |
| Move selection down in lists.    | `Down Arrow (no Shift)`                     |
| Move up within dialog options.   | `Up Arrow (no Shift)`<br />`K (no Shift)`   |
| Move down within dialog options. | `Down Arrow (no Shift)`<br />`J (no Shift)` |

## Suggestions & Completions

| Action                                                           | Keys                                               |
| ---------------------------------------------------------------- | -------------------------------------------------- |
| Accept the inline suggestion.                                    | `Tab`<br />`Enter (no Ctrl)`                       |
| Move to the previous completion option.                          | `Up Arrow (no Shift)`<br />`Ctrl + P (no Shift)`   |
| Move to the next completion option.                              | `Down Arrow (no Shift)`<br />`Ctrl + N (no Shift)` |
| Expand an inline suggestion when suggestion text is available.   | `Right Arrow`                                      |
| Collapse an inline suggestion when suggestion text is available. | `Left Arrow`                                       |

## Text Input

| Action                               | Keys                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| Submit the current prompt.           | `Enter (no Ctrl, no Shift, no Cmd, not Paste)`                                              |
| Insert a newline without submitting. | `Ctrl + Enter`<br />`Cmd + Enter`<br />`Paste + Enter`<br />`Shift + Enter`<br />`Ctrl + J` |

## External Tools

| Action                                                          | Keys       |
| --------------------------------------------------------------- | ---------- |
| Open the current prompt in an external editor.                  | `Ctrl + X` |
| Paste from the clipboard (image preferred, falls back to text). | `Ctrl + V` |

## App Controls

| Action                                                                                 | Keys       |
| -------------------------------------------------------------------------------------- | ---------- |
| Toggle detailed error information.                                                     | `Ctrl + O` |
| Toggle IDE context details.                                                            | `Ctrl + G` |
| Toggle Markdown rendering.                                                             | `Cmd + M`  |
| Toggle copy mode when the terminal is using the alternate buffer.                      | `Ctrl + Y` |
| Expand a height-constrained response to show additional lines.                         | `Ctrl + S` |
| Toggle focus between the shell and LLxprt input when an interactive shell is attached. | `Ctrl + F` |

## Session Control

| Action                                                            | Keys       |
| ----------------------------------------------------------------- | ---------- |
| Cancel the current request or quit the CLI (global app shortcut). | `Ctrl + C` |
| Exit the CLI when the input buffer is empty.                      | `Ctrl + D` |

## Todo Dialog

| Action                             | Keys       |
| ---------------------------------- | ---------- |
| Toggle the TODO dialog visibility. | `Ctrl + Q` |
| Toggle tool descriptions display.  | `Ctrl + T` |

## Mouse

| Action                       | Keys                        |
| ---------------------------- | --------------------------- |
| Toggle mouse event tracking. | `Ctrl + \`<br />`FS (0x1C)` |

<!-- KEYBINDINGS-AUTOGEN:END -->

## Context-Specific Shortcuts

These shortcuts are active only in specific contexts.

### Tool Approval Dialogs

| Action                                         | Keys        |
| ---------------------------------------------- | ----------- |
| Toggle YOLO mode (auto-approve all tool calls) | `Ctrl+Y`    |
| Toggle Auto Edit (auto-accept file edits)      | `Shift+Tab` |
| Jump to option by number                       | `1`–`9`     |

### Shell Mode

| Action                                       | Keys                |
| -------------------------------------------- | ------------------- |
| Enter/exit shell mode                        | `!` on empty prompt |
| Toggle focus between shell and LLxprt prompt | `Ctrl+F`            |

### Text Editing

| Action                            | Keys                             |
| --------------------------------- | -------------------------------- |
| Move cursor left one character    | `Ctrl+B` / `Left Arrow`          |
| Move cursor right one character   | `Ctrl+F` / `Right Arrow`         |
| Move left one word                | `Ctrl+Left` / `Meta+B`           |
| Move right one word               | `Ctrl+Right` / `Meta+F`          |
| Delete character right of cursor  | `Ctrl+D` / `Delete`              |
| Delete character left of cursor   | `Ctrl+H` / `Backspace`           |
| Delete word right of cursor       | `Ctrl+Delete` / `Meta+Delete`    |
| Delete word left of cursor        | `Ctrl+W` / `Ctrl+Backspace`      |
| Undo last edit                    | `Ctrl+Z`                         |
| Redo last edit                    | `Ctrl+Shift+Z`                   |
| Insert newline (single-line mode) | `\` at end of line, then `Enter` |
| Open in external editor           | `Meta+Enter` / `Ctrl+X`          |
| Clear input buffer                | `Esc` (press twice quickly)      |

### History Navigation

| Action          | Keys                              |
| --------------- | --------------------------------- |
| Previous prompt | `Up Arrow` (at top of input)      |
| Next prompt     | `Down Arrow` (at bottom of input) |

### macOS-Specific

| Action                    | Keys                 |
| ------------------------- | -------------------- |
| Toggle Markdown rendering | `Cmd+M` / `Option+M` |
