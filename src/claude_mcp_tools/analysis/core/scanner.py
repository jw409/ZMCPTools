"""Project Scanner for recursive directory traversal with ignore pattern support.

Adapted from AgentTreeGraph for ClaudeMcpTools integration.
"""

import mimetypes
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger()


@dataclass
class FileInfo:
    """Information about a scanned file."""

    path: Path
    relative_path: Path
    size_bytes: int
    modified_time: datetime
    language: str | None = None
    encoding: str | None = None
    mime_type: str | None = None
    is_binary: bool = False
    lines_of_code: int | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        """Post-initialization to set computed fields."""
        if self.mime_type is None:
            self.mime_type, _ = mimetypes.guess_type(str(self.path))

        if self.language is None:
            self.language = self._detect_language()

        if self.is_binary is False:
            self.is_binary = self._is_binary_file()

    def _detect_language(self) -> str | None:
        """Detect programming language from file extension."""
        suffix = self.path.suffix.lower()

        language_map = {
            ".py": "python",
            ".js": "javascript",
            ".jsx": "javascript",
            ".ts": "typescript",
            ".tsx": "typescript",
            ".java": "java",
            ".kt": "kotlin",
            ".c": "c",
            ".cpp": "cpp",
            ".cc": "cpp",
            ".cxx": "cpp",
            ".h": "c",
            ".hpp": "cpp",
            ".cs": "csharp",
            ".go": "go",
            ".rs": "rust",
            ".rb": "ruby",
            ".php": "php",
            ".swift": "swift",
            ".scala": "scala",
            ".r": "r",
            ".m": "objective-c",
            ".mm": "objective-c",
            ".sh": "bash",
            ".bash": "bash",
            ".zsh": "zsh",
            ".fish": "fish",
            ".ps1": "powershell",
            ".sql": "sql",
            ".html": "html",
            ".htm": "html",
            ".xml": "xml",
            ".css": "css",
            ".scss": "scss",
            ".sass": "sass",
            ".less": "less",
            ".json": "json",
            ".yaml": "yaml",
            ".yml": "yaml",
            ".toml": "toml",
            ".ini": "ini",
            ".cfg": "ini",
            ".conf": "config",
            ".md": "markdown",
            ".rst": "restructuredtext",
            ".tex": "latex",
            ".dockerfile": "dockerfile",
            ".gitignore": "gitignore",
            ".claudeignore": "claudeignore",
            ".treeignore": "treeignore",
        }

        return language_map.get(suffix)

    def _is_binary_file(self) -> bool:
        """Check if file is binary."""
        if self.mime_type:
            # Common text MIME types
            text_types = [
                "text/",
                "application/json",
                "application/xml",
                "application/javascript",
                "application/x-yaml",
                "application/toml",
            ]
            return not any(self.mime_type.startswith(t) for t in text_types)

        # Fallback: try to read a small chunk
        try:
            with open(self.path, "rb") as f:
                chunk = f.read(1024)
                return b"\0" in chunk
        except OSError:
            return True


