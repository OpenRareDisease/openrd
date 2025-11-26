# FSHD-openrd 知识库API接口设计文档

## 1. 概述

本文档详细描述了FSHD-openrd平台知识库API接口的设计方案，包括数据库表结构、API接口规范、数据模型和实现计划。

## 2. 数据库设计

### 2.1 知识库表结构设计

#### 2.1.1 知识分类表 (knowledge_categories)

```sql
CREATE TABLE knowledge_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,                    -- 分类名称
    description TEXT,                              -- 分类描述
    parent_id UUID REFERENCES knowledge_categories(id), -- 父级分类ID
    sort_order INTEGER DEFAULT 0,                  -- 排序顺序
    is_active BOOLEAN DEFAULT TRUE,                -- 是否激活
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 2.1.2 知识条目表 (knowledge_articles)

```sql
CREATE TABLE knowledge_articles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id UUID NOT NULL REFERENCES knowledge_categories(id),
    title VARCHAR(255) NOT NULL,                   -- 文章标题
    content TEXT NOT NULL,                         -- 文章内容
    summary TEXT,                                  -- 文章摘要
    author VARCHAR(100),                           -- 作者
    source VARCHAR(255),                           -- 来源
    tags TEXT[],                                   -- 标签数组
    status VARCHAR(20) DEFAULT 'draft',            -- 状态: draft, published, archived
    view_count INTEGER DEFAULT 0,                  -- 浏览次数
    like_count INTEGER DEFAULT 0,                  -- 点赞次数
    is_featured BOOLEAN DEFAULT FALSE,             -- 是否推荐
    metadata JSONB,                                -- 元数据
    created_by UUID REFERENCES app_users(id),      -- 创建者
    updated_by UUID REFERENCES app_users(id),      -- 更新者
    published_at TIMESTAMPTZ,                      -- 发布时间
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 2.1.3 知识标签表 (knowledge_tags)

```sql
CREATE TABLE knowledge_tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) NOT NULL UNIQUE,              -- 标签名称
    description TEXT,                              -- 标签描述
    color VARCHAR(7),                              -- 标签颜色
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 2.1.4 用户互动表 (knowledge_interactions)

```sql
CREATE TABLE knowledge_interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES app_users(id),
    article_id UUID NOT NULL REFERENCES knowledge_articles(id),
    interaction_type VARCHAR(20) NOT NULL,         -- 互动类型: view, like, share, bookmark
    interaction_data JSONB,                        -- 互动数据
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.2 索引设计

```sql
-- 知识分类索引
CREATE INDEX idx_knowledge_categories_parent_id ON knowledge_categories(parent_id);
CREATE INDEX idx_knowledge_categories_sort_order ON knowledge_categories(sort_order);

-- 知识条目索引
CREATE INDEX idx_knowledge_articles_category_id ON knowledge_articles(category_id);
CREATE INDEX idx_knowledge_articles_status ON knowledge_articles(status);
CREATE INDEX idx_knowledge_articles_published_at ON knowledge_articles(published_at);
CREATE INDEX idx_knowledge_articles_is_featured ON knowledge_articles(is_featured);
CREATE INDEX idx_knowledge_articles_tags ON knowledge_articles USING GIN(tags);
CREATE INDEX idx_knowledge_articles_title ON knowledge_articles(title);

-- 用户互动索引
CREATE INDEX idx_knowledge_interactions_user_article ON knowledge_interactions(user_id, article_id);
CREATE INDEX idx_knowledge_interactions_type ON knowledge_interactions(interaction_type);
```

## 3. API接口设计

### 3.1 基础API规范

- **基础路径**: `/api/knowledge`
- **认证**: 所有写操作需要JWT认证，读操作部分公开
- **版本**: v1
- **数据格式**: JSON

### 3.2 知识分类API

#### 3.2.1 获取分类列表
```
GET /api/knowledge/categories
```

**参数**:
- `parent_id` (可选): 父级分类ID
- `include_articles` (可选): 是否包含文章数量

**响应**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "分类名称",
      "description": "分类描述",
      "parent_id": "父级分类ID",
      "sort_order": 0,
      "article_count": 10,
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

#### 3.2.2 创建分类
```
POST /api/knowledge/categories
```

**请求体**:
```json
{
  "name": "分类名称",
  "description": "分类描述",
  "parent_id": "父级分类ID",
  "sort_order": 0
}
```

#### 3.2.3 更新分类
```
PUT /api/knowledge/categories/:id
```

