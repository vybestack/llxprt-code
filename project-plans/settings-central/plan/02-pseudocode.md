# Phase 2: Pseudocode Development

## Objective

Create detailed pseudocode for each component based on domain analysis.

## Worker Task

```bash
claude --dangerously-skip-permissions -p "
Based on specification.md and analysis/domain-model.md, create pseudocode for each component.

Create the following files:

### analysis/pseudocode/settings-service.md

```
CLASS SettingsService
  PRIVATE settings: GlobalSettings
  PRIVATE repository: ISettingsRepository
  PRIVATE emitter: EventEmitter
  PRIVATE validators: Map<Provider, Validator>

  METHOD constructor(repository)
    LOAD settings from repository
    INITIALIZE validators for each provider
    SETUP file watcher for external changes

  METHOD getSettings(provider?: string): Settings
    IF provider specified
      RETURN deep clone of settings.providers[provider]
    ELSE
      RETURN deep clone of all settings

  METHOD updateSettings(provider: string, changes: Partial<Settings>)
    VALIDATE changes with provider validator
    BEGIN transaction
      CLONE current settings
      MERGE changes into clone
      PERSIST clone to repository
      UPDATE memory with clone
      EMIT 'settings-update' event
    ON ERROR
      ROLLBACK to original settings
      THROW validation or persistence error

  METHOD switchProvider(newProvider: string)
    VALIDATE provider exists in config
    IF provider is 'qwen'
      SET default baseUrl and model
    BEGIN transaction  
      UPDATE activeProvider
      PERSIST to repository
      EMIT 'provider-switch' event
      RETURN new provider settings
```

### analysis/pseudocode/settings-repository.md

```
CLASS SettingsRepository
  PRIVATE filePath: string
  PRIVATE backupPath: string

  METHOD load(): GlobalSettings
    TRY
      READ file from filePath
      PARSE JSON
      VALIDATE against schema
      RETURN settings
    CATCH
      IF file not found
        RETURN default settings
      ELSE IF corrupt
        RESTORE from backup
        RETURN backup settings

  METHOD save(settings: GlobalSettings)
    VALIDATE settings against schema
    CREATE backup of current file
    WRITE settings to temp file
    ATOMIC rename temp to actual
    ON ERROR
      RESTORE from backup
      THROW persistence error

  METHOD backup()
    COPY current file to backup location
    ROTATE old backups (keep last 5)
```

### analysis/pseudocode/event-system.md

```
CLASS SettingsEventEmitter
  PRIVATE listeners: Map<EventType, Set<Listener>>

  METHOD emit(event: SettingsChangeEvent)
    GET listeners for event type
    FOR EACH listener
      TRY
        CALL listener with event data
      CATCH error
        LOG error but continue

  METHOD on(eventType: EventType, listener: Listener)
    ADD listener to set for eventType
    RETURN unsubscribe function

  METHOD notifyProviders(event: SettingsChangeEvent)
    FOR EACH registered provider
      CALL provider.onSettingsChange(event)
```

Do NOT write TypeScript code, only detailed pseudocode.
Include error handling and edge cases in pseudocode.
"
```

## Verification Checklist

- [ ] Pseudocode covers all methods from specification
- [ ] Algorithm steps are clear and detailed
- [ ] Error handling included in pseudocode
- [ ] No actual TypeScript implementation
- [ ] All requirements addressed