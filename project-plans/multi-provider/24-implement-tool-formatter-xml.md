# Phase 24 – Implement Text Parser for XML Tool Format (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To add support for XML-based tool call formats to the TextToolCallParser. Some models output tool calls using XML tags for structure.

## Background

XML format examples vary by model:

```xml
<!-- Claude-style -->
<function_calls>
<invoke name="get_weather">
<parameter name="location">San Francisco</parameter>
</invoke>
</function_calls>

<!-- Generic XML -->
<tool>
  <name>search</name>
  <arguments>
    <query>climate change</query>
  </arguments>
</tool>
```

## Deliverables

- Updated `TextToolCallParser` with XML patterns
- Tests for XML format parsing
- Support for multiple XML variants

## Checklist (implementer)

- [ ] Update `packages/cli/src/providers/parsers/TextToolCallParser.ts`:
  - [ ] Add XML patterns to patterns array:
    ```typescript
    // Format 6: XML with <invoke> tags (Claude-style)
    /<invoke\s+name="(\w+)">(.*?)<\/invoke>/gs,
    // Format 7: Generic XML tool format
    /<tool>\s*<name>(\w+)<\/name>\s*<arguments>(.*?)<\/arguments>\s*<\/tool>/gs,
    ```
  - [ ] Add XML parameter parsing helper:
    ```typescript
    private parseXMLParameters(xmlContent: string): Record<string, unknown> {
      // Parse <parameter name="key">value</parameter>
      // Or parse <key>value</key> format
    }
    ```

- [ ] Handle XML-specific edge cases:
  - [ ] Nested XML tags
  - [ ] CDATA sections
  - [ ] HTML entities (&lt;, &gt;, etc.)
  - [ ] Multiple parameter formats

- [ ] Update format detection:
  - [ ] Add 'xml' to text-based formats list
  - [ ] Consider creating `XMLToolCallParser` if complexity warrants

- [ ] Add tests to `TextToolCallParser.test.ts`:
  - [ ] Test Claude-style XML format
  - [ ] Test generic XML format
  - [ ] Test nested parameters
  - [ ] Test malformed XML

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/tools/ToolFormatter.test.ts
```

**STOP. Wait for Phase 24a verification.**
