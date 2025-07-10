# Phase 08f – Document Text-Based Tool Call Parsing (multi-provider)

## Goal

Document the text-based tool call parsing system for users and developers, explaining configuration, supported formats, and debugging.

## Deliverables

- Updated README with text-based tool parsing section
- Configuration examples in settings documentation
- Debugging guide for tool parsing issues

## Checklist

### User Documentation

- [ ] Add section to README.md explaining text-based tool support:

  ````markdown
  ## Text-Based Tool Call Support

  Some models output tool calls as text rather than structured JSON. The CLI automatically detects and parses these formats.

  ### Supported Models

  - gemma-3-12b-it
  - gemma-2-27b-it
  - Custom models (configurable)

  ### Configuration

  ```json
  {
    "enableTextToolCallParsing": true,
    "textToolCallModels": ["my-custom-model"]
  }
  ```
  ````

  ```

  ```

### Developer Documentation

- [ ] Create `docs/tool-parsing.md` with:
  - Supported formats and examples
  - How to add new patterns
  - Parser architecture explanation
  - Debugging tips

### Configuration Documentation

- [ ] Update settings documentation with:
  - `enableTextToolCallParsing` - Enable/disable text parsing
  - `textToolCallModels` - Additional models that need text parsing
  - Examples of when to use each setting

### Debugging Guide

- [ ] Add troubleshooting section:
  - How to enable debug logging
  - Common parsing failures and solutions
  - How to test new formats
  - Pattern regex explanations

## Self-verify

- [ ] Documentation is clear and includes examples
- [ ] All supported formats are documented
- [ ] Configuration options are explained
- [ ] Debugging steps are actionable
