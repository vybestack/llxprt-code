# Multi-line Input in LLxprt Code

LLxprt Code supports multi-line input, allowing you to enter complex prompts or code snippets that span multiple lines.

## How to Insert Line Breaks

You can insert a line break (newline) in your input using any of these methods:

- **Alt+Enter** (Option+Enter on macOS) - Insert a new line
- **Ctrl+Enter** - Insert a new line
- **Paste multi-line content** - When you paste content containing line breaks, they are preserved

## Example Usage

```
User input with Alt+Enter:
This is line 1 [Alt+Enter]
This is line 2 [Alt+Enter]
This is line 3 [Enter to submit]
```

## Regular Enter Key Behavior

- **Enter** without modifiers - Submits the current input
- **Enter** when line ends with `\` - Inserts a newline (line continuation)

## Implementation Details

The feature is implemented in:

- `packages/cli/src/ui/components/InputPrompt.tsx` - Handles the key combinations
- `packages/cli/src/ui/hooks/useKeypress.ts` - Detects Alt/Meta key through escape sequences
