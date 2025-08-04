# Task 09: PromptLoader Component - TDD Phase

## Objective

Write comprehensive behavioral tests for the PromptLoader component that verify file loading and compression behavior.

## Context

Tests must verify real file I/O and compression transformations based on [REQ-011] Compression requirements.

## Requirements to Test

- **[REQ-011.1]** System SHALL compress prompts during loading to reduce token usage
- **[REQ-011.2]** Compression SHALL preserve code blocks exactly
- **[REQ-011.3]** Compression SHALL remove excessive whitespace from prose
- **[REQ-011.4]** Compression SHALL preserve semantic structure
- **[REQ-011.5]** Compression SHALL be applied consistently
- **[REQ-007.4]** File read errors SHALL log warning and use fallback

## File to Create

```
packages/core/test/prompt-config/PromptLoader.spec.ts
```

## Required Behavioral Tests

### 1. Basic File Loading

```typescript
describe('PromptLoader', () => {
  let loader: PromptLoader;
  let testDir: string;

  beforeEach(async () => {
    loader = new PromptLoader();
    // Create temp directory for test files
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-test-'));
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(testDir, { recursive: true });
  });

  it('should load and compress a simple markdown file', async () => {
    /**
     * @requirement REQ-011.1, REQ-011.3
     * @scenario Load file with excessive whitespace
     * @given Markdown file with multiple blank lines and spaces
     * @when loadFile() is called
     * @then Returns compressed content with whitespace reduced
     */
    const content = `# Header

    This is a paragraph with extra blank lines.

    Another paragraph here.`;
    
    const testFile = path.join(testDir, 'test.md');
    await fs.writeFile(testFile, content);
    
    const result = await loader.loadFile(testFile);
    
    expect(result).toBe('# Header\nThis is a paragraph with extra blank lines.\nAnother paragraph here.');
  });
```

### 2. Code Block Preservation

```typescript
  it('should preserve code blocks exactly during compression', async () => {
    /**
     * @requirement REQ-011.2
     * @scenario File contains code blocks
     * @given Markdown with code blocks containing whitespace
     * @when loadFile() is called
     * @then Code blocks preserved exactly, prose compressed
     */
    const content = `# Title

    Some prose here.

    \`\`\`typescript
    function example() {
      // This whitespace is important
      return {
        indented: true
      };
    }
    \`\`\`

    More prose with    extra     spaces.`;
    
    const testFile = path.join(testDir, 'test.md');
    await fs.writeFile(testFile, content);
    
    const result = await loader.loadFile(testFile);
    
    expect(result).toContain('function example() {\n      // This whitespace is important');
    expect(result).toContain('More prose with extra spaces.');
  });

  it('should handle nested code blocks and inline code', async () => {
    /**
     * @requirement REQ-011.2
     * @scenario Mixed code block types
     * @given File with ``` blocks and inline `code`
     * @when loadFile() is called
     * @then All code preserved correctly
     */
    const content = `Use \`inline code\` here.

    \`\`\`
    Plain code block
        with indentation
    \`\`\`

    More text with \`preserved spaces\`.`;
    
    const testFile = path.join(testDir, 'test.md');
    await fs.writeFile(testFile, content);
    
    const result = await loader.loadFile(testFile);
    
    expect(result).toContain('`inline code`');
    expect(result).toContain('Plain code block\n        with indentation');
    expect(result).toContain('`preserved spaces`');
  });
```

### 3. Header and List Compression

```typescript
  it('should simplify headers while preserving structure', async () => {
    /**
     * @requirement REQ-011.4
     * @scenario Multiple header levels
     * @given Headers with ##, ###, ####
     * @when loadFile() is called
     * @then All become single # but structure preserved
     */
    const content = `## Section 1
### Subsection 1.1
#### Deep Section

# Already Simple`;

    const testFile = path.join(testDir, 'test.md');
    await fs.writeFile(testFile, content);
    
    const result = await loader.loadFile(testFile);
    
    expect(result).toBe('# Section 1\n# Subsection 1.1\n# Deep Section\n# Already Simple');
  });

  it('should compress bold list items', async () => {
    /**
     * @requirement REQ-011.3, REQ-011.4
     * @scenario Lists with bold markers
     * @given - **Item**: Description format
     * @when loadFile() is called
     * @then Simplified to - Item: Description
     */
    const content = `- **First**: Description one
- **Second**: Description two
- Regular item
- **Third**: Description three`;

    const testFile = path.join(testDir, 'test.md');
    await fs.writeFile(testFile, content);
    
    const result = await loader.loadFile(testFile);
    
    expect(result).toBe('- First: Description one\n- Second: Description two\n- Regular item\n- Third: Description three');
  });
