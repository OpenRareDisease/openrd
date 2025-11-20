import express from 'express';
import { getPool } from '../db/pool.js';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js'; // 认证中间件

const router = express.Router();

// 输入验证模式
const createProfileSchema = z.object({
  fullName: z.string().min(1).max(100),
  idNumber: z.string().min(1).max(50).optional(),
  birthDate: z.string().optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
});

// 应用认证中间件到所有 profiles 路由
router.use(authenticate);

// 创建档案 
router.post('/', async (req, res) => {
  try {
    // 输入验证
    const validatedData = createProfileSchema.parse(req.body);
    
    // 从认证用户获取 ID，
    const userId = (req as any).user.id; // 根据认证系统调整
    
    const pool = getPool(); 
    const result = await pool.query(
      'INSERT INTO user_profiles (user_id, full_name, id_number, birth_date, gender) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [userId, validatedData.fullName, validatedData.idNumber, validatedData.birthDate, validatedData.gender]
    );
    
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid input', 
        details: error.errors 
      });
    }
    
    console.error('Create profile error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// 获取档案 - 需要完整实现
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();
    
    const result = await pool.query(
      'SELECT * FROM user_profiles WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Profile not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;