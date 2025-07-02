"""File analyzer with language-specific parsing capabilities.

Adapted from AgentTreeGraph for ClaudeMcpTools integration.
"""

import ast
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger()


class PythonASTVisitor(ast.NodeVisitor):
    """AST visitor for extracting Python code structure."""

    def __init__(self):
        self.imports: list[dict[str, Any]] = []
        self.classes: list[dict[str, Any]] = []
        self.functions: list[dict[str, Any]] = []
        self.global_variables: list[dict[str, Any]] = []
        self.constants: list[dict[str, Any]] = []
        self.decorators: list[str] = []
        self.module_docstring: str | None = None
        self._current_class: str | None = None

    def visit_Module(self, node: ast.Module) -> None:
        """Visit module node and extract docstring."""
        if (node.body and
            isinstance(node.body[0], ast.Expr) and
            isinstance(node.body[0].value, ast.Constant) and
            isinstance(node.body[0].value.value, str)):
            self.module_docstring = node.body[0].value.value
        self.generic_visit(node)

    def visit_Import(self, node: ast.Import) -> None:
        """Visit import statement."""
        for alias in node.names:
            self.imports.append({
                "module": alias.name,
                "type": "import",
                "names": [alias.name],
                "alias": alias.asname,
                "line": node.lineno,
            })

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        """Visit from-import statement."""
        module = node.module or ""
        names = [alias.name for alias in node.names]
        self.imports.append({
            "module": module,
            "type": "from_import",
            "names": names,
            "alias": None,
            "line": node.lineno,
        })

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        """Visit class definition."""
        docstring = None
        if (node.body and
            isinstance(node.body[0], ast.Expr) and
            isinstance(node.body[0].value, ast.Constant) and
            isinstance(node.body[0].value.value, str)):
            docstring = node.body[0].value.value

        # Get base classes
        inheritance = []
        for base in node.bases:
            if isinstance(base, ast.Name):
                inheritance.append(base.id)
            elif isinstance(base, ast.Attribute):
                inheritance.append(f"{base.value.id}.{base.attr}")

        # Get decorators
        decorators = []
        for decorator in node.decorator_list:
            if isinstance(decorator, ast.Name):
                decorators.append(decorator.id)
            elif isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Name):
                decorators.append(decorator.func.id)

        # Get methods and properties
        methods = []
        properties = []
        old_class = self._current_class
        self._current_class = node.name

        for item in node.body:
            if isinstance(item, ast.FunctionDef) or isinstance(item, ast.AsyncFunctionDef):
                methods.append(item.name)

        self._current_class = old_class

        self.classes.append({
            "name": node.name,
            "line_start": node.lineno,
            "line_end": getattr(node, "end_lineno", node.lineno),
            "docstring": docstring,
            "methods": methods,
            "properties": properties,
            "inheritance": inheritance,
            "decorators": decorators,
        })

        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        """Visit function definition."""
        self._visit_function(node, False)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        """Visit async function definition."""
        self._visit_function(node, True)

    def _visit_function(self, node, is_async: bool) -> None:
        """Helper to visit function definitions."""
        docstring = None
        if (node.body and
            isinstance(node.body[0], ast.Expr) and
            isinstance(node.body[0].value, ast.Constant) and
            isinstance(node.body[0].value.value, str)):
            docstring = node.body[0].value.value

        # Get parameters
        parameters = []
        for arg in node.args.args:
            param_str = arg.arg
            if arg.annotation:
                if isinstance(arg.annotation, ast.Name):
                    param_str += f": {arg.annotation.id}"
                elif isinstance(arg.annotation, ast.Constant):
                    param_str += f": {arg.annotation.value}"
            parameters.append(param_str)

        # Get return type
        return_type = None
        if node.returns:
            if isinstance(node.returns, ast.Name):
                return_type = node.returns.id
            elif isinstance(node.returns, ast.Constant):
                return_type = str(node.returns.value)

        # Get decorators
        decorators = []
        for decorator in node.decorator_list:
            if isinstance(decorator, ast.Name):
                decorators.append(decorator.id)
            elif isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Name):
                decorators.append(decorator.func.id)

        # Calculate complexity (simple cyclomatic complexity)
        complexity = self._calculate_function_complexity(node)

        self.functions.append({
            "name": node.name,
            "line_start": node.lineno,
            "line_end": getattr(node, "end_lineno", node.lineno),
            "docstring": docstring,
            "parameters": parameters,
            "return_type": return_type,
            "complexity": complexity,
            "is_async": is_async,
            "decorators": decorators,
            "class": self._current_class,
        })

        self.generic_visit(node)

    def visit_Assign(self, node: ast.Assign) -> None:
        """Visit assignment to capture constants and global variables."""
        for target in node.targets:
            if isinstance(target, ast.Name):
                name = target.id
                value = None

                # Try to extract simple values
                if isinstance(node.value, ast.Constant):
                    value = repr(node.value.value)
                elif isinstance(node.value, ast.Str):  # For older Python versions
                    value = repr(node.value.s)
                elif isinstance(node.value, ast.Num):  # For older Python versions
                    value = repr(node.value.n)

                # Determine if it's a constant (uppercase name)
                if name.isupper():
                    self.constants.append({
                        "name": name,
                        "value": value or "...",
                        "type": type(node.value).__name__,
                        "line": node.lineno,
                    })
                else:
                    self.global_variables.append({
                        "name": name,
                        "value": value or "...",
                        "type": type(node.value).__name__,
                        "line": node.lineno,
                    })

    def _calculate_function_complexity(self, node) -> int:
        """Calculate simple cyclomatic complexity for a function."""
        complexity = 1  # Base complexity

        for child in ast.walk(node):
            if isinstance(child, (ast.If, ast.While, ast.For, ast.AsyncFor,
                                ast.ExceptHandler, ast.With, ast.AsyncWith)):
                complexity += 1
            elif isinstance(child, ast.BoolOp):
                complexity += len(child.values) - 1

        return complexity


