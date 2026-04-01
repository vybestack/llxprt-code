# Keyboard Shortcuts

Default keyboard shortcuts for editing, navigation, and UI control.

> **macOS note:** Where you see `Ctrl`, use `Cmd` on macOS for most shortcuts. Exceptions are noted — some shortcuts (like `Ctrl+C` to cancel) use `Ctrl` on all platforms.

**Quick tips:**

- **Esc** clears the current input. Prefer this over `Ctrl+C`, which cancels the active request and quits if pressed again.
- **Ctrl+F** toggles focus between the embedded shell and the LLxprt prompt when a shell is attached.
- **!** on an empty prompt enters shell mode directly.

<!-- KEYBINDINGS-AUTOGEN:START -->

## Basic Controls

| Action                                                          | Keys       |
| --------------------------------------------------------------- | ---------- |
| Confirm the current selection or choice.                        | `Enter`    |
| Dismiss dialogs or cancel the current focus.                    | `Esc`      |
| Cancel the current request or quit the CLI when input is empty. | `Ctrl + C` |
| Exit the CLI when the input buffer is empty.                    | `Ctrl + D` |

## Cursor Movement

| Action                                      | Keys                                                         |
| ------------------------------------------- | ------------------------------------------------------------ |
| Move the cursor to the start of the line.   | `Ctrl + A`<br />`Home (no Ctrl, no Shift)`                   |
| Move the cursor to the end of the line.     | `Ctrl + E`<br />`End (no Ctrl, no Shift)`                    |
| Move the cursor up one line.                | `Up Arrow (no Ctrl, no Cmd)`                                 |
| Move the cursor down one line.              | `Down Arrow (no Ctrl, no Cmd)`                               |
| Move the cursor one character to the left.  | `Left Arrow (no Ctrl, no Cmd)`<br />`Ctrl + B`               |
| Move the cursor one character to the right. | `Right Arrow (no Ctrl, no Cmd)`<br />`Ctrl + F`              |
| Move the cursor one word to the left.       | `Ctrl + Left Arrow`<br />`Cmd + Left Arrow`<br />`Cmd + B`   |
| Move the cursor one word to the right.      | `Ctrl + Right Arrow`<br />`Cmd + Right Arrow`<br />`Cmd + F` |

## Editing

| Action                                           | Keys                                                      |
| ------------------------------------------------ | --------------------------------------------------------- |
| Delete from the cursor to the end of the line.   | `Ctrl + K`                                                |
| Delete from the cursor to the start of the line. | `Ctrl + U`                                                |
| Clear all text in the input field.               | `Ctrl + C`                                                |
| Delete the previous word.                        | `Ctrl + Backspace`<br />`Cmd + Backspace`<br />`Ctrl + W` |
| Delete the next word.                            | `Ctrl + Delete`<br />`Cmd + Delete`                       |
| Delete the character to the left.                | `Backspace`<br />`Ctrl + H`                               |
| Delete the character to the right.               | `Delete`<br />`Ctrl + D`                                  |
| Undo the most recent text edit.                  | `Ctrl + Z (no Shift)`                                     |
| Redo the most recent undone text edit.           | `Ctrl + Shift + Z`                                        |

## Scrolling

| Action                   | Keys                              |
| ------------------------ | --------------------------------- |
| Scroll content up.       | `Shift + Up Arrow`                |
| Scroll content down.     | `Shift + Down Arrow`              |
| Scroll to the top.       | `Ctrl + Home`<br />`Shift + Home` |
| Scroll to the bottom.    | `Ctrl + End`<br />`Shift + End`   |
| Scroll up by one page.   | `Page Up`                         |
| Scroll down by one page. | `Page Down`                       |

## History & Search

| Action                                       | Keys                  |
| -------------------------------------------- | --------------------- |
| Show the previous entry in history.          | `Ctrl + P (no Shift)` |
| Show the next entry in history.              | `Ctrl + N (no Shift)` |
| Start reverse search through history.        | `Ctrl + R`            |
| Submit the selected reverse-search match.    | `Enter (no Ctrl)`     |
| Accept a suggestion while reverse searching. | `Tab`                 |

## Navigation

| Action                           | Keys                                        |
| -------------------------------- | ------------------------------------------- |
| Move selection up in lists.      | `Up Arrow (no Shift)`                       |
| Move selection down in lists.    | `Down Arrow (no Shift)`                     |
| Move up within dialog options.   | `Up Arrow (no Shift)`<br />`K (no Shift)`   |
| Move down within dialog options. | `Down Arrow (no Shift)`<br />`J (no Shift)` |

## Suggestions & Completions

| Action                                  | Keys                                               |
| --------------------------------------- | -------------------------------------------------- |
| Accept the inline suggestion.           | `Tab`<br />`Enter (no Ctrl)`                       |
| Move to the previous completion option. | `Up Arrow (no Shift)`<br />`Ctrl + P (no Shift)`   |
| Move to the next completion option.     | `Down Arrow (no Shift)`<br />`Ctrl + N (no Shift)` |
| Expand an inline suggestion.            | `Right Arrow`                                      |
| Collapse an inline suggestion.          | `Left Arrow`                                       |

## Text Input

| Action                                                          | Keys                                                                   |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Submit the current prompt.                                      | `Enter (no Ctrl, no Shift, no Cmd)`                                    |
| Insert a newline without submitting.                            | `Ctrl + Enter`<br />`Cmd + Enter`<br />`Shift + Enter`<br />`Ctrl + J` |
| Open the current prompt in an external editor.                  | `Ctrl + X`                                                             |
| Paste from the clipboard (image preferred, falls back to text). | `Ctrl + V`<br />`Cmd + V`                                              |

## App Controls

| Action                                                                                           | Keys                                |
| ------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Toggle detailed error information.                                                               | `Ctrl + O`                          |
| Show IDE context details.                                                                        | `Ctrl + G`                          |
| Toggle Markdown rendering.                                                                       | `Cmd + M`                           |
| Toggle copy mode when in alternate buffer mode.                                                  | `Ctrl + S`                          |
| Toggle YOLO (auto-approval) mode for tool calls.                                                 | `Ctrl + Y`                          |
| Toggle Auto Edit (auto-accept edits) mode.                                                       | `Shift + Tab`                       |
| Expand a height-constrained response to show additional lines when not in alternate buffer mode. | `Ctrl + S`                          |
| Toggle focus between the shell and LLxprt input when an interactive shell is attached.           | `Ctrl + F`                          |
| Toggle focus into the interactive shell from LLxprt input.                                       | `Tab (no Shift)`                    |
| Toggle focus out of the interactive shell and into LLxprt input.                                 | `Tab (no Shift)`<br />`Shift + Tab` |
| Clear the terminal screen and redraw the UI.                                                     | `Ctrl + L`                          |
| Refresh keypress handling.                                                                       | `Ctrl + Shift + R`                  |

## Todo Dialog

| Action                             | Keys       |
| ---------------------------------- | ---------- |
| Toggle the TODO dialog visibility. | `Ctrl + Q` |
| Toggle tool descriptions display.  | `Ctrl + T` |

## Mouse

| Action                       | Keys       |
| ---------------------------- | ---------- |
| Toggle mouse event tracking. | `Ctrl + \` |

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
