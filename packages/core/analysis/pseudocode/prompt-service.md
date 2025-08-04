# Prompt Service Pseudocode

## Overview
The Prompt Service is the main API that coordinates all components to provide assembled prompts to the application.

## Data Structures

```
STRUCTURE PromptService:
  - baseDir: string
  - cache: PromptCache instance
  - resolver: PromptResolver instance
  - loader: PromptLoader instance
  - templateEngine: TemplateEngine instance
  - installer: PromptInstaller instance
  - defaultContent: map of path->content
  - initialized: boolean
  - config: object with:
    - maxCacheSizeMB: number
    - compressionEnabled: boolean
    - debugMode: boolean
```

## Functions

### FUNCTION: constructor
INPUTS:
  - config: object with optional settings
OUTPUT: PromptService instance

ALGORITHM:
1. Set default configuration
   a. Set baseDir = expandPath(config.baseDir or "~/.llxprt/prompts")
   b. Set maxCacheSizeMB = config.maxCacheSizeMB or 100
   c. Set compressionEnabled = config.compressionEnabled !== false
   d. Set debugMode = config.debugMode or false

2. Initialize components
   a. Create cache = new PromptCache(maxCacheSizeMB)
   b. Create resolver = new PromptResolver()
   c. Create loader = new PromptLoader()
   d. Create templateEngine = new TemplateEngine()
   e. Create installer = new PromptInstaller()

3. Load default content
   a. Set defaultContent = loadBuiltInDefaults()

4. Set initialized = false

5. RETURN service instance

ERROR HANDLING:
- Component creation fails: Throw with clear message

### FUNCTION: initialize
INPUTS: none
OUTPUT: void (throws on error)

ALGORITHM:
1. Check if already initialized
   a. IF initialized is true:
      - RETURN immediately

2. Validate environment
   a. Check if baseDir parent exists
   b. IF not:
      - TRY to create parent directories
      - IF fails: THROW "Cannot create base directory"

3. Run installation
   a. Set installResult = installer.install(baseDir, defaultContent, {
        force: false,
        dryRun: false,
        verbose: debugMode
      })
   b. IF not installResult.success:
      - THROW "Installation failed: " + join(installResult.errors)

4. Validate installation
   a. Set validation = installer.validate(baseDir)
   b. IF not validation.isValid:
      - IF validation.errors contains critical errors:
        - THROW "Invalid installation: " + join(validation.errors)
      - ELSE:
        - Log warnings if debugMode

5. Preload all files into memory
   a. Set allFiles = getAllPromptFiles(baseDir)
   b. FOR each file in allFiles:
      - Set content = loader.loadFile(file, compressionEnabled)
      - IF content.success:
        - Store in memory cache
      - ELSE:
        - Log warning if debugMode

6. Detect environment
   a. Set environment = loader.detectEnvironment(process.cwd())
   b. Store environment for later use

7. Set initialized = true

ERROR HANDLING:
- Directory creation fails: Throw with permission help
- Installation fails: Throw with specific errors
- File loading fails: Log and continue

### FUNCTION: getPrompt
INPUTS:
  - context: object with provider, model, enabledTools, environment
  - userMemory: string or null (optional user-specific content)
OUTPUT: string (assembled prompt)

ALGORITHM:
1. Ensure initialized
   a. IF not initialized:
      - Call initialize()

2. Validate context
   a. IF context is null:
      - THROW "Context is required"
   b. IF context.provider is empty:
      - THROW "Provider is required"
   c. IF context.model is empty:
      - THROW "Model is required"

3. Generate cache key
   a. Set cacheKey = cache.generateKey(context)
   b. IF userMemory is provided:
      - Append hash of userMemory to cacheKey

4. Check cache
   a. Set cached = cache.get(cacheKey)
   b. IF cached.found:
      - IF debugMode: Log "Cache hit: " + cacheKey
      - RETURN cached.content