class JavaScriptParser:
    """Simple JavaScript/TypeScript parser using regex patterns."""

    def parse_file(self, file_path: Path) -> dict[str, Any]:
        """Parse JavaScript/TypeScript file."""
        try:
            with file_path.open("r", encoding="utf-8") as f:
                content = f.read()

            return self.parse_source(content, str(file_path))

        except (OSError, UnicodeDecodeError) as e:
            return {
                "file_path": str(file_path),
                "error": f"Failed to read file: {e}",
                "success": False,
            }

    def parse_source(self, content: str, file_path: str) -> dict[str, Any]:
        """Parse JavaScript/TypeScript source code."""
        try:
            functions = self._extract_functions(content)
            classes = self._extract_classes(content)
            imports = self._extract_imports(content)
            exports = self._extract_exports(content)

            return {
                "file_path": file_path,
                "language": "typescript" if file_path.endswith((".ts", ".tsx")) else "javascript",
                "success": True,
                "functions": functions,
                "classes": classes,
                "imports": imports,
                "exports": exports,
                "line_count": len(content.splitlines()),
            }

        except Exception as e:
            return {
                "file_path": file_path,
                "error": f"Parse error: {e}",
                "success": False,
            }

    def _extract_functions(self, content: str) -> list[dict[str, Any]]:
        """Extract function definitions."""
        functions = []

        # Function patterns
        patterns = [
            r"(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)",
            r"(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>",
            r"(\w+)\s*:\s*(?:async\s+)?function\s*\([^)]*\)",
            r"(\w+)\s*\([^)]*\)\s*\{",  # Method definitions
        ]

        lines = content.splitlines()
        for i, line in enumerate(lines, 1):
            for pattern in patterns:
                matches = re.finditer(pattern, line)
                for match in matches:
                    func_name = match.group(1)
                    if func_name not in ["if", "for", "while", "switch"]:  # Exclude keywords
                        functions.append({
                            "name": func_name,
                            "line_start": i,
                            "line_end": i,  # Simplified
                            "is_async": "async" in line,
                            "is_arrow": "=>" in line,
                            "is_exported": "export" in line,
                        })

        return functions

    def _extract_classes(self, content: str) -> list[dict[str, Any]]:
        """Extract class definitions."""
        classes = []

        class_pattern = r"(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?"
        lines = content.splitlines()

        for i, line in enumerate(lines, 1):
            match = re.search(class_pattern, line)
            if match:
                class_name = match.group(1)
                extends = match.group(2)

                classes.append({
                    "name": class_name,
                    "line_start": i,
                    "line_end": i,  # Simplified
                    "extends": extends,
                    "is_exported": "export" in line,
                    "methods": [],  # Would need more complex parsing
                    "properties": [],
                })

        return classes

    def _extract_imports(self, content: str) -> list[dict[str, Any]]:
        """Extract import statements."""
        imports = []

        import_patterns = [
            r'import\s+(.+)\s+from\s+[\'"]([^\'"]+)[\'"]',
            r'import\s+[\'"]([^\'"]+)[\'"]',
            r'const\s+(.+)\s+=\s+require\([\'"]([^\'"]+)[\'"]\)',
        ]

        lines = content.splitlines()
        for i, line in enumerate(lines, 1):
            for pattern in import_patterns:
                match = re.search(pattern, line)
                if match:
                    if len(match.groups()) == 2:
                        names = [match.group(1).strip()]
                        source = match.group(2)
                    else:
                        names = []
                        source = match.group(1)

                    imports.append({
                        "source": source,
                        "type": "require" if "require" in line else "import",
                        "names": names,
                        "line": i,
                    })

        return imports

    def _extract_exports(self, content: str) -> list[dict[str, Any]]:
        """Extract export statements."""
        exports = []

        export_patterns = [
            r"export\s+(?:default\s+)?(\w+)",
            r"export\s*\{\s*([^}]+)\s*\}",
            r"module\.exports\s*=\s*(\w+)",
        ]

        lines = content.splitlines()
        for i, line in enumerate(lines, 1):
            for pattern in export_patterns:
                match = re.search(pattern, line)
                if match:
                    export_name = match.group(1)
                    is_default = "default" in line

                    exports.append({
                        "name": export_name,
                        "type": "default" if is_default else "named",
                        "line": i,
                    })

        return exports


