# Debug Logging System Requirements

## Document Header

Document ID: REQ-20250120-DEBUGLOGGING
Created: 2025-01-20
Status: APPROVED
Priority: HIGH

## Business Requirements

### REQ-001: Core Debug Logging Framework
The system MUST implement a structured debug logging framework using the `debug` package to replace ad-hoc `if(DEBUG)` patterns throughout the codebase.

### REQ-002: Namespace-Based Filtering
The system MUST support hierarchical namespace-based filtering to enable/disable specific components' debug output without affecting others.

### REQ-003: Multi-Layer Configuration
The system MUST support configuration at multiple levels with clear precedence: CLI flags > environment variables > user config > project config > defaults.

### REQ-004: Runtime Control
The system MUST allow users to enable/disable debug logging and change settings during runtime without restarting the application.

### REQ-005: File Output
The system MUST output debug logs to files in `~/.llxprt/debug/` directory, NOT to console by default.

### REQ-006: Provider-Specific Logging
The system MUST provide detailed logging capabilities to help diagnose provider-specific issues, particularly for Cerebras API fragmentation.

## Technical Requirements

### REQ-007: Ephemeral Settings Pattern
The system MUST follow the emojifilter pattern for ephemeral settings with `/debug` commands and `/debug persist` for persistence.

### REQ-008: Zero Performance Impact
The system MUST have zero performance overhead when debug logging is disabled through lazy evaluation.

### REQ-009: Clean Migration Path
The system MUST provide a clean break from `DEBUG=1` pattern while maintaining temporary backward compatibility.

### REQ-010: Namespace Structure
The system MUST implement the following namespace hierarchy:
- `llxprt:[provider]:provider` - Main provider logic
- `llxprt:[provider]:streaming` - Streaming responses
- `llxprt:[provider]:tools` - Tool call handling
- `llxprt:[provider]:auth` - Authentication flow
- `llxprt:[provider]:errors` - Error handling
- `llxprt:core:[component]` - Core services
- `llxprt:cli:[component]` - CLI components

### REQ-011: Settings Schema
The system MUST implement a comprehensive settings schema supporting:
- Enable/disable control
- Namespace selection (array or object with configs)
- Log levels (trace, debug, info, warn, error)
- Output formats (pretty, json, compact)
- Performance options (lazy evaluation, max depth, truncation)
- Privacy options (redaction patterns, excluded keys)

### REQ-012: Debug Commands
The system MUST implement the following `/debug` commands:
- `/debug enable [namespace]` - Enable specific namespaces
- `/debug disable [namespace]` - Disable specific namespaces
- `/debug level [level]` - Set log level
- `/debug output [target]` - Change output target
- `/debug persist` - Save current settings to user config
- `/debug status` - Show current debug configuration

### REQ-013: File Management
The system MUST implement proper file management:
- Automatic log rotation (daily/size-based)
- Configurable max file size
- Automatic cleanup of old logs
- Async writes to prevent blocking

### REQ-014: Privacy and Security
The system MUST implement privacy protections:
- Automatic redaction of API keys and tokens
- Configurable excluded keys (never logged)
- User-controlled data exposure
- No default logging (opt-in only)

### REQ-015: OpenAI Provider Conversion
The system MUST convert the OpenAI provider to use the new debug logging system as the reference implementation in Phase 1.

### REQ-016: Full Codebase Migration
The system MUST convert all remaining `if(DEBUG)` patterns in the codebase to use the new logging system in Phase 2.

## Implementation Constraints

### REQ-017: TypeScript Strict Mode
All code MUST be written in TypeScript strict mode with no `any` types or type assertions.

### REQ-018: Test-Driven Development
All implementation MUST follow TDD principles with tests written before implementation code.

### REQ-019: Backward Compatibility
The system MUST maintain temporary backward compatibility with existing `DEBUG=1` environment variable during migration.

### REQ-020: Documentation
The system MUST include comprehensive documentation for:
- Namespace conventions
- Configuration options
- Migration guide from old patterns
- Common debugging scenarios

## Success Criteria

### REQ-021: Performance Metrics
- Zero overhead when disabled (measured via benchmarks)
- Sub-millisecond namespace matching
- Memory usage under 10MB for typical debug session

### REQ-022: Adoption Metrics
- 100% of OpenAI provider using new system (Phase 1)
- 100% of codebase migrated from `if(DEBUG)` (Phase 2)
- All tests passing with new logging active

### REQ-023: User Experience
- Debug output can be enabled without code changes
- Specific components can be debugged without noise
- Settings persist across sessions when requested

## Verification Requirements

### REQ-024: Automated Testing
- Unit tests for all debug utilities
- Integration tests for configuration hierarchy
- E2E tests for debug commands
- Performance benchmarks

### REQ-025: Manual Testing
- Verify debug output for each provider
- Test runtime configuration changes
- Validate file rotation and cleanup
- Confirm privacy redactions work

## Dependencies

### REQ-026: External Dependencies
- `debug` package (^4.3.4 or compatible)
- No other external dependencies required

### REQ-027: Internal Dependencies
- Must integrate with existing settings system
- Must work with current CLI command infrastructure
- Must be compatible with all provider implementations