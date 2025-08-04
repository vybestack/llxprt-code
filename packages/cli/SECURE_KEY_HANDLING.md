# Secure API Key Handling Implementation

This document describes the secure API key handling implementation for the llxprt-code CLI.

## Overview

The implementation provides secure handling for the `/key` command to prevent API keys from being exposed in terminal display, logs, or command history.

## Features

1. **Masked Input Display**: When typing `/key <api-key>`, the API key is masked with asterisks in real-time
2. **No Logging**: API keys are never logged to console or debug logs
3. **Sanitized History**: Command history stores masked versions of API keys
4. **Memory Security**: Keys are handled transiently and cleared when no longer needed

## Implementation Details

### Core Components

1. **SecureInputHandler** (`src/ui/utils/secureInputHandler.ts`)
   - Detects when `/key` command is being typed
   - Masks the API key portion while preserving the actual value
   - Provides sanitization for history storage
   - Shows first and last 2 characters for long keys (>8 chars) for verification

2. **InputPrompt Integration** (`src/ui/components/InputPrompt.tsx`)
   - Uses SecureInputHandler to process and display masked text
   - Shows security indicator when in secure mode
   - Ensures actual (unmasked) value is submitted to command handler
   - Clears secure state when input is cleared

3. **Command History Protection**
   - Shell history stores sanitized versions of `/key` commands
   - Slash command processor sanitizes commands before adding to history
   - Prevents accidental exposure through command recall

### Masking Behavior

- Short keys (≤8 characters): Fully masked with asterisks
- Long keys (>8 characters): Show first 2 and last 2 characters
  - Example: `my-secret-key` → `my*********ey`
  - Helps users verify they typed the correct key

### Security Considerations

1. **No Persistent Storage**: Keys are only held in memory during input
2. **Automatic Cleanup**: Secure state is reset after submission or cancellation
3. **Visual Feedback**: Clear indicator when in secure input mode
4. **No Logging**: API keys are never written to debug logs or console output

## Testing

Comprehensive test coverage includes:

- Detection of `/key` commands
- Masking behavior for various key lengths
- History sanitization
- State management and cleanup

Run tests with: `npm test -- src/ui/utils/secureInputHandler.test.ts`

## Usage

Users simply type `/key <api-key>` as normal. The system automatically:

1. Detects the sensitive command
2. Masks the display in real-time
3. Shows "[SECURE] API key input is masked for security" indicator
4. Submits the actual key value while keeping it hidden from view
5. Stores only the masked version in command history
