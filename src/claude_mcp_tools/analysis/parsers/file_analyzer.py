"""File analysis for extracting symbols, dependencies, and metadata.

This module provides the FileAnalyzer class that can analyze source files
to extract functions, classes, imports, and other symbols for .treesummary generation.
"""

import ast
import json
import re
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger()


class FileAnalyzer:
    """Analyzes source files to extract symbols and metadata."""

    def __init__(self):
        """Initialize the file analyzer."""
        self.language_mappings = {
            ".py": "python",
            ".js": "javascript",
            ".ts": "typescript",
            ".tsx": "typescript",
            ".jsx": "javascript",
            ".java": "java",
            ".cpp": "cpp",
            ".c": "c",
            ".h": "c",
            ".cs": "csharp",
            ".php": "php",
            ".rb": "ruby",
            ".go": "go",
            ".rs": "rust",
            ".swift": "swift",
            ".kt": "kotlin",
            ".scala": "scala",
            ".json": "json",
            ".yaml": "yaml",
            ".yml": "yaml",
            ".toml": "toml",
            ".md": "markdown",
        }

    def detect_language(self, file_path: str) -> str | None:
        """Detect programming language from file extension.
        
        Args:
            file_path: Path to the file
            
        Returns:
            Language name or None if not recognized
        """
        suffix = Path(file_path).suffix.lower()
        return self.language_mappings.get(suffix)

    def find_project_root(self, file_path: str) -> str | None:
        """Find project root by looking for common project indicators.
        
        Args:
            file_path: Path to a file within the project
            
        Returns:
            Project root path or None if not found
        """
        path = Path(file_path).parent

        # Look for common project root indicators
        indicators = {
            "pyproject.toml", "setup.py", "requirements.txt",
            "package.json", "yarn.lock", "package-lock.json",
            "Cargo.toml", "go.mod", "pom.xml", "build.gradle",
            ".git", ".gitignore", "README.md", "README.rst",
        }

        while path != path.parent:
            if any((path / indicator).exists() for indicator in indicators):
                return str(path)
            path = path.parent

        return None

    async def analyze_file(self, file_path: str, language: str | None = None) -> dict[str, Any] | None:
        """Analyze a single file and extract symbols and metadata.
        
        Args:
            file_path: Absolute path to the file
            language: Optional language hint
            
        Returns:
            Analysis results dictionary or None if analysis failed
        """
        try:
            path = Path(file_path)
            if not path.exists():
                logger.warning("File does not exist", file_path=file_path)
                return None

            # Detect language if not provided
            if not language:
                language = self.detect_language(file_path)

            if not language:
                logger.debug("Unsupported file type", file_path=file_path)
                return None

            # Read file content
            try:
                with path.open("r", encoding="utf-8") as f:
                    content = f.read()
            except UnicodeDecodeError:
                # Try with different encoding
                try:
                    with path.open("r", encoding="latin-1") as f:
                        content = f.read()
                except Exception:
                    logger.warning("Could not read file", file_path=file_path)
                    return None

            # Basic file metadata
            stat = path.stat()
            analysis = {
                "file_path": str(path),
                "relative_path": path.name,  # Will be updated by TreeSummaryManager
                "language": language,
                "file_size": stat.st_size,
                "line_count": len(content.splitlines()),
                "character_count": len(content),
                "last_modified": stat.st_mtime,
                "symbols": {},
                "imports": [],
                "exports": [],
                "summary": "",
                "complexity_score": 1,
                "maintainability_score": 5,
            }

            # Language-specific analysis
            if language == "python":
                await self._analyze_python(content, analysis)
            elif language in ["javascript", "typescript"]:
                await self._analyze_javascript(content, analysis)
            elif language == "json":
                await self._analyze_json(content, analysis)
            elif language in ["yaml", "toml"]:
                await self._analyze_config(content, analysis)
            elif language == "markdown":
                await self._analyze_markdown(content, analysis)
            else:
                # Generic text analysis
                await self._analyze_generic(content, analysis)

            return analysis

        except Exception as e:
            logger.error("File analysis failed", file_path=file_path, error=str(e))
            return None

    async def _analyze_python(self, content: str, analysis: dict[str, Any]):
        """Analyze Python source code using AST parsing.
        
        Args:
            content: Source code content
            analysis: Analysis dictionary to update
        """
        try:
            tree = ast.parse(content)

            functions = []
            classes = []
            imports = []

            for node in ast.walk(tree):
                if isinstance(node, ast.FunctionDef):
                    func_info = {
                        "name": node.name,
                        "line_start": node.lineno,
                        "line_end": getattr(node, "end_lineno", node.lineno),
                        "is_async": isinstance(node, ast.AsyncFunctionDef),
                        "parameters": [arg.arg for arg in node.args.args],
                        "decorators": [self._get_decorator_name(d) for d in node.decorator_list],
                        "docstring": ast.get_docstring(node),
                    }

                    # Try to extract return type annotation
                    if node.returns:
                        func_info["return_type"] = self._get_annotation_string(node.returns)

                    functions.append(func_info)

                elif isinstance(node, ast.ClassDef):
                    class_info = {
                        "name": node.name,
                        "line_start": node.lineno,
                        "line_end": getattr(node, "end_lineno", node.lineno),
                        "bases": [self._get_annotation_string(base) for base in node.bases],
                        "decorators": [self._get_decorator_name(d) for d in node.decorator_list],
                        "docstring": ast.get_docstring(node),
                        "methods": [],
                    }

                    # Extract methods
                    for child in node.body:
                        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                            class_info["methods"].append(child.name)

                    classes.append(class_info)

                elif isinstance(node, (ast.Import, ast.ImportFrom)):
                    if isinstance(node, ast.Import):
                        for alias in node.names:
                            imports.append({
                                "module": alias.name,
                                "type": "import",
                                "alias": alias.asname,
                                "line": node.lineno,
                            })
                    else:  # ImportFrom
                        imports.append({
                            "module": node.module,
                            "type": "from_import",
                            "names": [alias.name for alias in node.names],
                            "line": node.lineno,
                        })

            analysis["symbols"] = {
                "functions": functions,
                "classes": classes,
            }
            analysis["imports"] = imports

            # Calculate complexity score (simplified)
            complexity = min(10, len(functions) + len(classes) * 2)
            analysis["complexity_score"] = max(1, complexity)

            # Generate summary
            summary_parts = []
            if classes:
                summary_parts.append(f"{len(classes)} class(es)")
            if functions:
                summary_parts.append(f"{len(functions)} function(s)")
            if imports:
                summary_parts.append(f"{len(imports)} import(s)")

            analysis["summary"] = f"Python module with {', '.join(summary_parts)}" if summary_parts else "Empty Python module"

        except SyntaxError as e:
            logger.warning("Python syntax error", error=str(e))
            analysis["summary"] = f"Python file with syntax error: {e}"
            analysis["complexity_score"] = 1
        except Exception as e:
            logger.error("Python analysis failed", error=str(e))
            analysis["summary"] = "Python file (analysis failed)"
            analysis["complexity_score"] = 1

    async def _analyze_javascript(self, content: str, analysis: dict[str, Any]):
        """Analyze JavaScript/TypeScript using regex patterns.
        
        Args:
            content: Source code content
            analysis: Analysis dictionary to update
        """
        try:
            functions = []
            classes = []
            imports = []
            exports = []

            # Function patterns
            func_patterns = [
                r"function\s+(\w+)\s*\(",
                r"const\s+(\w+)\s*=\s*(?:async\s+)?function",
                r"const\s+(\w+)\s*=\s*(?:async\s+)?\(",
                r"(\w+)\s*:\s*(?:async\s+)?function",
                r"async\s+function\s+(\w+)\s*\(",
            ]

            for pattern in func_patterns:
                for match in re.finditer(pattern, content, re.MULTILINE):
                    functions.append({
                        "name": match.group(1),
                        "line_start": content[:match.start()].count("\n") + 1,
                        "is_async": "async" in match.group(0),
                    })

            # Class patterns
            class_pattern = r"class\s+(\w+)(?:\s+extends\s+(\w+))?"
            for match in re.finditer(class_pattern, content, re.MULTILINE):
                classes.append({
                    "name": match.group(1),
                    "line_start": content[:match.start()].count("\n") + 1,
                    "extends": match.group(2),
                })

            # Import patterns
            import_patterns = [
                r'import\s+(?:\{([^}]+)\}|\*\s+as\s+(\w+)|(\w+))\s+from\s+[\'"]([^\'"]+)[\'"]',
                r'const\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\([\'"]([^\'"]+)[\'"]\)',
            ]

            for pattern in import_patterns:
                for match in re.finditer(pattern, content, re.MULTILINE):
                    imports.append({
                        "source": match.group(-1),  # Last group is always the module path
                        "line": content[:match.start()].count("\n") + 1,
                    })

            # Export patterns
            export_patterns = [
                r"export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)",
                r"export\s+\{([^}]+)\}",
            ]

            for pattern in export_patterns:
                for match in re.finditer(pattern, content, re.MULTILINE):
                    exports.append({
                        "name": match.group(1),
                        "line": content[:match.start()].count("\n") + 1,
                    })

            analysis["symbols"] = {
                "functions": functions,
                "classes": classes,
            }
            analysis["imports"] = imports
            analysis["exports"] = exports

            # Calculate complexity
            complexity = min(10, len(functions) + len(classes) * 2)
            analysis["complexity_score"] = max(1, complexity)

            # Generate summary
            lang_name = "TypeScript" if analysis["language"] == "typescript" else "JavaScript"
            summary_parts = []
            if classes:
                summary_parts.append(f"{len(classes)} class(es)")
            if functions:
                summary_parts.append(f"{len(functions)} function(s)")
            if imports:
                summary_parts.append(f"{len(imports)} import(s)")

            analysis["summary"] = f"{lang_name} module with {', '.join(summary_parts)}" if summary_parts else f"Empty {lang_name} module"

        except Exception as e:
            logger.error("JavaScript analysis failed", error=str(e))
            analysis["summary"] = "JavaScript/TypeScript file (analysis failed)"
            analysis["complexity_score"] = 1

    async def _analyze_json(self, content: str, analysis: dict[str, Any]):
        """Analyze JSON files.
        
        Args:
            content: File content
            analysis: Analysis dictionary to update
        """
        try:
            data = json.loads(content)

            # Count keys and nesting depth
            def count_structure(obj, depth=0):
                if isinstance(obj, dict):
                    return {
                        "keys": len(obj),
                        "max_depth": max([count_structure(v, depth + 1)["max_depth"] for v in obj.values()] or [depth]),
                    }
                if isinstance(obj, list):
                    return {
                        "keys": len(obj),
                        "max_depth": max([count_structure(item, depth + 1)["max_depth"] for item in obj] or [depth]),
                    }
                return {"keys": 0, "max_depth": depth}

            structure = count_structure(data)

            analysis["symbols"] = {
                "top_level_keys": list(data.keys()) if isinstance(data, dict) else [],
                "structure": structure,
            }

            analysis["complexity_score"] = min(10, max(1, structure["max_depth"]))
            analysis["summary"] = f"JSON file with {structure['keys']} top-level items, depth {structure['max_depth']}"

        except json.JSONDecodeError as e:
            analysis["summary"] = f"Invalid JSON file: {e}"
            analysis["complexity_score"] = 1
        except Exception as e:
            logger.error("JSON analysis failed", error=str(e))
            analysis["summary"] = "JSON file (analysis failed)"
            analysis["complexity_score"] = 1

    async def _analyze_config(self, content: str, analysis: dict[str, Any]):
        """Analyze configuration files (YAML, TOML, etc.).
        
        Args:
            content: File content
            analysis: Analysis dictionary to update
        """
        try:
            lines = content.splitlines()
            sections = []

            # Look for section headers (simplified)
            for line in lines:
                line = line.strip()
                if line and not line.startswith("#"):
                    if ":" in line and not line.startswith(" "):
                        sections.append(line.split(":")[0])

            analysis["symbols"] = {
                "sections": sections[:10],  # First 10 sections
            }

            analysis["complexity_score"] = min(10, max(1, len(sections)))
            analysis["summary"] = f"Configuration file with {len(sections)} sections"

        except Exception as e:
            logger.error("Config analysis failed", error=str(e))
            analysis["summary"] = "Configuration file (analysis failed)"
            analysis["complexity_score"] = 1

    async def _analyze_markdown(self, content: str, analysis: dict[str, Any]):
        """Analyze Markdown files.
        
        Args:
            content: File content
            analysis: Analysis dictionary to update
        """
        try:
            lines = content.splitlines()
            headers = []

            for line in lines:
                if line.startswith("#"):
                    level = len(line) - len(line.lstrip("#"))
                    title = line.lstrip("#").strip()
                    headers.append({
                        "level": level,
                        "title": title,
                    })

            analysis["symbols"] = {
                "headers": headers,
            }

            analysis["complexity_score"] = min(10, max(1, len(headers)))
            analysis["summary"] = f"Markdown document with {len(headers)} headers"

        except Exception as e:
            logger.error("Markdown analysis failed", error=str(e))
            analysis["summary"] = "Markdown file (analysis failed)"
            analysis["complexity_score"] = 1

    async def _analyze_generic(self, content: str, analysis: dict[str, Any]):
        """Generic text analysis for unsupported file types.
        
        Args:
            content: File content
            analysis: Analysis dictionary to update
        """
        try:
            lines = content.splitlines()
            non_empty_lines = [line for line in lines if line.strip()]

            analysis["symbols"] = {
                "non_empty_lines": len(non_empty_lines),
                "total_lines": len(lines),
            }

            analysis["complexity_score"] = min(10, max(1, len(non_empty_lines) // 10))
            analysis["summary"] = f"Text file with {len(non_empty_lines)} non-empty lines"

        except Exception as e:
            logger.error("Generic analysis failed", error=str(e))
            analysis["summary"] = "Text file (analysis failed)"
            analysis["complexity_score"] = 1

    def _get_decorator_name(self, decorator) -> str:
        """Extract decorator name from AST node."""
        if isinstance(decorator, ast.Name):
            return decorator.id
        if isinstance(decorator, ast.Attribute):
            return f"{self._get_annotation_string(decorator.value)}.{decorator.attr}"
        return str(decorator)

    def _get_annotation_string(self, annotation) -> str:
        """Convert AST annotation to string."""
        if isinstance(annotation, ast.Name):
            return annotation.id
        if isinstance(annotation, ast.Attribute):
            return f"{self._get_annotation_string(annotation.value)}.{annotation.attr}"
        if isinstance(annotation, ast.Constant):
            return str(annotation.value)
        return str(annotation)
