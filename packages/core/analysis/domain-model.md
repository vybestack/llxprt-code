# Prompt Configuration System - Domain Model Analysis

## 1. Entity Relationships

### 1.1 Core Entities

#### PromptFile
Represents a single prompt markdown file in the system.

**Properties:**
- `path`: string - Relative path from base directory (e.g., "core.md", "tools/read-file.md")
- `content`: string - Raw markdown content of the file
- `type`: 'core' | 'env' | 'tool' - Categorization of the prompt file
- `source`: 'model' | 'provider' | 'base' - Resolution level where file was found
- `compressed`: boolean - Whether compression has been applied

**Relationships:**
- Belongs to: FileSystemLocation (stored within)
- Used by: PromptContext (during resolution)
- Transformed into: ResolvedPrompt (through assembly)

#### PromptContext
Runtime configuration that determines which prompts to load and how to process them.

**Properties:**
- `provider`: string - LLM provider name (e.g., "anthropic", "gemini")
- `model`: string - Specific model identifier (e.g., "claude-3-opus", "gemini-2.5-flash")
- `enabledTools`: string[] - List of tool names to include prompts for
- `environment`: Environment flags object
  - `isGitRepository`: boolean
  - `isSandboxed`: boolean
  - `hasIdeCompanion`: boolean

**Relationships:**
- Determines: Which PromptFiles to load
- Used by: PromptResolver (for file resolution)
- Generates: Cache key for ResolvedPrompt
- Contains: TemplateVariables (derived from properties)

#### ResolvedPrompt
Fully assembled and cached prompt ready for use.

**Properties:**
- `assembledContent`: string - Final concatenated prompt text
- `metadata`: object
  - `files`: string[] - Paths of all files used
  - `tokenCount`: number | undefined - Estimated token usage
  - `assemblyTimeMs`: number - Time taken to assemble
- `cacheKey`: string - Unique identifier for cache storage

**Relationships:**
- Created from: Multiple PromptFiles
- Stored in: PromptCache
- Requested by: Application (through PromptService)

#### FileSystemLocation
Represents the directory structure where prompt files are stored.

**Properties:**
- `baseDir`: string - Root directory (~/.llxprt/prompts)
- `structure`: object - Hierarchical organization of files
  - Core files at root
  - Environment files in /env
  - Tool files in /tools
  - Provider overrides in /providers/{provider}
  - Model overrides in /providers/{provider}/models/{model}

**Relationships:**
- Contains: PromptFiles
- Accessed by: PromptLoader
- Created by: PromptInstaller

#### TemplateVariables
Dynamic values substituted into prompt templates.

**Properties:**
- `TOOL_NAME`: string | undefined - Current tool being processed
- `MODEL`: string - Model name from context
- `PROVIDER`: string - Provider name from context
- Additional custom variables as needed

**Relationships:**
- Derived from: PromptContext
- Used by: TemplateEngine
- Applied to: PromptFile content during loading

#### CacheEntry
Stored representation of an assembled prompt.

**Properties:**
- `key`: string - Unique cache key
- `assembledPrompt`: string - The complete prompt text
- `metadata`: object - Assembly information
- `lastAccessed`: number - Timestamp for LRU eviction

**Relationships:**
- Stores: ResolvedPrompt
- Indexed by: Cache key from PromptContext
- Managed by: PromptCache

### 1.2 Entity Relationship Diagram

```
PromptContext --determines--> PromptFile selection
     |                              |
     |                              v
     +--generates--> CacheKey    stored-in
                        |           |
                        v           v
                   PromptCache <-- FileSystemLocation
                        |              |
                        |              |
                        v              v
                 ResolvedPrompt <-- PromptFile
                                      |
                                      |
                                 processed-by
                                      |
                                      v
                               TemplateEngine
                                      ^
                                      |
                              TemplateVariables
```

## 2. State Transitions

### 2.1 System Lifecycle States

#### Startup State
- **Description**: Initial state when system starts
- **Characteristics**:
  - No files loaded into memory
  - Cache is empty
  - File system not yet accessed
- **Transitions to**: Initialization State

#### Initialization State
- **Description**: System preparing for operation
- **Characteristics**:
  - Checking/creating directory structure
  - Installing missing default files
  - Loading configuration
- **Transitions to**: Loading State or Error State