class IgnorePatterns:
    """Handle ignore patterns from various ignore files."""

    def __init__(self, project_root: Path):
        self.project_root = project_root
        self.patterns = self._load_patterns()

    def _load_patterns(self) -> list[str]:
        """Load ignore patterns from .treeignore, .claudeignore, and .gitignore."""
        patterns = []

        # Default patterns
        default_patterns = [
            ".git/",
            "__pycache__/",
            "*.pyc",
            ".venv/",
            "venv/",
            "node_modules/",
            ".DS_Store",
            "*.log",
            ".treesummary/",
        ]
        patterns.extend(default_patterns)

        # Load from ignore files in order of precedence
        ignore_files = [".treeignore", ".claudeignore", ".gitignore"]

        for ignore_file in ignore_files:
            ignore_path = self.project_root / ignore_file
            if ignore_path.exists():
                try:
                    with ignore_path.open("r") as f:
                        file_patterns = [
                            line.strip() for line in f
                            if line.strip() and not line.startswith("#")
                        ]
                        patterns.extend(file_patterns)
                        logger.debug(f"Loaded {len(file_patterns)} patterns from {ignore_file}")
                except OSError as e:
                    logger.warning(f"Could not read {ignore_file}: {e}")

        return patterns

    def should_ignore(self, file_path: Path) -> bool:
        """Check if file should be ignored based on patterns."""
        try:
            relative_path = file_path.relative_to(self.project_root)
        except ValueError:
            # File is outside project root
            return True

        relative_str = str(relative_path)

        for pattern in self.patterns:
            # Directory patterns
            if pattern.endswith("/"):
                if relative_str.startswith(pattern[:-1] + "/") or relative_str == pattern[:-1]:
                    return True
            # File patterns with wildcards
            elif "*" in pattern:
                import fnmatch
                if fnmatch.fnmatch(relative_str, pattern) or fnmatch.fnmatch(file_path.name, pattern):
                    return True
            # Exact matches
            elif relative_str == pattern or file_path.name == pattern:
                return True

        return False


class ProjectScanner:
    """Scanner for project files with ignore pattern support."""

    def __init__(self, project_path: str | Path):
        self.project_path = Path(project_path).resolve()
        self.ignore_patterns = IgnorePatterns(self.project_path)

    async def scan_project(self, max_workers: int = 4) -> list[FileInfo]:
        """Scan project directory for files."""
        logger.info(f"Scanning project: {self.project_path}")

        if not self.project_path.exists():
            raise FileNotFoundError(f"Project path does not exist: {self.project_path}")

        if not self.project_path.is_dir():
            raise NotADirectoryError(f"Project path is not a directory: {self.project_path}")

        files = []

        def scan_file(file_path: Path) -> FileInfo | None:
            """Scan a single file and return FileInfo."""
            try:
                if self.ignore_patterns.should_ignore(file_path):
                    return None

                if not file_path.is_file():
                    return None

                stat = file_path.stat()
                relative_path = file_path.relative_to(self.project_path)

                file_info = FileInfo(
                    path=file_path,
                    relative_path=relative_path,
                    size_bytes=stat.st_size,
                    modified_time=datetime.fromtimestamp(stat.st_mtime),
                )

                # Count lines for text files
                if not file_info.is_binary and file_info.size_bytes > 0:
                    try:
                        with file_path.open("r", encoding="utf-8", errors="ignore") as f:
                            file_info.lines_of_code = sum(1 for _ in f)
                    except OSError:
                        pass

                return file_info

            except OSError as e:
                logger.warning(f"Could not scan file {file_path}: {e}")
                return None

        # Collect all files first
        all_files = []
        for root, dirs, filenames in os.walk(self.project_path):
            root_path = Path(root)

            # Filter directories
            dirs[:] = [
                d for d in dirs
                if not self.ignore_patterns.should_ignore(root_path / d)
            ]

            for filename in filenames:
                file_path = root_path / filename
                all_files.append(file_path)

        # Process files in parallel
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_file = {
                executor.submit(scan_file, file_path): file_path
                for file_path in all_files
            }

            for future in as_completed(future_to_file):
                file_info = future.result()
                if file_info:
                    files.append(file_info)

        logger.info(f"Scanned {len(files)} files in {self.project_path}")
        return files

    def should_analyze_file(self, file_path: str | Path) -> bool:
        """Check if file should be analyzed."""
        file_path = Path(file_path)

        if self.ignore_patterns.should_ignore(file_path):
            return False

        # Only analyze text files
        file_info = FileInfo(
            path=file_path,
            relative_path=file_path.relative_to(self.project_path) if file_path.is_relative_to(self.project_path) else file_path,
            size_bytes=0,
            modified_time=datetime.now(),
        )

        if file_info.is_binary:
            return False

        # Only analyze files with recognized languages
        if not file_info.language:
            return False

        # Skip very large files (>1MB)
        try:
            if file_path.stat().st_size > 1024 * 1024:
                return False
        except OSError:
            return False

        return True

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
