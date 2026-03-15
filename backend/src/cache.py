import logging
import os
from typing import Optional, Tuple
from sqlalchemy.orm import Session
from pgvector.sqlalchemy import Vector
from langchain_openai import OpenAIEmbeddings
from .models import SemanticCache
from .database import SessionLocal

logger = logging.getLogger(__name__)



class SemanticCacheManager:
    def __init__(self, threshold: float = 0.95):
        self.threshold = threshold
        self.embeddings = OpenAIEmbeddings(
            model="openrouter/embedding", 
            openai_api_key=os.environ.get("OPENROUTER_API_KEY"),
            openai_api_base="https://openrouter.hconeai.com/api/v1",
            default_headers={
                "Helicone-Auth": f"Bearer {os.environ.get('HELICONE_API_KEY')}"
            }
        )

    def get_cached_response(self, query: str, model: str) -> Optional[str]:
        """
        Check if a semantically similar query exists in the cache.
        Returns the response if found and similarity > threshold, else None.
        """
        try:
            query_embedding = self.embeddings.embed_query(query)
            
            with SessionLocal() as db:
                # Use cosine distance (1 - cosine similarity)
                # pgvector <=> operator is cosine distance
                # distance < (1 - threshold) means similarity > threshold
                result = db.query(SemanticCache).filter(
                    SemanticCache.model == model,
                    SemanticCache.embedding.cosine_distance(query_embedding) < (1 - self.threshold)
                ).order_by(SemanticCache.embedding.cosine_distance(query_embedding)).first()

                if result:
                    logger.info(f"[SemanticCache] Hit! Query: '{query[:50]}...' matched cached: '{result.query[:50]}...'")
                    return result.response
                
                return None
        except Exception as e:
            logger.error(f"[SemanticCache] Error during lookup: {e}")
            return None

    def set_cached_response(self, query: str, response: str, model: str):
        """Store a new query and its response in the semantic cache."""
        try:
            query_embedding = self.embeddings.embed_query(query)
            
            with SessionLocal() as db:
                new_cache = SemanticCache(
                    query=query,
                    embedding=query_embedding,
                    response=response,
                    model=model
                )
                db.add(new_cache)
                db.commit()
                logger.info(f"[SemanticCache] Saved new entry for query: '{query[:50]}...'")
        except Exception as e:
            logger.error(f"[SemanticCache] Error during save: {e}")

# Global instance
semantic_cache = SemanticCacheManager()
