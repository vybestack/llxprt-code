# Comprehensive Error Scenarios for Prompt Configuration System

## Overview

This document catalogs all error scenarios the prompt configuration system must handle gracefully, with expected behaviors and test cases for each.

## 1. File System Errors

### 1.1 Base Directory Access Errors

#### Scenario: ~/.llxprt directory doesn't exist
- **Trigger**: First run or deleted directory
- **Expected Behavior**: Attempt to create directory recursively
- **Recovery**: If creation fails, fatal error with instructions
- **Test**: Mock fs.mkdir to fail, verify error message

#### Scenario: No read permission on ~/.llxprt/prompts
- **Trigger**: Incorrect file permissions
- **Expected Behavior**: Fatal error with clear message
- **Error Message**: "Cannot read prompt configuration directory ~/.llxprt/prompts. Please check permissions."
- **Test**: Mock fs.access to return EACCES

#### Scenario: No write permission for installation
- **Trigger**: Read-only filesystem or permissions
- **Expected Behavior**: Fatal error during installation
- **Error Message**: "Cannot write to ~/.llxprt/prompts. Installation requires write access."
- **Test**: Mock fs.writeFile to return EACCES

### 1.2 File Reading Errors

#### Scenario: Prompt file exists but can't be read
- **Trigger**: File permissions, disk error
- **Expected Behavior**: Log warning, use fallback in hierarchy
- **Test**: Mock fs.readFile to throw EACCES for specific file

#### Scenario: File deleted between existence check and read
- **Trigger**: Race condition
- **Expected Behavior**: Treat as missing file, use fallback
- **Test**: Mock fileExists=true, readFile throws ENOENT

#### Scenario: Corrupted file (invalid UTF-8)
- **Trigger**: Binary data or corruption
- **Expected Behavior**: Log warning, use fallback
- **Test**: Mock readFile to return Buffer with invalid UTF-8

### 1.3 Path Traversal Attempts

#### Scenario: Malicious file path with ../
- **Trigger**: Compromised configuration
- **Expected Behavior**: Reject path, security error
- **Error Message**: "Invalid path: Path traversal not allowed"
- **Test**: Try to resolve "../../etc/passwd"

## 2. Template Processing Errors

### 2.1 Variable Substitution Errors

#### Scenario: Unclosed variable bracket {{MODEL
- **Trigger**: Malformed template syntax
- **Expected Behavior**: Leave as-is in output
- **Test**: Process "Hello {{MODEL world"

#### Scenario: Nested variables {{{{VAR}}}}
- **Trigger**: Complex template attempt
- **Expected Behavior**: Process outer brackets only
- **Test**: Process "{{{{MODEL}}}}" → "{{claude-3-opus}}"

#### Scenario: Variable with spaces {{MODEL NAME}}
- **Trigger**: Invalid variable name
- **Expected Behavior**: No substitution (invalid syntax)
- **Test**: Process "Using {{MODEL NAME}}" → unchanged

#### Scenario: Missing variable value
- **Trigger**: Variable not in context
- **Expected Behavior**: Substitute with empty string
- **Test**: Template "{{UNKNOWN}}" with no UNKNOWN var → ""

### 2.2 Template Size Errors

#### Scenario: Extremely large template file (>10MB)
- **Trigger**: Misconfigured or malicious file
- **Expected Behavior**: Reject file, use fallback
- **Error Message**: "Template file too large: >10MB"
- **Test**: Mock file size check

## 3. Resolution Hierarchy Errors

### 3.1 Missing Files in Hierarchy

#### Scenario: No file found at any level
- **Trigger**: Required file missing everywhere
- **Expected Behavior**: 
  - For core.md: Fatal error
  - For env/tool files: Skip silently
- **Test**: Mock all resolution paths as missing

#### Scenario: Provider directory exists but empty
- **Trigger**: Partial installation
- **Expected Behavior**: Fall back to base files
- **Test**: Directory exists but no files inside

### 3.2 Invalid Provider/Model Names

#### Scenario: Provider name with path separators
- **Trigger**: "anthropic/../../evil"
- **Expected Behavior**: Sanitize or reject
- **Error Message**: "Invalid provider name"
- **Test**: Context with malicious provider name

