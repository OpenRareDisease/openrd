import express from 'express';
import { pool } from '../config/database';

const router = express.Router();

// 创建档案
router.post('/profiles', async (req, res) => {
    try {
        const { userId, fullName, idNumber, birthDate, gender } = req.body;
        const result = await pool.query(
            'INSERT INTO user_profiles (user_id, full_name, id_number, birth_date, gender) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [userId, fullName, idNumber, birthDate, gender]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 获取档案
router.get('/profiles/:id', async (req, res) => {
    // 实现获取逻辑
});

export default router;
