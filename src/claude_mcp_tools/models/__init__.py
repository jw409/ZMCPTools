"""SQLAlchemy ORM models for Claude MCP Tools."""

import enum

from sqlalchemy.ext.asyncio import AsyncAttrs
from sqlalchemy.orm import DeclarativeBase

# Database engine and session setup
engine = None
AsyncSessionLocal = None

class Base(AsyncAttrs, DeclarativeBase):
    """Base class for all ORM models."""

# Status enums
class AgentStatus(enum.StrEnum):
    ACTIVE = "active"
    IDLE = "idle"
    COMPLETED = "completed"
    TERMINATED = "terminated"

class TaskStatus(enum.StrEnum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"

class SourceType(enum.StrEnum):
    API = "api"
    GUIDE = "guide"
    REFERENCE = "reference"
    TUTORIAL = "tutorial"

class UpdateFrequency(enum.StrEnum):
    HOURLY = "hourly"
    DAILY = "daily"
    WEEKLY = "weekly"

class SectionType(enum.StrEnum):
    CONTENT = "content"
    CODE = "code"
    EXAMPLE = "example"
    API = "api"

# Import all models to make them available
from .agent import AgentCapability, AgentSession
from .analysis import (
    AnalysisCache,
    AnalysisSession,
    DeadCodeFinding,
    FileAnalysis,
    FileWatcher,
    SymbolDependency,
)
from .communication import ChatMessage, ChatRoom, RoomMembership
from .documentation import (
    CodeDocumentationLink,
    DocumentationChange,
    DocumentationEmbedding,
    DocumentationEntry,
    DocumentationSource,
    ScrapedUrl,
)
from .error_logging import ErrorLog, ErrorPattern, LearningEntry
from .shared_memory import AgentInsight, Memory, SharedMemoryEntry, ToolCallLog
from .task import Task, TaskDependency

__all__ = [
    "AgentCapability",
    "AgentInsight",
    "AgentSession",
    "AgentStatus",
    "AnalysisCache",
    "AnalysisSession",
    "Base",
    "ChatMessage",
    "ChatRoom",
    "CodeDocumentationLink",
    "DeadCodeFinding",
    "DocumentationChange",
    "DocumentationEmbedding",
    "DocumentationEntry",
    "DocumentationSource",
    "ErrorLog",
    "ErrorPattern",
    "FileAnalysis",
    "FileWatcher",
    "LearningEntry",
    "Memory",
    "RoomMembership",
    "ScrapedUrl",
    "SectionType",
    "SharedMemoryEntry",
    "SourceType",
    "SymbolDependency",
    "Task",
    "TaskDependency",
    "TaskStatus",
    "ToolCallLog",
    "UpdateFrequency",
]