class FileAnalyzer:
    """Main file analyzer with language-specific parsing."""

    def __init__(self):
        self.python_parser = PythonASTVisitor()
        self.js_parser = JavaScriptParser()

    async def analyze_file(self, file_path: str | Path, language: str | None = None) -> dict[str, Any] | None:
        """Analyze a file and extract structural information."""
        file_path = Path(file_path)

        if not file_path.exists():
            logger.error(f"File does not exist: {file_path}")
            return None

        # Detect language if not provided
        if not language:
            language = self._detect_language(file_path)

        if not language:
            logger.debug(f"Unknown language for file: {file_path}")
            return None

        try:
            if language == "python":
                return self._analyze_python_file(file_path)
            if language in ["javascript", "typescript"]:
                return self.js_parser.parse_file(file_path)
            # Generic analysis for other languages
            return self._analyze_generic_file(file_path, language)

        except Exception as e:
            logger.error(f"Analysis failed for {file_path}: {e}")
            return None

    def _analyze_python_file(self, file_path: Path) -> dict[str, Any]:
        """Analyze Python file using AST."""
        try:
            with file_path.open("r", encoding="utf-8") as f:
                source_code = f.read()

            tree = ast.parse(source_code, filename=str(file_path))
            visitor = PythonASTVisitor()
            visitor.visit(tree)

            # Calculate overall complexity
            total_complexity = sum(func.get("complexity", 1) for func in visitor.functions)
            avg_complexity = total_complexity / len(visitor.functions) if visitor.functions else 0

            return {
                "file_path": str(file_path),
                "language": "python",
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "symbols": {
                    "functions": visitor.functions,
                    "classes": visitor.classes,
                    "imports": visitor.imports,
                    "constants": visitor.constants,
                },
                "exports": [func["name"] for func in visitor.functions if not func.get("class")],
                "summary": self._generate_summary(visitor),
                "complexity_score": min(10, max(1, int(avg_complexity))),
                "maintainability_score": self._calculate_maintainability(visitor),
                "success": True,
            }

        except SyntaxError as e:
            return {
                "file_path": str(file_path),
                "language": "python",
                "error": f"Syntax error: {e}",
                "success": False,
            }
        except Exception as e:
            return {
                "file_path": str(file_path),
                "language": "python",
                "error": f"Analysis error: {e}",
                "success": False,
            }

    def _analyze_generic_file(self, file_path: Path, language: str) -> dict[str, Any]:
        """Generic analysis for unsupported languages."""
        try:
            with file_path.open("r", encoding="utf-8", errors="ignore") as f:
                content = f.read()

            lines = content.splitlines()
            return {
                "file_path": str(file_path),
                "language": language,
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "symbols": {
                    "functions": [],
                    "classes": [],
                    "imports": [],
                    "constants": [],
                },
                "exports": [],
                "summary": f"{language.title()} file with {len(lines)} lines",
                "complexity_score": 1,
                "maintainability_score": 8,
                "line_count": len(lines),
                "success": True,
            }

        except Exception as e:
            return {
                "file_path": str(file_path),
                "language": language,
                "error": f"Analysis error: {e}",
                "success": False,
            }

    def _detect_language(self, file_path: Path) -> str | None:
        """Detect programming language from file extension."""
        suffix = file_path.suffix.lower()

        language_map = {
            ".py": "python",
            ".js": "javascript",
            ".jsx": "javascript",
            ".ts": "typescript",
            ".tsx": "typescript",
            ".java": "java",
            ".c": "c",
            ".cpp": "cpp",
            ".h": "c",
            ".hpp": "cpp",
            ".go": "go",
            ".rs": "rust",
            ".rb": "ruby",
            ".php": "php",
        }

        return language_map.get(suffix)

    def _generate_summary(self, visitor: PythonASTVisitor) -> str:
        """Generate a brief summary of the file."""
        parts = []

        if visitor.classes:
            parts.append(f"{len(visitor.classes)} class{'es' if len(visitor.classes) > 1 else ''}")

        if visitor.functions:
            parts.append(f"{len(visitor.functions)} function{'s' if len(visitor.functions) > 1 else ''}")

        if visitor.imports:
            parts.append(f"{len(visitor.imports)} import{'s' if len(visitor.imports) > 1 else ''}")

        if not parts:
            parts.append("utility module")

        summary = "Python module with " + ", ".join(parts)
        return summary[:100]  # Limit to 100 chars

    def _calculate_maintainability(self, visitor: PythonASTVisitor) -> int:
        """Calculate maintainability score (1-10)."""
        score = 10

        # Penalize high complexity
        avg_complexity = sum(func.get("complexity", 1) for func in visitor.functions) / max(len(visitor.functions), 1)
        if avg_complexity > 10:
            score -= 3
        elif avg_complexity > 5:
            score -= 1

        # Penalize lack of docstrings
        functions_with_docs = sum(1 for func in visitor.functions if func.get("docstring"))
        classes_with_docs = sum(1 for cls in visitor.classes if cls.get("docstring"))
        total_items = len(visitor.functions) + len(visitor.classes)

        if total_items > 0:
            doc_ratio = (functions_with_docs + classes_with_docs) / total_items
            if doc_ratio < 0.3:
                score -= 2
            elif doc_ratio < 0.6:
                score -= 1

        return max(1, min(10, score))

    def find_project_root(self, file_path: str | Path) -> Path | None:
        """Find project root from a file path."""
        file_path = Path(file_path).resolve()

        # Look for common project indicators
        indicators = [
            "pyproject.toml",
            "package.json",
            "Cargo.toml",
            "go.mod",
            ".git",
            "setup.py",
            "requirements.txt",
        ]

        current = file_path.parent if file_path.is_file() else file_path

        while current != current.parent:
            for indicator in indicators:
                if (current / indicator).exists():
                    return current
            current = current.parent

        return None
