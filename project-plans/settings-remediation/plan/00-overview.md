# Settings Service Remediation Implementation Plan

## Overview

Fix the completely backwards SettingsService that does persistence instead of in-memory ephemeral coordination. Remove all file system operations and make it a simple, synchronous, in-memory service as originally requested.

## Key Components

1. **SettingsService**: Convert to pure in-memory service
2. **Config Integration**: Remove local ephemeral storage, delegate to SettingsService  
3. **File System Removal**: Delete FileSystemSettingsRepository entirely
4. **Event System**: Maintain event emission for change notifications

## Implementation Phases

### Phase 1: Analysis & Design (01-02) ✅
- Domain model analysis 
- Pseudocode development

### Phase 2: Settings Service Remediation (03-05)
- Stub implementation (empty returns, no errors)
- TDD with behavioral tests (no reverse testing)
- Full implementation following pseudocode

### Phase 3: Config Integration (06-08)
- Stub for Config delegation
- TDD for Config using SettingsService
- Implementation of delegation pattern

### Phase 4: Cleanup & Migration (09-11)
- Remove FileSystemSettingsRepository
- Remove async patterns
- Update all consumers

### Phase 5: Integration Testing (12-14)
- End-to-end command tests
- Event propagation tests
- Performance validation

## Success Criteria

- NO file system operations in SettingsService
- All operations synchronous (<1ms)
- Settings cleared on restart
- Single source of truth for ephemeral settings
- All existing commands work without async delays

## Integration Requirements

This fix MUST integrate with:
- All CLI commands (/set, /model, /provider, etc.)
- Config class API (getEphemeralSetting, setEphemeralSetting)
- UI components listening for changes
- Provider instances needing settings

The fix is useless if these don't work after remediation.