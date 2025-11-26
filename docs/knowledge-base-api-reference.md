# FSHD-openrd 知识库API参考文档

## 概述

本文档详细描述了FSHD-openrd平台知识库模块的所有API接口。知识库模块提供了完整的FSHD相关知识管理系统，包括分类管理、文章CRUD、搜索功能和用户互动。

## 基础信息

- **基础路径**: `/api/knowledge`
- **认证**: 部分接口需要JWT认证（在请求头中添加 `Authorization: Bearer {token}`）
- **数据格式**: JSON
- **版本**: v1

## 响应格式

所有API响应都遵循统一的格式：

### 成功响应
```json
{
  "success": true,
  "data": {...},
  "message": "操作成功"
}
```

### 错误响应
```json
{
  "success": false,
  "error": "错误描述",
  "message": "详细错误信息"
}
```

### 分页响应
```json
{
  "success": true,
  "data": {
    "items": [...],
    "total": 100,
    "page": 1,
    "limit": 20,
    "total_pages": 5
  }
}
```

## 知识分类API

### 获取分类列表

**端点**: `GET /api/knowledge/categories`

**描述**: 获取知识分类列表，支持按父级分类筛选

**参数**:
- `parent_id` (可选): 父级分类ID，不传则获取顶级分类

**响应**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "FSHD基础知识",
      "description": "面肩肱型肌营养不良症的基本概念、病因和遗传机制",
      "parent_id": null,
      "sort_order": 1,
      "is_active": true,
      "article_count": 10,
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### 获取分类详情

**端点**: `GET /api/knowledge/categories/:id`

**描述**: 根据ID获取特定分类的详细信息

**参数**: 无

**响应**: 同分类列表中的单个分类对象

### 创建分类

**端点**: `POST /api/knowledge/categories`

**描述**: 创建新的知识分类（需要认证）

**请求体**:
```json
{
  "name": "新分类名称",
  "description": "分类描述",
  "parent_id": "父级分类ID", // 可选
  "sort_order": 0 // 可选，默认0
}
```

**响应**: 创建的分类对象

### 更新分类

**端点**: `PUT /api/knowledge/categories/:id`

**描述**: 更新现有分类信息（需要认证）

**请求体**: 同创建分类，所有字段可选

**响应**: 更新后的分类对象

### 删除分类

**端点**: `DELETE /api/knowledge/categories/:id`

**描述**: 删除分类（软删除，标记为不活跃）（需要认证）

**参数**: 无

**响应**:
```json
{
  "success": true,
  "message": "分类删除成功"
}
```

## 知识文章API

### 获取文章列表

**端点**: `GET /api/knowledge/articles`

**描述**: 获取知识文章列表，支持多种筛选和分页

**查询参数**:
- `category_id` (可选): 按分类ID筛选
- `status` (可选): 按状态筛选 (draft, published, archived)
- `is_featured` (可选): 是否只获取推荐文章 (true/false)
- `tags` (可选): 按标签筛选，多个标签用逗号分隔
- `search` (可选): 关键词搜索（标题、内容、摘要）
- `page` (可选): 页码，默认1
- `limit` (可选): 每页数量，默认20，最大100
- `sort_by` (可选): 排序字段 (created_at, updated_at, published_at, title, view_count, like_count)
- `sort_order` (可选): 排序方向 (asc, desc)

