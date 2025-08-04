# Prompt Resolver Pseudocode

## Overview

The Prompt Resolver handles hierarchical file resolution, finding the most specific version of each prompt file based on provider and model context.

## Functions

### FUNCTION: resolveFile

INPUTS:

- baseDir: string (root directory ~/.llxprt/prompts)
- relativePath: string (file path like "core.md" or "tools/read-file.md")
- context: object with provider and model
  OUTPUT: object with properties:
- found: boolean
- path: string or null (absolute path if found)
- source: string or null ('model', 'provider', or 'base')

ALGORITHM:

1. Validate inputs
   a. IF baseDir is null or not a directory:
   - RETURN {found: false, path: null, source: null}
     b. IF relativePath is null or contains "..":
   - RETURN {found: false, path: null, source: null}
     c. IF context is null:
   - Set context to empty object

2. Sanitize provider and model names
   a. Set provider = sanitizePathComponent(context.provider or "")
   b. Set model = sanitizePathComponent(context.model or "")

3. Build search paths in order (most specific first)
   a. Create empty array searchPaths
   b. IF provider and model are both non-empty:
   - Add "providers/{provider}/models/{model}/{relativePath}" to searchPaths
     c. IF provider is non-empty:
   - Add "providers/{provider}/{relativePath}" to searchPaths
     d. Always add "{relativePath}" to searchPaths

4. Search for file
   a. FOR each searchPath in searchPaths:
   - Set absolutePath = join(baseDir, searchPath)
   - IF fileExists(absolutePath) AND isRegularFile(absolutePath):
     - Determine source level:
       - IF searchPath contains "/models/": source = 'model'
       - ELSE IF searchPath starts with "providers/": source = 'provider'
       - ELSE: source = 'base'
     - RETURN {found: true, path: absolutePath, source: source}

5. File not found
   - RETURN {found: false, path: null, source: null}

ERROR HANDLING:

- Invalid paths: Return not found
- File system errors: Treat as not found
- Security issues: Reject immediately

### FUNCTION: resolveAllFiles

INPUTS:

- baseDir: string (root directory)
- context: object with provider, model, enabledTools, environment
  OUTPUT: array of resolved file objects

ALGORITHM:

1. Validate inputs
   a. IF baseDir is null or context is null:
   - RETURN empty array

2. Initialize file list
   a. Create empty array resolvedFiles

3. Resolve core prompt
   a. Set result = resolveFile(baseDir, "core.md", context)
   b. IF result.found:
   - Add {type: 'core', path: result.path, source: result.source} to resolvedFiles

4. Resolve environment prompts
   a. IF context.environment.isGitRepository:
   - Set result = resolveFile(baseDir, "env/git-repository.md", context)
   - IF result.found:
     - Add {type: 'env', path: result.path, source: result.source} to resolvedFiles

   b. IF context.environment.isSandboxed:
   - Set result = resolveFile(baseDir, "env/sandbox.md", context)
   - IF result.found:
     - Add {type: 'env', path: result.path, source: result.source} to resolvedFiles

   c. IF context.environment.hasIdeCompanion:
   - Set result = resolveFile(baseDir, "env/ide-mode.md", context)
   - IF result.found:
     - Add {type: 'env', path: result.path, source: result.source} to resolvedFiles

5. Resolve tool prompts
   a. FOR each tool in context.enabledTools:
   - Set toolFileName = convertToKebabCase(tool) + ".md"
   - Set toolPath = "tools/" + toolFileName
   - Set result = resolveFile(baseDir, toolPath, context)
   - IF result.found:
     - Add {type: 'tool', path: result.path, source: result.source, toolName: tool} to resolvedFiles
   - ELSE:
     - Log warning "Tool prompt not found: " + tool

6. RETURN resolvedFiles

ERROR HANDLING:

- Missing tools: Log warning and continue
- Invalid context: Use defaults

### FUNCTION: sanitizePathComponent

INPUTS:

- component: string (provider or model name)
  OUTPUT: string (filesystem-safe version)

ALGORITHM:

1. IF component is null or empty:
   - RETURN empty string

2. Apply sanitization rules
   a. Convert to lowercase
   b. Replace sequences of non-alphanumeric chars with single hyphen
   c. Remove leading and trailing hyphens
   d. IF result is empty after sanitization:
   - RETURN "unknown"

3. Check length limits
   a. IF length > 255:
   - Truncate to 255 characters

4. Check for reserved names
   a. IF component in [".", "..", "con", "prn", "aux", "nul"]:
   - RETURN "reserved-" + component

5. RETURN sanitized component

ERROR HANDLING:

- Invalid characters: Replace with hyphen
- Empty result: Use "unknown"

### FUNCTION: convertToKebabCase

INPUTS:

- toolName: string (PascalCase or camelCase)
  OUTPUT: string (kebab-case)

ALGORITHM:

1. IF toolName is null or empty:
   - RETURN empty string

2. Handle special cases
   a. IF toolName is all uppercase:
   - RETURN lowercase(toolName)

3. Convert case
   a. Initialize result as empty string
   b. Initialize previousWasLowercase as false

   c. FOR each character in toolName:
   - IF character is uppercase:
     - IF previousWasLowercase AND result is not empty:
       - Append "-" to result
     - Append lowercase(character) to result
     - Set previousWasLowercase to false
   - ELSE IF character is lowercase letter:
     - Append character to result
     - Set previousWasLowercase to true
   - ELSE IF character is digit:
     - IF result is not empty and last char is not "-":
       - Append "-" to result
     - Append character to result
     - Set previousWasLowercase to false
   - ELSE:
     - // Skip non-alphanumeric characters
     - Set previousWasLowercase to false

