#!/usr/bin/env python3
# Copyright (c) 2026 BillChen
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
Experience Memory MCP Server

A lightweight MCP server for storing and retrieving valuable experiences.
Uses Ollama (qwen3-embedding:0.6b) for semantic search and SQLite for storage.

Core Philosophy:
- Not remembering everything, but remembering "valuable experiences"
- Not passive retrieval, but "proactive reminder to query first"

Usage:
    python -m app.mcp.experience_memory_mcp
"""

import json
import sys
import os
import sqlite3
import asyncio
import logging
from datetime import datetime
from typing import Optional
from dataclasses import dataclass, asdict

import httpx

# Add project root to path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, PROJECT_ROOT)

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "qwen3-embedding:0.6b")
EMBEDDING_DIM = 1024  # qwen3-embedding dimension
DB_PATH = os.path.expanduser(os.getenv("EXPERIENCE_DB_PATH", "~/.jarvis/experiences.db"))

# Valid experience types
VALID_TYPES = ("pitfall", "pattern", "preference", "insight")


# =============================================================================
# Data Model
# =============================================================================

@dataclass
class Experience:
    id: int
    type: str
    title: str
    content: str
    tags: list[str]
    project: Optional[str]
    created_at: float
    updated_at: float
    access_count: int

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "type": self.type,
            "title": self.title,
            "content": self.content,
            "tags": self.tags,
            "project": self.project,
            "created_at": datetime.fromtimestamp(self.created_at).isoformat(),
            "updated_at": datetime.fromtimestamp(self.updated_at).isoformat(),
            "access_count": self.access_count
        }


# =============================================================================
# Embedding Service (Ollama)
# =============================================================================

class EmbeddingService:
    """Ollama-based embedding service using qwen3-embedding:0.6b"""

    def __init__(self, base_url: str = OLLAMA_URL, model: str = EMBEDDING_MODEL):
        self.base_url = base_url
        self.model = model
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    async def embed(self, text: str) -> list[float]:
        """Generate embedding for text using Ollama"""
        client = await self._get_client()
        try:
            response = await client.post(
                f"{self.base_url}/api/embeddings",
                json={"model": self.model, "prompt": text}
            )
            response.raise_for_status()
            return response.json()["embedding"]
        except httpx.HTTPError as e:
            logger.error(f"Embedding request failed: {e}")
            raise RuntimeError(f"Failed to generate embedding: {e}")

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None


# =============================================================================
# Storage Service (SQLite + sqlite-vec)
# =============================================================================

class ExperienceStorage:
    """SQLite-based storage with vector search capability"""

    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self.conn: Optional[sqlite3.Connection] = None
        self._vec_available = False

    def _ensure_dir(self):
        """Ensure database directory exists"""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)

    def initialize(self):
        """Initialize database and tables"""
        self._ensure_dir()
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row

        # Try to load sqlite-vec extension
        try:
            import sqlite_vec
            self.conn.enable_load_extension(True)
            sqlite_vec.load(self.conn)
            self._vec_available = True
            logger.info("sqlite-vec extension loaded successfully")
        except ImportError:
            logger.warning("sqlite-vec not available, falling back to basic search")
            self._vec_available = False
        except Exception as e:
            logger.warning(f"Failed to load sqlite-vec: {e}, falling back to basic search")
            self._vec_available = False

        # Create main table
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS experiences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL CHECK(type IN ('pitfall', 'pattern', 'preference', 'insight')),
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                tags TEXT DEFAULT '[]',
                project TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                access_count INTEGER DEFAULT 0
            )
        """)

        # Create indexes
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_type ON experiences(type)")
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_project ON experiences(project)")

        # Create vector table if sqlite-vec is available
        if self._vec_available:
            try:
                self.conn.execute(f"""
                    CREATE VIRTUAL TABLE IF NOT EXISTS experience_embeddings USING vec0(
                        experience_id INTEGER PRIMARY KEY,
                        embedding float[{EMBEDDING_DIM}] distance_metric=cosine
                    )
                """)
                logger.info("Vector table created successfully")
            except Exception as e:
                logger.warning(f"Failed to create vector table: {e}")
                self._vec_available = False

        # Create FTS5 table for keyword search (hybrid search)
        self._fts_available = False
        try:
            self.conn.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS experience_fts USING fts5(
                    title,
                    content,
                    tags,
                    content='experiences',
                    content_rowid='id',
                    tokenize='unicode61'
                )
            """)
            # Create triggers to keep FTS in sync
            self.conn.execute("""
                CREATE TRIGGER IF NOT EXISTS experience_ai AFTER INSERT ON experiences BEGIN
                    INSERT INTO experience_fts(rowid, title, content, tags)
                    VALUES (new.id, new.title, new.content, new.tags);
                END
            """)
            self.conn.execute("""
                CREATE TRIGGER IF NOT EXISTS experience_ad AFTER DELETE ON experiences BEGIN
                    INSERT INTO experience_fts(experience_fts, rowid, title, content, tags)
                    VALUES ('delete', old.id, old.title, old.content, old.tags);
                END
            """)
            self.conn.execute("""
                CREATE TRIGGER IF NOT EXISTS experience_au AFTER UPDATE ON experiences BEGIN
                    INSERT INTO experience_fts(experience_fts, rowid, title, content, tags)
                    VALUES ('delete', old.id, old.title, old.content, old.tags);
                    INSERT INTO experience_fts(rowid, title, content, tags)
                    VALUES (new.id, new.title, new.content, new.tags);
                END
            """)
            self._fts_available = True
            logger.info("FTS5 table created successfully")

            # Migrate existing data to FTS
            self._migrate_to_fts()
        except Exception as e:
            logger.warning(f"Failed to create FTS table: {e}")
            self._fts_available = False

        self.conn.commit()

    def store(self, exp_type: str, title: str, content: str,
              tags: list[str], project: Optional[str],
              embedding: Optional[list[float]] = None) -> int:
        """Store a new experience"""
        now = datetime.now().timestamp()

        cursor = self.conn.execute("""
            INSERT INTO experiences (type, title, content, tags, project, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (exp_type, title, content, json.dumps(tags), project, now, now))

        exp_id = cursor.lastrowid

        # Store embedding if available
        if self._vec_available and embedding:
            try:
                import sqlite_vec
                self.conn.execute(
                    "INSERT INTO experience_embeddings (experience_id, embedding) VALUES (?, ?)",
                    (exp_id, sqlite_vec.serialize_float32(embedding))
                )
            except Exception as e:
                logger.warning(f"Failed to store embedding: {e}")

        self.conn.commit()
        return exp_id

    def search_similar(self, embedding: list[float],
                       exp_type: Optional[str] = None,
                       project: Optional[str] = None,
                       limit: int = 5,
                       query: str = None) -> list[Experience]:
        """Search for similar experiences using hybrid search (vector + FTS)"""

        # Use hybrid search if both vector and FTS are available
        if self._vec_available and self._fts_available and query:
            try:
                return self._hybrid_search(embedding, query, exp_type, project, limit)
            except Exception as e:
                logger.warning(f"Hybrid search failed: {e}, falling back to vector search")

        # Fall back to vector-only search
        if self._vec_available:
            try:
                return self._vector_search(embedding, exp_type, project, limit)
            except Exception as e:
                logger.warning(f"Vector search failed: {e}, falling back to basic search")

        # Fallback to basic search (return recent experiences)
        return self.list_experiences(exp_type, project, limit)

    def _vector_search(self, embedding: list[float],
                       exp_type: Optional[str] = None,
                       project: Optional[str] = None,
                       limit: int = 5) -> list[Experience]:
        """Perform vector similarity search"""
        import sqlite_vec

        # Build query with filters
        query = """
            SELECT e.*, vec.distance
            FROM experience_embeddings vec
            JOIN experiences e ON e.id = vec.experience_id
            WHERE vec.embedding MATCH ?
              AND k = ?
        """
        params = [sqlite_vec.serialize_float32(embedding), limit * 2]  # Get more for filtering

        rows = self.conn.execute(query, params).fetchall()

        # Apply filters in Python (sqlite-vec doesn't support complex WHERE with MATCH)
        results = []
        for row in rows:
            if exp_type and row["type"] != exp_type:
                continue
            if project and row["project"] != project:
                continue

            exp = self._row_to_experience(row)
            results.append(exp)

            # Update access count
            self.conn.execute(
                "UPDATE experiences SET access_count = access_count + 1 WHERE id = ?",
                (exp.id,)
            )

            if len(results) >= limit:
                break

        self.conn.commit()
        return results

    def list_experiences(self, exp_type: Optional[str] = None,
                         project: Optional[str] = None,
                         limit: int = 20) -> list[Experience]:
        """List experiences with optional filters"""
        query = "SELECT * FROM experiences WHERE 1=1"
        params = []

        if exp_type:
            query += " AND type = ?"
            params.append(exp_type)

        if project:
            query += " AND project = ?"
            params.append(project)

        query += " ORDER BY updated_at DESC LIMIT ?"
        params.append(limit)

        rows = self.conn.execute(query, params).fetchall()
        return [self._row_to_experience(row) for row in rows]

    def get_by_id(self, exp_id: int) -> Optional[Experience]:
        """Get experience by ID"""
        row = self.conn.execute(
            "SELECT * FROM experiences WHERE id = ?", (exp_id,)
        ).fetchone()
        return self._row_to_experience(row) if row else None

    def update(self, exp_id: int, title: Optional[str] = None,
               content: Optional[str] = None, tags: Optional[list[str]] = None,
               embedding: Optional[list[float]] = None) -> bool:
        """Update an experience"""
        updates = []
        params = []

        if title:
            updates.append("title = ?")
            params.append(title)
        if content:
            updates.append("content = ?")
            params.append(content)
        if tags is not None:
            updates.append("tags = ?")
            params.append(json.dumps(tags))

        if not updates:
            return False

        updates.append("updated_at = ?")
        params.append(datetime.now().timestamp())
        params.append(exp_id)

        self.conn.execute(
            f"UPDATE experiences SET {', '.join(updates)} WHERE id = ?",
            params
        )

        # Update embedding if provided
        if self._vec_available and embedding:
            try:
                import sqlite_vec
                self.conn.execute(
                    "UPDATE experience_embeddings SET embedding = ? WHERE experience_id = ?",
                    (sqlite_vec.serialize_float32(embedding), exp_id)
                )
            except Exception as e:
                logger.warning(f"Failed to update embedding: {e}")

        self.conn.commit()
        return True

    def delete(self, exp_id: int) -> bool:
        """Delete an experience"""
        cursor = self.conn.execute("DELETE FROM experiences WHERE id = ?", (exp_id,))

        if self._vec_available:
            try:
                self.conn.execute(
                    "DELETE FROM experience_embeddings WHERE experience_id = ?",
                    (exp_id,)
                )
            except Exception:
                pass

        self.conn.commit()
        return cursor.rowcount > 0

    def _migrate_to_fts(self):
        """Migrate existing data to FTS table"""
        # Check if FTS table is empty
        fts_count = self.conn.execute("SELECT COUNT(*) FROM experience_fts").fetchone()[0]
        exp_count = self.conn.execute("SELECT COUNT(*) FROM experiences").fetchone()[0]

        if fts_count < exp_count:
            logger.info(f"Migrating {exp_count - fts_count} experiences to FTS...")
            # Rebuild FTS index from experiences table
            self.conn.execute("INSERT INTO experience_fts(experience_fts) VALUES('rebuild')")
            logger.info("FTS migration completed")

    def _fts_search(self, query: str, limit: int = 10) -> list[tuple[int, float]]:
        """Perform FTS5 keyword search, returns list of (id, bm25_score)"""
        if not self._fts_available:
            return []

        try:
            # Use BM25 scoring (lower is better, so we negate it)
            rows = self.conn.execute("""
                SELECT rowid, bm25(experience_fts) as score
                FROM experience_fts
                WHERE experience_fts MATCH ?
                ORDER BY score
                LIMIT ?
            """, (query, limit)).fetchall()
            return [(row[0], row[1]) for row in rows]
        except Exception as e:
            logger.warning(f"FTS search failed: {e}")
            return []

    def _hybrid_search(self, embedding: list[float], query: str,
                       exp_type: Optional[str] = None,
                       project: Optional[str] = None,
                       limit: int = 5,
                       vec_weight: float = 0.5) -> list[Experience]:
        """Perform hybrid search using RRF (Reciprocal Rank Fusion)"""
        import sqlite_vec

        k = 60  # RRF constant

        # Vector search results: {id: rank}
        vec_results = {}
        if self._vec_available:
            try:
                rows = self.conn.execute("""
                    SELECT experience_id, distance
                    FROM experience_embeddings
                    WHERE embedding MATCH ? AND k = ?
                """, [sqlite_vec.serialize_float32(embedding), limit * 3]).fetchall()
                for rank, (exp_id, _) in enumerate(rows):
                    vec_results[exp_id] = rank
            except Exception as e:
                logger.warning(f"Vector search in hybrid failed: {e}")

        # FTS search results: {id: rank}
        fts_results = {}
        if self._fts_available and query:
            try:
                # Prepare query for FTS (escape special chars, add wildcards)
                fts_query = ' OR '.join(f'"{term}"*' for term in query.split() if term)
                fts_rows = self._fts_search(fts_query, limit * 3)
                for rank, (exp_id, _) in enumerate(fts_rows):
                    fts_results[exp_id] = rank
            except Exception as e:
                logger.warning(f"FTS search in hybrid failed: {e}")

        # Merge using RRF
        all_ids = set(vec_results.keys()) | set(fts_results.keys())
        rrf_scores = {}

        for exp_id in all_ids:
            score = 0.0
            if exp_id in vec_results:
                score += vec_weight * (1.0 / (k + vec_results[exp_id]))
            if exp_id in fts_results:
                score += (1 - vec_weight) * (1.0 / (k + fts_results[exp_id]))
            rrf_scores[exp_id] = score

        # Sort by RRF score (higher is better)
        sorted_ids = sorted(rrf_scores.keys(), key=lambda x: rrf_scores[x], reverse=True)

        # Fetch and filter experiences
        results = []
        for exp_id in sorted_ids:
            exp = self.get_by_id(exp_id)
            if not exp:
                continue
            if exp_type and exp.type != exp_type:
                continue
            if project and exp.project != project:
                continue

            results.append(exp)

            # Update access count
            self.conn.execute(
                "UPDATE experiences SET access_count = access_count + 1 WHERE id = ?",
                (exp.id,)
            )

            if len(results) >= limit:
                break

        self.conn.commit()
        return results

    def _row_to_experience(self, row: sqlite3.Row) -> Experience:
        """Convert database row to Experience object"""
        return Experience(
            id=row["id"],
            type=row["type"],
            title=row["title"],
            content=row["content"],
            tags=json.loads(row["tags"]) if row["tags"] else [],
            project=row["project"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            access_count=row["access_count"]
        )

    def close(self):
        if self.conn:
            self.conn.close()
            self.conn = None


# =============================================================================
# MCP Server
# =============================================================================

# Global instances (lazy initialization)
_embedding_service: Optional[EmbeddingService] = None
_storage: Optional[ExperienceStorage] = None


def get_embedding_service() -> EmbeddingService:
    global _embedding_service
    if _embedding_service is None:
        _embedding_service = EmbeddingService()
    return _embedding_service


def get_storage() -> ExperienceStorage:
    global _storage
    if _storage is None:
        _storage = ExperienceStorage()
        _storage.initialize()
    return _storage


# Create MCP Server
server = Server("experience-memory")


@server.list_tools()
async def list_tools():
    """List all available tools"""
    return [
        Tool(
            name="learn",
            description="""Record a valuable experience to the knowledge base.

Use this tool when:
- You solved a tricky problem (type: pitfall)
- You discovered a project-specific pattern (type: pattern)
- You learned a user preference (type: preference)
- You gained a domain insight (type: insight)

The experience will be stored with semantic embeddings for later retrieval.""",
            inputSchema={
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": ["pitfall", "pattern", "preference", "insight"],
                        "description": "Type of experience: pitfall (gotchas/bugs), pattern (project conventions), preference (user likes), insight (domain knowledge)"
                    },
                    "title": {
                        "type": "string",
                        "description": "Short, descriptive title (e.g., 'asyncio task reference loss')"
                    },
                    "content": {
                        "type": "string",
                        "description": "Detailed description of the experience, including context, problem, and solution"
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional tags for categorization (e.g., ['python', 'async'])"
                    },
                    "project": {
                        "type": "string",
                        "description": "Optional project name. If omitted, experience is global"
                    }
                },
                "required": ["type", "title", "content"]
            }
        ),
        Tool(
            name="recall",
            description="""Search for relevant experiences using semantic similarity.

Use this tool FIRST when:
- You encounter an unfamiliar problem
- You're unsure about project conventions
- You need to remember past solutions

Returns the most relevant experiences based on meaning, not just keywords.""",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Natural language query describing what you're looking for"
                    },
                    "type": {
                        "type": "string",
                        "enum": ["pitfall", "pattern", "preference", "insight"],
                        "description": "Optional: filter by experience type"
                    },
                    "project": {
                        "type": "string",
                        "description": "Optional: filter by project name"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of results (default: 5)"
                    }
                },
                "required": ["query"]
            }
        ),
        Tool(
            name="list_experiences",
            description="List experiences with optional filters. Use to browse the knowledge base.",
            inputSchema={
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": ["pitfall", "pattern", "preference", "insight"],
                        "description": "Optional: filter by type"
                    },
                    "project": {
                        "type": "string",
                        "description": "Optional: filter by project"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of results (default: 20)"
                    }
                }
            }
        ),
        Tool(
            name="update_experience",
            description="Update an existing experience. Use when you have new information to add.",
            inputSchema={
                "type": "object",
                "properties": {
                    "id": {
                        "type": "integer",
                        "description": "Experience ID to update"
                    },
                    "title": {
                        "type": "string",
                        "description": "New title (optional)"
                    },
                    "content": {
                        "type": "string",
                        "description": "New content (optional)"
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "New tags (optional)"
                    }
                },
                "required": ["id"]
            }
        ),
        Tool(
            name="forget",
            description="Delete an experience. Use when information is outdated or incorrect.",
            inputSchema={
                "type": "object",
                "properties": {
                    "id": {
                        "type": "integer",
                        "description": "Experience ID to delete"
                    }
                },
                "required": ["id"]
            }
        )
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict):
    """Handle tool calls"""
    try:
        if name == "learn":
            return await handle_learn(arguments)
        elif name == "recall":
            return await handle_recall(arguments)
        elif name == "list_experiences":
            return await handle_list(arguments)
        elif name == "update_experience":
            return await handle_update(arguments)
        elif name == "forget":
            return await handle_forget(arguments)
        else:
            return [TextContent(type="text", text=f"Unknown tool: {name}")]
    except Exception as e:
        logger.error(f"Tool {name} failed: {e}")
        return [TextContent(type="text", text=f"Error: {str(e)}")]