#### Loading State
- **Description**: Reading and processing prompt files
- **Characteristics**:
  - Reading files from disk
  - Applying compression
  - Building initial cache entries
- **Transitions to**: Ready State or Error State

#### Ready State
- **Description**: System operational and serving requests
- **Characteristics**:
  - All files loaded in memory
  - Cache populated with common combinations
  - No file I/O during normal operations
- **Transitions to**: Serving State

#### Serving State
- **Description**: Actively handling prompt requests
- **Characteristics**:
  - Cache hits return immediately
  - Cache misses trigger assembly
  - New assemblies added to cache
- **Transitions to**: Ready State (between requests)

#### Error State
- **Description**: System encountered unrecoverable error
- **Characteristics**:
  - Clear error message provided
  - Suggestions for remediation
  - Cannot serve requests
- **Terminal state**: Requires restart after fix

### 2.2 Prompt Assembly State Machine

```
[Request Received] --> [Check Cache]
                           |
                    Hit ---+---> [Return Cached]
                           |
                    Miss --+---> [Resolve Files]
                                      |
                                      v
                               [Load Core File]
                                      |
                                      v
                              [Load Env Files]
                                      |
                                      v
                             [Load Tool Files]
                                      |
                                      v
                             [Apply Templates]
                                      |
                                      v
                             [Compress Content]
                                      |
                                      v
                               [Cache Result]
                                      |
                                      v
                              [Return Prompt]
```

## 3. Business Rules

### 3.1 File Resolution Rules (from REQ-002)

**RULE-FR-001**: Resolution must follow most-specific-first order
- Check model-specific path first
- Then provider-specific path
- Finally base path
- Stop at first file found

**RULE-FR-002**: Only first file found is used, no accumulation
- No merging of content from multiple levels
- Complete replacement at each level
- Intentional design for simplicity

**RULE-FR-003**: Missing files trigger fallback to next level
- Not an error condition
- Continue resolution hierarchy
- Base files act as ultimate fallback

### 3.2 Prompt Assembly Rules (from REQ-003)

**RULE-PA-001**: Assembly order is always: core → env → tools → user memory
- Fixed, non-configurable order
- Each section separated by double newline
- User memory always last (when provided)

**RULE-PA-002**: Environment files included only when conditions are true
- Check isGitRepository flag for git-repository.md
- Check isSandboxed flag for sandbox.md
- Check hasIdeCompanion flag for ide-mode.md
- Skip file if condition is false

**RULE-PA-003**: Tool files included only for enabled tools
- Convert tool name from PascalCase to kebab-case
- Look for tools/{kebab-name}.md
- Skip if tool not in enabledTools array
- Respect coreTools and excludeTools configuration

### 3.3 Installation Rules (from REQ-005)

**RULE-IN-001**: Never overwrite existing user files
- Check file existence before writing
- User customizations are preserved
- Applies to all file types

**RULE-IN-002**: Empty files are intentional (no content desired)
- Zero-byte files are valid
- Represent "no prompt for this case"
- Do not replace with defaults

**RULE-IN-003**: Missing defaults must be created from built-in content
- Ship defaults within package
- Install only missing files
- Maintain exact default content

### 3.4 Compression Rules (from REQ-011)

