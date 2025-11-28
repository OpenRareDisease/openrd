-- FSHD-openrd 知识库模块数据库迁移脚本
-- 创建知识库相关表结构

-- 知识分类表
CREATE TABLE knowledge_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    parent_id UUID REFERENCES knowledge_categories(id),
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 知识条目表
CREATE TABLE knowledge_articles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id UUID NOT NULL REFERENCES knowledge_categories(id),
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    summary TEXT,
    author VARCHAR(100),
    source VARCHAR(255),
    tags TEXT[] DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'draft',
    view_count INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    is_featured BOOLEAN DEFAULT FALSE,
    metadata JSONB,
    created_by UUID REFERENCES app_users(id),
    updated_by UUID REFERENCES app_users(id),
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 知识标签表
CREATE TABLE knowledge_tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    color VARCHAR(7),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 用户互动表
CREATE TABLE knowledge_interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES app_users(id),
    article_id UUID NOT NULL REFERENCES knowledge_articles(id),
    interaction_type VARCHAR(20) NOT NULL,
    interaction_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建索引
CREATE INDEX idx_knowledge_categories_parent_id ON knowledge_categories(parent_id);
CREATE INDEX idx_knowledge_categories_sort_order ON knowledge_categories(sort_order);

CREATE INDEX idx_knowledge_articles_category_id ON knowledge_articles(category_id);
CREATE INDEX idx_knowledge_articles_status ON knowledge_articles(status);
CREATE INDEX idx_knowledge_articles_published_at ON knowledge_articles(published_at);
CREATE INDEX idx_knowledge_articles_is_featured ON knowledge_articles(is_featured);
CREATE INDEX idx_knowledge_articles_title ON knowledge_articles(title);
CREATE INDEX idx_knowledge_articles_tags ON knowledge_articles USING GIN(tags);

CREATE INDEX idx_knowledge_interactions_user_article ON knowledge_interactions(user_id, article_id);
CREATE INDEX idx_knowledge_interactions_type ON knowledge_interactions(interaction_type);

-- 创建更新时间触发器函数（如果不存在）
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 为知识分类表添加更新时间触发器
CREATE TRIGGER knowledge_categories_set_updated_at
    BEFORE UPDATE ON knowledge_categories
    FOR EACH ROW
    EXECUTE PROCEDURE set_updated_at();

-- 为知识条目表添加更新时间触发器
CREATE TRIGGER knowledge_articles_set_updated_at
    BEFORE UPDATE ON knowledge_articles
    FOR EACH ROW
    EXECUTE PROCEDURE set_updated_at();

-- 插入初始数据：FSHD知识库分类
INSERT INTO knowledge_categories (name, description, sort_order) VALUES
('FSHD基础知识', '面肩肱型肌营养不良症的基本概念、病因和遗传机制', 1),
('症状管理', 'FSHD常见症状的识别、评估和管理方法', 2),
('康复训练', '针对FSHD患者的物理治疗和康复锻炼方案', 3),
('日常生活', 'FSHD患者的日常护理、生活技巧和辅助设备', 4),
('药物治疗', 'FSHD相关的药物治疗、临床试验和最新研究', 5),
('心理支持', 'FSHD患者及家属的心理健康支持和应对策略', 6),
('营养指导', 'FSHD患者的营养需求和饮食建议', 7),
('社区资源', 'FSHD相关的支持组织、医疗资源和社区服务', 8);

-- 插入示例知识条目
INSERT INTO knowledge_articles (category_id, title, content, summary, author, status, published_at) VALUES
(
    (SELECT id FROM knowledge_categories WHERE name = 'FSHD基础知识'),
    '什么是面肩肱型肌营养不良症（FSHD）？',
    '面肩肱型肌营养不良症（Facioscapulohumeral Muscular Dystrophy，简称FSHD）是一种遗传性肌肉疾病，主要影响面部、肩胛带和上臂的肌肉。\n\nFSHD的特点：\n- 通常在青少年期或成年早期发病\n- 进展缓慢但具有变异性\n- 主要症状包括面部肌肉无力、肩胛骨翼状突出、上臂无力\n- 部分患者可能出现听力损失、视网膜血管异常等非肌肉症状\n\nFSHD的遗传机制与D4Z4重复序列的缩短有关，导致基因异常表达。目前尚无治愈方法，但可以通过康复训练、辅助设备和症状管理来改善生活质量。',
    'FSHD是一种遗传性肌肉疾病，主要影响面部、肩部和上臂肌肉，本文介绍其基本概念和特点。',
    'FSHD医学专家',
    'published',
    NOW()
),
(
    (SELECT id FROM knowledge_categories WHERE name = '康复训练'),
    'FSHD患者肩部肌肉康复训练指南',
    '针对FSHD患者的肩部肌肉康复训练需要特别注意安全性和有效性。以下是一些推荐的训练方法：\n\n1. 被动关节活动训练\n   - 由治疗师或家属协助进行肩关节各个方向的活动\n   - 每天2-3次，每次10-15分钟\n\n2. 等长收缩训练\n   - 在无关节活动的情况下进行肌肉收缩\n   - 每个动作保持5-10秒，重复10次\n\n3. 抗重力辅助训练\n   - 利用滑轮系统或弹性带减轻重力影响\n   - 重点训练前锯肌和斜方肌下部\n\n4. 功能性训练\n   - 模拟日常活动如梳头、穿衣等\n   - 使用适当的辅助设备\n\n注意事项：\n- 避免过度训练导致肌肉疲劳\n- 训练强度应个体化调整\n- 如有疼痛应立即停止训练',
    '本文提供FSHD患者肩部肌肉康复训练的具体方法和注意事项。',
    '康复治疗师',
    'published',
    NOW()
);

-- 更新任务状态
COMMENT ON TABLE knowledge_categories IS '知识分类表，用于组织FSHD相关知识';
COMMENT ON TABLE knowledge_articles IS '知识条目表，存储具体的FSHD相关知识内容';
COMMENT ON TABLE knowledge_tags IS '知识标签表，用于文章标签管理';
COMMENT ON TABLE knowledge_interactions IS '用户互动表，记录用户对知识条目的浏览、点赞等行为';

-- 为应用角色授予权限（如果存在）
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'openrd_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO openrd_app;
        GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO openrd_app;
    END IF;
END
$$;