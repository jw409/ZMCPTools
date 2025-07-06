"""Documentation intelligence models."""

import json
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from . import Base, SectionType, SourceType, UpdateFrequency


class DocumentationSource(Base):
    """Enhanced documentation sources for comprehensive web scraping."""

    __tablename__ = "documentation_sources"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    url: Mapped[str] = mapped_column(String, nullable=False)
    source_type: Mapped[SourceType] = mapped_column(default=SourceType.GUIDE)
    crawl_depth: Mapped[int] = mapped_column(Integer, default=3)
    update_frequency: Mapped[UpdateFrequency] = mapped_column(default=UpdateFrequency.DAILY)
    selectors: Mapped[str | None] = mapped_column(Text)  # JSON object for CSS selectors
    allow_patterns: Mapped[str | None] = mapped_column(Text)  # JSON array of URL patterns to include (allowlist)
    ignore_patterns: Mapped[str | None] = mapped_column(Text)  # JSON array of URL patterns to exclude (blocklist)
    last_scraped: Mapped[datetime | None] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String, default="active")  # active, paused, error
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())
    source_metadata: Mapped[str | None] = mapped_column(Text)  # JSON

    # Relationships
    entries: Mapped[list["DocumentationEntry"]] = relationship("DocumentationEntry", back_populates="source")

    def get_selectors(self) -> dict:
        """Get selectors as a dictionary."""
        if not self.selectors:
            return {}
        try:
            return json.loads(self.selectors)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_selectors(self, selectors: dict) -> None:
        """Set selectors from a dictionary."""
        self.selectors = json.dumps(selectors) if selectors else None

    def get_allow_patterns(self) -> list[str]:
        """Get allow patterns as a list."""
        if not self.allow_patterns:
            return []
        try:
            return json.loads(self.allow_patterns)
        except (json.JSONDecodeError, TypeError):
            return []

    def set_allow_patterns(self, patterns: list[str]) -> None:
        """Set allow patterns from a list."""
        self.allow_patterns = json.dumps(patterns) if patterns else None

    def get_ignore_patterns(self) -> list[str]:
        """Get ignore patterns as a list."""
        if not self.ignore_patterns:
            return []
        try:
            return json.loads(self.ignore_patterns)
        except (json.JSONDecodeError, TypeError):
            return []

    def set_ignore_patterns(self, patterns: list[str]) -> None:
        """Set ignore patterns from a list."""
        self.ignore_patterns = json.dumps(patterns) if patterns else None

    def get_metadata(self) -> dict:
        """Get metadata as a dictionary."""
        if not self.source_metadata:
            return {}
        try:
            return json.loads(self.source_metadata)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_metadata(self, data: dict) -> None:
        """Set metadata from a dictionary."""
        self.source_metadata = json.dumps(data) if data else None


class DocumentationEntry(Base):
    """Enhanced scraped and indexed documentation content."""

    __tablename__ = "documentation_entries"
    __table_args__ = (UniqueConstraint("content_hash"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)
    source_id: Mapped[str] = mapped_column(String, ForeignKey("documentation_sources.id"), nullable=False)
    url: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String, nullable=False)
    extracted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    last_updated: Mapped[datetime | None] = mapped_column(DateTime)
    section_type: Mapped[SectionType] = mapped_column(default=SectionType.CONTENT)
    entry_metadata: Mapped[str | None] = mapped_column(Text)  # JSON
    links: Mapped[str | None] = mapped_column(Text)  # JSON array
    code_examples: Mapped[str | None] = mapped_column(Text)  # JSON array

    # Relationships
    source: Mapped["DocumentationSource"] = relationship("DocumentationSource", back_populates="entries")
    embeddings: Mapped[list["DocumentationEmbedding"]] = relationship("DocumentationEmbedding", back_populates="entry")
    code_links: Mapped[list["CodeDocumentationLink"]] = relationship("CodeDocumentationLink", back_populates="documentation_entry")
    changes: Mapped[list["DocumentationChange"]] = relationship("DocumentationChange", back_populates="entry")

    def get_metadata(self) -> dict:
        """Get metadata as a dictionary."""
        if not self.entry_metadata:
            return {}
        try:
            return json.loads(self.entry_metadata)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_metadata(self, data: dict) -> None:
        """Set metadata from a dictionary."""
        self.entry_metadata = json.dumps(data) if data else None

    def get_links(self) -> list[str]:
        """Get links as a list."""
        if not self.links:
            return []
        try:
            return json.loads(self.links)
        except (json.JSONDecodeError, TypeError):
            return []

    def set_links(self, links: list[str]) -> None:
        """Set links from a list."""
        self.links = json.dumps(links) if links else None

    def get_code_examples(self) -> list[dict]:
        """Get code examples as a list."""
        if not self.code_examples:
            return []
        try:
            return json.loads(self.code_examples)
        except (json.JSONDecodeError, TypeError):
            return []

    def set_code_examples(self, examples: list[dict]) -> None:
        """Set code examples from a list."""
        self.code_examples = json.dumps(examples) if examples else None


