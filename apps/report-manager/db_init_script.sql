-- PostgreSQL数据库初始化脚本
-- 适用于report_manager_002项目

-- 创建数据库（如果不存在）
SELECT 'CREATE DATABASE report_manager'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'report_manager')\gexec

-- 连接到report_manager数据库
\c report_manager;

-- 创建用户表
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    full_name VARCHAR(100),
    phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建医学报告表
CREATE TABLE IF NOT EXISTS medical_reports (
    id SERIAL PRIMARY KEY,
    report_name VARCHAR(255) NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_path VARCHAR(255) NOT NULL,
    file_size INTEGER,
    ocr_text TEXT,
    ai_extraction JSONB,
    d4z4_repeats INTEGER,
    methylation_value FLOAT,
    serratus_fatigue_grade INTEGER,
    deltoid_strength VARCHAR(50),
    biceps_strength VARCHAR(50),
    triceps_strength VARCHAR(50),
    quadriceps_strength VARCHAR(50),
    liver_function VARCHAR(255),
    creatine_kinase FLOAT,
    stair_test_result VARCHAR(255),
    analysis_status VARCHAR(20) DEFAULT 'pending',
    analysis_error TEXT,
    processing_started_at TIMESTAMP,
    processing_finished_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 确保新增字段存在（用于已有数据库）
ALTER TABLE medical_reports
ADD COLUMN IF NOT EXISTS ai_extraction JSONB;
ALTER TABLE medical_reports
ADD COLUMN IF NOT EXISTS analysis_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE medical_reports
ADD COLUMN IF NOT EXISTS analysis_error TEXT;
ALTER TABLE medical_reports
ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMP;
ALTER TABLE medical_reports
ADD COLUMN IF NOT EXISTS processing_finished_at TIMESTAMP;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_medical_reports_user_id ON medical_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_medical_reports_created_at ON medical_reports(created_at);

-- 插入测试用户
INSERT INTO users (username, password, email, full_name) 
VALUES ('test_user', 'hashed_password', 'test@example.com', 'Test User')
ON CONFLICT (username) DO NOTHING;

-- 插入测试报告
INSERT INTO medical_reports (report_name, user_id, file_path) 
VALUES ('Test Report', 1, 'reports/1/test_report.pdf')
ON CONFLICT DO NOTHING;

-- 显示创建的表
\dt;

-- 显示表结构
\d users;
\d medical_reports;

-- 显示数据库统计信息
\l report_manager;