5. Resolve files
   a. Set startTime = current time
   b. Set resolvedFiles = resolver.resolveAllFiles(baseDir, context)
   c. IF debugMode: Log resolved file paths

6. Load and process files
   a. Create array processedParts
   b. Set fileMetadata = []
   
   c. Process core file:
      - Find file with type='core' in resolvedFiles
      - IF found:
        - Set content = loadAndProcess(file.path, context, null)
        - Add content to processedParts
        - Add file info to fileMetadata
      - ELSE:
        - THROW "Core prompt not found"
   
   d. Process environment files:
      - FOR each file with type='env' in resolvedFiles:
        - Set content = loadAndProcess(file.path, context, null)
        - IF content not empty:
          - Add content to processedParts
          - Add file info to fileMetadata
   
   e. Process tool files:
      - FOR each file with type='tool' in resolvedFiles:
        - Set content = loadAndProcess(file.path, context, file.toolName)
        - IF content not empty:
          - Add content to processedParts
          - Add file info to fileMetadata

7. Add user memory if provided
   a. IF userMemory not null and not empty:
      - Add userMemory to processedParts

8. Assemble final prompt
   a. Set assembled = join(processedParts, "\n\n")
   b. Set assemblyTime = current time - startTime

9. Cache the result
   a. Set metadata = {
        files: fileMetadata,
        assemblyTimeMs: assemblyTime,
        tokenCount: estimateTokens(assembled)
      }
   b. cache.set(cacheKey, assembled, metadata)

10. RETURN assembled

ERROR HANDLING:
- Context validation fails: Throw with specifics
- Core file missing: Throw critical error
- Tool file missing: Log warning and continue
- Cache set fails: Log and continue

### FUNCTION: loadAndProcess
INPUTS:
  - filePath: string
  - context: object
  - currentTool: string or null
OUTPUT: string (processed content)

ALGORITHM:
1. Read from memory cache
   a. Get content from preloaded files
   b. IF not in memory:
      - Set loadResult = loader.loadFile(filePath, compressionEnabled)
      - IF not loadResult.success:
        - Log error if debugMode
        - RETURN empty string
      - Set content = loadResult.content

2. Create template variables
   a. Set variables = templateEngine.createVariablesFromContext(context, currentTool)

3. Process template
   a. Set processed = templateEngine.processTemplate(content, variables)

4. RETURN processed

ERROR HANDLING:
- File not in memory: Try loading directly
- Template processing fails: Return original content

### FUNCTION: getAllPromptFiles
INPUTS:
  - baseDir: string
OUTPUT: array of file paths

ALGORITHM:
1. Initialize file list
   a. Create empty array files

2. Walk directory tree
   a. Define recursive function walkDir(dir, relativePath):
      - List all entries in dir
      - FOR each entry:
        - IF entry is directory AND not "." or "..":
          - Call walkDir recursively
        - ELSE IF entry ends with ".md":
          - Add full path to files

3. Start walk from baseDir
   a. Call walkDir(baseDir, "")

4. RETURN files

ERROR HANDLING:
- Permission denied: Skip directory
- Invalid paths: Skip file

### FUNCTION: clearCache
INPUTS: none
OUTPUT: void

ALGORITHM:
1. Call cache.clear()
2. IF debugMode:
   - Log "Cache cleared"

ERROR HANDLING:
- None required

### FUNCTION: getCacheStats
INPUTS: none
OUTPUT: object with cache statistics

ALGORITHM:
1. RETURN cache.getStats()

ERROR HANDLING:
- None required

### FUNCTION: reloadFiles
INPUTS: none
OUTPUT: void

ALGORITHM:
1. Clear the cache
   a. Call clearCache()

2. Clear memory cache of files
   a. Set preloadedFiles to empty map

3. Re-run initialization
   a. Set initialized = false
   b. Call initialize()

ERROR HANDLING:
- Initialization fails: Restore previous state if possible

