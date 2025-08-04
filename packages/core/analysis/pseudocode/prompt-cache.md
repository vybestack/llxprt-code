# Prompt Cache Pseudocode

## Overview
The Prompt Cache provides in-memory storage for assembled prompts with O(1) lookup performance.

## Data Structures

### CacheEntry Structure
```
STRUCTURE CacheEntry:
  - key: string (unique identifier)
  - content: string (assembled prompt)
  - metadata: object containing:
    - files: array of string (file paths used)
    - tokenCount: number or null
    - assemblyTimeMs: number
    - createdAt: timestamp
    - lastAccessedAt: timestamp
    - accessCount: number
  - size: number (byte size of content)
```

### Cache Structure
```
STRUCTURE PromptCache:
  - entries: map of string->CacheEntry
  - totalSize: number (total bytes cached)
  - maxSize: number (maximum cache size in bytes)
  - accessOrder: linked list of keys (for LRU)
```

## Functions

### FUNCTION: initialize
INPUTS:
  - maxSizeMB: number (maximum cache size in megabytes)
OUTPUT: PromptCache instance

ALGORITHM:
1. Create new cache instance
   a. Set entries to empty map
   b. Set totalSize to 0
   c. Set maxSize to maxSizeMB * 1024 * 1024
   d. Set accessOrder to empty linked list

2. Validate configuration
   a. IF maxSizeMB <= 0:
      - Set maxSize to 100 * 1024 * 1024 (100MB default)
   b. IF maxSizeMB > 1000:
      - Set maxSize to 1000 * 1024 * 1024 (1GB limit)

3. RETURN cache instance

ERROR HANDLING:
- Invalid maxSize: Use sensible defaults

### FUNCTION: generateKey
INPUTS:
  - context: object with provider, model, enabledTools, environment
OUTPUT: string (cache key)

ALGORITHM:
1. Validate context
   a. IF context is null or undefined:
      - RETURN empty string

2. Extract key components
   a. Set provider = context.provider or "unknown"
   b. Set model = context.model or "unknown"
   c. Set tools = sort(context.enabledTools or [])
   d. Set envFlags = []

3. Build environment flags
   a. IF context.environment.isGitRepository:
      - Add "git" to envFlags
   b. IF context.environment.isSandboxed:
      - Add "sandbox" to envFlags
   c. IF context.environment.hasIdeCompanion:
      - Add "ide" to envFlags

4. Construct key
   a. Set components = [provider, model]
   b. IF tools is not empty:
      - Add joined tools string to components
   c. IF envFlags is not empty:
      - Add joined envFlags string to components
   d. Join components with ":" separator

5. RETURN key

ERROR HANDLING:
- Missing context properties: Use defaults
- Null arrays: Treat as empty

### FUNCTION: get
INPUTS:
  - key: string (cache key)
OUTPUT: object with properties:
  - found: boolean
  - content: string or null
  - metadata: object or null

ALGORITHM:
1. Validate key
   a. IF key is null or empty:
      - RETURN {found: false, content: null, metadata: null}

2. Look up entry
   a. IF entries map contains key:
      - Get entry from map
      - Update access tracking:
        - Set entry.lastAccessedAt to current time
        - Increment entry.accessCount
        - Move key to front of accessOrder list
      - RETURN {
          found: true,
          content: entry.content,
          metadata: copy of entry.metadata
        }
   b. ELSE:
      - RETURN {found: false, content: null, metadata: null}

ERROR HANDLING:
- Concurrent access: Use thread-safe operations

### FUNCTION: set
INPUTS:
  - key: string (cache key)
  - content: string (assembled prompt)
  - metadata: object (assembly information)
OUTPUT: boolean (success)

ALGORITHM:
1. Validate inputs
   a. IF key is null or empty:
      - RETURN false
   b. IF content is null:
      - RETURN false

2. Calculate content size
   a. Set contentSize = byte length of content
   b. IF contentSize > maxSize:
      - Log warning "Content too large for cache"
      - RETURN false

3. Check if key already exists
   a. IF entries map contains key:
      - Get existing entry
      - Update totalSize -= existing entry.size

4. Make room if needed
   a. WHILE totalSize + contentSize > maxSize AND accessOrder is not empty:
      - Get leastRecentlyUsed key from back of accessOrder
      - Remove entry from entries map
      - Update totalSize -= removed entry.size
      - Remove key from accessOrder

5. Create new entry
   a. Set newEntry = {
        key: key,
        content: content,
        metadata: copy of metadata,
        size: contentSize,
        createdAt: current time,
        lastAccessedAt: current time,
        accessCount: 0
      }

