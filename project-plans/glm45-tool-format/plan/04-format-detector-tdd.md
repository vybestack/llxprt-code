# Phase 4: Format Detector TDD

## Objective

Write comprehensive behavioral tests for ToolFormatDetector.

## Worker Task

```bash
claude --dangerously-skip-permissions -p "
Write behavioral tests for ToolFormatDetector.

Create packages/core/test/providers/openai/toolFormats/ToolFormatDetector.spec.ts:

/**
 * @requirement REQ-001.1
 * @scenario Detect format from settings not model
 * @given Settings with toolFormat='qwen'
 * @when detectFormat('gpt-4', settings) called
 * @then Returns qwen format from explicit setting
 */
test('should prioritize settings over model detection', () => {
  const detector = new ToolFormatDetector();
  const settings = { toolFormat: 'qwen' };
  
  const result = detector.detectFormat('gpt-4', settings);
  
  expect(result.detectedFormat).toBe('qwen');
  expect(result.source).toBe('explicit-setting');
  expect(result.confidence).toBe(1.0);
});

/**
 * @requirement REQ-002.1
 * @scenario GLM-4.5 auto-detects as Qwen format
 * @given Model name 'glm-4.5'
 * @when detectFormat called without settings
 * @then Returns qwen format from model pattern
 */
test('should detect qwen format for GLM-4.5 model', () => {
  const detector = new ToolFormatDetector();
  
  const result = detector.detectFormat('glm-4.5', {});
  
  expect(result.detectedFormat).toBe('qwen');
  expect(result.source).toBe('model-pattern');
  expect(result.confidence).toBe(0.9);
});

/**
 * @requirement REQ-003.1
 * @scenario GLM-4.5 variations detected
 * @given Various GLM-4.5 model names
 * @when detectFormat called for each
 * @then All return qwen format
 */
test('should handle GLM-4.5 name variations', () => {
  const detector = new ToolFormatDetector();
  const variations = ['glm-4.5', 'GLM-4.5', 'glm-4.5-plus'];
  
  for (const model of variations) {
    const result = detector.detectFormat(model, {});
    expect(result.detectedFormat).toBe('qwen');
  }
});

/**
 * @requirement REQ-001.2
 * @scenario Override auto-detection
 * @given GLM-4.5 model with toolFormat='openai'
 * @when detectFormat called
 * @then Returns openai from explicit setting
 */
test('should allow format override for GLM models', () => {
  const detector = new ToolFormatDetector();
  const settings = { toolFormat: 'openai' };
  
  const result = detector.detectFormat('glm-4.5', settings);
  
  expect(result.detectedFormat).toBe('openai');
  expect(result.source).toBe('explicit-setting');
});

/**
 * @requirement REQ-004.1
 * @scenario Existing Qwen models work
 * @given Model 'qwen3-coder-plus'
 * @when detectFormat called
 * @then Returns qwen format
 */
test('should detect qwen format for qwen models', () => {
  const detector = new ToolFormatDetector();
  
  const result = detector.detectFormat('qwen3-coder-plus', {});
  
  expect(result.detectedFormat).toBe('qwen');
  expect(result.source).toBe('model-pattern');
});

/**
 * @requirement REQ-001.4
 * @scenario Unknown model defaults to OpenAI
 * @given Unknown model 'custom-llm'
 * @when detectFormat called
 * @then Returns openai as default
 */
test('should default to openai for unknown models', () => {
  const detector = new ToolFormatDetector();
  
  const result = detector.detectFormat('custom-llm', {});
  
  expect(result.detectedFormat).toBe('openai');
  expect(result.source).toBe('default');
  expect(result.confidence).toBe(0.5);
});

/**
 * @requirement REQ-002.2
 * @scenario Get strategy for format
 * @given Detected format is 'qwen'
 * @when getStrategy called
 * @then Returns QwenFormatStrategy instance
 */
test('should return correct strategy for format', () => {
  const detector = new ToolFormatDetector();
  
  const strategy = detector.getStrategy('qwen');
  
  expect(strategy).toBeInstanceOf(QwenFormatStrategy);
  expect(strategy.formatTools).toBeDefined();
  expect(strategy.parseToolCall).toBeDefined();
});

/**
 * @requirement REQ-003.2
 * @scenario Settings with 'auto' value
 * @given Settings with toolFormat='auto'
 * @when detectFormat for GLM-4.5
 * @then Uses model pattern detection
 */
test('should use model detection when format is auto', () => {
  const detector = new ToolFormatDetector();
  const settings = { toolFormat: 'auto' };
  
  const result = detector.detectFormat('glm-4.5', settings);
  
  expect(result.detectedFormat).toBe('qwen');
  expect(result.source).toBe('model-pattern');
});

// Add 7+ more tests covering:
// - Case insensitive model matching
// - GPT models default to OpenAI
// - Claude models default to OpenAI  
// - Gemini model detection
// - Invalid format in settings ignored
// - Strategy caching/reuse
// - Performance within 1ms requirement

IMPORTANT:
- Test behavior not implementation
- No mock verification (toHaveBeenCalled)
- Check actual values returned
- Tests must fail initially
"
```

## Verification

```bash
# Run tests - should fail with NotYetImplemented
npm test packages/core/test/providers/openai/toolFormats/ToolFormatDetector.spec.ts

# Check behavioral assertions
grep -c "toBe\|toEqual" ToolFormatDetector.spec.ts
# Should be 15+

# No mock theater
grep "toHaveBeenCalled" ToolFormatDetector.spec.ts
[ $? -ne 0 ] || echo "FAIL: Mock verification"

# Requirement coverage
for req in REQ-001.1 REQ-002.1 REQ-003.1 REQ-004.1; do
  grep "@requirement $req" ToolFormatDetector.spec.ts || echo "MISSING: $req"
done
```