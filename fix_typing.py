#!/usr/bin/env python3
"""Script to fix typing issues in Python files."""

import re
from pathlib import Path

def fix_typing_in_file(file_path):
    """Fix typing issues in a single file."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        original_content = content
        changes = []
        
        # Fix import statements
        if 'from typing import' in content:
            # Remove Optional, List, Dict, Tuple from imports
            content = re.sub(
                r'from typing import ([^\\n]*)(Optional|List|Dict|Tuple)[^\\n]*',
                lambda m: _fix_import_line(m.group(0)),
                content,
                flags=re.MULTILINE
            )
            if content != original_content:
                changes.append("Fixed typing imports")
        
        # Fix type annotations
        original_annotations = content
        
        # Fix Optional[Type] -> Type | None
        content = re.sub(r'Optional\\[([^\\]]+)\\]', r'\\1 | None', content)
        if content != original_annotations:
            changes.append("Fixed Optional[] syntax")
            
        original_annotations = content
        
        # Fix List[Type] -> list[Type]
        content = re.sub(r'List\\[([^\\]]+)\\]', r'list[\\1]', content)
        if content != original_annotations:
            changes.append("Fixed List[] syntax")
            
        original_annotations = content
        
        # Fix Dict[Key, Value] -> dict[Key, Value]
        content = re.sub(r'Dict\\[([^\\]]+)\\]', r'dict[\\1]', content)
        if content != original_annotations:
            changes.append("Fixed Dict[] syntax")
            
        original_annotations = content
        
        # Fix Tuple[Types] -> tuple[Types]
        content = re.sub(r'Tuple\\[([^\\]]+)\\]', r'tuple[\\1]', content)
        if content != original_annotations:
            changes.append("Fixed Tuple[] syntax")
        
        # Write back if changes were made
        if content != original_content:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return changes
        
        return []
        
    except Exception as e:
        print(f"Error processing {file_path}: {e}")
        return []

def _fix_import_line(import_line):
    """Fix a single import line by removing old typing imports."""
    line = import_line
    
    # Keep only Any and Literal from typing imports
    imports_to_keep = []
    if 'Any' in line:
        imports_to_keep.append('Any')
    if 'Literal' in line:
        imports_to_keep.append('Literal')
    
    if imports_to_keep:
        return f"from typing import {', '.join(imports_to_keep)}"
    else:
        # If no imports to keep, remove the entire line
        return ""

def main():
    """Main function to fix typing in all files."""
    project_root = Path('/home/zach/github/ClaudeMcpTools')
    
    # List of directories and files to process
    files_to_process = []
    
    # Add specific files
    specific_files = [
        'src/claude_mcp_tools/server.py',
        'src/claude_mcp_tools/database.py',
        'installer/claude_mcp_tools_installer/main.py',
        'scripts/configure-claude-permissions.py'
    ]
    
    for file_path in specific_files:
        full_path = project_root / file_path
        if full_path.exists():
            files_to_process.append(full_path)
    
    # Add all Python files from specific directories
    dirs_to_scan = [
        'src/claude_mcp_tools/services',
        'src/claude_mcp_tools/analysis',
        'src/claude_mcp_tools/orchestration'
    ]
    
    for dir_path in dirs_to_scan:
        full_dir = project_root / dir_path
        if full_dir.exists():
            for py_file in full_dir.rglob('*.py'):
                files_to_process.append(py_file)
    
    # Process all files
    total_files = 0
    files_changed = 0
    
    for file_path in files_to_process:
        if file_path.name == 'fix_typing.py':  # Skip this script
            continue
            
        total_files += 1
        changes = fix_typing_in_file(file_path)
        
        if changes:
            files_changed += 1
            print(f"Fixed {file_path}: {', '.join(changes)}")
    
    print(f"\\nProcessed {total_files} files, {files_changed} files changed")

if __name__ == '__main__':
    main()