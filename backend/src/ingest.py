"""
ingest.py — RAG Ingestion Script for Bol AI
============================================
Vectorizes local project folders into pgvector for RAG retrieval.

Usage:
    cd backend
    UV_CACHE_DIR=/tmp/uv-cache uv run python ingest.py [--folder ../projects]

Prerequisites:
    1. pgvector extension enabled in Postgres (deploy_dev.sh does this automatically)
    2. Ollama running with mxbai-embed-large pulled:
       ollama pull mxbai-embed-large
"""

import os
import sys
import argparse
import logging
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

DATABASE_URL    = os.environ["DATABASE_URL"]
OLLAMA_BASE_URL = os.environ["OLLAMA_BASE_URL"]

# File types to ingest
SUPPORTED_EXTENSIONS = {".py", ".ts", ".tsx", ".js", ".jsx", ".md", ".txt", ".json", ".yaml", ".yml"}

# Folders/files to skip
SKIP_DIRS = {"node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build", ".next"}


def collect_files(root: Path) -> list[Path]:
    files = []
    for path in root.rglob("*"):
        if path.is_file() and path.suffix in SUPPORTED_EXTENSIONS:
            if not any(skip in path.parts for skip in SKIP_DIRS):
                files.append(path)
    return sorted(files)


def ingest(folder: str = "../projects"):
    root = Path(folder).resolve()
    if not root.exists():
        logger.error(f"Folder not found: {root}")
        logger.info("Create a './projects' folder with your code files, then re-run.")
        sys.exit(1)

    logger.info(f"Scanning: {root}")
    files = collect_files(root)
    logger.info(f"Found {len(files)} files to ingest")

    if not files:
        logger.warning("No supported files found. Nothing to ingest.")
        return

    # Lazy imports (only needed at ingest time)
    from langchain_community.document_loaders import TextLoader
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    from langchain_ollama import OllamaEmbeddings
    from langchain_postgres import PGVector

    # Load documents
    docs = []
    for f in files:
        try:
            loader = TextLoader(str(f), encoding="utf-8", autodetect_encoding=True)
            loaded = loader.load()
            for doc in loaded:
                doc.metadata["source"] = str(f.relative_to(root.parent))
            docs.extend(loaded)
            logger.info(f"  Loaded: {f.name} ({len(loaded)} chunks)")
        except Exception as e:
            logger.warning(f"  Skipped {f.name}: {e}")

    logger.info(f"Total documents loaded: {len(docs)}")

    # Split into chunks
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
        separators=["\n\n", "\n", " ", ""],
    )
    chunks = splitter.split_documents(docs)
    logger.info(f"Total chunks after splitting: {len(chunks)}")

    # Embed and store
    logger.info("Initialising OllamaEmbeddings (mxbai-embed-large)...")
    embeddings = OllamaEmbeddings(
        model="mxbai-embed-large",
        base_url=OLLAMA_BASE_URL,
    )

    logger.info("Storing in pgvector (collection: bol_ai_docs)...")
    PGVector.from_documents(
        documents=chunks,
        embedding=embeddings,
        collection_name="bol_ai_docs",
        connection=DATABASE_URL,
        pre_delete_collection=True,   # Fresh re-ingest each run
    )

    logger.info(f"✅ Ingestion complete — {len(chunks)} chunks stored in pgvector.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest project files into pgvector for RAG")
    parser.add_argument(
        "--folder",
        default="../projects",
        help="Path to the folder to ingest (default: ../projects)",
    )
    args = parser.parse_args()
    ingest(args.folder)
