# BS Filter System Overview

## Purpose

The BS filter system provides configurable control over BS phrases in LLM outputs and tool calls. This addresses the need for professional, BS-free interactions while maintaining flexibility for users who find these phrases acceptable or need them for specific use cases.

## Core Functionality

### What It Filters

The BS filter applies to:
- **LLM text responses** - All streaming text output from providers (Anthropic, OpenAI, Gemini, etc.)
- **Tool call parameters** - Arguments passed to tools by the LLM, especially:
  - File modification tools (`edit_file`, `write_file`, `replace`) - prevents BS in code
  - All other tool inputs to maintain consistency
- **Tool result displays** - Output shown to users from tool executions

### What It Does NOT Filter

The filter explicitly does NOT apply to:
- **User input** - Users can type BS phrases freely
- **File content** - Reading files preserves original content
- **System messages** - Internal communication remains unfiltered
- **Error messages** - System errors display as-is

## Configuration Modes

The filter operates in four distinct modes:

### 1. `allowed` Mode
- No filtering performed
- All BS phrases pass through unchanged
- For users who want the full LLM experience

### 2. `auto` Mode (Default)
- Silent removal/conversion of BS phrases
- No warnings or errors
- Useful BS phrases can be converted to text equivalents if needed later
- Decorative or redundant BS phrases removed entirely

### 3. `warn` Mode
- Same filtering as `auto` mode
- After tool execution, sends feedback to LLM about stripped BS phrases
- Helps train LLM to avoid these phrases
- Does not block execution

### 4. `error` Mode
- Blocks tool execution if BS phrases are detected
- Returns error to LLM instead of executing tool
- Strictest mode for zero-tolerance environments
- Forces LLM to retry without these phrases

## Configuration Hierarchy

Settings follow a clear precedence order:

1. **Session Configuration** (Highest Priority)
   - Set via `/set bsfilter [mode]`
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

## BS Phrases to Filter (Remove or Convert)

The default set of phrases to filter includes the common BS phrases that many find annoying or unnecessarily repetitive:

**Phrases for Conversion or Removal:**
- "You're absolutely right" → "[ACKNOWLEDGED]"
- "That's a BRILLIANT observation" → "[NOTED]"
- "As an AI language model..." → (Remove entirely)
- "I do not have personal opinions, feelings, or experiences." → (Remove entirely)
- "I understand your query/request." → (Remove entirely)
- "I'm here to help!" → (Remove entirely)
- "Let me break that down for you." → "[ANALYSIS]"
- "While I strive for accuracy..." → (Remove entirely)
- "It's important to note that..." → (Remove entirely)
- "In conclusion..." → (Remove entirely when not necessary)
- "I aim to be helpful and harmless." → (Remove entirely)
- "Feel free to ask if you have any more questions!" → (Remove entirely)

These defaults can be overridden by the user with their own list in settings and profiles.

## Use Cases

### Professional Environments
Set default to `error` mode in settings.json to enforce BS-free communication across all sessions.

### Problematic Models
When a model produces excessive BS phrases, temporarily relax filtering:
```
/set bsfilter warn
```

### Development/Testing
Use `allowed` mode to see raw LLM output:
```
/set bsfilter allowed
```

### Saving Configurations
Save model-specific settings to profiles:
```
/set bsfilter auto
/profile save claude-clean
```

## Expected Behavior

### In `auto` Mode (Default)
- User: "Can you explain this concept?"
- LLM: "You're absolutely right! Let me break that down for you. It's important to note that..."
- Displayed: "Let me break that down for you. [NOTES]"

### In `warn` Mode
- Same filtering as auto
- After tool execution, system message sent to LLM: "BS phrases were detected and removed from your tool call. Please avoid using BS phrases in tool parameters."

### In `error` Mode with Tool Calls
- LLM attempts: `write_file({content: "You're absolutely right! Here's the updated code..."})`
- Tool blocked with error: "Cannot write BS phrases to code files"
- LLM retries: `write_file({content: "Here's the updated code..."})`
- Tool executes successfully

### File Modification Protection
- LLM attempts: `edit_file({new_string: "console.log('That's a BRILLIANT observation')"})`
- In `auto`/`warn`: Silently converted to `"console.log('[NOTED]')"`
- In `error`: Blocked entirely, forcing retry without BS phrases

## Benefits

1. **Professional Output** - Clean, direct responses without redundant phrases
2. **Flexibility** - Multiple modes for different preferences and requirements
3. **Non-Intrusive** - Default `auto` mode works silently
4. **Educational** - `warn` mode helps train LLMs to avoid these phrases
5. **Enforceable** - `error` mode guarantees BS-free execution
6. **User Freedom** - Users can always type BS phrases in their input
7. **Customizable** - Users can configure their own sets of phrases to filter
8. **Preservation** - File content remains unmodified when reading files

## Integration Points

The filter integrates seamlessly with:
- Provider response streaming
- Tool execution pipeline
- Settings and profile system
- Session management
- All provider types (Anthropic, OpenAI, Gemini, etc.)