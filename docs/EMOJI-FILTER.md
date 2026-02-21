# Emoji Filter Configuration Guide

## Overview

The emoji filter system helps maintain professional, emoji-free code by filtering emojis from LLM responses and preventing them from being written to your files.

## Configuration Methods

### 1. Session Configuration (Temporary)

Use the `/set` command to configure for the current session:

```bash
# Set to auto mode (default - filters silently)
/set emojifilter auto

# Set to warn mode (filters with feedback)
/set emojifilter warn

# Set to error mode (blocks content with emojis)
/set emojifilter error

# Set to allowed mode (no filtering)
/set emojifilter allowed

# Remove session override (revert to default)
/set unset emojifilter
```

### 2. Default Configuration (Persistent)

Add to your `~/.llxprt/settings.json` file:

```json
{
  "emojiFilter": {
    "mode": "auto"
  },
  "providers": {
    // ... your provider configs
  }
}
```

### 3. Profile Configuration

Save your current configuration to a profile:

```bash
# Set your preferred mode
/set emojifilter warn

# Save to profile
/profile save myprofile

# Later, load the profile
/profile load myprofile
```

## Configuration Hierarchy

Settings are applied in this order (highest priority first):

1. **Session** - Set via `/set emojifilter` command
2. **Profile** - Loaded via `/profile load`
3. **Default** - From `settings.json`
4. **Built-in** - `auto` mode if nothing configured

## Filter Modes

### `allowed` - No Filtering

- Emojis pass through unchanged
- No warnings or errors
- Use when you want emojis in responses

### `auto` - Silent Filtering (Default)

- Converts functional emojis to text (✅ → [OK])
- Removes decorative emojis (🎉, 😀)
- No feedback messages
- **Requirement REQ-004.1 compliant**

### `warn` - Filter with Feedback

- Same filtering as auto mode
- Provides feedback when emojis are filtered
- Shows system reminder messages
- Good for understanding what's being filtered

### `error` - Block Emoji Content

- Prevents any content with emojis
- Blocks file operations if emojis detected
- Returns error messages
- Maximum protection for code files

## What Gets Filtered

### Filtered (File Modification Tools)

- `edit` - File editing operations
- `write_file` - File creation/writing
- Tool arguments for file operations

### NOT Filtered

- `grep`, `glob`, `find`, `ls` — search operations
- `bash`, `shell` — shell commands (input and output pass through unmodified)
- `read_file` — file reading
- File paths (even with emojis)
- User input
- Search-side arguments of tool calls (e.g., the pattern in a grep call)

### Streaming Display

For streamed model responses, emoji filtering is applied at the **display layer** only. The model's actual output is preserved unmodified in conversation history. This is required because some providers (notably Anthropic) need the model's original thinking and response text to remain unchanged for correct context handling. You see the filtered version; the model sees the original.

## Examples

### Example settings.json

```json
{
  "emojiFilter": {
    "mode": "warn"
  },
  "providers": {
    "anthropic": {
      "enabled": true,
      "apiKey": "your-key",
      "model": "claude-3-opus-20240229"
    }
  },
  "ui": {
    "theme": "dark"
  }
}
```

### Common Emoji Conversions

| Emoji | Converted To |
| ----- | ------------ |
| ✅    | [OK]         |
| ✓     | [OK]         |
| ❌    | [ERROR]      |
| ⚠️    | WARNING:     |
| 💡    | TIP:         |
| 📝    | NOTE:        |
| ⚡    | [ACTION]     |

### Decorative Emojis Removed

These emojis are removed entirely:

- 🎉 🎊 ✨ 💫 ⭐ 🌟
- 😀 😃 😄 😁 😊 😎
- 👍 👎 👏 🙌 💪
- 🔥 💯 🚀 💥

## Troubleshooting

### Emojis Still Appearing?

1. Check current mode: The mode is shown when you use `/set emojifilter`
2. Verify no session override: Use `/set unset emojifilter` to clear
3. Check your settings.json for typos

### Want to Search for Emojis?

Search tools are not filtered, so you can:

```bash
# This works - search tools aren't filtered
grep "🎉" myfile.txt
```

### File with Emoji in Name?

File paths are preserved:

```bash
# This works - file paths aren't filtered
/edit "my-file-🎉.txt"
```
