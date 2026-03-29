#!/usr/bin/env python3
"""Apply eslint suggestion fixes for prefer-nullish-coalescing."""
import json
import subprocess
import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ESLINT_CMD = "npx eslint packages/cli/src/ui/components/ --format json"

def get_suggestion_fixes():
    """Get all suggestion-based fixes from eslint."""
    result = subprocess.run(
        ESLINT_CMD, shell=True, capture_output=True, text=True,
        cwd=ROOT
    )
    data = json.loads(result.stdout)
    
    # Collect fixes per file, sorted by range start (descending to apply from end)
    file_fixes = {}
    for f in data:
        filepath = f['filePath']
        fixes = []
        for m in f.get('messages', []):
            if m.get('ruleId') == '@typescript-eslint/prefer-nullish-coalescing':
                sugs = m.get('suggestions', [])
                if sugs:
                    fix = sugs[0]['fix']
                    fixes.append((fix['range'][0], fix['range'][1], fix['text']))
        if fixes:
            # Sort by range start descending so we apply from the end
            fixes.sort(key=lambda x: x[0], reverse=True)
            file_fixes[filepath] = fixes
    return file_fixes

def apply_fixes():
    file_fixes = get_suggestion_fixes()
    total = sum(len(v) for v in file_fixes.values())
    print(f"Applying {total} fixes across {len(file_fixes)} files")
    
    for filepath, fixes in file_fixes:
        with open(filepath, 'r') as f:
            content = f.read()
        
        for start, end, replacement in fixes:
            content = content[:start] + replacement + content[end:]
        
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"  Fixed {filepath} ({len(fixes)} fixes)")

if __name__ == '__main__':
    apply_fixes()