#### Scenario: Model name with special characters
- **Trigger**: "model|name;rm -rf"
- **Expected Behavior**: Sanitize to safe characters
- **Test**: Various special characters in model name

## 4. Cache-Related Errors

### 4.1 Memory Pressure

#### Scenario: Cache grows beyond memory limit
- **Trigger**: Many provider/model combinations
- **Expected Behavior**: LRU eviction or size limit
- **Test**: Add 1000+ cache entries

#### Scenario: Cache key collision
- **Trigger**: Hash collision (unlikely)
- **Expected Behavior**: Unique keys prevent collision
- **Test**: Verify key generation uniqueness

### 4.2 Cache Corruption

#### Scenario: Cache entry corrupted in memory
- **Trigger**: Memory error
- **Expected Behavior**: Regenerate on next request
- **Test**: Corrupt cache entry, verify regeneration

## 5. Configuration Errors

### 5.1 Tool Configuration Issues

#### Scenario: Enabled tool doesn't exist
- **Trigger**: Typo in tool name
- **Expected Behavior**: Log warning, skip tool
- **Warning**: "Tool prompt not found: TypoTool"
- **Test**: Enable non-existent tool

#### Scenario: Tool name can't be converted
- **Trigger**: Tool with numbers "Tool123"
- **Expected Behavior**: Handle gracefully
- **Test**: Various edge case tool names

### 5.2 Environment Detection Failures

#### Scenario: Git detection command fails
- **Trigger**: git not installed
- **Expected Behavior**: Assume not in git repo
- **Test**: Mock isGitRepository to throw

#### Scenario: SANDBOX env var has invalid value
- **Trigger**: SANDBOX="yes" instead of "1"
- **Expected Behavior**: Only recognize "1" as true
- **Test**: Various SANDBOX values

## 6. Installation Errors

### 6.1 Partial Installation

#### Scenario: Installation interrupted mid-way
- **Trigger**: Process killed
- **Expected Behavior**: Idempotent - resume on next run
- **Test**: Simulate partial file creation

#### Scenario: Disk full during installation
- **Trigger**: No space left
- **Expected Behavior**: Rollback or clear error
- **Error**: "Installation failed: ENOSPC"
- **Test**: Mock writeFile to throw ENOSPC

### 6.2 Default Content Issues

#### Scenario: Built-in defaults missing
- **Trigger**: Packaging error
- **Expected Behavior**: Fatal error
- **Error**: "Critical: Default prompts not found"
- **Test**: Remove defaults from constants

## 7. Runtime Errors

### 7.1 File System Changes

#### Scenario: Files modified after startup
- **Trigger**: User edits while running
- **Expected Behavior**: Use cached version
- **Note**: Document restart requirement
- **Test**: Modify file after cache, verify no reload

#### Scenario: Directory deleted while running
- **Trigger**: User deletes ~/.llxprt/prompts
- **Expected Behavior**: Continue with cache
- **Test**: Delete directory after startup

### 7.2 Concurrent Access

#### Scenario: Multiple processes starting
- **Trigger**: Parallel llxprt instances
- **Expected Behavior**: Safe concurrent reads
- **Test**: Simulate parallel installations

## 8. Migration Errors

### 8.1 Legacy System Issues

#### Scenario: Both old and new systems active
- **Trigger**: Partial migration
- **Expected Behavior**: Feature flag controls
- **Test**: Verify flag behavior

#### Scenario: Prompt content mismatch
- **Trigger**: Extraction error
- **Expected Behavior**: Regression test catches
- **Test**: Compare old vs new output

## Error Handling Best Practices

1. **Clear Error Messages**: Include file paths and remediation steps
2. **Graceful Degradation**: Use fallbacks when possible
3. **Security First**: Reject suspicious paths/content
4. **Logging**: Debug mode for troubleshooting
5. **User Experience**: Fatal only when absolutely necessary

## Test Coverage Requirements

Each error scenario should have:
1. Unit test verifying the specific error handling
2. Integration test verifying system behavior
3. Clear assertion on expected outcome
4. No test should verify mock behavior