# Experience Memory MCP 设计文档

> 日期：2025-01-05
> 状态：设计讨论阶段

## 1. 核心痛点

Claude 上下文窗口有限，长对话中容易"忘记"之前做过的事情。

两个核心场景：

| 场景 | 需要的能力 |
|------|-----------|
| **踩坑后** | 主动记录教训，打标签分类 |
| **遇到问题时** | 主动检索，而不是重新摸索 |

## 2. 现有方案分析

### 已有的 MCP 记忆方案

| 方案 | 特点 | 仓库 |
|------|------|------|
| **MCP Memory Service** | 自动捕获上下文、Dream-inspired consolidation、90% token 减少 | https://github.com/doobidoo/mcp-memory-service |
| **MCP Knowledge Graph** | 知识图谱存储实体/关系/观察 | https://github.com/shaneholloman/mcp-knowledge-graph |
| **Long-Term Memory MCP** | SQLite + 向量嵌入、语义搜索 | https://playbooks.com/mcp/tomschell-long-term-memory |
| **Claude Memory MCP** | 本地 memory.db、全文搜索 | https://playbooks.com/mcp/whenmoon-memory |

### 学术界思想

- **Long Term Memory: Foundation of AI Self-Evolution** - 三种路径：外部知识库+RAG、直接训练进模型、混合方案
- **MemoryLLM** - Transformer + 固定大小记忆池，模型可自我更新
- **Cognitive Memory in LLMs** - 语义记忆、情景记忆、程序记忆

### 现有方案的不足

1. **被动**：等 Claude 自己想起来用，往往就忘了
2. **噪音多**：记录太多无用信息，检索效率低
3. **缺乏结构**：没有"经验"、"教训"、"偏好"的区分

## 3. 我们的设计理念

```
不是记住一切，而是记住"有价值的经验"
不是被动检索，而是"主动提醒先查"
```

### 与现有方案的差异

| 维度 | 现有方案 | 我们的方案 |
|------|---------|-----------|
| 记录策略 | 自动记录一切 | 只记录有价值的经验 |
| 分类 | 无/简单 | pitfall/pattern/preference/insight |
| 触发 | 被动 | system prompt 主动提醒查询 |
| 目标 | 通用记忆 | 经验积累、避免重复踩坑 |

## 4. 工具设计

### 核心工具

```python
# 1. 记录经验
learn(
    type="pitfall",           # pitfall/pattern/preference/insight
    title="asyncio task 引用丢失",
    content="create_task 返回值必须保存，否则任务可能被垃圾回收...",
    tags=["python", "async"],
    project="jarvis"          # 可选，按项目隔离
)

# 2. 查询经验（语义搜索）
recall("WebSocket 重连问题")  # 返回相关经验

# 3. 列出经验
list_learnings(type="pitfall", project="jarvis")

# 4. 更新经验
update_learning(id=1, content="更新后的内容...")

# 5. 删除经验
forget(id=1)
```

### 分类体系

| Type | 用途 | 示例 |
|------|------|------|
| `pitfall` | 踩过的坑 | "这个 API 有 bug，需要 workaround" |
| `pattern` | 项目特定模式 | "这个项目用 stream-json 和 Claude 通信" |
| `preference` | 用户偏好 | "用户喜欢简洁代码，不要过度抽象" |
| `insight` | 领域洞察 | "MCP 用 stdio 通信，通过 JSON-RPC" |

## 5. 数据模型

```python
{
    "id": 1,
    "type": "pitfall",              # pitfall/pattern/preference/insight
    "title": "asyncio.create_task 必须保存引用",
    "content": "在 Python 中使用 asyncio.create_task() 时，必须保存返回的 Task 对象引用，否则任务可能被垃圾回收器回收导致任务中断。解决方案：使用 set 保存所有 task 引用。",
    "tags": ["python", "async", "asyncio"],
    "project": "jarvis",            # 适用项目，null 表示全局
    "created_at": "2025-01-05T10:00:00Z",
    "updated_at": "2025-01-05T10:00:00Z",
    "last_accessed": "2025-01-05T12:00:00Z",
    "access_count": 3,              # 使用频率，可用于排序
    "embedding": [0.1, 0.2, ...]    # 可选，用于语义搜索
}
```

## 6. 存储方案

### 方案 A：SQLite + 全文搜索（简单）

```sql
CREATE TABLE learnings (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT,  -- JSON array
    project TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    last_accessed TIMESTAMP,
    access_count INTEGER DEFAULT 0
);

CREATE VIRTUAL TABLE learnings_fts USING fts5(title, content, tags);
```

### 方案 B：SQLite + 向量嵌入（语义搜索）

- 使用 sentence-transformers 生成嵌入
- 存储在 SQLite 的 BLOB 字段
- 余弦相似度搜索

## 7. System Prompt 集成

在 Claude 的 system prompt 中加入：

```
你有一个经验知识库 MCP 工具可用。

使用规则：
1. 遇到不确定的问题时，先调用 recall("关键词") 查询是否有相关经验
2. 解决了一个棘手问题后，调用 learn() 记录经验教训
3. 发现项目特定模式时，记录为 pattern
4. 了解到用户偏好时，记录为 preference
```

## 8. 参考资料

- MCP Memory Service: https://github.com/doobidoo/mcp-memory-service (已 clone)
- MCP Knowledge Graph: https://github.com/shaneholloman/mcp-knowledge-graph (已 clone)
- Long Term Memory 论文: https://arxiv.org/html/2410.15665v1
- MemoryLLM 论文: https://arxiv.org/html/2402.04624v2

## 9. 下一步

- [ ] 分析 mcp-memory-service 和 mcp-knowledge-graph 的实现细节
- [ ] 确定技术方案（全文搜索 vs 向量嵌入）
- [ ] 实现 MVP
- [ ] 集成到 jarvis 项目
