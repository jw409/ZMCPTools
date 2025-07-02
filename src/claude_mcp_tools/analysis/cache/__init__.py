"""Advanced caching system for AgentTreeGraph integration.

This module implements sophisticated caching strategies based on Foundation Session
patterns to achieve 85-90% token cost reduction for code analysis operations.

Key Components:
- CacheManager: Multi-level caching with SQLite persistence
- DeterministicPromptTemplates: Optimized prompt templates for cache hits  
- FoundationSessionCache: Session-based context caching
- FileAnalysisCache: File-based caching with .treesummary integration
- CacheInvalidationStrategy: Sophisticated invalidation with dependency tracking

Usage Example:
    ```python
    # Initialize cache system
    cache_manager = CacheManager("/path/to/cache")
    await cache_manager.initialize()
    
    # Create foundation session for maximum cache reuse
    session_id = await cache_manager.create_foundation_session(
        project_path="/path/to/project",
        base_context={"project_name": "MyProject", ...}
    )
    
    # Use deterministic prompts for analysis
    prompt, template_id = DeterministicPromptTemplates.get_python_analysis_prompt(
        file_content=content, 
        file_path=path
    )
    
    # Check cache before analysis
    cached_result = await cache_manager.get_cached_analysis(
        file_path=path,
        content=content, 
        template_id=template_id,
        session_id=session_id
    )
    
    if not cached_result:
        # Perform analysis and cache result
        result = await analyze_file(prompt)
        await cache_manager.cache_analysis_result(
            file_path=path,
            content=content,
            template_id=template_id, 
            analysis_result=result,
            session_id=session_id
        )
    ```

Token Savings:
- Foundation Session: 85-90% token cost reduction
- File Content Caching: Avoids re-analysis of unchanged files
- Deterministic Prompts: Maximum LLM cache utilization
- Incremental Updates: Real-time .treesummary maintenance
"""

from .file_cache import FileAnalysisCache
from .invalidation import CacheInvalidationStrategy, InvalidationScope, InvalidationTrigger
from .manager import CacheEntry, CacheManager, FoundationSession
from .prompt_templates import DeterministicPromptTemplates

__all__ = [
    "CacheEntry",
    "CacheInvalidationStrategy",
    "CacheManager",
    "DeterministicPromptTemplates",
    "FileAnalysisCache",
    "FoundationSession",
    "InvalidationScope",
    "InvalidationTrigger",
]