```

### 4. File System Error Handling

```typescript
  it('should handle missing files gracefully', async () => {
    /**
     * @requirement REQ-007.4
     * @scenario File does not exist
     * @given Non-existent file path
     * @when loadFile() is called
     * @then Throws appropriate error
     */
    const missingFile = path.join(testDir, 'does-not-exist.md');
    
    await expect(loader.loadFile(missingFile)).rejects.toThrow('ENOENT');
  });

  it('should check file existence correctly', async () => {
    /**
     * @requirement REQ-007.4
     * @scenario Check if files exist
     * @given Existing and non-existing paths
     * @when fileExists() is called
     * @then Returns correct boolean values
     */
    const existingFile = path.join(testDir, 'exists.md');
    await fs.writeFile(existingFile, 'content');
    
    const exists = await loader.fileExists(existingFile);
    const notExists = await loader.fileExists(path.join(testDir, 'missing.md'));
    
    expect(exists).toBe(true);
    expect(notExists).toBe(false);
  });
```

### 5. Edge Cases

```typescript
  it('should handle empty files', async () => {
    /**
     * @requirement REQ-011.1
     * @scenario Empty file
     * @given File with no content
     * @when loadFile() is called
     * @then Returns empty string
     */
    const emptyFile = path.join(testDir, 'empty.md');
    await fs.writeFile(emptyFile, '');
    
    const result = await loader.loadFile(emptyFile);
    
    expect(result).toBe('');
  });

  it('should handle files with only whitespace', async () => {
    /**
     * @requirement REQ-011.3
     * @scenario File with only spaces and newlines
     * @given Whitespace-only content
     * @when loadFile() is called
     * @then Returns empty string after compression
     */
    const whitespaceFile = path.join(testDir, 'whitespace.md');
    await fs.writeFile(whitespaceFile, '\n\n   \n\t\n   \n');
    
    const result = await loader.loadFile(whitespaceFile);
    
    expect(result).toBe('');
  });

  it('should handle very large files', async () => {
    /**
     * @requirement REQ-011.5
     * @scenario Large file processing
     * @given File with 10000 lines
     * @when loadFile() is called
     * @then Compresses successfully
     */
    const lines = Array(10000).fill('Line of text here').join('\n\n');
    const largeFile = path.join(testDir, 'large.md');
    await fs.writeFile(largeFile, lines);
    
    const result = await loader.loadFile(largeFile);
    
    expect(result.split('\n').length).toBeLessThan(10000);
    expect(result).toContain('Line of text here');
  });
```

### 6. Character Encoding

```typescript
  it('should handle UTF-8 characters correctly', async () => {
    /**
     * @requirement REQ-011.5
     * @scenario Unicode content
     * @given File with emojis and special characters
     * @when loadFile() is called
     * @then Preserves all characters correctly
     */
    const content = '# Title 🚀\n\nContent with émojis and 中文字符';
    const unicodeFile = path.join(testDir, 'unicode.md');
    await fs.writeFile(unicodeFile, content, 'utf8');
    
    const result = await loader.loadFile(unicodeFile);
    
    expect(result).toBe('# Title 🚀\nContent with émojis and 中文字符');
  });
```

### 7. Code Block Edge Cases

```typescript
  it('should handle unclosed code blocks', async () => {
    /**
     * @requirement REQ-011.2
     * @scenario Malformed code block
     * @given Code block without closing ```
     * @when loadFile() is called
     * @then Treats rest of file as code
     */
    const content = `Text before

\`\`\`typescript
function test() {
  return true;
}

This is still in the code block`;

    const testFile = path.join(testDir, 'unclosed.md');
    await fs.writeFile(testFile, content);
    
    const result = await loader.loadFile(testFile);
    
    expect(result).toContain('This is still in the code block');
    // Should not compress content after unclosed block
  });
```

## Commands to Run

```bash
cd packages/core

# Run tests (should fail with NotYetImplemented)
npm test PromptLoader.spec.ts

# Verify test count
grep -c "it(" test/prompt-config/PromptLoader.spec.ts  # Should be 15+

# Check for behavioral tests
grep -c "toBe\|toEqual\|toContain" test/prompt-config/PromptLoader.spec.ts
```

## Success Criteria

- 15+ behavioral tests
- Tests use real file I/O (temp directory)
- All compression rules tested
- Error handling tested
- Edge cases covered
- All tests fail with NotYetImplemented