#!/usr/bin/env python3
"""
Minimal Python AST parser for ZMCP Tools
Returns JSON with symbols extracted from Python files
Called as subprocess from TypeScript TreeSitterASTTool
"""

import ast
import json
import sys
from pathlib import Path
from typing import List, Dict, Any, Optional


def extract_symbols(file_path: str) -> Dict[str, Any]:
    """Extract functions, classes, imports from Python file using AST"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            source = f.read()

        tree = ast.parse(source, filename=file_path)

        symbols = {
            'functions': [],
            'classes': [],
            'imports': [],
            'exports': [],
            'variables': [],
            'errors': []
        }

        for node in ast.walk(tree):
            # Extract functions
            if isinstance(node, ast.FunctionDef):
                symbols['functions'].append({
                    'name': node.name,
                    'type': 'function',
                    'line': node.lineno,
                    'col': node.col_offset,
                    'is_async': isinstance(node, ast.AsyncFunctionDef),
                    'is_exported': not node.name.startswith('_'),
                    'docstring': ast.get_docstring(node),
                    'args': [arg.arg for arg in node.args.args]
                })

            # Extract classes
            elif isinstance(node, ast.ClassDef):
                methods = [n.name for n in node.body if isinstance(n, ast.FunctionDef)]
                symbols['classes'].append({
                    'name': node.name,
                    'type': 'class',
                    'line': node.lineno,
                    'col': node.col_offset,
                    'is_exported': not node.name.startswith('_'),
                    'docstring': ast.get_docstring(node),
                    'methods': methods,
                    'bases': [ast.unparse(base) for base in node.bases]
                })

            # Extract imports
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    symbols['imports'].append({
                        'module': alias.name,
                        'alias': alias.asname,
                        'line': node.lineno,
                        'type': 'import'
                    })

            elif isinstance(node, ast.ImportFrom):
                module = node.module or ''
                for alias in node.names:
                    symbols['imports'].append({
                        'module': f"{module}.{alias.name}" if module else alias.name,
                        'from_module': module,
                        'name': alias.name,
                        'alias': alias.asname,
                        'line': node.lineno,
                        'type': 'import_from'
                    })

            # Extract top-level variables/constants
            elif isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        symbols['variables'].append({
                            'name': target.id,
                            'type': 'variable',
                            'line': node.lineno,
                            'col': node.col_offset,
                            'is_constant': target.id.isupper()
                        })

        # Extract __all__ for exports if present
        for node in tree.body:
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name) and target.id == '__all__':
                        if isinstance(node.value, ast.List):
                            symbols['exports'] = [
                                elt.s if isinstance(elt, ast.Str) else ast.unparse(elt)
                                for elt in node.value.elts
                            ]

        return {
            'success': True,
            'file_path': file_path,
            'symbols': symbols,
            'language': 'python'
        }

    except SyntaxError as e:
        return {
            'success': False,
            'file_path': file_path,
            'error': f"SyntaxError: {e.msg}",
            'line': e.lineno,
            'offset': e.offset
        }
    except Exception as e:
        return {
            'success': False,
            'file_path': file_path,
            'error': str(e)
        }


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(json.dumps({'success': False, 'error': 'Usage: ast_parser.py <file_path>'}))
        sys.exit(1)

    file_path = sys.argv[1]

    if not Path(file_path).exists():
        print(json.dumps({'success': False, 'error': f'File not found: {file_path}'}))
        sys.exit(1)

    result = extract_symbols(file_path)
    print(json.dumps(result, indent=2))