6. Store entry
   a. Add newEntry to entries map with key
   b. Add key to front of accessOrder
   c. Update totalSize += contentSize

7. RETURN true

ERROR HANDLING:
- Memory allocation failure: Return false
- Concurrent modification: Use locking

### FUNCTION: remove
INPUTS:
  - key: string (cache key)
OUTPUT: boolean (was removed)

ALGORITHM:
1. Validate key
   a. IF key is null or empty:
      - RETURN false

2. Check existence
   a. IF entries map doesn't contain key:
      - RETURN false

3. Remove entry
   a. Get entry from entries map
   b. Remove key from entries map
   c. Remove key from accessOrder list
   d. Update totalSize -= entry.size

4. RETURN true

ERROR HANDLING:
- Key not found: Return false gracefully

### FUNCTION: clear
INPUTS: none
OUTPUT: void

ALGORITHM:
1. Clear all data structures
   a. Clear entries map
   b. Clear accessOrder list
   c. Set totalSize to 0

2. Force garbage collection hint (if available)

ERROR HANDLING:
- None required

### FUNCTION: getStats
INPUTS: none
OUTPUT: object with cache statistics

ALGORITHM:
1. Calculate statistics
   a. Set entryCount = size of entries map
   b. Set totalSizeMB = totalSize / (1024 * 1024)
   c. Set utilizationPercent = (totalSize / maxSize) * 100
   d. Set averageEntrySize = entryCount > 0 ? totalSize / entryCount : 0

2. Calculate access patterns
   a. Set totalAccesses = 0
   b. Set mostAccessed = null
   c. Set maxAccesses = 0
   d. FOR each entry in entries map:
      - Add entry.accessCount to totalAccesses
      - IF entry.accessCount > maxAccesses:
        - Set mostAccessed = entry.key
        - Set maxAccesses = entry.accessCount

3. RETURN {
     entryCount: entryCount,
     totalSizeMB: totalSizeMB,
     maxSizeMB: maxSize / (1024 * 1024),
     utilizationPercent: utilizationPercent,
     averageEntrySizeKB: averageEntrySize / 1024,
     totalAccesses: totalAccesses,
     mostAccessedKey: mostAccessed,
     mostAccessedCount: maxAccesses
   }

ERROR HANDLING:
- Division by zero: Check before dividing

### FUNCTION: has
INPUTS:
  - key: string (cache key)
OUTPUT: boolean (exists in cache)

ALGORITHM:
1. Validate key
   a. IF key is null or empty:
      - RETURN false

2. Check existence
   a. RETURN entries map contains key

ERROR HANDLING:
- None required

### FUNCTION: preload
INPUTS:
  - contexts: array of context objects
OUTPUT: number (count of successfully cached)

ALGORITHM:
1. Validate input
   a. IF contexts is null or empty:
      - RETURN 0

2. Initialize counter
   a. Set successCount = 0

3. FOR each context in contexts:
   a. Generate key = generateKey(context)
   b. IF key is not empty AND not has(key):
      - // This would trigger assembly in real implementation
      - // For pseudocode, assume content is provided
      - Log "Would assemble prompt for key: " + key
      - Increment successCount

4. RETURN successCount

ERROR HANDLING:
- Invalid contexts: Skip them

## Edge Cases

### Edge Case 1: Zero-size Cache
SCENARIO: maxSize set to 0
HANDLING: Effectively disable caching, all sets fail

### Edge Case 2: Single Large Entry
SCENARIO: One entry uses entire cache
HANDLING: Allow it, but evict on next set

### Edge Case 3: Rapid Access Pattern Changes
SCENARIO: Access pattern changes completely
HANDLING: LRU will adapt over time

### Edge Case 4: Identical Keys
SCENARIO: Same context generates same key
HANDLING: Overwrite existing entry

### Edge Case 5: Memory Pressure
SCENARIO: System low on memory
HANDLING: Respect maxSize limit strictly

### Edge Case 6: Concurrent Access
SCENARIO: Multiple threads accessing cache
HANDLING: Use thread-safe data structures

### Edge Case 7: Key Collision
SCENARIO: Different contexts generate same key
HANDLING: Highly unlikely with proper key generation

## Performance Considerations

1. Use hash map for O(1) lookups
2. Maintain access order efficiently with doubly-linked list
3. Batch evictions to reduce overhead
4. Pre-calculate sizes to avoid repeated calculations
5. Use immutable data structures for thread safety
6. Consider sharding for very large caches

## Thread Safety

1. All public methods must be thread-safe
2. Use read-write locks for better concurrency
3. Make metadata copies to prevent external modification
4. Atomic operations for statistics updates
5. No iterators exposed to prevent concurrent modification