# Tool Call Format Parsing

Some models emit tool calls as specially formatted text instead of structured
JSON. LLxprt Code can detect and parse these formats so those models work with
built-in tools.

## How format detection works

LLxprt Code auto-detects the appropriate tool-call format based on the active
provider and model. You can override the auto-detected format at runtime with
the `/toolformat` command.

### Supported formats

The `/toolformat` command accepts the following values:

| Category          | Formats                                                   |
| ----------------- | --------------------------------------------------------- |
| Structured (JSON) | `openai`, `anthropic`, `deepseek`, `qwen`, `kimi`         |
| Text-based        | `hermes`, `xml`, `llama`                                  |
| Hybrid            | `gemma` (JSON tool declarations¹, text-marker responses²) |
| Special           | `auto` (return to auto-detection)                         |

¹ Tool declarations sent to the model use the JSON function-calling format
(the request side goes through `fromOpenAIFormat`).

² Tool-call responses from the model are parsed as text delimited by
`[TOOL_REQUEST]` / `[END_TOOL_REQUEST]` markers (see the Gemma example
below), not as JSON.

The `text` value is **not** a valid format — it will be rejected.

## Using `/toolformat`

Inside an LLxprt Code session:

```text
> /toolformat
Current tool format: auto-detected (gemma)
To override: /toolformat <format>
To return to auto: /toolformat auto
Supported formats:
  Structured: openai, anthropic, deepseek, qwen, kimi
  Text-based: hermes, xml, llama
  Hybrid:     gemma (JSON declarations, text-marker responses)
```

- `/toolformat` (no argument): shows the currently active format.
- `/toolformat <format>`: forces a specific format for the current session.
- `/toolformat auto`: returns to automatic detection.

Examples:

```text
> /toolformat hermes
Tool format override set to 'hermes' for provider 'ollama'.

> /toolformat auto
Tool format override cleared for provider 'ollama'. Using auto-detection.
```

## Provider `toolFormat` setting

You can set a persistent default in the provider configuration:

```json
{
  "providers": [
    {
      "name": "my-local-llm",
      "toolFormat": "hermes"
    }
  ]
}
```

The `/toolformat` command overrides this at runtime; `/toolformat auto` clears
the override and falls back to the provider setting or auto-detection.

## Legacy settings (non-functional)

The `enableTextToolCallParsing` and `textToolCallModels` settings exist in the
configuration schema but are **legacy/non-functional**. They have no production
consumer — nothing in the parsing pipeline reads them to gate behavior. Do not
rely on them. Use `/toolformat` or the provider `toolFormat` setting instead.

## Supported text format patterns

The text-based parsers recognize the following patterns. These are the formats
that `hermes`, `xml`, `llama`, and the structured variants actually parse.

### Hermes (`<tool_call>` tags)

```xml
<tool_call>
{"arguments": {"symbol": "TSLA"}, "name": "get_stock_fundamentals"}
</tool_call>
```

### JSON with name/arguments

```json
{ "name": "search", "arguments": { "query": "climate change" } }
```

### XML parameter tags (Claude-style)

```xml
<invoke name="get_weather">
<parameter name="location">San Francisco</parameter>
</invoke>
```

### Generic XML

```xml
<tool>
  <name>search</name>
  <arguments>
    <query>climate change</query>
  </arguments>
</tool>
```

### Gemma (TOOL_REQUEST)

```text
[TOOL_REQUEST]
list_directory {"path": "/home/user"}
[END_TOOL_REQUEST]
```

### DeepSeek (Unicode tokens)

```text
<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>get_weather
{"location": "San Francisco", "unit": "celsius"}
<｜tool▁call▁end｜>
```

### Llama (pythonic/JSON styles)

```python
[get_user_info(user_id=7890, special='black')]
```

```json
{ "name": "function_name", "parameters": { "arg": "value" } }
```

### Key-Value

```text
✦ tool_call: list_directory for path /home/user ignore *.log
```

## Troubleshooting

**Tool calls not detected:**

1. Use `/toolformat` to check the current format.
2. Try forcing the format with `/toolformat <format>` (e.g., `/toolformat hermes`).
3. If the model's output doesn't match any supported pattern, the tool call
   will be dropped.

**Malformed arguments:**

The parser validates arguments as JSON. If a model emits malformed JSON, the
tool call is dropped.

## Internals

For implementation details — supported format patterns, the parser architecture,
and how to add new formats — see the
[Text Tool Call Parsing internals](../dev-docs/providers/text-tool-call-parsing.md).
