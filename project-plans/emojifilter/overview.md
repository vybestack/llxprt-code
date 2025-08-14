# Emoji Filter System Overview

## Purpose

The emoji filter system provides configurable control over emoji usage in LLM outputs and tool calls. This addresses the need for professional, emoji-free interactions while maintaining flexibility for users who prefer emojis or need them for specific use cases.

## Core Functionality

### What It Filters

The emoji filter applies to:
- **LLM text responses** - All streaming text output from providers (Anthropic, OpenAI, Gemini, etc.)
- **Tool call parameters** - Arguments passed to tools by the LLM, especially:
  - File modification tools (`edit_file`, `write_file`, `replace`) - prevents emojis in code
  - All other tool inputs to maintain consistency
- **Tool result displays** - Output shown to users from tool executions

### What It Does NOT Filter

The filter explicitly does NOT apply to:
- **User input** - Users can type emojis freely
- **File content** - Reading files preserves original content
- **System messages** - Internal communication remains unfiltered
- **Error messages** - System errors display as-is

## Configuration Modes

The filter operates in four distinct modes:

### 1. `allowed` Mode
- No filtering performed
- All emojis pass through unchanged
- For users who want the full LLM experience

### 2. `auto` Mode (Default)
- Silent conversion/removal of emojis
- No warnings or errors
- Useful emojis converted to text equivalents
- Decorative emojis removed entirely

### 3. `warn` Mode
- Same filtering as `auto` mode
- After tool execution, sends feedback to LLM about stripped emojis
- Helps train LLM to avoid emoji usage
- Does not block execution

### 4. `error` Mode
- Blocks tool execution if emojis detected
- Returns error to LLM instead of executing tool
- Strictest mode for zero-tolerance environments
- Forces LLM to retry without emojis

## Configuration Hierarchy

Settings follow a clear precedence order:

1. **Session Configuration** (Highest Priority)
   - Set via `/set emojifilter [mode]`
   - Active for current session only
   - Overrides all other settings

2. **Profile Configuration** (When Loaded)
   - Saved via `/profile save [name]`
   - Loaded via `/profile load [name]`
   - Becomes session config when loaded

3. **Default Configuration** (Lowest Priority)
   - Set in `~/.llxprt/settings.json`
   - Applies to all new sessions
   - Can be strict (`error`) by default

## Emoji Conversion Rules

### Emojis to Filter (Convert or Remove)

**Status/Checkmarks:**
- ✅ → [OK]
- ✔️ → [OK]
- ☑️ → [OK]
- ❌ → [FAIL]
- ❎ → [FAIL]
- ✖️ → [FAIL]
- ⚠️ → WARNING:
- ⛔ → [ERROR]
- 🚫 → [BLOCKED]

**Informational:**
- 💡 → TIP:
- 📝 → NOTE:
- 📌 → NOTE:
- 🔍 → Searching:
- 🔎 → Found:
- 📊 → Stats:
- 📈 → Increased:
- 📉 → Decreased:
- 🎯 → Target:
- 🚀 → [LAUNCH]
- 🏁 → [COMPLETE]

**Progress/Status Indicators:**
- 🟢 → [READY]
- 🟡 → [PENDING]
- 🔴 → [ERROR]
- 🟩 → [PASS]
- 🟨 → [WARNING]
- 🟥 → [FAIL]
- ⏳ → [WAITING]
- ⌛ → [PROCESSING]
- 🔄 → [REFRESH]
- 🔃 → [SYNC]

**Decorative (Remove Entirely):**
- 🎉, 🎊, 🎈 (celebrations)
- 😀, 😃, 😄, 😊, 🙂 (faces)
- 👍, 👎, 👏, 🙌 (hands)
- ⚡, 🌟, ✨, 💫 (effects)
- 🔥, 💥, 💢 (emphasis)
- 🤔, 🤷, 🤦 (expressions)
- All other Unicode emoji blocks

### Allowed Characters

These remain unfiltered as they serve functional purposes:
- ← → ↑ ↓ (arrows)
- ┌ ┐ └ ┘ │ ─ (box drawing)
- • ◦ ▪ ▫ (bullets)
- ▶ ▼ ◀ ▲ (triangles)

## Use Cases

### Professional Environments
Set default to `error` mode in settings.json to enforce emoji-free communication across all sessions.

### Problematic Models
When a model produces excessive emojis, temporarily relax filtering:
```
/set emojifilter warn
```

### Development/Testing
Use `allowed` mode to see raw LLM output:
```
/set emojifilter allowed
```

### Saving Configurations
Save model-specific settings to profiles:
```
/set emojifilter auto
/profile save claude-clean
```

## Expected Behavior

### In `auto` Mode (Default)
- User: "Create a celebration function"
- LLM: "🎉 I'll create a celebration function! ✨"
- Displayed: "I'll create a celebration function!"

### In `warn` Mode
- Same filtering as auto
- After tool execution, system message sent to LLM: "Emojis were detected and removed from your tool call. Please avoid using emojis in tool parameters."
- Tool still executes with filtered parameters

### In `error` Mode with Tool Calls
- LLM attempts: `write_file({content: "# 🚀 Project Setup"})`
- Tool blocked with error: "Cannot write emojis to code files"
- LLM retries: `write_file({content: "# Project Setup"})`
- Tool executes successfully

### File Modification Protection
- LLM attempts: `edit_file({new_string: "console.log('✅ Success!')"})`
- In `auto`/`warn`: Silently converted to `"console.log('[OK] Success!')"`
- In `error`: Blocked entirely, forcing retry without emojis

## Benefits

1. **Professional Output** - Clean, text-only responses suitable for documentation
2. **Flexibility** - Multiple modes for different preferences and requirements
3. **Non-Intrusive** - Default `auto` mode works silently
4. **Educational** - `warn` mode helps train LLMs to avoid emojis
5. **Enforceable** - `error` mode guarantees emoji-free execution
6. **User Freedom** - Users can always type emojis in their input
7. **Preservation** - File content remains unmodified

## Integration Points

The filter integrates seamlessly with:
- Provider response streaming
- Tool execution pipeline
- Settings and profile system
- Session management
- All provider types (Anthropic, OpenAI, Gemini, etc.)