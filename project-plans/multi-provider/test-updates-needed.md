# Test Updates Needed for Dual Tool System

## Overview

With the introduction of text-based tool parsing alongside structured tool formatting, several verification phases need updated tests to cover both paths.

## Phases Requiring Test Updates

### Phase 11a - ToolFormatter Integration Verification

- Add tests for auto-format detection
- Test that text-based formats bypass ToolFormatter
- Verify toolFormat override mechanism

### Phase 12a - /toolformat Command Verification

- Test auto-detection display
- Test override functionality
- Test switching between structured and text formats

### Phase 13a - Tool Format Flow Verification

- Test that overrides work with both paths
- Verify text formats trigger TextToolCallParser
- Verify structured formats use ToolFormatter

### Phase 17a - Anthropic Tool Formatter Verification

- Ensure Anthropic is marked as structured format
- Test it doesn't accidentally use text parsing

### Phase 20a - Anthropic Provider Manager Integration

- Test provider switching between text and structured formats
- Verify format detection updates correctly

### Phase 21a - Anthropic CLI Integration

- End-to-end tests with Anthropic (structured) and Gemma (text)
- Test switching between them mid-conversation

### Phase 25a - Tool Execution Integration

- **Most critical**: Test both paths lead to successful execution
- Test mixed tool calls (some structured, some text)
- Verify error handling for both paths

## New Test Scenarios

### Integration Tests

1. **Format Auto-Detection**
   - Switch models and verify format changes
   - Test models with same provider but different formats

2. **Text Parsing Robustness**
   - Multiple formats in single response
   - Partial/malformed tool calls
   - Tool calls with complex nested arguments

3. **Performance Tests**
   - Compare structured vs text parsing speed
   - Memory usage with large responses

### Regression Tests

1. Ensure existing OpenAI tests still pass
2. Verify Gemini compatibility wrapper still works
3. Check that non-tool responses aren't affected

## Test Data Needed

- Sample responses from each text format (Hermes, XML, DeepSeek, Llama)
- Edge cases: empty tool calls, huge arguments, special characters
- Multi-tool responses in various formats
