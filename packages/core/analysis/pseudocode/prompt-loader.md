# Prompt Loader Pseudocode

## Overview
The Prompt Loader handles reading prompt files from disk, applying compression rules, and handling file I/O errors.

## Functions

### FUNCTION: loadFile
INPUTS:
  - filePath: string (absolute path to file)
  - shouldCompress: boolean (whether to apply compression)
OUTPUT: object with properties:
  - success: boolean
  - content: string (file content, possibly compressed)
  - error: string or null

ALGORITHM:
1. Validate input
   a. IF filePath is null or undefined:
      - RETURN {success: false, content: "", error: "Invalid file path"}
   b. IF filePath contains ".." or doesn't start with baseDir:
      - RETURN {success: false, content: "", error: "Path traversal detected"}

2. Check file size before reading
   a. TRY to get file stats
   b. IF file doesn't exist:
      - RETURN {success: false, content: "", error: "File not found"}
   c. IF file size > 10MB (10 * 1024 * 1024 bytes):
      - RETURN {success: false, content: "", error: "File too large"}
   d. IF file is not regular file (e.g., directory, symlink):
      - RETURN {success: false, content: "", error: "Not a regular file"}

3. Read file content
   a. TRY to read file with UTF-8 encoding
   b. IF read fails:
      - RETURN {success: false, content: "", error: "Failed to read file: " + error message}
   c. Store raw content

4. Validate UTF-8 encoding
   a. Check if content contains valid UTF-8
   b. IF invalid UTF-8 detected:
      - RETURN {success: false, content: "", error: "Invalid UTF-8 encoding"}

5. Apply compression if requested
   a. IF shouldCompress is true:
      - Set compressedContent = compressContent(rawContent)
      - Set finalContent = compressedContent
   b. ELSE:
      - Set finalContent = rawContent

6. RETURN {success: true, content: finalContent, error: null}

ERROR HANDLING:
- File not found: Return error with clear message
- Permission denied: Return error suggesting permission fix
- Invalid encoding: Return error about encoding
- File too large: Return error with size limit
- Path traversal: Security error

### FUNCTION: compressContent
INPUTS:
  - content: string (raw file content)
OUTPUT: string (compressed content)

ALGORITHM:
1. IF content is empty or null:
   - RETURN empty string

2. Initialize compression state
   a. Split content into lines array
   b. Create empty array for compressedLines
   c. Set inCodeBlock to false
   d. Set lastLineWasEmpty to false
   e. Set codeBlockDelimiter to null

3. FOR each line in lines:
   a. Check for code block boundaries
      - IF line starts with "```":
        - IF not inCodeBlock:
          - Set inCodeBlock to true
          - Extract language identifier after ```
          - Set codeBlockDelimiter to line
        - ELSE IF line equals codeBlockDelimiter or is "```":
          - Set inCodeBlock to false
          - Set codeBlockDelimiter to null
        - Add line to compressedLines unchanged
        - Set lastLineWasEmpty to false
        - CONTINUE to next line

   b. IF inCodeBlock:
      - Add line to compressedLines unchanged
      - Set lastLineWasEmpty to false
      - CONTINUE to next line

   c. Apply prose compression rules:
      - Set compressedLine = line

      # Simplify headers
      - IF line matches "^#{2,}\s+(.+)$":
        - Replace with "# $1"

      # Simplify bold list items
      - IF line matches "^(\s*)-\s+\*\*(.+?)\*\*:\s*(.*)$":
        - Replace with "$1- $2: $3"

      # Remove excessive whitespace
      - Trim leading and trailing whitespace
      - Replace multiple spaces with single space

      # Handle blank lines
      - IF compressedLine is empty:
        - IF lastLineWasEmpty:
          - CONTINUE to next line (skip multiple blanks)
        - ELSE:
          - Set lastLineWasEmpty to true
      - ELSE:
        - Set lastLineWasEmpty to false

      # Add to result
      - Add compressedLine to compressedLines

4. Join compressedLines with newline and RETURN

ERROR HANDLING:
- Malformed code blocks: Continue processing, don't break
- Very long lines: Process normally, no truncation

### FUNCTION: loadAllFiles
INPUTS:
  - baseDir: string (root directory for prompts)
  - fileList: array of relative paths
  - shouldCompress: boolean
OUTPUT: map of path->content

ALGORITHM:
1. Validate inputs
   a. IF baseDir is null or invalid:
      - RETURN empty map
   b. IF fileList is null or empty:
      - RETURN empty map

