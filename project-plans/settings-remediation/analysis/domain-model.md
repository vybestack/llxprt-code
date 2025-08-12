# Domain Analysis: Settings Service Remediation

## Core Entities

### 1. SettingsService (In-Memory Coordinator)
- **Purpose**: Central runtime coordinator for ephemeral settings
- **Lifetime**: Application lifecycle (cleared on restart)
- **Storage**: In-memory Map/Object only
- **Access Pattern**: Synchronous get/set
- **Responsibilities**:
  - Store ephemeral settings in memory
  - Emit events on changes
  - Provide synchronous access
  - NO persistence operations

### 2. Config (Persistence Layer)
- **Purpose**: Handle profiles and persistent settings
- **Storage**: File system (profiles, saved configurations)
- **Responsibilities**:
  - Profile management
  - Saved settings persistence
  - Delegate ephemeral operations to SettingsService
  - NO local ephemeral storage

### 3. EphemeralSettings (Data Structure)
- **Nature**: Runtime-only configuration
- **Examples**:
  - Current model selection
  - API keys (session only)
  - Base URLs
  - Temperature/token settings
  - Compression thresholds
- **Lifecycle**: Cleared on application restart

## State Transitions

### Setting Update Flow
1. User invokes command (e.g., `/set temperature 0.8`)
2. Command calls SettingsService.set() synchronously
3. SettingsService updates in-memory store
4. SettingsService emits change event
5. Listeners (UI, providers) update immediately
6. NO file system writes occur

### Application Startup
1. SettingsService initializes with empty settings
2. Config loads profiles/saved settings from disk
3. Config may populate some defaults in SettingsService
4. Ephemeral settings start fresh (not restored)

### Provider Switch
1. User invokes `/provider openai`
2. SettingsService.setActiveProvider('openai') called
3. In-memory activeProvider updated
4. Event emitted to notify consumers
5. Providers/UI update based on event

## Business Rules

### Ephemeral vs Persistent
- **Ephemeral**: Runtime settings that don't persist
  - Model selections during session
  - Temporary API keys
  - Session-specific parameters
- **Persistent**: Saved configurations
  - Profiles
  - Default preferences
  - Saved API keys (if user chooses)

### Setting Precedence
1. Ephemeral settings (highest priority)
2. Profile settings
3. Global defaults (lowest priority)

### Memory Management
- Settings stored in simple JavaScript object
- No caching layers needed (direct access)
- No cleanup required (garbage collected)
- No file watchers or I/O operations

## Edge Cases

### 1. Application Crash
- **Current (Wrong)**: Attempts to persist, may corrupt file
- **Fixed**: Ephemeral settings lost (correct behavior)
- **User Impact**: Must reconfigure session settings

### 2. Multiple Instances
- **Current (Wrong)**: File conflicts with centralized-settings.json
- **Fixed**: Each instance has own in-memory settings
- **User Impact**: No conflicts, instances isolated

### 3. Memory Pressure
- **Concern**: Settings object grows too large
- **Mitigation**: Ephemeral settings are lightweight
- **Limit**: Reasonable bounds on setting sizes

### 4. Event Storm
- **Concern**: Rapid setting changes flood listeners
- **Mitigation**: Optional debouncing in consumers
- **Not Required**: Direct updates are fast enough

## Error Scenarios

### 1. Invalid Setting Value
- **Detection**: Validation in SettingsService.set()
- **Response**: Throw synchronous error
- **Recovery**: Caller handles error immediately

### 2. Missing Provider Settings
- **Detection**: When accessing provider-specific settings
- **Response**: Return undefined (not error)
- **Recovery**: Caller uses defaults

### 3. Event Listener Failure
- **Detection**: Listener throws during event handling
- **Response**: Catch and log, continue to other listeners
- **Recovery**: System remains stable

## Anti-Patterns to Remove

### 1. File System Operations
- **Remove**: All fs.writeFile, fs.readFile
- **Remove**: FileSystemSettingsRepository entirely
- **Remove**: File watchers and path operations

### 2. Async Patterns
- **Remove**: Promise-based setting operations
- **Remove**: Async queue processing
- **Remove**: Background persistence tasks

### 3. Dual Storage
- **Remove**: Config.ephemeralSettings object
- **Remove**: Sync between Config and SettingsService
- **Remove**: Complex reconciliation logic

## Success Criteria

### Functional
- Settings accessible in <1ms
- No file system operations for ephemeral
- Events propagate immediately
- Settings cleared on restart

### Architectural
- Single source of truth (SettingsService for ephemeral)
- Synchronous operations only
- Clean separation of concerns
- No persistence in SettingsService

### User Experience
- Instant setting updates
- No async delays
- Predictable behavior
- No file corruption risks