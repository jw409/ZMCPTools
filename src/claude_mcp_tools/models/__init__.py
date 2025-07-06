"""SQLAlchemy ORM models for Claude MCP Tools."""

import enum
from typing import TypeVar, Type

from sqlalchemy.ext.asyncio import AsyncAttrs
from sqlalchemy.orm import DeclarativeBase

# Database engine and session setup
engine = None
AsyncSessionLocal = None

class Base(AsyncAttrs, DeclarativeBase):
    """Base class for all ORM models."""

# Type variable for enum self-reference
T = TypeVar('T', bound='CaseInsensitiveStrEnum')

class CaseInsensitiveStrEnum(enum.StrEnum):
    """Base class for case-insensitive string enums."""
    
    @classmethod
    def from_string(cls: Type[T], value: str) -> T:
        """Get enum value from string with case-insensitive matching.
        
        Args:
            value: String value to match (case-insensitive)
            
        Returns:
            Matching enum value
            
        Raises:
            ValueError: If no matching enum value found
        """
        if not value:
            raise ValueError(f"Empty value cannot be converted to {cls.__name__}")
            
        # Try exact match first
        try:
            return cls(value)
        except ValueError:
            pass
            
        # Try case-insensitive match
        value_lower = value.lower()
        for enum_val in cls:
            if enum_val.value.lower() == value_lower:
                return enum_val
                
        # If still no match, try with underscores/spaces normalized
        value_normalized = value.lower().replace(' ', '_').replace('-', '_')
        for enum_val in cls:
            enum_normalized = enum_val.value.lower().replace(' ', '_').replace('-', '_')
            if enum_normalized == value_normalized:
                return enum_val
                
        # No match found
        valid_values = [enum_val.value for enum_val in cls]
        raise ValueError(f"'{value}' is not a valid {cls.__name__}. Valid values: {valid_values}")
    
    @classmethod
    def normalize(cls: Type[T], value: str | T) -> T:
        """Normalize a value to the correct enum format.
        
        Args:
            value: String or enum value to normalize
            
        Returns:
            Normalized enum value
        """
        if isinstance(value, cls):
            return value
        return cls.from_string(value)

# Status enums
class AgentStatus(CaseInsensitiveStrEnum):
    ACTIVE = "active"
    IDLE = "idle"
    COMPLETED = "completed"
    TERMINATED = "terminated"

class TaskStatus(CaseInsensitiveStrEnum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"

class SourceType(CaseInsensitiveStrEnum):
    API = "API"
    GUIDE = "GUIDE"
    REFERENCE = "REFERENCE"
    TUTORIAL = "TUTORIAL"

class UpdateFrequency(CaseInsensitiveStrEnum):
    HOURLY = "HOURLY"
    DAILY = "DAILY"
    WEEKLY = "WEEKLY"

class DocumentationStatus(CaseInsensitiveStrEnum):
    NOT_STARTED = "NOT_STARTED"      # Never been scraped
    IN_PROGRESS = "IN_PROGRESS"      # Currently scraping
    COMPLETED = "COMPLETED"          # Successfully scraped
    FAILED = "FAILED"               # Scraping failed
    PAUSED = "PAUSED"               # Manually paused
    STALE = "STALE"                 # Needs re-scraping

class ScrapeJobStatus(CaseInsensitiveStrEnum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"

class SectionType(CaseInsensitiveStrEnum):
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
    ScrapeJob,
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
    "CaseInsensitiveStrEnum",
    "ChatMessage",
    "ChatRoom",
    "CodeDocumentationLink",
    "DeadCodeFinding",
    "DocumentationChange",
    "DocumentationEmbedding",
    "DocumentationEntry",
    "DocumentationSource",
    "DocumentationStatus",
    "ErrorLog",
    "ErrorPattern",
    "FileAnalysis",
    "FileWatcher",
    "LearningEntry",
    "Memory",
    "RoomMembership",
    "ScrapeJob",
    "ScrapeJobStatus",
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
