"""Enhanced file handling MCP server for Claude Code."""

import difflib
import fnmatch
import os
import platform
import subprocess
from pathlib import Path

import pyscreenshot as ImageGrab
from fastmcp import FastMCP

app = FastMCP("Claude MCP Tools")


def load_ignore_patterns(directory: str) -> list[str]:
    """Load ignore patterns from .claudeignore and .gitignore files."""
    patterns = []

    # Load .claudeignore first (takes precedence)
    claudeignore_path = Path(directory) / ".claudeignore"
    if claudeignore_path.exists():
        with open(claudeignore_path) as f:
            patterns.extend([
                line.strip() for line in f
                if line.strip() and not line.startswith("#")
            ])

    # Load .gitignore as fallback
    gitignore_path = Path(directory) / ".gitignore"
    if gitignore_path.exists():
        with open(gitignore_path) as f:
            patterns.extend([
                line.strip() for line in f
                if line.strip() and not line.startswith("#")
            ])

    # Add default patterns if no ignore files exist
    if not patterns:
        patterns = [
            "node_modules/",
            ".git/",
            "__pycache__/",
            "*.pyc",
            ".venv/",
            "venv/",
            ".DS_Store",
            "*.log",
        ]

    return patterns


def should_ignore(file_path: str, patterns: list[str], base_dir: str = ".") -> bool:
    """Check if a file should be ignored based on patterns."""
    relative_path = os.path.relpath(file_path, base_dir)

    for pattern in patterns:
        # Handle directory patterns
        if pattern.endswith("/"):
            if relative_path.startswith(pattern[:-1]) or fnmatch.fnmatch(relative_path + "/", pattern):
                return True
        # Handle file patterns
        elif fnmatch.fnmatch(relative_path, pattern) or fnmatch.fnmatch(os.path.basename(relative_path), pattern):
            return True

    return False


def _list_files_impl(directory: str = ".", show_hidden: bool = True, max_depth: int = 3) -> str:
    """List files and directories, respecting .claudeignore and optionally showing hidden files."""
    try:
        # Use current working directory as base for relative paths
        if not os.path.isabs(directory):
            directory = os.path.join(os.getcwd(), directory)
        directory = os.path.abspath(directory)
        ignore_patterns = load_ignore_patterns(directory)

        result = []
        result.append(f"📁 {directory}")

        if ignore_patterns:
            result.append(f"🚫 Ignoring patterns: {', '.join(ignore_patterns)}")

        result.append("")

        def scan_directory(path: str, current_depth: int = 0, prefix: str = ""):
            if current_depth > max_depth:
                return

            try:
                items = sorted(os.listdir(path))

                for item in items:
                    item_path = os.path.join(path, item)

                    # Skip hidden files unless explicitly requested
                    if not show_hidden and item.startswith("."):
                        continue

                    # Check ignore patterns
                    if should_ignore(item_path, ignore_patterns, directory):
                        continue

                    is_dir = os.path.isdir(item_path)
                    icon = "📁" if is_dir else "📄"

                    result.append(f"{prefix}{icon} {item}")

                    # Recursively scan subdirectories
                    if is_dir and current_depth < max_depth:
                        scan_directory(item_path, current_depth + 1, prefix + "  ")

            except PermissionError:
                result.append(f"{prefix}❌ Permission denied")

        scan_directory(directory)
        return "\n".join(result)

    except Exception as e:
        return f"Error listing files: {e!s}"


@app.tool(
    name="list_files",
    description="List files and directories in a structured tree format, respecting .claudeignore patterns. Useful for exploring project structure and understanding file organization.",
    tags={"filesystem", "exploration", "tree"},
)
def list_files(directory: str = ".", show_hidden: bool = True, max_depth: int = 3) -> str:
    """List files and directories, respecting .claudeignore and optionally showing hidden files."""
    return _list_files_impl(directory, show_hidden, max_depth)


def _create_claudeignore_impl(directory: str = ".", patterns: list[str] | None = None) -> str:
    """Create a .claudeignore file with common ignore patterns."""
    try:
        if patterns is None:
            patterns = [
                "# Claude ignore patterns",
                "# Dependencies",
                "node_modules/",
                ".venv/",
                "venv/",
                "__pycache__/",
                "",
                "# Build outputs",
                "dist/",
                "build/",
                "*.egg-info/",
                "",
                "# Logs and temporary files",
                "*.log",
                "*.tmp",
                ".DS_Store",
                "",
                "# Version control",
                ".git/",
                "",
                "# IDE and editor files",
                ".vscode/",
                ".idea/",
                "*.swp",
                "*.swo",
            ]

        # Use current working directory as base for relative paths
        if not os.path.isabs(directory):
            directory = os.path.join(os.getcwd(), directory)
        directory = os.path.abspath(directory)
        claudeignore_path = Path(directory) / ".claudeignore"

        with open(claudeignore_path, "w") as f:
            f.write("\n".join(patterns))

        return f"✅ Created .claudeignore with {len([p for p in patterns if not p.startswith('#') and p.strip()])} patterns"

    except Exception as e:
        return f"Error creating .claudeignore: {e!s}"


