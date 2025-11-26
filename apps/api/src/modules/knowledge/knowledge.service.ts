import type { Pool } from 'pg';
import type { AppEnv } from '../../config/env.js';
import type { AppLogger } from '../../config/logger.js';
import type {
  IKnowledgeService,
  KnowledgeCategory,
  KnowledgeCategoryWithCount,
  CreateKnowledgeCategory,
  UpdateKnowledgeCategory,
  KnowledgeArticle,
  KnowledgeArticleWithCategory,
  CreateKnowledgeArticle,
  UpdateKnowledgeArticle,
  KnowledgeInteraction,
  KnowledgeQueryParams,
  KnowledgeSearchParams,
  PaginatedResponse
} from './types/knowledge.types.js';

export class KnowledgeService implements IKnowledgeService {
  private pool: Pool;
  private logger: AppLogger;
  private env: AppEnv;

  constructor(dependencies: { pool: Pool; logger: AppLogger; env: AppEnv }) {
    this.pool = dependencies.pool;
    this.logger = dependencies.logger;
    this.env = dependencies.env;
  }

  // 分类相关方法
  async getCategories(parentId?: string): Promise<KnowledgeCategoryWithCount[]> {
    try {
      let query = `
        SELECT 
          kc.*,
          COUNT(ka.id) as article_count
        FROM knowledge_categories kc
        LEFT JOIN knowledge_articles ka ON kc.id = ka.category_id AND ka.status = 'published'
        WHERE kc.is_active = true
      `;

      const params: any[] = [];

      if (parentId) {
        query += ` AND kc.parent_id = $1`;
        params.push(parentId);
      } else {
        query += ` AND kc.parent_id IS NULL`;
      }

      query += ` GROUP BY kc.id ORDER BY kc.sort_order ASC, kc.name ASC`;

      const result = await this.pool.query(query, params);
      return result.rows.map(row => ({
        ...row,
        article_count: parseInt(row.article_count, 10)
      }));
    } catch (error) {
      this.logger.error({ error }, '获取知识分类失败');
      throw error;
    }
  }

  async getCategoryById(id: string): Promise<KnowledgeCategory | null> {
    try {
      const result = await this.pool.query(
        'SELECT * FROM knowledge_categories WHERE id = $1 AND is_active = true',
        [id]
      );
      return result.rows[0] || null;
    } catch (error) {
      this.logger.error({ error, id }, '获取知识分类详情失败');
      throw error;
    }
  }