#### 3.2.4 删除分类
```
DELETE /api/knowledge/categories/:id
```

### 3.3 知识条目API

#### 3.3.1 获取文章列表
```
GET /api/knowledge/articles
```

**参数**:
- `category_id` (可选): 分类ID筛选
- `status` (可选): 状态筛选 (draft, published, archived)
- `is_featured` (可选): 是否推荐
- `tags` (可选): 标签筛选
- `search` (可选): 关键词搜索
- `page` (可选): 页码，默认1
- `limit` (可选): 每页数量，默认20

#### 3.3.2 获取文章详情
```
GET /api/knowledge/articles/:id
```

#### 3.3.3 创建文章
```
POST /api/knowledge/articles
```

**请求体**:
```json
{
  "category_id": "分类ID",
  "title": "文章标题",
  "content": "文章内容",
  "summary": "文章摘要",
  "author": "作者",
  "source": "来源",
  "tags": ["标签1", "标签2"],
  "status": "draft",
  "is_featured": false,
  "metadata": {}
}
```

#### 3.3.4 更新文章
```
PUT /api/knowledge/articles/:id
```

#### 3.3.5 删除文章
```
DELETE /api/knowledge/articles/:id
```

### 3.4 搜索API

#### 3.4.1 全文搜索
```
GET /api/knowledge/search
```

**参数**:
- `q` (必需): 搜索关键词
- `category_id` (可选): 分类筛选
- `tags` (可选): 标签筛选
- `page` (可选): 页码
- `limit` (可选): 每页数量

### 3.5 用户互动API

#### 3.5.1 记录浏览
```
POST /api/knowledge/articles/:id/view
```

#### 3.5.2 点赞/取消点赞
```
POST /api/knowledge/articles/:id/like
```

#### 3.5.3 收藏/取消收藏
```
POST /api/knowledge/articles/:id/bookmark
```

## 4. 数据模型

### 4.1 TypeScript接口定义

```typescript
// 知识分类接口
interface KnowledgeCategory {
  id: string;
  name: string;
  description?: string;
  parent_id?: string;
  sort_order: number;
  is_active: boolean;
  article_count?: number;
  created_at: string;
  updated_at: string;
}

// 知识条目接口
interface KnowledgeArticle {
  id: string;
  category_id: string;
  title: string;
  content: string;
  summary?: string;
  author?: string;
  source?: string;
  tags: string[];
  status: 'draft' | 'published' | 'archived';
  view_count: number;
  like_count: number;
  is_featured: boolean;
  metadata?: Record<string, any>;
  created_by?: string;
  updated_by?: string;
  published_at?: string;
  created_at: string;
  updated_at: string;
}

// 用户互动接口
interface KnowledgeInteraction {
  id: string;
  user_id: string;
  article_id: string;
  interaction_type: 'view' | 'like' | 'share' | 'bookmark';
  interaction_data?: Record<string, any>;
  created_at: string;
}

// API响应接口
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}
```

## 5. 实现计划

### 5.1 模块结构

```
apps/api/src/modules/knowledge/
├── knowledge.controller.ts    # 控制器层
├── knowledge.service.ts       # 服务层
├── knowledge.routes.ts        # 路由层
├── knowledge.schema.ts        # 数据验证模式
└── types/
    └── knowledge.types.ts     # TypeScript类型定义
```

### 5.2 实现步骤

1. **数据库迁移脚本** - 创建知识库相关表结构
2. **数据模型定义** - 定义TypeScript接口和验证模式
3. **服务层实现** - 实现业务逻辑和数据操作
4. **控制器层实现** - 处理HTTP请求和响应
5. **路由层实现** - 定义API路由和中间件
6. **集成到主应用** - 注册知识库路由
7. **测试和文档** - 编写单元测试和API文档

### 5.3 技术要点

- 使用现有的认证中间件保护写操作
- 实现全文搜索功能（标题、内容、标签）
- 支持分页和筛选
- 记录用户互动数据
- 实现文章状态管理（草稿、已发布、已归档）

## 6. 安全考虑

- 所有写操作需要JWT认证
- 验证用户权限（管理员可以管理所有内容，普通用户只能管理自己的内容）
- 输入数据验证和清理
- SQL注入防护
- XSS攻击防护

## 7. 性能优化

- 数据库索引优化
- 查询结果分页
- 热门文章缓存
- 搜索关键词索引
- 懒加载关联数据

---

**文档版本**: v1.0  
**创建日期**: 2025-01-25  
**最后更新**: 2025-01-25