async def handle_learn(args: dict):
    """Handle learn tool - store new experience"""
    exp_type = args.get("type")
    title = args.get("title")
    content = args.get("content")
    tags = args.get("tags", [])
    project = args.get("project")

    if exp_type not in VALID_TYPES:
        return [TextContent(type="text", text=f"Invalid type. Must be one of: {VALID_TYPES}")]

    # Generate embedding
    embedding_service = get_embedding_service()
    storage = get_storage()

    try:
        # Combine title and content for embedding
        text_for_embedding = f"{title}\n\n{content}"
        embedding = await embedding_service.embed(text_for_embedding)
    except Exception as e:
        logger.warning(f"Embedding generation failed: {e}, storing without embedding")
        embedding = None

    # Store experience
    exp_id = storage.store(exp_type, title, content, tags, project, embedding)

    result = {
        "success": True,
        "id": exp_id,
        "message": f"Experience recorded: '{title}' (type: {exp_type})",
        "hint": "This experience can now be found using the 'recall' tool"
    }

    return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False, indent=2))]


async def handle_recall(args: dict):
    """Handle recall tool - semantic search"""
    query = args.get("query")
    exp_type = args.get("type")
    project = args.get("project")
    limit = args.get("limit", 5)

    embedding_service = get_embedding_service()
    storage = get_storage()

    try:
        # Generate query embedding
        embedding = await embedding_service.embed(query)
        # Pass query for hybrid search (vector + FTS)
        experiences = storage.search_similar(embedding, exp_type, project, limit, query=query)
    except Exception as e:
        logger.warning(f"Semantic search failed: {e}, falling back to list")
        experiences = storage.list_experiences(exp_type, project, limit)

    if not experiences:
        return [TextContent(type="text", text="No relevant experiences found.")]

    result = {
        "query": query,
        "found": len(experiences),
        "experiences": [exp.to_dict() for exp in experiences]
    }

    return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False, indent=2))]