2. Initialize result map
   a. Create empty map for fileContents

3. FOR each relativePath in fileList:
   a. Construct absolute path:
      - Set absolutePath = join(baseDir, relativePath)
   
   b. Load file:
      - Set result = loadFile(absolutePath, shouldCompress)
   
   c. Store result:
      - IF result.success is true:
        - Set fileContents[relativePath] = result.content
      - ELSE:
        - Log warning with relativePath and result.error
        - Continue to next file

4. RETURN fileContents

ERROR HANDLING:
- Individual file errors: Log and continue
- Don't fail entire batch for one bad file

### FUNCTION: detectEnvironment
INPUTS:
  - workingDirectory: string (current working directory)
OUTPUT: object with properties:
  - isGitRepository: boolean
  - isSandboxed: boolean
  - hasIdeCompanion: boolean

ALGORITHM:
1. Detect Git repository
   a. Set currentDir = workingDirectory
   b. WHILE currentDir is not root directory:
      - IF exists(join(currentDir, ".git")):
        - Set isGitRepository = true
        - BREAK
      - Set currentDir = parent directory of currentDir
   c. IF not found:
      - Set isGitRepository = false

2. Detect sandbox environment
   a. Check environment variables:
      - IF env.SANDBOX equals "1" or "true":
        - Set isSandboxed = true
      - ELSE IF env.CONTAINER equals "1" or "true":
        - Set isSandboxed = true
      - ELSE IF exists("/sandbox") or exists("/.dockerenv"):
        - Set isSandboxed = true
      - ELSE:
        - Set isSandboxed = false

3. Detect IDE companion
   a. Check for IDE markers:
      - IF env.IDE_COMPANION equals "1" or "true":
        - Set hasIdeCompanion = true
      - ELSE IF exists(join(workingDirectory, ".vscode")):
        - Set hasIdeCompanion = true
      - ELSE IF exists(join(workingDirectory, ".idea")):
        - Set hasIdeCompanion = true
      - ELSE:
        - Set hasIdeCompanion = false

4. RETURN {
     isGitRepository: isGitRepository,
     isSandboxed: isSandboxed,
     hasIdeCompanion: hasIdeCompanion
   }

ERROR HANDLING:
- Permission errors: Default to false
- Missing directories: Default to false

### FUNCTION: watchFiles
INPUTS:
  - baseDir: string (directory to watch)
  - callback: function to call on changes
OUTPUT: object with stop() method

ALGORITHM:
1. Validate inputs
   a. IF baseDir doesn't exist:
      - RETURN null
   b. IF callback is not a function:
      - RETURN null

2. Set up file watcher
   a. Create recursive watcher on baseDir
   b. Filter for .md files only
   c. Debounce events (wait 100ms for multiple changes)

3. On file change event:
   a. Get relative path from baseDir
   b. Check if it's a prompt file (*.md)
   c. IF is prompt file:
      - Wait for debounce period
      - Call callback with event type and path

4. RETURN object with:
   - stop(): function to stop watching

ERROR HANDLING:
- Watcher creation fails: Return null
- Individual file events fail: Log and continue

## Edge Cases

### Edge Case 1: Empty File
INPUT: Path to empty file
OUTPUT: {success: true, content: "", error: null}

### Edge Case 2: Binary File
INPUT: Path to binary file
HANDLING: Detect non-UTF8, return encoding error

### Edge Case 3: Very Large File (approaching 10MB)
INPUT: 9.9MB text file
HANDLING: Load successfully but log warning

### Edge Case 4: Symlink
INPUT: Path to symbolic link
HANDLING: Don't follow, return "Not a regular file" error

### Edge Case 5: File Deleted During Read
SCENARIO: File exists in stat() but deleted before read()
HANDLING: Catch error, return "Failed to read file"

### Edge Case 6: Code Block Never Closed
INPUT: File with ``` but no closing ```
HANDLING: Treat rest of file as code block

### Edge Case 7: Nested Code Blocks
INPUT: ``` inside a code block
HANDLING: Track delimiter, only close with exact match

### Edge Case 8: Mixed Line Endings
INPUT: File with both \n and \r\n
HANDLING: Normalize to \n during split

## Performance Considerations

1. Cache file stats to avoid multiple syscalls
2. Read files in one operation (not streaming)
3. Use efficient string operations for compression
4. Batch file operations when possible
5. Implement read-ahead for predictable access patterns