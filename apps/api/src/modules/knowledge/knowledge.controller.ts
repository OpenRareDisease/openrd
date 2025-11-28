import type { Request, Response } from 'express';
import type { IKnowledgeService } from './types/knowledge.types.js';
import {
  CreateKnowledgeCategorySchema,
  UpdateKnowledgeCategorySchema,
  CreateKnowledgeArticleSchema,
  UpdateKnowledgeArticleSchema,
  KnowledgeQueryParamsSchema,
  KnowledgeSearchParamsSchema,
  type ApiResponse
} from './types/knowledge.types.js';

export class KnowledgeController {
  private service: IKnowledgeService;

  constructor(service: IKnowledgeService) {
    this.service = service;
  }

  // 分类相关控制器方法
  async getCategories(req: Request, res: Response) {
    try {
      const parentId = req.query.parent_id as string | undefined;
      const categories = await this.service.getCategories(parentId);

      const response: ApiResponse<any> = {
        success: true,
        data: categories
      };
      res.json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        success: false,
        error: error.message || '获取分类列表失败'
      };
      res.status(500).json(response);
    }
  }

  async getCategoryById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const category = await this.service.getCategoryById(id);

      if (!category) {
        const response: ApiResponse<null> = {
          success: false,
          error: '分类不存在'
        };
        return res.status(404).json(response);
      }

      const response: ApiResponse<any> = {
        success: true,
        data: category
      };
      res.json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        success: false,
        error: error.message || '获取分类详情失败'
      };
      res.status(500).json(response);
    }
  }

  async createCategory(req: Request, res: Response) {
    try {
      const validationResult = CreateKnowledgeCategorySchema.safeParse(req.body);
      
      if (!validationResult.success) {
        const response: ApiResponse<null> = {
          success: false,
          error: '请求数据验证失败',
          message: validationResult.error.errors.map(err => `${err.path}: ${err.message}`).join(', ')
        };
        return res.status(400).json(response);
      }

      const category = await this.service.createCategory(validationResult.data);
      
      const response: ApiResponse<any> = {
        success: true,
        data: category,
        message: '分类创建成功'
      };
      res.status(201).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        success: false,
        error: error.message || '创建分类失败'
      };
      res.status(500).json(response);
    }
  }

  async updateCategory(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const validationResult = UpdateKnowledgeCategorySchema.safeParse(req.body);
      
      if (!validationResult.success) {
        const response: ApiResponse<null> = {
          success: false,
          error: '请求数据验证失败',
          message: validationResult.error.errors.map(err => `${err.path}: ${err.message}`).join(', ')
        };
        return res.status(400).json(response);
      }

      const category = await this.service.updateCategory(id, validationResult.data);
      
      const response: ApiResponse<any> = {
        success: true,
        data: category,
        message: '分类更新成功'
      };
      res.json(response);
    } catch (error: any) {
      const status = error.message.includes('不存在') ? 404 : 500;
      const response: ApiResponse<null> = {
        success: false,
        error: error.message || '更新分类失败'
      };
      res.status(status).json(response);
    }
  }

  async deleteCategory(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const success = await this.service.deleteCategory(id);

      if (!success) {
        const response: ApiResponse<null> = {
          success: false,
          error: '分类不存在或删除失败'
        };
        return res.status(404).json(response);
      }

      const response: ApiResponse<null> = {
        success: true,
        message: '分类删除成功'
      };
      res.json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        success: false,
        error: error.message || '删除分类失败'
      };
      res.status(500).json(response);
    }
  }

  // 文章相关控制器方法
  async getArticles(req: Request, res: Response) {
    try {
      const validationResult = KnowledgeQueryParamsSchema.safeParse(req.query);
      
      if (!validationResult.success) {
        const response: ApiResponse<null> = {
          success: false,
          error: '查询参数验证失败',
          message: validationResult.error.errors.map(err => `${err.path}: ${err.message}`).join(', ')
        };
        return res.status(400).json(response);
      }

      const result = await this.service.getArticles(validationResult.data);
      
      const response: ApiResponse<any> = {
        success: true,
        data: result
      };
      res.json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        success: false,
        error: error.message || '获取文章列表失败'
      };
      res.status(500).json(response);
    }
  }

  async getArticleById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const article = await this.service.getArticleById(id);

      if (!article) {
        const response: ApiResponse<null> = {
          success: false,
          error: '文章不存在'
        };
        return res.status(404).json(response);
      }

      // 记录浏览行为（异步，不等待）
      if (req.user?.id) {
        this.service.recordInteraction({
          user_id: req.user.id,
          article_id: id,
          interaction_type: 'view'
        }).catch(error => {
          console.error('记录浏览行为失败:', error);
        });
      }

      // 增加浏览次数（异步，不等待）
      this.service.incrementViewCount(id).catch(error => {
        console.error('增加浏览次数失败:', error);
      });

      const response: ApiResponse<any> = {
        success: true,
        data: article
      };
      res.json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        success: false,
        error: error.message || '获取文章详情失败'
      };
      res.status(500).json(response);
    }
  }

  async createArticle(req: Request, res: Response) {
    try {
      const validationResult = CreateKnowledgeArticleSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        const response: ApiResponse<null> = {
          success: false,
          error: '请求数据验证失败',
          message: validationResult.error.errors.map(err => `${err.path}: ${err.message}`).join(', ')
        };
        return res.status(400).json(response);
      }

      // 添加创建者信息
      const articleData = {
        ...validationResult.data,
        created_by: req.user?.id,
        updated_by: req.user?.id
      };

      const article = await this.service.createArticle(articleData);
      
      const response: ApiResponse<any> = {
        success: true,
        data: article,
        message: '文章创建成功'
      };
      res.status(201).json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        success: false,
        error: error.message || '创建文章失败'
      };
      res.status(500).json(response);
    }
  }

  async updateArticle(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const validationResult = UpdateKnowledgeArticleSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        const response: ApiResponse<null> = {
          success: false,
          error: '请求数据验证失败',
          message: validationResult.error.errors.map(err => `${err.path}: ${err.message}`).join(', ')
        };
        return res.status(400).json(response);
      }

      // 添加更新者信息
      const articleData = {
        ...validationResult.data,
        updated_by: req.user?.id
      };

      const article = await this.service.updateArticle(id, articleData);
      
      const response: ApiResponse<any> = {
        success: true,
        data: article,
        message: '文章更新成功'
      };
      res.json(response);
    } catch (error: any) {
      const status = error.message.includes('不存在') ? 404 : 500;
      const response: ApiResponse<null> = {
        success: false,
        error: error.message || '更新文章失败'
      };
      res.status(status).json(response);
    }
  }

  async deleteArticle(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const success = await this.service.deleteArticle(id);

      if (!success) {
        const response: ApiResponse<null> = {
          success: false,
          error: '文章不存在或删除失败'
        };
        return res.status(404).json(response);
      }

      const response: ApiResponse<null> = {
        success: true,
        message: '文章删除成功'
      };
      res.json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        success: false,
        error: error.message || '删除文章失败'
      };
      res.status(500).json(response);
    }
  }

  // 搜索相关控制器方法
  async searchArticles(req: Request, res: Response) {
    try {
      const validationResult = KnowledgeSearchParamsSchema.safeParse(req.query);
      
      if (!validationResult.success) {
        const response: ApiResponse<null> = {
          success: false,
          error: '搜索参数验证失败',
          message: validationResult.error.errors.map(err => `${err.path}: ${err.message}`).join(', ')
        };
        return res.status(400).json(response);
      }

      const result = await this.service.searchArticles(validationResult.data);
      
      const response: ApiResponse<any> = {
        success: true,
        data: result
      };
      res.json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        success: false,
        error: error.message || '搜索文章失败'
      };
      res.status(500).json(response);
    }
  }

  // 互动相关控制器方法
  async likeArticle(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        const response: ApiResponse<null> = {
          success: false,
          error: '用户未登录'
        };
        return res.status(401).json(response);
      }

      // 记录点赞行为
      const interaction = await this.service.recordInteraction({
        user_id: userId,
        article_id: id,
        interaction_type: 'like',
        interaction_data: { timestamp: new Date().toISOString() }
      });

      const response: ApiResponse<any> = {
        success: true,
        data: interaction,
        message: '点赞成功'
      };
      res.json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        success: false,
        error: error.message || '点赞失败'
      };
      res.status(500).json(response);
    }
  }

  async bookmarkArticle(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        const response: ApiResponse<null> = {
          success: false,
          error: '用户未登录'
        };
        return res.status(401).json(response);
      }

      // 记录收藏行为
      const interaction = await this.service.recordInteraction({
        user_id: userId,
        article_id: id,
        interaction_type: 'bookmark',
        interaction_data: { timestamp: new Date().toISOString() }
      });

      const response: ApiResponse<any> = {
        success: true,
        data: interaction,
        message: '收藏成功'
      };
      res.json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        success: false,
        error: error.message || '收藏失败'
      };
      res.status(500).json(response);
    }
  }

  async getUserInteractions(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const { articleId } = req.query;

      if (!userId) {
        const response: ApiResponse<null> = {
          success: false,
          error: '用户未登录'
        };
        return res.status(401).json(response);
      }

      const interactions = await this.service.getUserInteractions(
        userId, 
        articleId as string | undefined
      );

      const response: ApiResponse<any> = {
        success: true,
        data: interactions
      };
      res.json(response);
    } catch (error: any) {
      const response: ApiResponse<null> = {
        success: false,
        error: error.message || '获取用户互动记录失败'
      };
      res.status(500).json(response);
    }
  }
}