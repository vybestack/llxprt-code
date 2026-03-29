#!/usr/bin/env python3
"""
Script to auto-fix @typescript-eslint warnings in the components directory.
Handles:
1. no-unnecessary-condition: neverOptionalChain - replace ?. with . 
2. strict-boolean-expressions: with nullable number/object conditions
3. consistent-type-imports: import() type annotations -> named type imports
4. no-misused-promises: add void before fire-and-forget promises
5. switch-exhaustiveness-check: add default exhaustive check
"""
import json
import subprocess
import sys
import os
import re

ROOT = '/Users/acoliver/projects/llxprt/branch-3/llxprt-code'

def run_eslint():
    result = subprocess.run(
        'npx eslint packages/cli/src/ui/components/ --format json',
        shell=True, capture_output=True, text=True, cwd=ROOT
    )
    return json.loads(result.stdout)

def read_file_lines(filepath):
    with open(filepath, 'r') as f:
        return f.readlines()

def write_file_lines(filepath, lines):
    with open(filepath, 'w') as f:
        f.writelines(lines)

def fix_optional_chains(filepath, warnings):
    """Replace unnecessary optional chains ?. with . on non-nullish values."""
    lines = read_file_lines(filepath)
    changed = False
    
    # Process in reverse order to preserve line numbers
    for w in reversed(warnings):
        if w['messageId'] == 'neverOptionalChain':
            line_idx = w['line'] - 1
            col = w['column'] - 1  # 0-based
            line = lines[line_idx]
            
            # Find the ?. at the column position
            if col < len(line) and line[col:col+2] == '?.':
                # Replace ?. with .
                lines[line_idx] = line[:col] + '.' + line[col+2:]
                changed = True
                print(f"  L{w['line']}: Replaced unnecessary optional chain")
    
    if changed:
        write_file_lines(filepath, lines)
    return changed

def fix_always_truthy_conditions(filepath, warnings):
    """Remove or fix always-truthy/falsy conditions."""
    lines = read_file_lines(filepath)
    changed = False
    
    for w in reversed(warnings):
        if w['messageId'] in ('alwaysTruthy', 'alwaysFalsy', 'noOverlapBooleanExpression'):
            line_idx = w['line'] - 1
            col = w['column'] - 1
            line = lines[line_idx]
            
            # We need to understand the context
            # For `(expr as Type) || []` patterns, they're type-asserted objects that are always truthy
            # Just log for now, will handle manually
            print(f"  L{w['line']}: {w['messageId']} - {line.strip()[:80]}")
    
    return changed

def main():
    print("Running eslint to get warnings...")
    data = run_eslint()
    
    # Group warnings by file and rule
    file_warnings = {}
    for f in data:
        filepath = f['filePath']
        if not filepath.startswith(ROOT):
            continue
        ts_warnings = [m for m in f.get('messages', []) if m.get('ruleId', '').startswith('@typescript-eslint/')]
        if ts_warnings:
            file_warnings[filepath] = ts_warnings
    
    # Phase 1: Fix unnecessary optional chains
    print("\n=== Phase 1: Fixing unnecessary optional chains ===")
    for filepath, warnings in file_warnings.items():
        optional_chain_warnings = [w for w in warnings if w.get('ruleId') == '@typescript-eslint/no-unnecessary-condition' and w.get('messageId') == 'neverOptionalChain']
        if optional_chain_warnings:
            print(f"\n{filepath}:")
            fix_optional_chains(filepath, optional_chain_warnings)
    
    print("\nDone with Phase 1")

if __name__ == '__main__':
    main()
