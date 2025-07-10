# Phase 23b – Implement Text Parsers for DeepSeek and Llama Formats (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To add support for DeepSeek and Llama tool call formats to the TextToolCallParser. These models use unique text-based formats for tool calls.

## Background

### DeepSeek Format:

```
<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>get_weather
{"location": "San Francisco", "unit": "celsius"}
<｜tool▁call▁end｜>
```

### Llama Formats:

```python
# Pythonic format (Llama 3.2)
[get_user_info(user_id=7890, special='black')]

# Function tag format
<function=example_function_name>{"example_name": "example_value"}</function>

# JSON format (Llama 3.1)
{"name": "function_name", "parameters": {"arg": "value"}}
```

## Deliverables

- Updated `TextToolCallParser` with DeepSeek and Llama patterns
- Tests for new format parsing
- Updated format detection logic

## Checklist (implementer)

- [ ] Update `packages/cli/src/providers/parsers/TextToolCallParser.ts`:
  - [ ] Add DeepSeek pattern:
    ```typescript
    // Format 8: DeepSeek with special tokens
    /<｜tool▁call▁begin｜>function<｜tool▁sep｜>(\w+)\s*({.*?})\s*<｜tool▁call▁end｜>/gs,
    ```
  - [ ] Add Llama patterns:
    ```typescript
    // Format 9: Llama pythonic format
    /\[(\w+)\((.*?)\)\]/gs,
    // Format 10: Llama function tag format
    /<function=(\w+)>({.*?})<\/function>/gs,
    ```
  - [ ] Add pythonic argument parser:
    ```typescript
    private parsePythonicArgs(argsStr: string): Record<string, unknown> {
      // Parse "user_id=7890, special='black'" format
    }
    ```

- [ ] Update format detection:
  - [ ] Add model detection for DeepSeek variants
  - [ ] Add model detection for Llama variants
  - [ ] Map models to their preferred formats

- [ ] Handle format-specific quirks:
  - [ ] DeepSeek's special Unicode characters
  - [ ] Llama's mixed quote styles in pythonic format
  - [ ] Multiple tool calls in sequence

- [ ] Add tests:
  - [ ] Test DeepSeek format with special tokens
  - [ ] Test all three Llama formats
  - [ ] Test pythonic format with various argument types
  - [ ] Test edge cases and malformed inputs

## Self-verify

```bash
npm run typecheck
npm run lint
npm test src/providers/parsers/TextToolCallParser.test.ts
```

**STOP. Wait for Phase 23c verification.**
