# Token Store Pseudocode

## Interface: MultiProviderTokenStorage

### Function: storeToken(provider: string, token: OAuthToken) -> Result<void, TokenStoreError>

**Purpose**: Securely store OAuth token for a specific provider

**Algorithm**:
1. Validate input parameters
   - Check provider is non-empty string
   - Check token has required fields: access_token, expiry
   - Return ValidationError if invalid
2. Generate secure file path
   - Path = ~/.llxprt/oauth/{provider}.json
   - Ensure parent directory exists with 0700 permissions
3. Serialize token data
   - Convert token object to JSON string
   - Include fields: access_token, refresh_token, expiry, scope, token_type
   - Validate JSON serialization success
4. Atomic file write with security
   - Create temporary file with random suffix (.tmp-{random})
   - Write JSON data to temporary file
   - Set file permissions to 0600 (owner read/write only)
   - Atomic rename from temporary to target file
   - Return FileSystemError on any I/O failure
5. Cleanup expired tokens
   - Call cleanupExpiredTokens() after successful write
   - Log cleanup results but don't fail on cleanup errors

**Error Handling**:
- ValidationError: Invalid provider name or token format
- FileSystemError: Unable to create directory or write file
- PermissionError: Cannot set secure file permissions

**Data Transformations**:
- Token object -> JSON string -> File bytes
- Unix timestamp validation (expiry > current time)

---

### Function: retrieveToken(provider: string) -> Result<OAuthToken, TokenStoreError>

**Purpose**: Retrieve stored OAuth token for provider

**Algorithm**:
1. Validate provider parameter
   - Check provider is non-empty string
   - Return ValidationError if invalid
2. Construct file path
   - Path = ~/.llxprt/oauth/{provider}.json
3. Check file existence and permissions
   - Return NotFoundError if file doesn't exist
   - Verify file permissions are 0600
   - Return PermissionError if permissions too open
4. Read and deserialize token
   - Read file contents as string
   - Parse JSON to token object
   - Validate required fields exist
   - Return DeserializationError on parse failure
5. Validate token expiry
   - Check expiry timestamp > current time
   - Return ExpiredTokenError if token expired
   - Apply 30-second buffer for refresh window
6. Return validated token

**Error Handling**:
- ValidationError: Invalid provider parameter
- NotFoundError: Token file doesn't exist
- PermissionError: File permissions too permissive
- DeserializationError: Invalid JSON or missing fields
- ExpiredTokenError: Token past expiration time

**Data Transformations**:
- File bytes -> JSON string -> Token object
- Unix timestamp -> Date comparison

---

### Function: deleteToken(provider: string) -> Result<void, TokenStoreError>

**Purpose**: Securely delete stored token for provider

**Algorithm**:
1. Validate provider parameter
   - Check provider is non-empty string
   - Return ValidationError if invalid
2. Construct file path
   - Path = ~/.llxprt/oauth/{provider}.json
3. Check file existence
   - Return NotFoundError if file doesn't exist (optional - could be success)
4. Secure file deletion
   - Overwrite file with random data (3 passes)
   - Truncate file to zero length
   - Delete file from filesystem
   - Return FileSystemError on any I/O failure

**Error Handling**:
- ValidationError: Invalid provider parameter
- FileSystemError: Unable to delete file
- PermissionError: Insufficient permissions for deletion

---

### Function: listProviders() -> Result<string[], TokenStoreError>

**Purpose**: List all providers with stored tokens

**Algorithm**:
1. Get OAuth directory path
   - Path = ~/.llxprt/oauth/
2. Check directory existence
   - Return empty array if directory doesn't exist
3. List directory contents
   - Get all .json files in directory
   - Filter for valid provider token files
4. Extract provider names
   - Remove .json extension from filenames
   - Validate each provider name format
5. Return provider list

**Error Handling**:
- FileSystemError: Unable to read directory
- PermissionError: Insufficient directory permissions

**Data Transformations**:
- Directory listing -> Filename array -> Provider name array

---

### Function: cleanupExpiredTokens() -> Result<CleanupStats, TokenStoreError>

**Purpose**: Remove expired tokens from storage

**Algorithm**:
1. Get all providers
   - Call listProviders()
   - Return error if listing fails
2. Check each provider token
   - For each provider in list:
     - Try to retrieve token
     - If token expired (expiry < current time):
       - Add to deletion list
     - If token invalid/corrupted:
       - Add to deletion list
3. Delete expired tokens
   - For each token in deletion list:
     - Call deleteToken(provider)
     - Count successful/failed deletions
4. Return cleanup statistics
   - Total tokens checked
   - Expired tokens found
   - Tokens successfully deleted
   - Deletion failures

**Error Handling**:
- FileSystemError: Directory or file I/O errors
- Log errors but continue cleanup process
- Return partial success statistics

**Data Transformations**:
- Provider list -> Token validation -> Deletion list -> Statistics

---

### Function: validateTokenFile(filePath: string) -> Result<boolean, TokenStoreError>

**Purpose**: Validate token file security and format

**Algorithm**:
1. Check file existence
   - Return NotFoundError if file doesn't exist
2. Validate file permissions
   - Check permissions are exactly 0600
   - Return PermissionError if too permissive
3. Validate file ownership
   - Check file owned by current user
   - Return OwnershipError if wrong owner
4. Validate file content
   - Read file as JSON
   - Check required token fields present
   - Validate field types and formats
   - Return FormatError if invalid structure
5. Return validation result

**Error Handling**:
- NotFoundError: File doesn't exist
- PermissionError: Incorrect file permissions
- OwnershipError: File owned by different user
- FormatError: Invalid JSON or token structure

---

## Data Structures

### OAuthToken
```
struct OAuthToken {
    access_token: string     // Bearer token for API calls
    refresh_token?: string   // Optional refresh token
    expiry: number          // Unix timestamp
    scope?: string          // OAuth scope granted
    token_type: string      // Always "Bearer"
}
```

### CleanupStats
```
struct CleanupStats {
    total_checked: number      // Number of tokens examined
    expired_found: number      // Number of expired tokens
    deleted_success: number    // Successfully deleted tokens
    deletion_failures: number  // Failed deletions
}
```

### TokenStoreError
```
enum TokenStoreError {
    ValidationError,     // Invalid input parameters
    NotFoundError,       // Token file not found
    PermissionError,     // File permission issues
    FileSystemError,     // I/O operation failed
    DeserializationError,// JSON parsing failed
    ExpiredTokenError,   // Token past expiration
    OwnershipError,      // File ownership mismatch
    FormatError         // Invalid token structure
}
```

## Security Considerations

1. **File Permissions**: All token files must be 0600 (owner read/write only)
2. **Atomic Operations**: Use temporary files and atomic rename for writes
3. **Secure Deletion**: Overwrite files before deletion to prevent recovery
4. **Path Validation**: Prevent directory traversal attacks in provider names
5. **Buffer Management**: Clear sensitive data from memory after use
6. **Lock Files**: Consider file locking for concurrent access protection

## Performance Considerations

1. **File I/O Optimization**: Batch operations when possible
2. **Caching**: Cache token validation results with TTL
3. **Lazy Cleanup**: Run cleanup on background thread
4. **Error Recovery**: Graceful degradation on file system errors