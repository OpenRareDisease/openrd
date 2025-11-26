import { Router } from 'express';
import type { RouteContext } from '../../routes/index.js';
import { getPool } from '../../db/pool.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { KnowledgeService } from './knowledge.service.js';
import { KnowledgeController } from './knowledge.controller.js';

export const createKnowledgeRouter = (context: RouteContext) => {
  const router = Router();
  const service = new KnowledgeService({
    pool: getPool(),
    logger: context.logger,
    env: context.env
  });
  const controller = new KnowledgeController(service);

  // 分类相关路由
  router.get('/categories', asyncHandler(controller.getCategories.bind(controller)));
  router.get('/categories/:id', asyncHandler(controller.getCategoryById.bind(controller)));
  router.post('/categories', asyncHandler(controller.createCategory.bind(controller)));
  router.put('/categories/:id', asyncHandler(controller.updateCategory.bind(controller)));
  router.delete('/categories/:id', asyncHandler(controller.deleteCategory.bind(controller)));

  // 文章相关路由
  router.get('/articles', asyncHandler(controller.getArticles.bind(controller)));
  router.get('/articles/:id', asyncHandler(controller.getArticleById.bind(controller)));
  router.post('/articles', asyncHandler(controller.createArticle.bind(controller)));
  router.put('/articles/:id', asyncHandler(controller.updateArticle.bind(controller)));
  router.delete('/articles/:id', asyncHandler(controller.deleteArticle.bind(controller)));

  // 搜索路由
  router.get('/search', asyncHandler(controller.searchArticles.bind(controller)));

  // 用户互动路由
  router.post('/articles/:id/like', asyncHandler(controller.likeArticle.bind(controller)));
  router.post('/articles/:id/bookmark', asyncHandler(controller.bookmarkArticle.bind(controller)));
  router.get('/interactions', asyncHandler(controller.getUserInteractions.bind(controller)));

  return router;
};

// 导出路由创建函数
export default createKnowledgeRouter;