#!/usr/bin/env python3
"""
Comprehensive eslint fixer for @typescript-eslint warnings.
Handles remaining warnings after auto-fix:
1. strict-boolean-expressions - add explicit checks
2. no-unnecessary-condition - remove always-true/false conditions
3. consistent-type-imports (import() type annotations)
4. no-misused-promises - add void operator
5. switch-exhaustiveness-check - add exhaustive defaults
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

def read_file(filepath):
    with open(filepath, 'r') as f:
        return f.read()

def write_file(filepath, content):
    with open(filepath, 'w') as f:
        f.write(content)

def get_warnings_for_file(data, filepath_suffix):
    for f in data:
        if f['filePath'].endswith(filepath_suffix):
            return [m for m in f.get('messages', []) if m.get('ruleId', '').startswith('@typescript-eslint/')]
    return []

def get_all_file_warnings(data):
    result = {}
    for f in data:
        filepath = f['filePath']
        ts_warnings = [m for m in f.get('messages', []) if m.get('ruleId', '').startswith('@typescript-eslint/')]
        if ts_warnings:
            result[filepath] = ts_warnings
    return result

def fix_file_strict_boolean_and_unnecessary(filepath, warnings):
    """Fix strict-boolean-expressions and no-unnecessary-condition warnings."""
    content = read_file(filepath)
    lines = content.split('\n')
    changed = False
    
    # Separate warnings by type
    always_truthy = [(w['line'], w['column']) for w in warnings 
                     if w.get('ruleId') == '@typescript-eslint/no-unnecessary-condition' 
                     and w.get('messageId') == 'alwaysTruthy']
    always_falsy = [(w['line'], w['column']) for w in warnings 
                    if w.get('ruleId') == '@typescript-eslint/no-unnecessary-condition' 
                    and w.get('messageId') == 'alwaysFalsy']
    no_overlap = [(w['line'], w['column']) for w in warnings 
                  if w.get('ruleId') == '@typescript-eslint/no-unnecessary-condition' 
                  and w.get('messageId') == 'noOverlapBooleanExpression']
    nullable_number = [(w['line'], w['column'], w.get('suggestions', [])) for w in warnings 
                       if w.get('ruleId') == '@typescript-eslint/strict-boolean-expressions' 
                       and w.get('messageId') == 'conditionErrorNullableNumber']
    object_condition = [(w['line'], w['column']) for w in warnings 
                        if w.get('ruleId') == '@typescript-eslint/strict-boolean-expressions' 
                        and w.get('messageId') == 'conditionErrorObject']
    
    # Log for manual inspection
    for line, col in always_truthy:
        print(f"  ALWAYS_TRUTHY L{line}:{col}: {lines[line-1].strip()[:100]}")
    for line, col in always_falsy:
        print(f"  ALWAYS_FALSY L{line}:{col}: {lines[line-1].strip()[:100]}")
    for line, col in no_overlap:
        print(f"  NO_OVERLAP L{line}:{col}: {lines[line-1].strip()[:100]}")
    for line, col, sugs in nullable_number:
        print(f"  NULLABLE_NUM L{line}:{col}: {lines[line-1].strip()[:100]}")
    for line, col in object_condition:
        print(f"  OBJECT_COND L{line}:{col}: {lines[line-1].strip()[:100]}")
    
    return changed

def main():
    print("Running eslint...")
    data = run_eslint()
    file_warnings = get_all_file_warnings(data)
    
    for filepath, warnings in sorted(file_warnings.items(), key=lambda x: -len(x[1])):
        short = filepath.replace(ROOT + '/', '')
        print(f"\n=== {short} ({len(warnings)} warnings) ===")
        fix_file_strict_boolean_and_unnecessary(filepath, warnings)

if __name__ == '__main__':
    main()