@app.tool(
    name="create_claudeignore",
    description="Create a .claudeignore file with predefined patterns to exclude files from Claude operations. Essential for managing large codebases efficiently.",
    tags={"filesystem", "configuration", "ignore"},
)
def create_claudeignore(directory: str = ".", patterns: list[str] | None = None) -> str:
    """Create a .claudeignore file with common ignore patterns."""
    return _create_claudeignore_impl(directory, patterns)


def _find_files_impl(pattern: str, directory: str = ".", include_hidden: bool = True) -> str:
    """Find files matching a pattern, respecting ignore files and optionally including hidden files."""
    try:
        # Use current working directory as base for relative paths
        if not os.path.isabs(directory):
            directory = os.path.join(os.getcwd(), directory)
        directory = os.path.abspath(directory)
        ignore_patterns = load_ignore_patterns(directory)

        matches = []

        for root, dirs, files in os.walk(directory):
            # Filter directories based on ignore patterns and hidden status
            dirs[:] = [
                d for d in dirs
                if not should_ignore(os.path.join(root, d), ignore_patterns, directory)
                and (include_hidden or not d.startswith("."))
            ]

            # Filter files
            for file in files:
                file_path = os.path.join(root, file)

                # Skip hidden files unless requested
                if not include_hidden and file.startswith("."):
                    continue

                # Check ignore patterns
                if should_ignore(file_path, ignore_patterns, directory):
                    continue

                # Check if file matches pattern
                if fnmatch.fnmatch(file, pattern) or fnmatch.fnmatch(file_path, pattern):
                    relative_path = os.path.relpath(file_path, directory)
                    matches.append(relative_path)

        if matches:
            result = f"🔍 Found {len(matches)} files matching '{pattern}':\n"
            result += "\n".join(f"📄 {match}" for match in sorted(matches))
            return result
        return f"🔍 No files found matching '{pattern}'"

    except Exception as e:
        return f"Error finding files: {e!s}"


@app.tool(
    name="find_files",
    description="Search for files matching glob patterns (e.g., '*.py', '**/*.js'). Perfect for locating specific file types or names across the project.",
    tags={"filesystem", "search", "pattern-matching"},
)
def find_files(pattern: str, directory: str = ".", include_hidden: bool = True) -> str:
    """Find files matching a pattern, respecting ignore files and optionally including hidden files."""
    return _find_files_impl(pattern, directory, include_hidden)


def normalize_whitespace(text: str) -> str:
    """Normalize whitespace for fuzzy matching while preserving structure."""
    # Replace multiple whitespace chars with single space, but preserve line structure
    lines = text.split("\n")
    normalized_lines = []
    for line in lines:
        # Strip leading/trailing whitespace but preserve indentation structure
        stripped = line.strip()
        if stripped:
            # Count leading whitespace in original
            leading_ws = len(line) - len(line.lstrip())
            normalized_lines.append(" " * min(leading_ws, 4) + stripped)
        else:
            normalized_lines.append("")
    return "\n".join(normalized_lines)


def find_best_match(search_text: str, content: str, similarity_threshold: float = 0.8) -> tuple[int, int, float] | None:
    """Find the best matching substring in content using fuzzy matching."""
    search_normalized = normalize_whitespace(search_text.strip())
    lines = content.split("\n")

    best_match = None
    best_ratio = 0.0

    # Try different window sizes around the expected length
    search_lines = len(search_normalized.split("\n"))

    for start_line in range(len(lines)):
        for window_size in range(max(1, search_lines - 2), min(len(lines) - start_line + 1, search_lines + 3)):
            end_line = start_line + window_size
            if end_line > len(lines):
                break

            window_content = "\n".join(lines[start_line:end_line])
            window_normalized = normalize_whitespace(window_content)

            ratio = difflib.SequenceMatcher(None, search_normalized, window_normalized).ratio()

            if ratio > best_ratio and ratio >= similarity_threshold:
                best_ratio = ratio
                best_match = (start_line, end_line, ratio)

    return best_match


