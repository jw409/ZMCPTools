"""AgentTreeGraph analysis tracking models."""

import json
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from . import Base


class AnalysisSession(Base):
    """Project analysis sessions."""

    __tablename__ = "analysis_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    project_path: Mapped[str] = mapped_column(String, nullable=False)
    session_type: Mapped[str] = mapped_column(String, default="full_analysis")  # full_analysis, incremental, dead_code, summary
    status: Mapped[str] = mapped_column(String, default="pending")  # pending, in_progress, completed, failed
    assigned_agent_id: Mapped[str | None] = mapped_column(String, ForeignKey("agent_sessions.id"))
    started_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    files_analyzed: Mapped[int] = mapped_column(Integer, default=0)
    files_total: Mapped[int] = mapped_column(Integer, default=0)
    languages_detected: Mapped[str | None] = mapped_column(Text)  # JSON array
    treesummary_path: Mapped[str | None] = mapped_column(String)
    watching_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    analysis_metadata: Mapped[str | None] = mapped_column(Text)  # JSON

    # Relationships
    assigned_agent: Mapped["AgentSession | None"] = relationship("AgentSession")
    file_analyses: Mapped[list["FileAnalysis"]] = relationship("FileAnalysis", back_populates="analysis_session")
    dead_code_findings: Mapped[list["DeadCodeFinding"]] = relationship("DeadCodeFinding", back_populates="analysis_session")
    symbol_dependencies: Mapped[list["SymbolDependency"]] = relationship("SymbolDependency", back_populates="analysis_session")

    def get_languages_detected(self) -> list[str]:
        """Get detected languages as a list."""
        if not self.languages_detected:
            return []
        try:
            return json.loads(self.languages_detected)
        except (json.JSONDecodeError, TypeError):
            return []

    def set_languages_detected(self, languages: list[str]) -> None:
        """Set detected languages from a list."""
        self.languages_detected = json.dumps(languages) if languages else None

    def get_metadata(self) -> dict:
        """Get metadata as a dictionary."""
        if not self.analysis_metadata:
            return {}
        try:
            return json.loads(self.analysis_metadata)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_metadata(self, data: dict) -> None:
        """Set metadata from a dictionary."""
        self.analysis_metadata = json.dumps(data) if data else None


class FileAnalysis(Base):
    """File analysis results tracking."""

    __tablename__ = "file_analyses"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    analysis_session_id: Mapped[str | None] = mapped_column(String, ForeignKey("analysis_sessions.id"))
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    relative_path: Mapped[str | None] = mapped_column(String)
    language: Mapped[str | None] = mapped_column(String)
    file_size: Mapped[int | None] = mapped_column(Integer)
    line_count: Mapped[int | None] = mapped_column(Integer)
    complexity_score: Mapped[int | None] = mapped_column(Integer)
    maintainability_score: Mapped[int | None] = mapped_column(Integer)
    symbols_extracted: Mapped[int] = mapped_column(Integer, default=0)
    analysis_timestamp: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    content_hash: Mapped[str | None] = mapped_column(String)
    analysis_data: Mapped[str | None] = mapped_column(Text)  # JSON of complete analysis results
    error_message: Mapped[str | None] = mapped_column(Text)

    # Relationships
    analysis_session: Mapped["AnalysisSession | None"] = relationship("AnalysisSession", back_populates="file_analyses")

    def get_analysis_data(self) -> dict:
        """Get analysis data as a dictionary."""
        if not self.analysis_data:
            return {}
        try:
            return json.loads(self.analysis_data)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_analysis_data(self, data: dict) -> None:
        """Set analysis data from a dictionary."""
        self.analysis_data = json.dumps(data) if data else None


class FileWatcher(Base):
    """File watching status."""

    __tablename__ = "file_watchers"

    project_path: Mapped[str] = mapped_column(String, primary_key=True)
    status: Mapped[str] = mapped_column(String, default="active")  # active, stopped, error
    started_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    last_event_at: Mapped[datetime | None] = mapped_column(DateTime)
    files_watched: Mapped[int] = mapped_column(Integer, default=0)
    events_processed: Mapped[int] = mapped_column(Integer, default=0)
    error_count: Mapped[int] = mapped_column(Integer, default=0)
    configuration: Mapped[str | None] = mapped_column(Text)  # JSON

    def get_configuration(self) -> dict:
        """Get configuration as a dictionary."""
        if not self.configuration:
            return {}
        try:
            return json.loads(self.configuration)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_configuration(self, config: dict) -> None:
        """Set configuration from a dictionary."""
        self.configuration = json.dumps(config) if config else None


class AnalysisCache(Base):
    """Analysis cache for performance optimization."""

    __tablename__ = "analysis_cache"

    cache_key: Mapped[str] = mapped_column(String, primary_key=True)
    content_hash: Mapped[str] = mapped_column(String, nullable=False)
    language: Mapped[str | None] = mapped_column(String)
    analysis_result: Mapped[str | None] = mapped_column(Text)  # JSON of cached analysis
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    last_accessed: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    access_count: Mapped[int] = mapped_column(Integer, default=1)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime)

    def get_analysis_result(self) -> dict:
        """Get analysis result as a dictionary."""
        if not self.analysis_result:
            return {}
        try:
            return json.loads(self.analysis_result)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_analysis_result(self, result: dict) -> None:
        """Set analysis result from a dictionary."""
        self.analysis_result = json.dumps(result) if result else None


class DeadCodeFinding(Base):
    """Dead code detection results."""

    __tablename__ = "dead_code_findings"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    analysis_session_id: Mapped[str | None] = mapped_column(String, ForeignKey("analysis_sessions.id"))
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    finding_type: Mapped[str] = mapped_column(String, nullable=False)  # unused_file, unused_function, unused_class, unused_import
    symbol_name: Mapped[str | None] = mapped_column(String)
    line_number: Mapped[int | None] = mapped_column(Integer)
    confidence_score: Mapped[float | None] = mapped_column(Float)
    impact_level: Mapped[str] = mapped_column(String, default="low")  # low, medium, high
    reason: Mapped[str | None] = mapped_column(Text)
    recommendation: Mapped[str | None] = mapped_column(Text)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    false_positive: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())

    # Relationships
    analysis_session: Mapped["AnalysisSession | None"] = relationship("AnalysisSession", back_populates="dead_code_findings")


class SymbolDependency(Base):
    """Symbol dependency tracking."""

    __tablename__ = "symbol_dependencies"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    source_file: Mapped[str] = mapped_column(String, nullable=False)
    source_symbol: Mapped[str] = mapped_column(String, nullable=False)
    target_file: Mapped[str] = mapped_column(String, nullable=False)
    target_symbol: Mapped[str | None] = mapped_column(String)
    dependency_type: Mapped[str] = mapped_column(String, nullable=False)  # import, call, inheritance, reference
    line_number: Mapped[int | None] = mapped_column(Integer)
    analysis_session_id: Mapped[str | None] = mapped_column(String, ForeignKey("analysis_sessions.id"))
    confidence_score: Mapped[float] = mapped_column(Float, default=1.0)

    # Relationships
    analysis_session: Mapped["AnalysisSession | None"] = relationship("AnalysisSession", back_populates="symbol_dependencies")
