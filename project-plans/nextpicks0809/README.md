# Next Cherry-picks and Reimplementations - August 9, 2025

## Overview
This plan covers marking picked upstream commits and reimplementing features with our privacy-first approach.

## Commits to Mark as Picked

### 1. `60bde58f` - LoggingContentGenerator
- **Status**: Reimplemented as LoggingProviderWrapper
- **Action**: Mark as picked with empty merge

### 2. `bae922a6` - Move logging into CodeAssistServer  
- **Status**: Reimplemented with our privacy-first logging
- **Action**: Mark as picked with empty merge

### 3. `e50d886b` - Telemetry docs
- **Status**: Will create our own privacy-first docs
- **Action**: Create docs, then mark as picked

### 4. `5ab184fc` - Git lines added/removed telemetry
- **Status**: Will reimplement with privacy-first approach
- **Action**: Implement locally-only version, then mark as picked

## Implementation Tasks

### Task 1: Mark Picked Commits
- Create empty merges for already-reimplemented features
- Document our implementations in commit messages

### Task 2: Privacy-First Telemetry Documentation
- Document our local-only telemetry approach
- Explain /logging command and privacy controls
- Clarify that no data is sent to external services

### Task 3: Git Statistics Tracking
- Implement lines added/removed tracking
- Store locally when logging is enabled
- Simple on/off control (no fine-grained settings)
- Include in conversation logs

## Principles
- Privacy-first: All data stays local
- Simple controls: On or off, no complex settings
- Multi-provider: Works with all providers
- Test-first: Write behavioral tests before implementation