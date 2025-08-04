# Prompt Installer Pseudocode

## Overview

The Prompt Installer creates the directory structure and installs default prompt files while preserving user customizations.

## Constants

```
DEFAULT_BASE_DIR = "~/.llxprt/prompts"
REQUIRED_DIRECTORIES = [
  "",           // Base directory
  "env",       // Environment-specific prompts
  "tools",     // Tool-specific prompts
  "providers"  // Provider overrides
]
```

## Functions

### FUNCTION: install

INPUTS:

- baseDir: string or null (defaults to DEFAULT_BASE_DIR)
- defaults: map of path->content (built-in default files)
- options: object with: - force: boolean (overwrite existing files) - dryRun: boolean (simulate without writing) - verbose: boolean (detailed logging)
  OUTPUT: object with properties:
- success: boolean
- installed: array of installed file paths
- skipped: array of skipped file paths
- errors: array of error messages

ALGORITHM:

1. Prepare installation
   a. IF baseDir is null:
   - Set baseDir to expandPath(DEFAULT_BASE_DIR)
     b. Validate baseDir:
   - IF contains ".." or not absolute: - RETURN {success: false, installed: [], skipped: [], errors: ["Invalid base directory"]}
     c. Initialize result tracking:
   - Set installed to empty array
   - Set skipped to empty array
   - Set errors to empty array

2. Create directory structure
   a. FOR each dir in REQUIRED_DIRECTORIES:
   - Set fullPath = join(baseDir, dir)
   - IF options.dryRun:
     - Log "Would create: " + fullPath
   - ELSE:
     - TRY to create directory (recursive):
       - IF created: Log if verbose
       - IF already exists: Continue
       - IF error: Add to errors and set success = false

3. Install default files
   a. FOR each entry (path, content) in defaults:
   - Set fullPath = join(baseDir, path)
   - Set fileDir = dirname(fullPath)
   - Create parent directory if needed:
     - IF not exists(fileDir) AND not options.dryRun:
       - TRY to create directory (recursive)
       - IF error: Add to errors and continue
   - Check existing file:
     - IF exists(fullPath) AND not options.force:
       - Add path to skipped
       - Log if verbose: "Preserving existing: " + path
       - CONTINUE to next file
   - Write file:
     - IF options.dryRun:
       - Log "Would write: " + fullPath
       - Add path to installed
     - ELSE:
       - TRY to write file atomically:
         - Write to temp file first
         - Set permissions to readable
         - Rename temp to final
         - Add path to installed
       - IF error:
         - Add error message to errors
         - Delete temp file if exists

4. Set directory permissions
   a. IF not options.dryRun:
   - Set baseDir permissions to 755 (rwxr-xr-x)
   - Set all subdirectories to 755
   - Set all files to 644 (rw-r--r--)

5. RETURN {
   success: errors.length === 0,
   installed: installed,
   skipped: skipped,
   errors: errors
   }

ERROR HANDLING:

- Permission denied: Add clear error with fix suggestion
- Disk full: Add error about space
- Invalid paths: Validate before operations

### FUNCTION: uninstall

INPUTS:

- baseDir: string or null
- options: object with: - removeUserFiles: boolean (remove all files) - dryRun: boolean
  OUTPUT: object with properties:
- success: boolean
- removed: array of removed paths
- errors: array of error messages

ALGORITHM:

1. Validate inputs
   a. IF baseDir is null:
   - Set baseDir to expandPath(DEFAULT_BASE_DIR)
     b. IF not exists(baseDir):
   - RETURN {success: true, removed: [], errors: []}

2. Build removal list
   a. Create empty array toRemove
   b. IF options.removeUserFiles:
   - Add all files in baseDir to toRemove
     c. ELSE:
   - Add only default file paths to toRemove

3. Remove files
   a. FOR each file in toRemove:
   - IF options.dryRun:
     - Log "Would remove: " + file
   - ELSE:
     - TRY to remove file:
       - Add to removed array
     - IF error:
       - Add to errors array

4. Remove empty directories
   a. FOR each dir in reverse(REQUIRED_DIRECTORIES):
   - Set fullPath = join(baseDir, dir)
   - IF directory is empty:
     - Remove directory
     - Add to removed array

5. RETURN {
   success: errors.length === 0,
   removed: removed,
   errors: errors
   }

ERROR HANDLING:

- Files in use: Skip with warning
- Permission errors: Add to errors

### FUNCTION: validate

INPUTS:

- baseDir: string or null
  OUTPUT: object with validation details

ALGORITHM:

1. Setup validation
   a. IF baseDir is null:
   - Set baseDir to expandPath(DEFAULT_BASE_DIR)
     b. Initialize results:
   - Set isValid to true
   - Create arrays: errors, warnings, missing

2. Check base directory
   a. IF not exists(baseDir):
   - Add error "Base directory does not exist"
   - Set isValid to false
   - RETURN early with results

3. Check directory structure
   a. FOR each dir in REQUIRED_DIRECTORIES:
   - Set fullPath = join(baseDir, dir)
   - IF not exists(fullPath):
     - Add to missing array
     - Add warning "Missing directory: " + dir

4. Check required files
   a. IF not exists(join(baseDir, "core.md")):
   - Add to missing array
   - Add error "Missing required core.md"
   - Set isValid to false

