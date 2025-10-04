#!/usr/bin/env python3
"""
Remove remaining website-related methods from ResourceManager
"""

# Read the file
with open('src/managers/ResourceManager.ts', 'r') as f:
    lines = f.readlines()

# Track if we're in a method to remove
in_getWebsites = False
in_getWebsitePages = False
brace_count = 0
result_lines = []

for i, line in enumerate(lines):
    # Check if we're starting getWebsites method
    if 'private async getWebsites(' in line:
        in_getWebsites = True
        brace_count = 0
        result_lines.append('  // getWebsites method removed - using external playwright-mcp\n')
        continue

    # Check if we're starting getWebsitePages method
    if 'private async getWebsitePages(' in line:
        in_getWebsitePages = True
        brace_count = 0
        result_lines.append('  // getWebsitePages method removed - using external playwright-mcp\n')
        continue

    # If we're in a method to remove, track braces
    if in_getWebsites or in_getWebsitePages:
        # Count braces
        brace_count += line.count('{') - line.count('}')

        # If we've closed all braces, we're done with this method
        if brace_count <= 0 and ('{' in line or '}' in line):
            in_getWebsites = False
            in_getWebsitePages = False
        continue

    # Keep the line if not in a method to remove
    result_lines.append(line)

# Write the result
with open('src/managers/ResourceManager.ts', 'w') as f:
    f.writelines(result_lines)

print("Cleaned up remaining website methods from ResourceManager.ts")