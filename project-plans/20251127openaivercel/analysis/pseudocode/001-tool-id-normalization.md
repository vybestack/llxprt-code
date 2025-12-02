# Pseudocode: Tool ID Normalization

## Purpose

Bidirectional conversion of tool call IDs between internal history format (hist_tool_*) and OpenAI API format (call_*).

## Referenced By

- P04: Tool ID Normalization Tests
- P04a: Tool ID Normalization Implementation
- P06: Message Conversion Implementation

---

## Interface Contracts (TypeScript)

```typescript
// INPUTS
interface NormalizeToOpenAIToolIdInput {
  id: string;  // Tool ID in any format (hist_tool_, call_, toolu_, or unknown)
}

interface NormalizeToHistoryToolIdInput {
  id: string;  // Tool ID in any format (call_, hist_tool_, toolu_, or unknown)
}

// OUTPUTS
interface NormalizeToOpenAIToolIdOutput {
  result: string;  // Always starts with "call_" prefix
}

interface NormalizeToHistoryToolIdOutput {
  result: string;  // Always starts with "hist_tool_" prefix
}

// DEPENDENCIES
// None - these are pure utility functions with no external dependencies
```

## Integration Points (Line-by-Line)

| Line(s) | Integration Point | Connected Component |
|---------|-------------------|---------------------|
| 001-020 | normalizeToOpenAIToolId | Used by 002-message-conversion.md:103, 137 |
| 030-050 | normalizeToHistoryToolId | Used by 003-streaming-generation.md:092, 004-non-streaming-generation.md:087 |
| 060-065 | Round-trip invariant | Tested in P04 property-based tests |

## Anti-Pattern Warnings

```
WARNING: ANTI-PATTERN: Using regex for prefix detection
   Instead: Use string.startsWith() for performance and readability
   
WARNING: ANTI-PATTERN: Modifying the original UUID portion
   Instead: Only change the prefix, preserve UUID as-is
   
WARNING: ANTI-PATTERN: Throwing on unknown formats
   Instead: Gracefully handle by prefixing (lines 019-020, 048-049)

WARNING: ANTI-PATTERN: Calling external services or async operations
   Instead: Keep as synchronous pure functions
```

---

## Function: normalizeToOpenAIToolId

Converts any tool ID format to OpenAI-compatible format (call_* prefix).

```
001: FUNCTION normalizeToOpenAIToolId(id: string) -> string
002:   // Already in OpenAI format - return unchanged
003:   IF id STARTS_WITH "call_" THEN
004:     RETURN id
005:   END IF
006:   
007:   // Convert from history format
008:   IF id STARTS_WITH "hist_tool_" THEN
009:     uuid = id SUBSTRING_FROM length("hist_tool_")
010:     RETURN "call_" + uuid
011:   END IF
012:   
013:   // Convert from Anthropic format
014:   IF id STARTS_WITH "toolu_" THEN
015:     uuid = id SUBSTRING_FROM length("toolu_")
016:     RETURN "call_" + uuid
017:   END IF
018:   
019:   // Unknown format - prefix with call_
020:   RETURN "call_" + id
021: END FUNCTION
```

### Input Constraints
- Line 001: id is a non-null string (may be empty)

### Output Guarantees
- Line 003-004: IDs already in call_ format pass through unchanged
- Line 010: hist_tool_ prefix is replaced with call_
- Line 016: toolu_ prefix is replaced with call_
- Line 020: Unknown formats get call_ prepended

---

## Function: normalizeToHistoryToolId

Converts any tool ID format to internal history format (hist_tool_* prefix).

```
030: FUNCTION normalizeToHistoryToolId(id: string) -> string
031:   // Already in history format - return unchanged
032:   IF id STARTS_WITH "hist_tool_" THEN
033:     RETURN id
034:   END IF
035:   
036:   // Convert from OpenAI format
037:   IF id STARTS_WITH "call_" THEN
038:     uuid = id SUBSTRING_FROM length("call_")
039:     RETURN "hist_tool_" + uuid
040:   END IF
041:   
042:   // Convert from Anthropic format
043:   IF id STARTS_WITH "toolu_" THEN
044:     uuid = id SUBSTRING_FROM length("toolu_")
045:     RETURN "hist_tool_" + uuid
046:   END IF
047:   
048:   // Unknown format - prefix with hist_tool_
049:   RETURN "hist_tool_" + id
050: END FUNCTION
```

### Input Constraints
- Line 030: id is a non-null string (may be empty)

### Output Guarantees
- Line 032-033: IDs already in hist_tool_ format pass through unchanged
- Line 039: call_ prefix is replaced with hist_tool_
- Line 045: toolu_ prefix is replaced with hist_tool_
- Line 049: Unknown formats get hist_tool_ prepended

---

## Round-Trip Guarantee

```
060: // INVARIANT: Round-trip conversion preserves original ID
061: // For any ID x in hist_tool_ format:
062: //   normalizeToHistoryToolId(normalizeToOpenAIToolId(x)) == x
063: 
064: // For any ID x in call_ format:
065: //   normalizeToOpenAIToolId(normalizeToHistoryToolId(x)) == x
```

---

## Edge Cases

```
070: // Edge case: Empty string
071: normalizeToOpenAIToolId("") -> "call_"
072: normalizeToHistoryToolId("") -> "hist_tool_"
073:
074: // Edge case: Just the prefix
075: normalizeToOpenAIToolId("hist_tool_") -> "call_"
076: normalizeToHistoryToolId("call_") -> "hist_tool_"
077:
078: // Edge case: IDs with underscores in UUID portion
079: normalizeToOpenAIToolId("hist_tool_abc_123_def") -> "call_abc_123_def"
080: normalizeToHistoryToolId("call_abc_123_def") -> "hist_tool_abc_123_def"
```

---

## Implementation Notes

- Use string.startsWith() for prefix detection (lines 003, 008, 014, 032, 037, 043)
- Use string.slice() or string.substring() for prefix removal (lines 009, 015, 038, 044)
- No validation of UUID format - just prefix manipulation
- No trimming or normalization of the UUID portion