5. Check permissions
   a. TRY to:
   - Check read permission on baseDir
   - Check write permission on baseDir
     b. IF no read permission:
   - Add error "Cannot read from directory"
   - Set isValid to false
     c. IF no write permission:
   - Add warning "Cannot write to directory"

6. Check file integrity
   a. FOR each default file path:
   - IF exists but size is 0 and should have content:
     - Add warning "Empty file: " + path
   - IF exists but not readable:
     - Add error "Cannot read: " + path

7. RETURN {
   isValid: isValid,
   errors: errors,
   warnings: warnings,
   missing: missing,
   baseDir: baseDir
   }

ERROR HANDLING:

- Permission check fails: Add to errors
- Continue checking despite errors

### FUNCTION: repair

INPUTS:

- baseDir: string or null
- defaults: map of path->content
- options: object with verbose flag
  OUTPUT: object with repair results

ALGORITHM:

1. Run validation first
   a. Set validation = validate(baseDir)
   b. IF validation.isValid:
   - RETURN {success: true, repaired: [], errors: []}

2. Attempt repairs
   a. Create arrays: repaired, errors

   b. Fix missing directories:
   - FOR each dir in validation.missing:
     - IF dir is a directory path:
       - TRY to create directory
       - IF success: Add to repaired
       - IF error: Add to errors

   c. Fix missing default files:
   - FOR each file in validation.missing:
     - IF file in defaults map:
       - TRY to write default content
       - IF success: Add to repaired
       - IF error: Add to errors

   d. Fix permissions:
   - TRY to set correct permissions:
     - Directories: 755
     - Files: 644
   - IF error: Add to errors

3. Run validation again
   a. Set finalValidation = validate(baseDir)

4. RETURN {
   success: finalValidation.isValid,
   repaired: repaired,
   errors: errors,
   stillInvalid: finalValidation.errors
   }

ERROR HANDLING:

- Repair fails: Continue with other repairs
- Log all errors clearly

### FUNCTION: backup

INPUTS:

- baseDir: string or null
- backupPath: string (where to save backup)
  OUTPUT: object with backup results

ALGORITHM:

1. Validate inputs
   a. IF baseDir is null:
   - Set baseDir to expandPath(DEFAULT_BASE_DIR)
     b. IF not exists(baseDir):
   - RETURN {success: false, error: "Nothing to backup"}
     c. IF backupPath is null or invalid:
   - RETURN {success: false, error: "Invalid backup path"}

2. Create backup
   a. Set timestamp = current time in format YYYYMMDD_HHMMSS
   b. Set backupDir = join(backupPath, "prompt-backup-" + timestamp)

   c. TRY to:
   - Create backupDir
   - Copy entire baseDir contents to backupDir
   - Create manifest file with:
     - Backup date
     - Source path
     - File count
     - Total size

3. Verify backup
   a. Count files in source and backup
   b. Compare file sizes
   c. IF mismatch:
   - Add warning to result

4. RETURN {
   success: true,
   backupPath: backupDir,
   fileCount: count,
   totalSize: size
   }

ERROR HANDLING:

- Insufficient space: Clear error message
- Permission denied: Suggest alternative location

### FUNCTION: expandPath

INPUTS:

- path: string (may contain ~ or env variables)
  OUTPUT: string (expanded absolute path)

ALGORITHM:

1. Handle null input
   a. IF path is null or empty:
   - RETURN empty string

2. Expand home directory
   a. IF path starts with "~":
   - Replace "~" with user home directory

3. Expand environment variables
   a. Find all ${VAR} or $VAR patterns
   b. FOR each variable found:
   - Get value from environment
   - Replace variable with value
   - IF not found: Leave as-is

4. Resolve to absolute path
   a. IF not absolute:
   - Prepend current working directory

5. Normalize path
   a. Remove redundant separators
   b. Resolve . and .. components

6. RETURN normalized path

ERROR HANDLING:

- Invalid paths: Return original
- Missing env vars: Leave unreplaced

## Edge Cases

### Edge Case 1: No Write Permissions

SCENARIO: User doesn't have write access to ~/.llxprt
HANDLING:

- Detect early in install
- Provide clear error with chmod suggestion
- Suggest alternative location

### Edge Case 2: Disk Full

SCENARIO: Disk runs out of space during installation
HANDLING:

- Use atomic writes (temp file + rename)
- Clean up partial files
- Report which files succeeded

### Edge Case 3: Existing User Customizations

SCENARIO: User has modified default files
HANDLING:

- Never overwrite without force flag
- List all preserved files
- Provide diff command suggestion

### Edge Case 4: Symbolic Links

SCENARIO: baseDir is a symlink
HANDLING:

- Resolve to real path
- Warn user about symlink
- Continue with real path

### Edge Case 5: Race Condition

SCENARIO: Multiple processes installing simultaneously
HANDLING:

- Use file locking on marker file
- Make operations idempotent
- Second process skips existing files

### Edge Case 6: Corrupted Installation

SCENARIO: Partial files from failed install
HANDLING:

- Validate detects corruption
- Repair can fix it
- Backup corrupted files first

### Edge Case 7: Case-Sensitive Filesystems

SCENARIO: "Core.md" vs "core.md"
HANDLING:

- Always use lowercase
- Warn about case conflicts
- Standardize during install

## Performance Considerations

1. Batch file operations when possible
2. Use atomic writes to prevent corruption
3. Check space before starting
4. Create directories recursively in one call
5. Use efficient file copying (not read/write)
6. Implement progress callback for large installs