**响应**:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "category_id": "分类ID",
        "category_name": "分类名称",
        "title": "文章标题",
        "content": "文章内容",
        "summary": "文章摘要",
        "author": "作者",
        "source": "来源",
        "tags": ["标签1", "标签2"],
        "status": "published",
        "view_count": 100,
        "like_count": 10,
        "is_featured": true,
        "metadata": {},
        "created_by": "创建者ID",
        "updated_by": "更新者ID",
        "published_at": "2024-01-01T00:00:00Z",
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z"
      }
    ],
    "total": 50,
    "page": 1,
    "limit": 20,
    "total_pages": 3
  }
}
```

### 获取文章详情

**端点**: `GET /api/knowledge/articles/:id`

**描述**: 根据ID获取文章详情，会自动记录浏览行为

**参数**: 无

**响应**: 单个文章对象（包含分类名称）

### 创建文章

**端点**: `POST /api/knowledge/articles`

**描述**: 创建新的知识文章（需要认证）

**请求体**:
```json
{
  "category_id": "分类ID",
  "title": "文章标题",
  "content": "文章内容",
  "summary": "文章摘要", // 可选
  "author": "作者", // 可选
  "source": "来源", // 可选
  "tags": ["FSHD", "康复"], // 可选
  "status": "draft", // draft, published, archived
  "is_featured": false, // 可选
  "metadata": {} // 可选，自定义元数据
}
```

**响应**: 创建的文章对象

### 更新文章

**端点**: `PUT /api/knowledge/articles/:id`

**描述**: 更新现有文章信息（需要认证）

**请求体**: 同创建文章，所有字段可选

**响应**: 更新后的文章对象

### 删除文章

**端点**: `DELETE /api/knowledge/articles/:id`

**描述**: 删除文章（需要认证）

**参数**: 无

**响应**:
```json
{
  "success": true,
  "message": "文章删除成功"
}
```

## 搜索API

### 全文搜索

**端点**: `GET /api/knowledge/search`

**描述**: 在知识库中进行全文搜索

**查询参数**:
- `q` (必需): 搜索关键词
- `category_id` (可选): 按分类筛选
- `tags` (可选): 按标签筛选，多个标签用逗号分隔
- `page` (可选): 页码，默认1
- `limit` (可选): 每页数量，默认20，最大100

**响应**: 同文章列表的分页响应格式，搜索结果按相关性排序

## 用户互动API

### 点赞文章

**端点**: `POST /api/knowledge/articles/:id/like`

**描述**: 给文章点赞（需要认证）

**参数**: 无

**请求体**: 无

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "互动记录ID",
    "user_id": "用户ID",
    "article_id": "文章ID",
    "interaction_type": "like",
    "interaction_data": {
      "timestamp": "2024-01-01T00:00:00Z"
    },
    "created_at": "2024-01-01T00:00:00Z"
  },
  "message": "点赞成功"
}
```

### 收藏文章

**端点**: `POST /api/knowledge/articles/:id/bookmark`

**描述**: 收藏文章（需要认证）

**参数**: 无

**请求体**: 无

**响应**: 同点赞响应，interaction_type为"bookmark"

### 获取用户互动记录

**端点**: `GET /api/knowledge/interactions`

**描述**: 获取当前用户的互动记录（需要认证）

**查询参数**:
- `articleId` (可选): 按文章ID筛选

**响应**:
```json
{
  "success": true,
  "data": [
    {
      "id": "互动记录ID",
      "user_id": "用户ID",
      "article_id": "文章ID",
      "interaction_type": "like",
      "interaction_data": {},
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

## 错误代码

| 状态码 | 描述 |
|--------|------|
| 200 | 成功 |
| 201 | 创建成功 |
| 400 | 请求参数错误 |
| 401 | 未授权访问 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |

## 使用示例

### 获取所有已发布的FSHD基础知识文章

```bash
GET /api/knowledge/articles?category_id={基础知识分类ID}&status=published&limit=10
```

### 搜索关于康复训练的文章

```bash
GET /api/knowledge/search?q=康复训练&tags=康复,训练
```

### 创建新的知识文章

```bash
POST /api/knowledge/articles
Authorization: Bearer {jwt_token}
Content-Type: application/json

{
  "category_id": "分类ID",
  "title": "FSHD患者的日常护理指南",
  "content": "详细内容...",
  "summary": "本文介绍FSHD患者的日常护理方法和注意事项",
  "tags": ["日常护理", "生活技巧"],
  "status": "published",
  "author": "医疗专家"
}
```

### 点赞文章

```bash
POST /api/knowledge/articles/{文章ID}/like
Authorization: Bearer {jwt_token}
```

## 数据库表结构

知识库模块包含以下数据库表：

1. **knowledge_categories** - 知识分类表
2. **knowledge_articles** - 知识文章表  
3. **knowledge_tags** - 标签表（预留）
4. **knowledge_interactions** - 用户互动表

详细表结构请参考数据库迁移脚本：`db/migrations/004_knowledge_base_tables.sql`

## 注意事项

1. **认证要求**: 创建、更新、删除操作以及用户互动需要JWT认证
2. **数据验证**: 所有输入数据都会进行严格的验证
3. **分页限制**: 每页最大数量为100条记录
4. **搜索性能**: 全文搜索使用PostgreSQL的全文搜索功能
5. **互动记录**: 浏览行为会自动记录，无需手动调用

---

**文档版本**: v1.0  
**最后更新**: 2025-01-25