  async createCategory(data: CreateKnowledgeCategory): Promise<KnowledgeCategory> {
    try {
      const result = await this.pool.query(
        `INSERT INTO knowledge_categories (name, description, parent_id, sort_order, is_active)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [data.name, data.description, data.parent_id, data.sort_order, data.is_active]
      );
      return result.rows[0];
    } catch (error) {
      this.logger.error({ error, data }, '创建知识分类失败');
      throw error;
    }
  }

  async updateCategory(id: string, data: UpdateKnowledgeCategory): Promise<KnowledgeCategory> {
    try {
      const fields: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      Object.entries(data).forEach(([key, value]) => {
        if (value !== undefined) {
          fields.push(`${key} = $${paramCount}`);
          values.push(value);
          paramCount++;
        }
      });

      if (fields.length === 0) {
        throw new Error('没有提供更新字段');
      }

      values.push(id);
      const query = `UPDATE knowledge_categories SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`;
      
      const result = await this.pool.query(query, values);
      if (result.rows.length === 0) {
        throw new Error('分类不存在');
      }
      return result.rows[0];
    } catch (error) {
      this.logger.error({ error, id, data }, '更新知识分类失败');
      throw error;
    }
  }

  async deleteCategory(id: string): Promise<boolean> {
    try {
      // 检查是否有子分类
      const subCategories = await this.pool.query(
        'SELECT id FROM knowledge_categories WHERE parent_id = $1 AND is_active = true',
        [id]
      );

      if (subCategories.rows.length > 0) {
        throw new Error('无法删除包含子分类的分类');
      }

      // 检查是否有文章
      const articles = await this.pool.query(
        'SELECT id FROM knowledge_articles WHERE category_id = $1',
        [id]
      );

      if (articles.rows.length > 0) {
        throw new Error('无法删除包含文章的分类');
      }

      // 软删除：标记为不活跃
      const result = await this.pool.query(
        'UPDATE knowledge_categories SET is_active = false WHERE id = $1',
        [id]
      );

      return result.rowCount > 0;
    } catch (error) {
      this.logger.error({ error, id }, '删除知识分类失败');
      throw error;
    }
  }

  // 文章相关方法
  async getArticles(params: KnowledgeQueryParams): Promise<PaginatedResponse<KnowledgeArticleWithCategory>> {
    try {
      const {
        category_id,
        status,
        is_featured,
        tags,
        search,
        page = 1,
        limit = 20,
        sort_by = 'created_at',
        sort_order = 'desc'
      } = params;

      let whereConditions = ['1=1'];
      const queryParams: any[] = [];
      let paramCount = 1;

      if (category_id) {
        whereConditions.push(`ka.category_id = $${paramCount}`);
        queryParams.push(category_id);
        paramCount++;
      }

      if (status) {
        whereConditions.push(`ka.status = $${paramCount}`);
        queryParams.push(status);
        paramCount++;
      }

      if (is_featured !== undefined) {
        whereConditions.push(`ka.is_featured = $${paramCount}`);
        queryParams.push(is_featured);
        paramCount++;
      }

      if (tags) {
        const tagArray = tags.split(',').map(tag => tag.trim());
        whereConditions.push(`ka.tags && $${paramCount}`);
        queryParams.push(tagArray);
        paramCount++;
      }

      if (search) {
        whereConditions.push(`(ka.title ILIKE $${paramCount} OR ka.content ILIKE $${paramCount})`);
        queryParams.push(`%${search}%`);
        paramCount++;
      }

      // 计算总数
      const countQuery = `
        SELECT COUNT(*) as total
        FROM knowledge_articles ka
        WHERE ${whereConditions.join(' AND ')}
      `;
      const countResult = await this.pool.query(countQuery, queryParams);
      const total = parseInt(countResult.rows[0].total, 10);

      // 获取数据
      const offset = (page - 1) * limit;
      const dataQuery = `
        SELECT 
          ka.*,
          kc.name as category_name
        FROM knowledge_articles ka
        LEFT JOIN knowledge_categories kc ON ka.category_id = kc.id
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY ka.${sort_by} ${sort_order.toUpperCase()}
        LIMIT $${paramCount} OFFSET $${paramCount + 1}
      `;
      
      const dataParams = [...queryParams, limit, offset];
      const dataResult = await this.pool.query(dataQuery, dataParams);

      return {
        items: dataResult.rows,
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
      };
    } catch (error) {
      this.logger.error({ error, params }, '获取文章列表失败');
      throw error;
    }
  }

  async getArticleById(id: string): Promise<KnowledgeArticleWithCategory | null> {
    try {
      const result = await this.pool.query(
        `SELECT 
          ka.*,
          kc.name as category_name
         FROM knowledge_articles ka
         LEFT JOIN knowledge_categories kc ON ka.category_id = kc.id
         WHERE ka.id = $1`,
        [id]
      );
      return result.rows[0] || null;
    } catch (error) {
      this.logger.error({ error, id }, '获取文章详情失败');
      throw error;
    }
  }

  async createArticle(data: CreateKnowledgeArticle): Promise<KnowledgeArticle> {
    try {
      const result = await this.pool.query(
        `INSERT INTO knowledge_articles (
          category_id, title, content, summary, author, source, tags, 
          status, is_featured, metadata, created_by, updated_by, published_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *`,
        [
          data.category_id,
          data.title,
          data.content,
          data.summary,
          data.author,
          data.source,
          data.tags,
          data.status,
          data.is_featured,
          data.metadata,
          data.created_by,
          data.updated_by,
          data.status === 'published' ? new Date().toISOString() : null
        ]
      );
      return result.rows[0];
    } catch (error) {
      this.logger.error({ error, data }, '创建文章失败');
      throw error;
    }
  }

  async updateArticle(id: string, data: UpdateKnowledgeArticle): Promise<KnowledgeArticle> {
    try {
      const fields: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      Object.entries(data).forEach(([key, value]) => {
        if (value !== undefined) {
          // 特殊处理状态变更
          if (key === 'status' && value === 'published') {
            fields.push('published_at = $' + paramCount);
            values.push(new Date().toISOString());
            paramCount++;
          }
          
          fields.push(`${key} = $${paramCount}`);
          values.push(value);
          paramCount++;
        }
      });

      if (fields.length === 0) {
        throw new Error('没有提供更新字段');
      }

      values.push(id);
      const query = `UPDATE knowledge_articles SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`;
      
      const result = await this.pool.query(query, values);
      if (result.rows.length === 0) {
        throw new Error('文章不存在');
      }
      return result.rows[0];
    } catch (error) {
      this.logger.error({ error, id, data }, '更新文章失败');
      throw error;
    }
  }

  async deleteArticle(id: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        'DELETE FROM knowledge_articles WHERE id = $1',
        [id]
      );
      return result.rowCount > 0;
    } catch (error) {
      this.logger.error({ error, id }, '删除文章失败');
      throw error;
    }
  }

  async incrementViewCount(id: string): Promise<void> {
    try {
      await this.pool.query(
        'UPDATE knowledge_articles SET view_count = view_count + 1 WHERE id = $1',
        [id]
      );
    } catch (error) {
      this.logger.error({ error, id }, '增加文章浏览次数失败');
      throw error;
    }
  }

  // 搜索相关方法
  async searchArticles(params: KnowledgeSearchParams): Promise<PaginatedResponse<KnowledgeArticleWithCategory>> {
    try {
      const { q, category_id, tags, page = 1, limit = 20 } = params;

      let whereConditions = ['ka.status = $1'];
      const queryParams: any[] = ['published'];
      let paramCount = 2;

      // 搜索条件
      whereConditions.push(`(
        ka.title ILIKE $${paramCount} OR 
        ka.content ILIKE $${paramCount} OR 
        ka.summary ILIKE $${paramCount} OR
        ka.tags::text ILIKE $${paramCount}
      )`);
      queryParams.push(`%${q}%`);
      paramCount++;

      if (category_id) {
        whereConditions.push(`ka.category_id = $${paramCount}`);
        queryParams.push(category_id);
        paramCount++;
      }

      if (tags) {
        const tagArray = tags.split(',').map(tag => tag.trim());
        whereConditions.push(`ka.tags && $${paramCount}`);
        queryParams.push(tagArray);
        paramCount++;
      }

      // 计算总数
      const countQuery = `
        SELECT COUNT(*) as total
        FROM knowledge_articles ka
        WHERE ${whereConditions.join(' AND ')}
      `;
      const countResult = await this.pool.query(countQuery, queryParams);
      const total = parseInt(countResult.rows[0].total, 10);

      // 获取数据
      const offset = (page - 1) * limit;
      const dataQuery = `
        SELECT 
          ka.*,
          kc.name as category_name,
          ts_rank_cd(
            setweight(to_tsvector('chinese', ka.title), 'A') || 
            setweight(to_tsvector('chinese', coalesce(ka.summary, '')), 'B') ||
            setweight(to_tsvector('chinese', ka.content), 'C'),
            plainto_tsquery('chinese', $${paramCount})
          ) as rank
        FROM knowledge_articles ka
        LEFT JOIN knowledge_categories kc ON ka.category_id = kc.id
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY rank DESC, ka.created_at DESC
        LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
      `;
      
      const dataParams = [...queryParams, q, limit, offset];
      const dataResult = await this.pool.query(dataQuery, dataParams);

      return {
        items: dataResult.rows,
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
      };
    } catch (error) {
      this.logger.error({ error, params }, '搜索文章失败');
      throw error;
    }
  }

  // 互动相关方法
  async recordInteraction(data: Omit<KnowledgeInteraction, 'id' | 'created_at'>): Promise<KnowledgeInteraction> {
    try {
      // 检查是否已经存在相同的互动记录
      const existing = await this.pool.query(
        'SELECT id FROM knowledge_interactions WHERE user_id = $1 AND article_id = $2 AND interaction_type = $3',
        [data.user_id, data.article_id, data.interaction_type]
      );

      if (existing.rows.length > 0) {
        // 更新现有记录
        const result = await this.pool.query(
          'UPDATE knowledge_interactions SET interaction_data = $1, created_at = NOW() WHERE id = $2 RETURNING *',
          [data.interaction_data, existing.rows[0].id]
        );
        return result.rows[0];
      } else {
        // 创建新记录
        const result = await this.pool.query(
          'INSERT INTO knowledge_interactions (user_id, article_id, interaction_type, interaction_data) VALUES ($1, $2, $3, $4) RETURNING *',
          [data.user_id, data.article_id, data.interaction_type, data.interaction_data]
        );
        return result.rows[0];
      }
    } catch (error) {
      this.logger.error({ error, data }, '记录用户互动失败');
      throw error;
    }
  }

  async getUserInteractions(userId: string, articleId?: string): Promise<KnowledgeInteraction[]> {
    try {
      let query = 'SELECT * FROM knowledge_interactions WHERE user_id = $1';
      const params: any[] = [userId];

      if (articleId) {
        query += ' AND article_id = $2';
        params.push(articleId);
      }

      query += ' ORDER BY created_at DESC';

      const result = await this.pool.query(query, params);
      return result.rows;
    } catch (error) {
      this.logger.error({ error, userId, articleId }, '获取用户互动记录失败');
      throw error;
    }
  }
}