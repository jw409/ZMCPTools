"""AgentTreeGraph analysis module for ClaudeMcpTools.

This module integrates AgentTreeGraph's code analysis capabilities into the
ClaudeMcpTools orchestration system, providing real-time project analysis,
symbol extraction, and .treesummary generation.
"""

__version__ = "1.0.0"
__author__ = "ClaudeMcpTools with AgentTreeGraph Integration"

from .core.treesummary import TreeSummaryManager
from .hooks.filesystem import TreeSummaryHook
from .parsers.file_analyzer import FileAnalyzer

__all__ = [
    "FileAnalyzer",
    "TreeSummaryHook",
    "TreeSummaryManager",
]