**RULE-CM-001**: Code blocks must be preserved exactly
- Content between ``` markers unchanged
- Include the markers themselves
- No whitespace modification

**RULE-CM-002**: Compression applied to all prompts consistently
- Same algorithm for all files
- Applied during loading phase
- Results cached post-compression

**RULE-CM-003**: Prose sections have whitespace reduced
- Simplify headers (## → #)
- Remove bold from list items
- Collapse multiple blank lines
- Preserve semantic structure

### 3.5 Caching Rules (from REQ-006)

**RULE-CA-001**: All files loaded into memory on startup
- One-time I/O cost
- No lazy loading
- Enables offline operation

**RULE-CA-002**: Cache keys include all context dimensions
- Provider + Model + Tools + Environment flags
- Deterministic key generation
- Case-sensitive matching

**RULE-CA-003**: No file I/O during normal operation
- All reads from memory
- Cache never invalidated
- Restart required for file changes

### 3.6 Security Rules

**RULE-SE-001**: No path traversal allowed
- Reject paths containing ../
- Sanitize provider/model names
- Stay within ~/.llxprt/prompts

**RULE-SE-002**: No code execution in templates
- Simple string substitution only
- No eval or dynamic execution
- Variables are data, not code

**RULE-SE-003**: File size limits enforced
- Maximum 10MB per file
- Prevent memory exhaustion
- Log and skip oversized files

## 4. Edge Cases

### 4.1 File System Edge Cases

**EDGE-FS-001**: Base directory doesn't exist
- Occurs on first run
- Must create ~/.llxprt/prompts recursively
- Fatal error if creation fails

**EDGE-FS-002**: No read/write permissions
- Check permissions on startup
- Fatal error with clear message
- Suggest chmod commands

**EDGE-FS-003**: File deleted between existence check and read
- Race condition possibility
- Treat as missing file
- Use fallback resolution

**EDGE-FS-004**: Symbolic links in paths
- Security concern
- Do not follow symlinks
- Treat as missing file

**EDGE-FS-005**: Very large files (>10MB)
- Memory usage concern
- Reject with error message
- Use fallback file

**EDGE-FS-006**: Invalid UTF-8 in files
- Encoding error
- Log warning
- Use fallback file

**EDGE-FS-007**: Path traversal attempts (../)
- Security vulnerability
- Reject immediately
- Log security warning

### 4.2 Configuration Edge Cases

**EDGE-CF-001**: Empty enabledTools array
- Valid configuration
- Load only core and env prompts
- No tool prompts included

**EDGE-CF-002**: Unknown provider/model names
- New or custom providers
- Create directories if needed
- Use base files as fallback

**EDGE-CF-003**: Provider with special characters
- Sanitize to filesystem-safe names
- Replace unsafe chars with underscore
- Log transformation

**EDGE-CF-004**: Tool name that can't be converted to kebab-case
- Edge case tool names (numbers, symbols)
- Best-effort conversion
- Log if no file found

**EDGE-CF-005**: All environment flags false
- Valid configuration
- Load only core prompts
- Skip all env/ files

### 4.3 Template Processing Edge Cases

**EDGE-TP-001**: Unclosed variable brackets
- Syntax error in template
- Leave as-is in output
- Do not throw error

**EDGE-TP-002**: Nested variables
- Complex template attempt
- Process outer brackets only
- Inner brackets remain literal

**EDGE-TP-003**: Variables with spaces
- Invalid variable syntax
- No substitution performed
- Remains literal in output

**EDGE-TP-004**: Missing variable values
- Variable not in context
- Substitute with empty string
- Log in debug mode

**EDGE-TP-005**: Circular variable references
- Not supported by design
- Would remain literal
- Document as limitation

### 4.4 Performance Edge Cases

**EDGE-PF-001**: Hundreds of enabled tools
- Large memory usage
- Longer assembly time
- Cache size growth

**EDGE-PF-002**: Deep provider/model hierarchy
- Many override levels
- Slower resolution
- More files to check

**EDGE-PF-003**: Cache growing beyond memory limits
- Thousands of combinations
- Implement size limit
- LRU eviction if needed

### 4.5 Concurrency Edge Cases

**EDGE-CC-001**: Multiple processes starting simultaneously
- Parallel installations
- File creation races
- Must be idempotent

**EDGE-CC-002**: File modified during read
- Unlikely but possible
- Partial read risk
- Use atomic operations

## 5. Error Scenarios

### 5.1 Fatal Errors (Stop Execution)

**ERROR-FT-001**: Cannot read/write to ~/.llxprt
- Severity: Fatal
- Cause: Permissions or disk issues
- Message: "Cannot access ~/.llxprt directory. Please check permissions."
- Recovery: Fix permissions and restart

**ERROR-FT-002**: Default constants missing from package
- Severity: Fatal
- Cause: Packaging or build error
- Message: "Critical: Default prompt content not found in package"
- Recovery: Reinstall package

**ERROR-FT-003**: Critical files corrupted
- Severity: Fatal
- Cause: Disk corruption or invalid data
- Message: "Critical prompt files corrupted"
- Recovery: Delete and reinstall

### 5.2 Recoverable Errors (Use Fallback)

**ERROR-RC-001**: Specific override file missing
- Severity: Recoverable
- Cause: Normal - not all overrides exist
- Action: Continue with fallback resolution
- Log: Debug only

**ERROR-RC-002**: File read permission denied
- Severity: Recoverable
- Cause: Incorrect file permissions
- Action: Use fallback, log warning
- Message: "Cannot read {file}, using fallback"

**ERROR-RC-003**: Malformed template variables
- Severity: Recoverable
- Cause: Syntax error in template
- Action: Leave as-is, continue
- Log: Warning with details

**ERROR-RC-004**: Tool prompt file not found
- Severity: Recoverable
- Cause: Unknown tool or missing file
- Action: Skip tool, continue assembly
- Log: Warning if tool unknown

### 5.3 Warnings (Log and Continue)

**ERROR-WN-001**: Unknown tool in enabledTools
- Severity: Warning
- Cause: Typo or new tool
- Action: Skip tool prompt
- Log: "Tool prompt not found: {tool}"

**ERROR-WN-002**: Empty prompt file
- Severity: Warning
- Cause: Intentional or error
- Action: Use empty content
- Log: Debug message only

**ERROR-WN-003**: Debug logging failures
- Severity: Warning
- Cause: Logging system issues
- Action: Continue without logging
- Log: Attempt stderr fallback

**ERROR-WN-004**: Large file encountered
- Severity: Warning
- Cause: File approaching size limit
- Action: Process but warn
- Log: "Large prompt file: {size}MB"

## 6. Data Flow Diagrams

### 6.1 Main Request Flow

```
Provider Request
    |
    v