4. Clean up result
   a. Replace multiple consecutive hyphens with single hyphen
   b. Remove leading and trailing hyphens

5. RETURN result

ERROR HANDLING:

- Non-ASCII characters: Skip them
- Empty result: Return empty string

### FUNCTION: listAvailableFiles

INPUTS:

- baseDir: string (root directory)
- fileType: string ('core', 'env', 'tool', or 'all')
  OUTPUT: array of available file information

ALGORITHM:

1. Validate inputs
   a. IF baseDir is null or not a directory:
   - RETURN empty array
     b. IF fileType not in ['core', 'env', 'tool', 'all']:
   - Set fileType to 'all'

2. Initialize results
   a. Create empty array availableFiles

3. Scan base directory
   a. IF fileType is 'all' or 'core':
   - IF exists(join(baseDir, "core.md")):
     - Add {path: "core.md", type: 'core', source: 'base'} to availableFiles

   b. IF fileType is 'all' or 'env':
   - Set envDir = join(baseDir, "env")
   - IF exists(envDir):
     - FOR each file in envDir:
       - IF file ends with ".md":
         - Add {path: "env/" + file, type: 'env', source: 'base'} to availableFiles

   c. IF fileType is 'all' or 'tool':
   - Set toolsDir = join(baseDir, "tools")
   - IF exists(toolsDir):
     - FOR each file in toolsDir:
       - IF file ends with ".md":
         - Add {path: "tools/" + file, type: 'tool', source: 'base'} to availableFiles

4. Scan provider overrides
   a. Set providersDir = join(baseDir, "providers")
   b. IF exists(providersDir):
   - FOR each provider in providersDir:
     - IF isDirectory(join(providersDir, provider)):
       - Scan provider directory recursively
       - Add found files with appropriate source tags

5. Sort results
   a. Sort by type (core, env, tool)
   b. Then by path alphabetically

6. RETURN availableFiles

ERROR HANDLING:

- Permission errors: Skip inaccessible directories
- Symbolic links: Don't follow them

### FUNCTION: validateFileStructure

INPUTS:

- baseDir: string (root directory)
  OUTPUT: object with validation results

ALGORITHM:

1. Initialize validation result
   a. Set isValid to true
   b. Create empty array errors
   c. Create empty array warnings

2. Check base directory
   a. IF not exists(baseDir):
   - Set isValid to false
   - Add error "Base directory does not exist"
   - RETURN early
     b. IF not isDirectory(baseDir):
   - Set isValid to false
   - Add error "Base path is not a directory"
   - RETURN early

3. Check required directories
   a. FOR each dir in ["env", "tools"]:
   - IF not exists(join(baseDir, dir)):
     - Add warning "Missing directory: " + dir

4. Check core file
   a. IF not exists(join(baseDir, "core.md")):
   - Set isValid to false
   - Add error "Missing required core.md file"

5. Check for invalid files
   a. Walk directory tree starting at baseDir
   b. FOR each file found:
   - IF file doesn't end with ".md":
     - Add warning "Non-markdown file found: " + file
   - IF file size > 10MB:
     - Add warning "Large file found: " + file
   - IF filename contains special characters:
     - Add warning "Invalid filename: " + file

6. Check permissions
   a. TRY to read core.md:
   - IF fails:
     - Set isValid to false
     - Add error "Cannot read core.md - check permissions"

7. RETURN {
   isValid: isValid,
   errors: errors,
   warnings: warnings
   }

ERROR HANDLING:

- File system errors: Add to errors array
- Continue validation despite errors

## Edge Cases

### Edge Case 1: Provider with Special Characters

INPUT: context.provider = "anthropic/claude"
HANDLING: Sanitize to "anthropic-claude"

### Edge Case 2: Very Long Model Names

INPUT: context.model = "very-long-model-name-that-exceeds-filesystem-limits..."
HANDLING: Truncate to 255 characters

### Edge Case 3: Case Sensitivity

SCENARIO: "OpenAI" vs "openai" as provider
HANDLING: Normalize to lowercase

### Edge Case 4: Missing Context Properties

INPUT: context = {provider: "openai"} (no model)
HANDLING: Search only provider and base levels

### Edge Case 5: Tool Name Conversion Edge Cases

- "ReadFile" → "read-file"
- "HTTPRequest" → "http-request"
- "parseJSON" → "parse-json"
- "io" → "io"
- "S3" → "s3"

### Edge Case 6: Circular Symlinks

SCENARIO: Symlink pointing to parent directory
HANDLING: Don't follow symlinks

### Edge Case 7: Hidden Files

SCENARIO: .hidden.md files
HANDLING: Skip hidden files (starting with .)

### Edge Case 8: Unicode in Filenames

INPUT: Tool with unicode name
HANDLING: Sanitize to ASCII equivalents

## Performance Considerations

1. Cache file existence checks within request
2. Use efficient path joining (avoid string concatenation)
3. Minimize file system calls
4. Build search paths lazily
5. Consider parallel file checking for large tool lists
6. Implement directory listing cache
