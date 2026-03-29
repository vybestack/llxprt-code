#!/usr/bin/env python3
"""
Comprehensive eslint fixer for @typescript-eslint warnings.
Applies fixes based on messageId patterns.
"""
import json
import subprocess
import re
import sys

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

def fix_nullable_boolean(lines, line_num, col, line_text):
    """Fix: nullable boolean in condition. Pattern: if (x) where x: boolean | null | undefined"""
    # Common patterns:
    # if (x) -> if (x === true) or if (x !== false) or if (x != null && x)
    # if (!x) -> if (x !== true) or if (x === false || x == null)  
    # x ? a : b -> (x === true) ? a : b
    # x && ... -> x === true && ...
    # filter(x => x) -> filter((x): x is boolean => x !== null && x !== undefined) or filter(x => x === true)
    pass  # Will handle case by case

def fix_always_truthy(lines, line_num, col, line_text):
    """Fix: value is always truthy in condition."""
    pass

def main():
    data = run_eslint()
    
    # Group by file
    file_warnings = {}
    for f in data:
        fp = f['filePath']
        ts_warnings = [m for m in f.get('messages', []) if m.get('ruleId', '').startswith('@typescript-eslint/')]
        if ts_warnings:
            file_warnings[fp] = ts_warnings
    
    # Print all warnings for analysis
    for fp in sorted(file_warnings.keys()):
        short = fp.replace(ROOT + '/', '')
        for w in file_warnings[fp]:
            line_num = w['line']
            col = w['column']
            rule = w['ruleId'].replace('@typescript-eslint/', '')
            mid = w.get('messageId', '')
            msg = w.get('message', '')[:150]
            
            # Read the actual line
            try:
                with open(fp, 'r') as f:
                    file_lines = f.readlines()
                actual_line = file_lines[line_num - 1].rstrip() if line_num <= len(file_lines) else '<EOF>'
            except:
                actual_line = '<read error>'
            
            print(f"{short}:{line_num}:{col} [{rule}:{mid}]")
            print(f"  {actual_line}")
            print()

if __name__ == '__main__':
    main()
