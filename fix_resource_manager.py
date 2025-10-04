#!/usr/bin/env python3
"""
Clean up ResourceManager to remove all scraping-related methods.
"""

import re

# Read the file
with open('src/managers/ResourceManager.ts', 'r') as f:
    content = f.read()

# Find and remove getDocumentationSources method (lines 639-692 approx)
content = re.sub(
    r'  private async getDocumentationSources\([^}]*?\n  \}\n',
    '',
    content,
    flags=re.DOTALL
)

# Find and remove getWebsites method (lines 694-745 approx)
content = re.sub(
    r'  private async getWebsites\([^}]*?\n  \}\n',
    '',
    content,
    flags=re.DOTALL
)

# Find and remove getDocumentationSearch method (lines 1262-1338 approx)
content = re.sub(
    r'  private async getDocumentationSearch\([^}]*?\n  \}\n',
    '',
    content,
    flags=re.DOTALL
)

# Write the cleaned content back
with open('src/managers/ResourceManager.ts', 'w') as f:
    f.write(content)

print("Cleaned ResourceManager.ts")