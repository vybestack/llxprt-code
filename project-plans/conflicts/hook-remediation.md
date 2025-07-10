# React Hook Warning Remediation

## Issue

React Hook warning in `packages/cli/src/ui/hooks/slashCommandProcessor.ts` at line 1644.

## Problem

The `legacyCommands` useMemo hook included unnecessary dependencies:

- `performMemoryRefresh`
- `showMemoryAction`

These dependencies were listed in the dependency array but were not actually used within the useMemo callback body.

## Solution

Removed the unused dependencies from the useMemo dependency array at lines 1654-1655.

## Changes Made

1. Removed `performMemoryRefresh` from the dependency array
2. Removed `showMemoryAction` from the dependency array
3. Also removed a duplicate `addMessage` entry that was in the dependency list

## Result

The React Hook warning should now be resolved as the dependency array only contains dependencies that are actually used within the useMemo callback.