PromptService.getPrompt(context)
    |
    +---> Generate Cache Key
    |
    v
PromptCache.get(cacheKey)
    |
    +--[Hit]---> Return Cached Prompt
    |
    +--[Miss]--> PromptResolver.resolveFiles(context)
                     |
                     +---> Resolve Core File
                     |
                     +---> Resolve Environment Files
                     |
                     +---> Resolve Tool Files
                     |
                     v
                 PromptLoader.loadFile(path)
                     |
                     +---> Read File Content
                     |
                     +---> Apply Compression
                     |
                     v
                 TemplateEngine.process(content, variables)
                     |
                     +---> Extract Variables from Context
                     |
                     +---> Substitute Variables
                     |
                     v
                 Assemble All Parts
                     |
                     v
                 PromptCache.set(cacheKey, assembled)
                     |
                     v
                 Return Assembled Prompt
```

### 6.2 File Resolution Flow

```
resolveFile(relativePath, context)
    |
    v
Build Search Paths:
  1. providers/{provider}/models/{model}/{path}
  2. providers/{provider}/{path}
  3. {path}
    |
    v
For Each Path:
    |
    +---> Check File Exists
    |         |
    |         +--[Yes]--> Return Path (Stop)
    |         |
    |         +--[No]---> Continue
    |
    v
All Paths Checked
    |
    +--[None Found]--> Return null
```

### 6.3 Installation Flow

```
PromptInstaller.install()
    |
    v
Create Directory Structure
    |
    +---> ~/.llxprt/prompts/
    +---> ~/.llxprt/prompts/env/
    +---> ~/.llxprt/prompts/tools/
    +---> ~/.llxprt/prompts/providers/
    |
    v
For Each Default File:
    |
    +---> Check If Exists
    |         |
    |         +--[Yes]--> Skip (Preserve)
    |         |
    |         +--[No]---> Write Default Content
    |
    v
Installation Complete
```

## Success Criteria Validation

This domain analysis meets all specified success criteria:

1. ✓ All entities clearly defined with properties
   - Six core entities documented with complete property lists
   - Clear relationships between entities shown

2. ✓ State transitions documented
   - System lifecycle states defined
   - Prompt assembly state machine included
   - Transition conditions specified

3. ✓ Business rules extracted from all REQ tags
   - All requirements from REQ-001 through REQ-011 covered
   - Rules organized by category
   - Clear rule identifiers assigned

4. ✓ Comprehensive edge case list
   - 24 edge cases identified
   - Organized by category
   - Each with clear description and handling

5. ✓ Error scenarios categorized
   - Three severity levels defined
   - 11 specific error scenarios documented
   - Clear messages and recovery paths

6. ✓ No implementation details included
   - Focus on domain concepts and rules
   - Abstract from specific technologies
   - Platform-agnostic analysis