def _easy_replace_impl(file_path: str, search_text: str, replace_text: str, similarity_threshold: float = 0.8, preview: bool = False) -> str:
    """Smart string replacement with fuzzy matching to handle whitespace differences."""
    try:
        file_path = os.path.abspath(file_path)

        if not os.path.exists(file_path):
            return f"❌ File not found: {file_path}"

        with open(file_path, encoding="utf-8") as f:
            content = f.read()

        # Find the best match
        match = find_best_match(search_text, content, similarity_threshold)

        if not match:
            return f"❌ No suitable match found for the search text (similarity < {similarity_threshold})"

        start_line, end_line, ratio = match
        lines = content.split("\n")

        # Get the matched content
        matched_content = "\n".join(lines[start_line:end_line])

        if preview:
            return f"🔍 Preview (similarity: {ratio:.2f}):\n" \
                   f"📍 Lines {start_line + 1}-{end_line}:\n" \
                   f"OLD:\n{matched_content}\n\n" \
                   f"NEW:\n{replace_text}"

        # Perform the replacement
        new_lines = lines[:start_line] + [replace_text] + lines[end_line:]
        new_content = "\n".join(new_lines)

        with open(file_path, "w", encoding="utf-8") as f:
            f.write(new_content)

        # Trigger analysis hook for .treesummary update
        try:
            import asyncio

            from .analysis.hooks.integration import trigger_file_analysis_hook
            asyncio.create_task(trigger_file_analysis_hook(file_path, "modified"))
        except Exception:
            pass  # Don't fail the file operation if analysis hook fails

        return f"✅ Replaced content in {file_path} (lines {start_line + 1}-{end_line}, similarity: {ratio:.2f})"

    except Exception as e:
        return f"❌ Error in easy_replace: {e!s}"


@app.tool(
    name="easy_replace",
    description="Intelligent text replacement with fuzzy matching to handle formatting differences. Use when exact string matching fails due to whitespace or indentation variations.",
    tags={"editing", "replace", "fuzzy-matching", "text-manipulation"},
)
def easy_replace(file_path: str, search_text: str, replace_text: str, similarity_threshold: float = 0.8, preview: bool = False) -> str:
    """Smart string replacement with fuzzy matching to handle whitespace differences."""
    return _easy_replace_impl(file_path, search_text, replace_text, similarity_threshold, preview)


def _easy_replace_all_impl(replacements: list[dict[str, str]], file_patterns: list[str] | None = None, dry_run: bool = False) -> str:
    """Perform multiple replacements across files with rollback capability."""
    try:
        if file_patterns is None:
            file_patterns = ["*"]

        # Find all matching files
        all_files = []
        for pattern in file_patterns:
            if os.path.isabs(pattern):
                if os.path.exists(pattern):
                    all_files.append(pattern)
            else:
                # Use existing find_files logic
                for root, dirs, files in os.walk("."):
                    for file in files:
                        file_path = os.path.join(root, file)
                        if fnmatch.fnmatch(file, pattern) or fnmatch.fnmatch(file_path, pattern):
                            all_files.append(os.path.abspath(file_path))

        if not all_files:
            return "❌ No files found matching the patterns"

        results = []
        changes_made = []

        for file_path in all_files:
            if not os.path.exists(file_path):
                continue

            try:
                with open(file_path, encoding="utf-8") as f:
                    original_content = f.read()

                current_content = original_content
                file_changes = []

                for i, replacement in enumerate(replacements):
                    if "search" not in replacement or "replace" not in replacement:
                        results.append(f"❌ {file_path}: Invalid replacement #{i+1} (missing 'search' or 'replace')")
                        continue

                    search_text = replacement["search"]
                    replace_text = replacement["replace"]
                    similarity_threshold = float(replacement.get("similarity_threshold", 0.8))

                    match = find_best_match(search_text, current_content, similarity_threshold)

                    if match:
                        start_line, end_line, ratio = match
                        lines = current_content.split("\n")
                        matched_content = "\n".join(lines[start_line:end_line])

                        new_lines = lines[:start_line] + [replace_text] + lines[end_line:]
                        current_content = "\n".join(new_lines)

                        file_changes.append({
                            "replacement_index": i,
                            "matched_content": matched_content,
                            "start_line": start_line,
                            "end_line": end_line,
                            "ratio": ratio,
                        })

                if file_changes:
                    if not dry_run:
                        with open(file_path, "w", encoding="utf-8") as f:
                            f.write(current_content)
                        changes_made.append((file_path, original_content))

                        # Trigger analysis hook for .treesummary update
                        try:
                            import asyncio

                            from .analysis.hooks.integration import trigger_file_analysis_hook
                            asyncio.create_task(trigger_file_analysis_hook(file_path, "modified"))
                        except Exception:
                            pass  # Don't fail the file operation if analysis hook fails

                    results.append(f"✅ {file_path}: {len(file_changes)} replacements {'(DRY RUN)' if dry_run else ''}")
                    for change in file_changes:
                        results.append(f"   - Replacement #{change['replacement_index']+1} at lines {change['start_line']+1}-{change['end_line']} (similarity: {change['ratio']:.2f})")
                else:
                    results.append(f"⚠️  {file_path}: No matches found")

            except Exception as e:
                results.append(f"❌ {file_path}: {e!s}")
                # Rollback on error
                for rollback_file, rollback_content in changes_made:
                    try:
                        with open(rollback_file, "w", encoding="utf-8") as f:
                            f.write(rollback_content)
                    except:
                        pass
                return f"❌ Operation failed and rolled back. Error: {e!s}\n" + "\n".join(results)

        summary = f"📊 Processed {len(all_files)} files, {len(changes_made)} files modified {'(DRY RUN)' if dry_run else ''}"
        return summary + "\n\n" + "\n".join(results)

    except Exception as e:
        return f"❌ Error in easy_replace_all: {e!s}"


