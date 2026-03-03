#!/usr/bin/env python3
import re

with open('PLAN.md', 'r') as f:
    content = f.read()

# Add behavior coverage check to deepthinker prompts
# Split by deepthinker sections
sections = content.split('Deepthinker Review Prompt')

for i in range(1, len(sections)):
    section = sections[i]
    
    # Only process if this doesn't already have behavior coverage check
    if 'Verify 100% behavior coverage' not in section:
        # Find the pattern "2. Verify changes match upstream intent for: XXX\n3. Check Non-Negotiables:"
        # And insert "3. Verify 100% behavior coverage..." before "Check Non-Negotiables"
        pattern = r'(2\. Verify changes match upstream intent for:[^\n]*\n)(3\. Check Non-Negotiables:)'
        
        def insert_coverage_check(match):
            step2 = match.group(1)
            old_step3 = match.group(2)
            new_step3 = '3. Verify 100% behavior coverage: All changed behaviors must be covered by tests\n'
            new_step4 = old_step3.replace('3.', '4.')
            return step2 + new_step3 + new_step4
        
        section = re.sub(pattern, insert_coverage_check, section, count=1)
        
        # Now renumber the remaining steps (4 -> 5, 5 -> 6)
        # Find "4. Run" and change to "5. Run"
        section = re.sub(r'(?<=\n)4\. Run (Quick|Full)', r'5. Run \1', section, count=1)
        # Find "5. Output" and change to "6. Output"
        section = re.sub(r'(?<=\n)5\. Output:', '6. Output:', section, count=1)
        
        sections[i] = section

content = 'Deepthinker Review Prompt'.join(sections)

with open('PLAN.md', 'w') as f:
    f.write(content)

print("Added behavior coverage checks to deepthinker prompts")
