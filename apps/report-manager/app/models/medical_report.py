from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Float, Text, JSON
from sqlalchemy.orm import relationship
from main import Base

class MedicalReport(Base):
    __tablename__ = 'medical_reports'
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    report_name = Column(String(255), nullable=False)
    file_path = Column(String(255), nullable=False)
    file_size = Column(Integer)
    ocr_text = Column(Text)
    
    # AI 分析结果字段
    d4z4_repeats = Column(Integer)  # D4Z4 重复数
    methylation_value = Column(Float)  # 甲基化值
    serratus_fatigue_grade = Column(Integer)  # 前锯肌脂肪化等级
    
    # 肌力评估
    deltoid_strength = Column(String(20))  # 三角肌肌力
    biceps_strength = Column(String(20))  # 肱二头肌肌力
    triceps_strength = Column(String(20))  # 肱三头肌肌力
    quadriceps_strength = Column(String(20))  # 肱四头肌肌力
    
    # 肝功能和肌酸激酶
    liver_function = Column(String(50))  # 肝功能
    creatine_kinase = Column(Float)  # 肌酸激酶
    
    # 楼梯测试
    stair_test_result = Column(String(50))  # 楼梯测试结果

    # AI 结构化抽取结果（完整 JSON）
    ai_extraction = Column(JSON)

    # 解析状态
    analysis_status = Column(String(20), default='pending')  # pending/processing/completed/failed
    analysis_error = Column(Text)
    processing_started_at = Column(DateTime)
    processing_finished_at = Column(DateTime)
    
    # 关系定义
    user = relationship('User', back_populates='medical_reports')
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'report_name': self.report_name,
            'file_path': self.file_path,
            'file_size': self.file_size,
            'ocr_text': self.ocr_text,
            'd4z4_repeats': self.d4z4_repeats,
            'methylation_value': self.methylation_value,
            'serratus_fatigue_grade': self.serratus_fatigue_grade,
            'deltoid_strength': self.deltoid_strength,
            'biceps_strength': self.biceps_strength,
            'triceps_strength': self.triceps_strength,
            'quadriceps_strength': self.quadriceps_strength,
            'liver_function': self.liver_function,
            'creatine_kinase': self.creatine_kinase,
            'stair_test_result': self.stair_test_result,
            'ai_extraction': self.ai_extraction,
            'analysis_status': self.analysis_status,
            'analysis_error': self.analysis_error,
            'processing_started_at': self.processing_started_at.isoformat() if self.processing_started_at else None,
            'processing_finished_at': self.processing_finished_at.isoformat() if self.processing_finished_at else None,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat()
        }
