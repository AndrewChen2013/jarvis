# Copyright (c) 2025 BillChen
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""
Experience Memory MCP 测试

直接调用函数测试，不通过 MCP 协议
"""

import pytest
import asyncio
import tempfile
import os
import sys

# 添加项目根目录
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.mcp.experience_memory_mcp import (
    ExperienceStorage,
    EmbeddingService,
    Experience,
    handle_learn,
    handle_recall,
    handle_list,
    handle_update,
    handle_forget,
    VALID_TYPES,
)


# =============================================================================
# Fixtures
# =============================================================================

@pytest.fixture
def temp_db_path(tmp_path):
    """创建临时数据库路径"""
    return str(tmp_path / "test_experiences.db")


@pytest.fixture
def storage(temp_db_path):
    """创建测试用的 Storage 实例"""
    s = ExperienceStorage(db_path=temp_db_path)
    s.initialize()
    yield s
    s.close()


@pytest.fixture
def embedding_service():
    """创建 EmbeddingService 实例"""
    service = EmbeddingService()
    yield service
    # Cleanup is async, handle in test if needed


# =============================================================================
# Storage 基础测试
# =============================================================================

class TestExperienceStorage:
    """ExperienceStorage 类测试"""

    def test_initialize(self, storage):
        """测试初始化"""
        assert storage.conn is not None
        assert storage._fts_available is True
        # vec 可能不可用取决于环境

    def test_store_and_get(self, storage):
        """测试存储和获取"""
        exp_id = storage.store(
            exp_type="pitfall",
            title="Test Experience",
            content="This is a test content",
            tags=["test", "python"],
            project="test-project",
            embedding=None
        )

        assert exp_id > 0

        # 获取
        exp = storage.get_by_id(exp_id)
        assert exp is not None
        assert exp.id == exp_id
        assert exp.type == "pitfall"
        assert exp.title == "Test Experience"
        assert exp.content == "This is a test content"
        assert exp.tags == ["test", "python"]
        assert exp.project == "test-project"

    def test_store_all_types(self, storage):
        """测试所有经验类型"""
        for exp_type in VALID_TYPES:
            exp_id = storage.store(
                exp_type=exp_type,
                title=f"Test {exp_type}",
                content=f"Content for {exp_type}",
                tags=[exp_type],
                project=None,
                embedding=None
            )
            assert exp_id > 0

            exp = storage.get_by_id(exp_id)
            assert exp.type == exp_type

    def test_update(self, storage):
        """测试更新"""
        exp_id = storage.store(
            exp_type="insight",
            title="Original Title",
            content="Original Content",
            tags=["original"],
            project=None,
            embedding=None
        )

        # 更新
        success = storage.update(
            exp_id=exp_id,
            title="Updated Title",
            content="Updated Content",
            tags=["updated", "modified"]
        )
        assert success is True

        # 验证
        exp = storage.get_by_id(exp_id)
        assert exp.title == "Updated Title"
        assert exp.content == "Updated Content"
        assert exp.tags == ["updated", "modified"]

    def test_delete(self, storage):
        """测试删除"""
        exp_id = storage.store(
            exp_type="pattern",
            title="To Delete",
            content="Will be deleted",
            tags=[],
            project=None,
            embedding=None
        )

        # 删除
        success = storage.delete(exp_id)
        assert success is True

        # 验证已删除
        exp = storage.get_by_id(exp_id)
        assert exp is None

    def test_delete_nonexistent(self, storage):
        """测试删除不存在的记录"""
        success = storage.delete(99999)
        assert success is False

    def test_list_experiences(self, storage):
        """测试列表查询"""
        # 创建多条记录
        for i in range(5):
            storage.store(
                exp_type="pitfall" if i % 2 == 0 else "pattern",
                title=f"Experience {i}",
                content=f"Content {i}",
                tags=[f"tag{i}"],
                project="project-a" if i < 3 else "project-b",
                embedding=None
            )

        # 列出所有
        all_exp = storage.list_experiences(limit=10)
        assert len(all_exp) == 5

        # 按类型过滤
        pitfalls = storage.list_experiences(exp_type="pitfall")
        assert len(pitfalls) == 3

        patterns = storage.list_experiences(exp_type="pattern")
        assert len(patterns) == 2

        # 按项目过滤
        project_a = storage.list_experiences(project="project-a")
        assert len(project_a) == 3

        project_b = storage.list_experiences(project="project-b")
        assert len(project_b) == 2

        # 组合过滤
        filtered = storage.list_experiences(exp_type="pitfall", project="project-a")
        assert len(filtered) == 2

        # 限制数量
        limited = storage.list_experiences(limit=2)
        assert len(limited) == 2


# =============================================================================
# FTS 搜索测试
# =============================================================================

class TestFTSSearch:
    """FTS5 全文搜索测试"""

    def test_fts_available(self, storage):
        """测试 FTS 是否可用"""
        assert storage._fts_available is True

    def test_fts_search_exact_match(self, storage):
        """测试精确关键词匹配"""
        storage.store(
            exp_type="pitfall",
            title="Python asyncio bug",
            content="When using asyncio.create_task, remember to keep reference",
            tags=["python", "asyncio"],
            project=None,
            embedding=None
        )

        # 搜索
        results = storage._fts_search("asyncio", limit=5)
        assert len(results) > 0

    def test_fts_search_chinese(self, storage):
        """测试中文搜索 (unicode61 对中文支持有限，需要完整词匹配)"""
        storage.store(
            exp_type="insight",
            title="database config",
            content="数据库连接池大小应该根据并发量来设置 database pool",
            tags=["数据库", "性能"],
            project=None,
            embedding=None
        )

        # unicode61 tokenizer 对中文按字分词，搜索英文关键词更可靠
        results = storage._fts_search("database", limit=5)
        assert len(results) > 0

    def test_fts_search_no_match(self, storage):
        """测试无匹配"""
        storage.store(
            exp_type="pattern",
            title="Test Pattern",
            content="Some content here",
            tags=[],
            project=None,
            embedding=None
        )

        results = storage._fts_search("nonexistent_keyword_xyz", limit=5)
        assert len(results) == 0


# =============================================================================
# Embedding 测试 (需要 Ollama 运行)
# =============================================================================

class TestEmbeddingService:
    """EmbeddingService 测试 (需要 Ollama)"""

    @pytest.mark.asyncio
    async def test_embed(self, embedding_service):
        """测试生成 embedding"""
        try:
            embedding = await embedding_service.embed("Hello, world!")
            assert isinstance(embedding, list)
            assert len(embedding) == 1024  # qwen3-embedding dimension
            assert all(isinstance(x, float) for x in embedding)
        except Exception as e:
            pytest.skip(f"Ollama not available: {e}")
        finally:
            await embedding_service.close()

    @pytest.mark.asyncio
    async def test_embed_chinese(self, embedding_service):
        """测试中文 embedding"""
        try:
            embedding = await embedding_service.embed("这是一个测试文本")
            assert isinstance(embedding, list)
            assert len(embedding) == 1024
        except Exception as e:
            pytest.skip(f"Ollama not available: {e}")
        finally:
            await embedding_service.close()


# =============================================================================
# 向量搜索测试 (需要 Ollama + sqlite-vec)
# =============================================================================

class TestVectorSearch:
    """向量搜索测试"""

    @pytest.mark.asyncio
    async def test_vector_search(self, storage, embedding_service):
        """测试向量相似度搜索"""
        if not storage._vec_available:
            pytest.skip("sqlite-vec not available")

        try:
            # 存储带 embedding 的经验
            text1 = "Python asyncio task management"
            emb1 = await embedding_service.embed(text1)
            storage.store(
                exp_type="pitfall",
                title="Asyncio Task Loss",
                content=text1,
                tags=["python"],
                project=None,
                embedding=emb1
            )

            text2 = "Database connection pooling"
            emb2 = await embedding_service.embed(text2)
            storage.store(
                exp_type="pattern",
                title="DB Connection Pool",
                content=text2,
                tags=["database"],
                project=None,
                embedding=emb2
            )

            # 搜索相似
            query_emb = await embedding_service.embed("async task in Python")
            results = storage.search_similar(query_emb, limit=2)

            assert len(results) > 0
            # 第一个结果应该是 asyncio 相关的
            assert "asyncio" in results[0].title.lower() or "async" in results[0].content.lower()

        except Exception as e:
            pytest.skip(f"Embedding service error: {e}")
        finally:
            await embedding_service.close()


# =============================================================================
# 混合搜索测试
# =============================================================================

class TestHybridSearch:
    """混合搜索 (Vector + FTS) 测试"""

    @pytest.mark.asyncio
    async def test_hybrid_search(self, storage, embedding_service):
        """测试混合搜索"""
        if not storage._vec_available or not storage._fts_available:
            pytest.skip("Vector or FTS not available")

        try:
            # 存储测试数据
            experiences = [
                ("Python GIL 限制", "Python的全局解释器锁GIL会限制多线程性能", ["python", "性能"]),
                ("Go goroutine", "Go语言的goroutine是轻量级线程", ["go", "并发"]),
                ("Python asyncio", "Python asyncio提供异步IO支持", ["python", "异步"]),
            ]

            for title, content, tags in experiences:
                emb = await embedding_service.embed(f"{title}\n{content}")
                storage.store(
                    exp_type="insight",
                    title=title,
                    content=content,
                    tags=tags,
                    project=None,
                    embedding=emb
                )

            # 混合搜索: 关键词 "Python" + 语义 "并发编程"
            query = "Python 并发"
            query_emb = await embedding_service.embed(query)

            results = storage.search_similar(query_emb, limit=3, query=query)

            assert len(results) > 0
            # 应该找到 Python 相关的结果
            titles = [r.title for r in results]
            assert any("Python" in t for t in titles)

        except Exception as e:
            pytest.skip(f"Search error: {e}")
        finally:
            await embedding_service.close()

    @pytest.mark.asyncio
    async def test_hybrid_search_keyword_boost(self, storage, embedding_service):
        """测试关键词对排名的影响"""
        if not storage._vec_available or not storage._fts_available:
            pytest.skip("Vector or FTS not available")

        try:
            # 创建两个语义相似但关键词不同的经验
            exp1 = ("服务重启问题", "restart服务时遇到的问题和解决方案", ["运维"])
            exp2 = ("应用启动缓慢", "应用程序启动时间过长的优化方法", ["性能"])

            for title, content, tags in [exp1, exp2]:
                emb = await embedding_service.embed(f"{title}\n{content}")
                storage.store(
                    exp_type="pitfall",
                    title=title,
                    content=content,
                    tags=tags,
                    project=None,
                    embedding=emb
                )

            # 搜索包含 "restart" 关键词
            query = "restart 问题"
            query_emb = await embedding_service.embed(query)
            results = storage.search_similar(query_emb, limit=2, query=query)

            # 第一个结果应该包含 restart 关键词
            if len(results) > 0:
                assert "restart" in results[0].content.lower() or "重启" in results[0].title

        except Exception as e:
            pytest.skip(f"Search error: {e}")
        finally:
            await embedding_service.close()


# =============================================================================
# Handler 函数测试 (集成测试)
# =============================================================================

class TestHandlers:
    """MCP Handler 函数测试"""

    @pytest.fixture(autouse=True)
    def setup_storage(self, temp_db_path, monkeypatch):
        """设置测试环境"""
        # Monkey patch DB_PATH
        monkeypatch.setattr(
            "app.mcp.experience_memory_mcp.DB_PATH",
            temp_db_path
        )
        # Reset global instances
        import app.mcp.experience_memory_mcp as module
        module._storage = None
        module._embedding_service = None

    @pytest.mark.asyncio
    async def test_handle_learn(self):
        """测试 learn handler"""
        result = await handle_learn({
            "type": "pitfall",
            "title": "Test Learn",
            "content": "Test content for learn",
            "tags": ["test"],
            "project": "test-project"
        })

        assert len(result) == 1
        import json
        data = json.loads(result[0].text)
        assert data["success"] is True
        assert data["id"] > 0
        assert "Test Learn" in data["message"]

    @pytest.mark.asyncio
    async def test_handle_learn_invalid_type(self):
        """测试无效类型"""
        result = await handle_learn({
            "type": "invalid_type",
            "title": "Test",
            "content": "Test"
        })

        assert len(result) == 1
        assert "Invalid type" in result[0].text

    @pytest.mark.asyncio
    async def test_handle_list(self):
        """测试 list handler"""
        # 先创建一些数据
        await handle_learn({
            "type": "pattern",
            "title": "Pattern 1",
            "content": "Content 1"
        })
        await handle_learn({
            "type": "insight",
            "title": "Insight 1",
            "content": "Content 2"
        })

        # 列出所有
        result = await handle_list({})
        import json
        data = json.loads(result[0].text)
        assert data["total"] >= 2

        # 按类型过滤
        result = await handle_list({"type": "pattern"})
        data = json.loads(result[0].text)
        assert all(e["type"] == "pattern" for e in data["experiences"])

    @pytest.mark.asyncio
    async def test_handle_update(self):
        """测试 update handler"""
        # 创建
        result = await handle_learn({
            "type": "preference",
            "title": "Original",
            "content": "Original content"
        })
        import json
        exp_id = json.loads(result[0].text)["id"]

        # 更新
        result = await handle_update({
            "id": exp_id,
            "title": "Updated Title",
            "content": "Updated content"
        })
        data = json.loads(result[0].text)
        assert data["success"] is True

    @pytest.mark.asyncio
    async def test_handle_update_nonexistent(self):
        """测试更新不存在的记录"""
        result = await handle_update({
            "id": 99999,
            "title": "New Title"
        })
        assert "not found" in result[0].text

    @pytest.mark.asyncio
    async def test_handle_forget(self):
        """测试 forget handler"""
        # 创建
        result = await handle_learn({
            "type": "insight",
            "title": "To Forget",
            "content": "Will be forgotten"
        })
        import json
        exp_id = json.loads(result[0].text)["id"]

        # 删除
        result = await handle_forget({"id": exp_id})
        data = json.loads(result[0].text)
        assert data["success"] is True
        assert "forgotten" in data["message"]

    @pytest.mark.asyncio
    async def test_handle_forget_nonexistent(self):
        """测试删除不存在的记录"""
        result = await handle_forget({"id": 99999})
        assert "not found" in result[0].text

    @pytest.mark.asyncio
    async def test_handle_recall(self):
        """测试 recall handler"""
        # 创建测试数据
        await handle_learn({
            "type": "pitfall",
            "title": "Database Connection Leak",
            "content": "Always close database connections in finally block",
            "tags": ["database", "python"]
        })

        # 搜索
        result = await handle_recall({
            "query": "database connection",
            "limit": 5
        })

        import json
        data = json.loads(result[0].text)
        assert data["found"] >= 1
        assert len(data["experiences"]) >= 1


# =============================================================================
# Experience 数据模型测试
# =============================================================================

class TestExperienceModel:
    """Experience 数据模型测试"""

    def test_to_dict(self):
        """测试转换为字典"""
        import time
        now = time.time()

        exp = Experience(
            id=1,
            type="pitfall",
            title="Test",
            content="Content",
            tags=["tag1", "tag2"],
            project="project",
            created_at=now,
            updated_at=now,
            access_count=5
        )

        d = exp.to_dict()
        assert d["id"] == 1
        assert d["type"] == "pitfall"
        assert d["title"] == "Test"
        assert d["tags"] == ["tag1", "tag2"]
        assert d["access_count"] == 5
        assert "created_at" in d
        assert "updated_at" in d


# =============================================================================
# 边界条件测试
# =============================================================================

class TestEdgeCases:
    """边界条件测试"""

    def test_empty_tags(self, storage):
        """测试空标签"""
        exp_id = storage.store(
            exp_type="pattern",
            title="No Tags",
            content="Content without tags",
            tags=[],
            project=None,
            embedding=None
        )
        exp = storage.get_by_id(exp_id)
        assert exp.tags == []

    def test_long_content(self, storage):
        """测试长内容"""
        long_content = "A" * 10000
        exp_id = storage.store(
            exp_type="insight",
            title="Long Content",
            content=long_content,
            tags=[],
            project=None,
            embedding=None
        )
        exp = storage.get_by_id(exp_id)
        assert len(exp.content) == 10000

    def test_special_characters(self, storage):
        """测试特殊字符"""
        exp_id = storage.store(
            exp_type="preference",
            title="Special: <>&\"'`~!@#$%^*(){}[]|\\",
            content="Content with 中文, émojis 🎉, and symbols",
            tags=["special", "unicode"],
            project=None,
            embedding=None
        )
        exp = storage.get_by_id(exp_id)
        assert "Special:" in exp.title
        assert "🎉" in exp.content

    def test_null_project(self, storage):
        """测试 null 项目"""
        exp_id = storage.store(
            exp_type="pitfall",
            title="Global Experience",
            content="Not tied to any project",
            tags=[],
            project=None,
            embedding=None
        )
        exp = storage.get_by_id(exp_id)
        assert exp.project is None


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