### FUNCTION: validateConfiguration
INPUTS:
  - context: object to validate
OUTPUT: object with validation results

ALGORITHM:
1. Initialize result
   a. Set isValid = true
   b. Create empty arrays: errors, warnings

2. Check required fields
   a. IF not context.provider:
      - Add error "Provider is required"
      - Set isValid = false
   b. IF not context.model:
      - Add error "Model is required"
      - Set isValid = false

3. Check provider/model format
   a. IF context.provider contains invalid chars:
      - Add warning "Provider will be sanitized"
   b. IF context.model contains invalid chars:
      - Add warning "Model will be sanitized"

4. Check tools
   a. IF context.enabledTools:
      - FOR each tool in enabledTools:
        - IF tool is not string:
          - Add error "Invalid tool: must be string"
          - Set isValid = false

5. Check environment
   a. IF context.environment:
      - FOR each key in ['isGitRepository', 'isSandboxed', 'hasIdeCompanion']:
        - IF key exists and not boolean:
          - Add warning key + " should be boolean"

6. RETURN {
     isValid: isValid,
     errors: errors,
     warnings: warnings
   }

ERROR HANDLING:
- Type checking errors: Add to validation errors

### FUNCTION: getAvailableTools
INPUTS: none
OUTPUT: array of available tool names

ALGORITHM:
1. Ensure initialized
   a. IF not initialized:
      - Call initialize()

2. List tool files
   a. Set toolsDir = join(baseDir, "tools")
   b. IF not exists(toolsDir):
      - RETURN empty array

3. Extract tool names
   a. Create empty array toolNames
   b. List all files in toolsDir
   c. FOR each file:
      - IF file ends with ".md":
        - Remove ".md" extension
        - Convert from kebab-case to PascalCase
        - Add to toolNames

4. Sort and return
   a. Sort toolNames alphabetically
   b. RETURN toolNames

ERROR HANDLING:
- Directory read fails: Return empty array

### FUNCTION: estimateTokens
INPUTS:
  - text: string
OUTPUT: number (estimated token count)

ALGORITHM:
1. Basic estimation (without tokenizer)
   a. Count words = split by whitespace
   b. Count characters = length of text
   c. Estimate = max(wordCount * 1.3, characterCount / 4)

2. RETURN rounded estimate

ERROR HANDLING:
- Null text: Return 0

## Edge Cases

### Edge Case 1: Concurrent Initialization
SCENARIO: Multiple threads call initialize()
HANDLING:
- Use lock/mutex on initialized flag
- Second caller waits for first to complete

### Edge Case 2: File System Changes
SCENARIO: Files change after initialization
HANDLING:
- Changes not detected until reloadFiles()
- Document this limitation

### Edge Case 3: Invalid Context Combinations
SCENARIO: Impossible provider/model combo
HANDLING:
- Service doesn't validate combinations
- Returns empty if no files found

### Edge Case 4: Memory Pressure
SCENARIO: System low on memory
HANDLING:
- Cache eviction handles this
- File preloading might fail

### Edge Case 5: Circular Dependencies
SCENARIO: Tool A needs Tool B needs Tool A
HANDLING:
- Not possible with current design
- Each tool independent

### Edge Case 6: Very Long Prompts
SCENARIO: Assembled prompt > 1MB
HANDLING:
- Log warning about size
- Still return (let caller handle)

### Edge Case 7: Malformed User Memory
SCENARIO: User memory contains prompt injection
HANDLING:
- No validation performed
- Caller's responsibility

## Performance Considerations

1. Preload all files on initialization
2. Cache assembled prompts aggressively
3. Use memory-efficient data structures
4. Avoid repeated file system calls
5. Implement lazy loading for large deployments
6. Consider worker threads for parallel assembly

## Debug Mode Features

When debugMode is true:
1. Log all file resolutions
2. Log cache hits/misses
3. Log assembly times
4. Log error details
5. Enable verbose installer output
6. Log token estimates