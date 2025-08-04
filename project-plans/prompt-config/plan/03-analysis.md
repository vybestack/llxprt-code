# Task 03: Domain Analysis

## Objective

Create a detailed domain analysis for the prompt configuration system, identifying entities, relationships, state transitions, business rules, and edge cases.

## Context

This analysis phase ensures we understand the complete domain before writing any code. Reference the specification.md and architectural-design.md for requirements and design decisions.

## Requirements to Analyze

All requirements from [REQ-001] through [REQ-011] need domain analysis.

## Analysis Deliverables

Create `analysis/domain-model.md` with the following sections:

### 1. Entity Relationships

Identify and document all entities and their relationships:

- **PromptFile**: Represents a prompt markdown file
  - Properties: path, content, type (core/env/tool)
  - Relationships: belongs to PromptContext

- **PromptContext**: Runtime configuration for prompt assembly
  - Properties: provider, model, enabledTools, environment
  - Relationships: determines which PromptFiles to load

- **ResolvedPrompt**: Assembled and cached prompt
  - Properties: assembledContent, metadata, cacheKey
  - Relationships: created from multiple PromptFiles

- **FileSystemLocation**: Where files are stored
  - Properties: baseDir, structure
  - Relationships: contains PromptFiles

### 2. State Transitions

Document the lifecycle of prompts:

1. **Startup State**: Files on disk, nothing loaded
2. **Loading State**: Reading files, applying compression
3. **Cached State**: Prompts assembled and stored in memory
4. **Serving State**: Returning cached prompts to consumers

### 3. Business Rules

Extract and document all business rules from requirements:

From [REQ-002] File Resolution:
- RULE: Resolution must follow most-specific-first order
- RULE: Only first file found is used, no accumulation
- RULE: Missing files trigger fallback to next level

From [REQ-003] Prompt Assembly:
- RULE: Assembly order is always: core → env → tools → user memory
- RULE: Environment files included only when conditions are true
- RULE: Tool files included only for enabled tools

From [REQ-005] Installation:
- RULE: Never overwrite existing user files
- RULE: Empty files are intentional (no content desired)
- RULE: Missing defaults must be created from built-in content

From [REQ-011] Compression:
- RULE: Code blocks must be preserved exactly
- RULE: Compression applied to all prompts consistently
- RULE: Prose sections have whitespace reduced

### 4. Edge Cases

Identify all edge cases that need handling:

File System:
- Base directory doesn't exist
- No read/write permissions
- File deleted between existence check and read
- Symbolic links in paths
- Very large files (>10MB)
- Invalid UTF-8 in files
- Path traversal attempts (../)

Configuration:
- Empty enabledTools array
- Unknown provider/model names
- Provider with special characters
- Tool name that can't be converted to kebab-case
- All environment flags false

Template Processing:
- Unclosed variable brackets
- Nested variables
- Variables with spaces
- Missing variable values
- Circular variable references

Performance:
- Hundreds of enabled tools
- Deep provider/model hierarchy
- Cache growing beyond memory limits

### 5. Error Scenarios

Reference error-scenarios.md and categorize by severity:

**Fatal Errors** (stop execution):
- Cannot read/write to ~/.llxprt
- Default constants missing from package
- Critical files corrupted

**Recoverable Errors** (use fallback):
- Specific override file missing
- File read permission denied
- Malformed template variables

**Warnings** (log and continue):
- Unknown tool in enabledTools
- Empty prompt file
- Debug logging failures

### 6. Data Flow Diagrams

Document how data flows through the system:

```
Provider Request → PromptService.getPrompt(context)
                ↓
        PromptCache.get(context)
                ↓ (cache miss)
        PromptResolver.resolveFiles(context)
                ↓
        PromptLoader.loadFile(path) [with compression]
                ↓
        TemplateEngine.process(content, variables)
                ↓
        PromptCache.set(assembled)
                ↓
        Return assembled prompt
```

## Success Criteria

- All entities clearly defined with properties
- State transitions documented
- Business rules extracted from all REQ tags
- Comprehensive edge case list
- Error scenarios categorized
- No implementation details included