class DocumentationEmbedding(Base):
    """Vector embeddings for semantic search."""

    __tablename__ = "documentation_embeddings"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    entry_id: Mapped[str] = mapped_column(String, ForeignKey("documentation_entries.id"), nullable=False)
    embedding: Mapped[str] = mapped_column(Text, nullable=False)  # JSON array of vector values
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())

    # Relationships
    entry: Mapped["DocumentationEntry"] = relationship("DocumentationEntry", back_populates="embeddings")

    def get_embedding(self) -> list[float]:
        """Get embedding as a list of floats."""
        if not self.embedding:
            return []
        try:
            return json.loads(self.embedding)
        except (json.JSONDecodeError, TypeError):
            return []

    def set_embedding(self, embedding: list[float]) -> None:
        """Set embedding from a list of floats."""
        self.embedding = json.dumps(embedding)


class CodeDocumentationLink(Base):
    """Code-to-documentation linkages."""

    __tablename__ = "code_documentation_links"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    line_number: Mapped[int] = mapped_column(Integer, nullable=False)
    symbol_name: Mapped[str] = mapped_column(String, nullable=False)
    symbol_type: Mapped[str] = mapped_column(String, nullable=False)  # function, class, method, variable
    documentation_entry_id: Mapped[str] = mapped_column(String, ForeignKey("documentation_entries.id"), nullable=False)
    relevance_score: Mapped[float | None] = mapped_column(Float)
    confidence: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())

    # Relationships
    documentation_entry: Mapped["DocumentationEntry"] = relationship("DocumentationEntry", back_populates="code_links")


class DocumentationChange(Base):
    """Documentation change tracking."""

    __tablename__ = "documentation_changes"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    entry_id: Mapped[str] = mapped_column(String, ForeignKey("documentation_entries.id"), nullable=False)
    change_type: Mapped[str] = mapped_column(String, nullable=False)  # created, updated, deleted, moved
    old_content_hash: Mapped[str | None] = mapped_column(String)
    new_content_hash: Mapped[str | None] = mapped_column(String)
    impact_level: Mapped[str] = mapped_column(String, default="minor")  # minor, major, breaking
    description: Mapped[str | None] = mapped_column(Text)
    detected_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())

    # Relationships
    entry: Mapped["DocumentationEntry"] = relationship("DocumentationEntry", back_populates="changes")


class ScrapedUrl(Base):
    """Cached scraped URLs with normalized URLs to prevent duplicate scraping."""

    __tablename__ = "scraped_urls"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    normalized_url: Mapped[str] = mapped_column(String, nullable=False, index=True)
    original_url: Mapped[str] = mapped_column(String, nullable=False)
    source_id: Mapped[str] = mapped_column(String, ForeignKey("documentation_sources.id"), nullable=False)
    content_hash: Mapped[str | None] = mapped_column(String)  # Hash of scraped content for change detection
    last_scraped: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    scrape_count: Mapped[int] = mapped_column(Integer, default=1)
    last_status_code: Mapped[int | None] = mapped_column(Integer)  # HTTP status code
    last_error: Mapped[str | None] = mapped_column(Text)  # Last error message if any
    skip_until: Mapped[datetime | None] = mapped_column(DateTime)  # Skip scraping until this time (for rate limiting)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

    # Relationships
    source: Mapped["DocumentationSource"] = relationship("DocumentationSource")

    # Unique constraint to prevent duplicate normalized URLs per source
    __table_args__ = (UniqueConstraint('normalized_url', 'source_id', name='_normalized_url_source_uc'),)

    @staticmethod
    def normalize_url(url: str) -> str:
        """Normalize URL by removing query parameters, fragments, and session-specific parts."""
        import urllib.parse as urlparse
        
        parsed = urlparse.urlparse(url)
        
        # Remove fragment (everything after #)
        # Remove query parameters (everything after ?)
        normalized = urlparse.urlunparse((
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            '',  # Remove params
            '',  # Remove query
            ''   # Remove fragment
        ))
        
        # Remove trailing slash for consistency (except for root)
        if len(normalized) > 1 and normalized.endswith('/'):
            normalized = normalized.rstrip('/')
            
        return normalized.lower()

    def should_rescrape(self, force_refresh: bool = False, min_age_hours: int = 24) -> bool:
        """Check if this URL should be rescraped based on age and other factors."""
        if force_refresh:
            return True
            
        if self.skip_until and self.skip_until > datetime.now():
            return False
            
        # Check if it's been long enough since last scrape
        if self.last_scraped:
            from datetime import timedelta
            age = datetime.now() - self.last_scraped
            return age > timedelta(hours=min_age_hours)
            
        return True
