"""Vector embedding service for semantic search using ChromaDB and sentence-transformers."""

import uuid
from pathlib import Path
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import execute_query
from ..models import DocumentationEmbedding, DocumentationEntry

logger = structlog.get_logger()

try:
    import chromadb
    from sentence_transformers import SentenceTransformer
    VECTOR_DEPS_AVAILABLE = True
except ImportError:
    VECTOR_DEPS_AVAILABLE = False
    logger.warning("ChromaDB and/or sentence-transformers not available - vector search disabled")


class VectorService:
    """Service for vector embeddings and semantic search."""

    def __init__(self, vector_db_path: Path):
        """Initialize vector service.
        
        Args:
            vector_db_path: Path to vector database directory
        """
        self.vector_db_path = vector_db_path
        self.vector_db_path.mkdir(parents=True, exist_ok=True)

        self._chroma_client = None
        self._collection = None
        self._embedding_model = None
        self._model_name = "sentence-transformers/all-MiniLM-L6-v2"

    async def initialize(self) -> None:
        """Initialize ChromaDB client and embedding model."""
        if not VECTOR_DEPS_AVAILABLE:
            logger.warning("Vector dependencies not available - skipping initialization")
            return

        try:
            # Initialize ChromaDB client
            self._chroma_client = chromadb.PersistentClient(
                path=str(self.vector_db_path),
            )

            # Get or create collection
            self._collection = self._chroma_client.get_or_create_collection(
                name="documentation_embeddings",
                metadata={"description": "Documentation content embeddings"},
            )

            # Initialize embedding model
            self._embedding_model = SentenceTransformer(self._model_name)

            logger.info("Vector service initialized",
                       db_path=str(self.vector_db_path),
                       model=self._model_name)

        except Exception as e:
            logger.error("Failed to initialize vector service", error=str(e))
            raise

    async def create_embeddings_for_entry(self, entry_id: str) -> dict[str, Any]:
        """Create embeddings for a documentation entry.
        
        Args:
            entry_id: Documentation entry ID
            
        Returns:
            Result with embedding statistics
        """
        if not self._is_available():
            return {"success": False, "error": "Vector service not available"}

        async def _create_embeddings(session: AsyncSession):
            # Get the entry
            stmt = select(DocumentationEntry).where(DocumentationEntry.id == entry_id)
            result = await session.execute(stmt)
            entry = result.scalar_one_or_none()

            if not entry:
                return {"success": False, "error": f"Entry {entry_id} not found"}

            # Split content into chunks
            chunks = self._split_text_into_chunks(entry.content)

            embeddings_created = 0

            for i, chunk in enumerate(chunks):
                try:
                    # Generate embedding
                    embedding = self._embedding_model.encode(chunk).tolist()

                    # Store in database
                    embedding_id = str(uuid.uuid4())
                    embedding_record = DocumentationEmbedding(
                        id=embedding_id,
                        entry_id=entry_id,
                        chunk_index=i,
                        chunk_text=chunk,
                    )
                    embedding_record.set_embedding(embedding)

                    session.add(embedding_record)

                    # Store in ChromaDB
                    self._collection.add(
                        embeddings=[embedding],
                        documents=[chunk],
                        ids=[embedding_id],
                        metadatas=[{
                            "entry_id": entry_id,
                            "chunk_index": i,
                            "title": entry.title,
                            "url": entry.url,
                            "source_id": entry.source_id,
                        }],
                    )

                    embeddings_created += 1

                except Exception as e:
                    logger.error("Failed to create embedding for chunk",
                                entry_id=entry_id, chunk_index=i, error=str(e))

            await session.commit()

            return {
                "success": True,
                "entry_id": entry_id,
                "chunks_processed": len(chunks),
                "embeddings_created": embeddings_created,
            }

        return await execute_query(_create_embeddings)

    async def search_similar_content(
        self,
        query: str,
        source_ids: list[str] | None = None,
        limit: int = 10,
        similarity_threshold: float = 0.5,
    ) -> list[dict[str, Any]]:
        """Search for similar content using vector similarity.
        
        Args:
            query: Search query
            source_ids: Filter by source IDs
            limit: Maximum number of results
            similarity_threshold: Minimum similarity score
            
        Returns:
            List of similar content with similarity scores
        """
        if not self._is_available():
            return []

        try:
            # Generate query embedding
            query_embedding = self._embedding_model.encode(query).tolist()

            # Build where clause for filtering
            where_clause = {}
            if source_ids:
                where_clause["source_id"] = {"$in": source_ids}

            # Search in ChromaDB
            results = self._collection.query(
                query_embeddings=[query_embedding],
                n_results=limit,
                where=where_clause if where_clause else None,
            )

            # Format results
            similar_content = []
            if results and results["documents"]:
                for i, (doc, metadata, distance) in enumerate(zip(
                    results["documents"][0],
                    results["metadatas"][0],
                    results["distances"][0], strict=False,
                )):
                    # Convert distance to similarity score (ChromaDB uses cosine distance)
                    similarity = 1.0 - distance

                    if similarity >= similarity_threshold:
                        similar_content.append({
                            "content": doc,
                            "similarity_score": similarity,
                            "entry_id": metadata["entry_id"],
                            "title": metadata["title"],
                            "url": metadata["url"],
                            "source_id": metadata["source_id"],
                            "chunk_index": metadata["chunk_index"],
                        })

            return similar_content

        except Exception as e:
            logger.error("Vector search failed", query=query, error=str(e))
            return []

    async def update_embeddings_for_entry(self, entry_id: str) -> dict[str, Any]:
        """Update embeddings for a modified documentation entry.
        
        Args:
            entry_id: Documentation entry ID
            
        Returns:
            Result with update statistics
        """
        if not self._is_available():
            return {"success": False, "error": "Vector service not available"}

        # Delete existing embeddings
        await self.delete_embeddings_for_entry(entry_id)

        # Create new embeddings
        return await self.create_embeddings_for_entry(entry_id)

    async def delete_embeddings_for_entry(self, entry_id: str) -> dict[str, Any]:
        """Delete embeddings for a documentation entry.
        
        Args:
            entry_id: Documentation entry ID
            
        Returns:
            Result with deletion statistics
        """
        if not self._is_available():
            return {"success": False, "error": "Vector service not available"}

        async def _delete_embeddings(session: AsyncSession):
            # Get embedding IDs from database
            stmt = select(DocumentationEmbedding.id).where(
                DocumentationEmbedding.entry_id == entry_id,
            )
            result = await session.execute(stmt)
            embedding_ids = [row[0] for row in result.fetchall()]

            if not embedding_ids:
                return {"success": True, "embeddings_deleted": 0}

            # Delete from ChromaDB
            try:
                self._collection.delete(ids=embedding_ids)
            except Exception as e:
                logger.warning("Failed to delete from ChromaDB", error=str(e))

            # Delete from database
            from sqlalchemy import delete as sql_delete
            delete_stmt = sql_delete(DocumentationEmbedding).where(
                DocumentationEmbedding.entry_id == entry_id,
            )
            await session.execute(delete_stmt)
            await session.commit()

            return {
                "success": True,
                "embeddings_deleted": len(embedding_ids),
            }

        return await execute_query(_delete_embeddings)

    async def get_embedding_stats(self) -> dict[str, Any]:
        """Get statistics about embeddings.
        
        Returns:
            Statistics about embeddings
        """
        async def _get_stats(session: AsyncSession):
            from sqlalchemy import func

            # Count total embeddings
            count_stmt = select(func.count(DocumentationEmbedding.id))
            result = await session.execute(count_stmt)
            total_embeddings = result.scalar() or 0

            # Count unique entries with embeddings
            unique_entries_stmt = select(func.count(func.distinct(DocumentationEmbedding.entry_id)))
            result = await session.execute(unique_entries_stmt)
            unique_entries = result.scalar() or 0

            # ChromaDB collection stats
            chroma_count = 0
            if self._collection:
                try:
                    chroma_count = self._collection.count()
                except Exception:
                    pass

            return {
                "total_embeddings": total_embeddings,
                "unique_entries_with_embeddings": unique_entries,
                "chromadb_collection_count": chroma_count,
                "embedding_model": self._model_name,
                "vector_service_available": self._is_available(),
            }

        return await execute_query(_get_stats)

    def _is_available(self) -> bool:
        """Check if vector service is available."""
        return (VECTOR_DEPS_AVAILABLE and
                self._chroma_client is not None and
                self._collection is not None and
                self._embedding_model is not None)

    def _split_text_into_chunks(self, text: str, chunk_size: int = 512, overlap: int = 50) -> list[str]:
        """Split text into overlapping chunks for embedding.
        
        Args:
            text: Text to split
            chunk_size: Maximum chunk size in characters
            overlap: Overlap between chunks
            
        Returns:
            List of text chunks
        """
        if len(text) <= chunk_size:
            return [text]

        chunks = []
        start = 0

        while start < len(text):
            end = start + chunk_size

            # If this is not the last chunk, try to end at a sentence boundary
            if end < len(text):
                # Look for sentence endings within the last 100 characters
                search_start = max(end - 100, start)
                sentence_end = -1

                for i in range(end - 1, search_start - 1, -1):
                    if text[i] in ".!?":
                        sentence_end = i + 1
                        break

                if sentence_end > start:
                    end = sentence_end

            chunk = text[start:end].strip()
            if chunk:
                chunks.append(chunk)

            # Move start position with overlap
            start = max(start + 1, end - overlap)

            # Prevent infinite loop
            if start >= len(text):
                break

        return chunks


# Global vector service instance
_vector_service = None


async def get_vector_service(vector_db_path: Path | None = None) -> VectorService:
    """Get the global vector service instance.
    
    Args:
        vector_db_path: Path to vector database directory
        
    Returns:
        Vector service instance
    """
    global _vector_service

    if _vector_service is None:
        if vector_db_path is None:
            vector_db_path = Path.home() / ".claude-orchestration" / "documentation" / "vectors"

        _vector_service = VectorService(vector_db_path)
        await _vector_service.initialize()

    return _vector_service