@app.tool(
    name="easy_replace_all",
    description="Perform multiple text replacements across multiple files with automatic rollback on errors. Ideal for refactoring operations across codebases.",
    tags={"editing", "batch-operations", "refactoring", "rollback"},
)
def easy_replace_all(replacements: list[dict[str, str]], file_patterns: list[str] | None = None, dry_run: bool = False) -> str:
    """Perform multiple replacements across files with rollback capability."""
    return _easy_replace_all_impl(replacements, file_patterns, dry_run)


def _take_screenshot_impl(output_path: str = "screenshot.png", region: list[int] | None = None, monitor: int = 0, format: str = "png") -> str:
    """Take a screenshot of the screen or a specific region."""
    try:
        output_path = os.path.abspath(output_path)

        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        # Platform-specific screenshot methods
        system = platform.system().lower()

        if system == "linux":
            # Try native Linux screenshot tools first
            screenshot_taken = False

            # Try scrot
            if not screenshot_taken:
                try:
                    cmd = ["scrot"]
                    if region:
                        cmd.extend(["-s", f"{region[2]}x{region[3]}+{region[0]}+{region[1]}"])
                    cmd.append(output_path)
                    subprocess.run(cmd, check=True, capture_output=True)
                    screenshot_taken = True
                except (subprocess.CalledProcessError, FileNotFoundError):
                    pass

            # Try gnome-screenshot
            if not screenshot_taken:
                try:
                    cmd = ["gnome-screenshot", "-f", output_path]
                    if region:
                        cmd.extend(["-a"])  # Area selection
                    subprocess.run(cmd, check=True, capture_output=True)
                    screenshot_taken = True
                except (subprocess.CalledProcessError, FileNotFoundError):
                    pass

            # Fallback to Python method
            if not screenshot_taken:
                if region:
                    bbox = (region[0], region[1], region[0] + region[2], region[1] + region[3])
                    img = ImageGrab.grab(bbox=bbox)
                else:
                    img = ImageGrab.grab()
                img.save(output_path, format.upper())
                screenshot_taken = True

        elif system == "darwin":  # macOS
            try:
                cmd = ["screencapture"]
                if region:
                    cmd.extend(["-R", f"{region[0]},{region[1]},{region[2]},{region[3]}"])
                cmd.append(output_path)
                subprocess.run(cmd, check=True, capture_output=True)
            except subprocess.CalledProcessError:
                # Fallback to Python method
                if region:
                    bbox = (region[0], region[1], region[0] + region[2], region[1] + region[3])
                    img = ImageGrab.grab(bbox=bbox)
                else:
                    img = ImageGrab.grab()
                img.save(output_path, format.upper())

        elif system == "windows":
            # Use Python method for Windows (most reliable)
            if region:
                bbox = (region[0], region[1], region[0] + region[2], region[1] + region[3])
                img = ImageGrab.grab(bbox=bbox)
            else:
                img = ImageGrab.grab()
            img.save(output_path, format.upper())

        else:
            # Unknown system, try Python method
            if region:
                bbox = (region[0], region[1], region[0] + region[2], region[1] + region[3])
                img = ImageGrab.grab(bbox=bbox)
            else:
                img = ImageGrab.grab()
            img.save(output_path, format.upper())

        if os.path.exists(output_path):
            file_size = os.path.getsize(output_path)
            return f"📸 Screenshot saved to {output_path} ({file_size} bytes)"
        return "❌ Screenshot failed - file not created"

    except Exception as e:
        return f"❌ Error taking screenshot: {e!s}"


@app.tool(
    name="take_screenshot",
    description="Capture screenshots of the entire screen or specific regions. Cross-platform support for debugging visual issues or documenting UI states.",
    tags={"screenshot", "debugging", "visual", "documentation"},
)
def take_screenshot(output_path: str = "screenshot.png", region: list[int] | None = None, monitor: int = 0, format: str = "png") -> str:
    """Take a screenshot of the screen or a specific region."""
    return _take_screenshot_impl(output_path, region, monitor, format)


def main():
    """Main entry point for the MCP server."""
    app.run()


if __name__ == "__main__":
    main()