async def handle_list(args: dict):
    """Handle list_experiences tool"""
    exp_type = args.get("type")
    project = args.get("project")
    limit = args.get("limit", 20)

    storage = get_storage()
    experiences = storage.list_experiences(exp_type, project, limit)

    if not experiences:
        return [TextContent(type="text", text="No experiences found.")]

    result = {
        "total": len(experiences),
        "experiences": [exp.to_dict() for exp in experiences]
    }

    return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False, indent=2))]


async def handle_update(args: dict):
    """Handle update_experience tool"""
    exp_id = args.get("id")
    title = args.get("title")
    content = args.get("content")
    tags = args.get("tags")

    storage = get_storage()

    # Check if experience exists
    exp = storage.get_by_id(exp_id)
    if not exp:
        return [TextContent(type="text", text=f"Experience ID {exp_id} not found")]

    # Generate new embedding if content changed
    embedding = None
    if content or title:
        try:
            embedding_service = get_embedding_service()
            new_title = title or exp.title
            new_content = content or exp.content
            embedding = await embedding_service.embed(f"{new_title}\n\n{new_content}")
        except Exception as e:
            logger.warning(f"Embedding update failed: {e}")

    success = storage.update(exp_id, title, content, tags, embedding)

    result = {
        "success": success,
        "message": f"Experience '{exp.title}' updated" if success else "Update failed"
    }

    return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False, indent=2))]


async def handle_forget(args: dict):
    """Handle forget tool - delete experience"""
    exp_id = args.get("id")

    storage = get_storage()

    # Get experience info before deleting
    exp = storage.get_by_id(exp_id)
    if not exp:
        return [TextContent(type="text", text=f"Experience ID {exp_id} not found")]

    success = storage.delete(exp_id)

    result = {
        "success": success,
        "message": f"Experience '{exp.title}' forgotten" if success else "Delete failed"
    }

    return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False, indent=2))]


async def main():
    """MCP Server entry point"""
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
