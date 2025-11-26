import { z } from 'zod';

// 知识分类相关类型
export const KnowledgeCategorySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  parent_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});

export const CreateKnowledgeCategorySchema = KnowledgeCategorySchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export const UpdateKnowledgeCategorySchema = CreateKnowledgeCategorySchema.partial();

export type KnowledgeCategory = z.infer<typeof KnowledgeCategorySchema>;
export type CreateKnowledgeCategory = z.infer<typeof CreateKnowledgeCategorySchema>;
export type UpdateKnowledgeCategory = z.infer<typeof UpdateKnowledgeCategorySchema>;

// 知识条目相关类型
export const KnowledgeArticleSchema = z.object({
  id: z.string().uuid().optional(),
  category_id: z.string().uuid(),
  title: z.string().min(1).max(255),
  content: z.string().min(1),
  summary: z.string().optional(),
  author: z.string().max(100).optional(),
  source: z.string().max(255).optional(),
  tags: z.array(z.string()).default([]),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  view_count: z.number().int().default(0),
  like_count: z.number().int().default(0),
  is_featured: z.boolean().default(false),
  metadata: z.record(z.any()).optional(),
  created_by: z.string().uuid().optional(),
  updated_by: z.string().uuid().optional(),
  published_at: z.string().datetime().nullable().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});

export const CreateKnowledgeArticleSchema = KnowledgeArticleSchema.omit({
  id: true,
  view_count: true,
  like_count: true,
  created_at: true,
  updated_at: true,
});

export const UpdateKnowledgeArticleSchema = CreateKnowledgeArticleSchema.partial();

export type KnowledgeArticle = z.infer<typeof KnowledgeArticleSchema>;
export type CreateKnowledgeArticle = z.infer<typeof CreateKnowledgeArticleSchema>;
export type UpdateKnowledgeArticle = z.infer<typeof UpdateKnowledgeArticleSchema>;

// 用户互动相关类型
export const KnowledgeInteractionSchema = z.object({
  id: z.string().uuid().optional(),
  user_id: z.string().uuid(),
  article_id: z.string().uuid(),
  interaction_type: z.enum(['view', 'like', 'share', 'bookmark']),
  interaction_data: z.record(z.any()).optional(),
  created_at: z.string().datetime().optional(),
});

export type KnowledgeInteraction = z.infer<typeof KnowledgeInteractionSchema>;

// 查询参数类型
export const KnowledgeQueryParamsSchema = z.object({
  category_id: z.string().uuid().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  is_featured: z.boolean().optional(),
  tags: z.string().optional(), // 逗号分隔的标签
  search: z.string().optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  sort_by: z.enum(['created_at', 'updated_at', 'published_at', 'title', 'view_count', 'like_count']).default('created_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
});

export type KnowledgeQueryParams = z.infer<typeof KnowledgeQueryParamsSchema>;

// 搜索参数类型
export const KnowledgeSearchParamsSchema = z.object({
  q: z.string().min(1),
  category_id: z.string().uuid().optional(),
  tags: z.string().optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

export type KnowledgeSearchParams = z.infer<typeof KnowledgeSearchParamsSchema>;

// API响应类型
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

// 知识分类详情（包含文章数量）
export interface KnowledgeCategoryWithCount extends KnowledgeCategory {
  article_count: number;
}

// 知识条目详情（包含分类信息）
export interface KnowledgeArticleWithCategory extends KnowledgeArticle {
  category_name?: string;
}

// 服务层接口
export interface IKnowledgeService {
  // 分类相关方法
  getCategories(parentId?: string): Promise<KnowledgeCategoryWithCount[]>;
  getCategoryById(id: string): Promise<KnowledgeCategory | null>;
  createCategory(data: CreateKnowledgeCategory): Promise<KnowledgeCategory>;
  updateCategory(id: string, data: UpdateKnowledgeCategory): Promise<KnowledgeCategory>;
  deleteCategory(id: string): Promise<boolean>;

  // 文章相关方法
  getArticles(params: KnowledgeQueryParams): Promise<PaginatedResponse<KnowledgeArticleWithCategory>>;
  getArticleById(id: string): Promise<KnowledgeArticleWithCategory | null>;
  createArticle(data: CreateKnowledgeArticle): Promise<KnowledgeArticle>;
  updateArticle(id: string, data: UpdateKnowledgeArticle): Promise<KnowledgeArticle>;
  deleteArticle(id: string): Promise<boolean>;
  incrementViewCount(id: string): Promise<void>;

  // 搜索相关方法
  searchArticles(params: KnowledgeSearchParams): Promise<PaginatedResponse<KnowledgeArticleWithCategory>>;

  // 互动相关方法
  recordInteraction(data: Omit<KnowledgeInteraction, 'id' | 'created_at'>): Promise<KnowledgeInteraction>;
  getUserInteractions(userId: string, articleId?: string): Promise<KnowledgeInteraction[]>;
}