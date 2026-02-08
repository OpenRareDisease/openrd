from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime
from typing import List, Any, Dict
import os
import uuid
from app.models.medical_report import MedicalReport
from app.dependencies.database import get_db
from app.services.ocr_service import extract_text_from_file
from app.services.ai_service import analyze_medical_report
from app.services.minio_service import upload_file, get_file_url
from app.dependencies.auth import require_api_key
from main import SessionLocal

router = APIRouter(dependencies=[Depends(require_api_key)])

# Pydantic模型用于请求和响应
class MedicalReportCreate(BaseModel):
    report_name: str
    user_id: int

class MedicalReportUpdate(BaseModel):
    report_name: str | None = None

class MedicalReportResponse(BaseModel):
    id: int
    report_name: str
    user_id: int
    file_path: str
    file_size: int | None = None
    ocr_text: str | None = None
    d4z4_repeats: int | None = None
    methylation_value: float | None = None
    serratus_fatigue_grade: int | None = None
    deltoid_strength: str | None = None
    biceps_strength: str | None = None
    triceps_strength: str | None = None
    quadriceps_strength: str | None = None
    liver_function: str | None = None
    creatine_kinase: float | None = None
    stair_test_result: str | None = None
    ai_extraction: Dict[str, Any] | None = None
    analysis_status: str | None = None
    analysis_error: str | None = None
    processing_started_at: datetime | None = None
    processing_finished_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

@router.post("/", response_model=MedicalReportResponse)
async def create_medical_report(
    file: UploadFile = File(...),
    report_name: str = Form(...),
    user_id: int = Form(...),
    db: Session = Depends(get_db)
):
    """Upload a new medical report"""
    # 验证文件类型（PDF/JPG/PNG）
    is_pdf = file.content_type == "application/pdf" and file.filename.lower().endswith(".pdf")
    is_image = (
        file.content_type in {"image/jpeg", "image/png"}
        and file.filename.lower().endswith((".jpg", ".jpeg", ".png"))
    )
    if not (is_pdf or is_image):
        raise HTTPException(status_code=400, detail="Only PDF or JPG/PNG image files are allowed")
    
    # 保存文件到系统临时目录
    import tempfile
    temp_path = os.path.join(tempfile.gettempdir(), f"{uuid.uuid4()}_{file.filename}")
    with open(temp_path, "wb") as buffer:
        content = await file.read()
        buffer.write(content)
    
    try:
        # 生成唯一的文件名
        file_extension = os.path.splitext(file.filename)[1]
        unique_filename = f"{uuid.uuid4()}{file_extension}"
        
        # 上传文件到MinIO
        minio_file_path = f"reports/{user_id}/{unique_filename}"
        upload_file(temp_path, minio_file_path)
        
        # 获取文件大小
        file_size = os.path.getsize(temp_path)
        
        # 提取文本（PDF或图片）
        ocr_text = extract_text_from_file(temp_path, file.content_type)
        
        # 调用AI分析报告
        ai_results = analyze_medical_report(ocr_text)
        
        # 创建报告记录
        new_report = MedicalReport(
            user_id=user_id,
            report_name=report_name,
            file_path=minio_file_path,
            file_size=file_size,
            ocr_text=ocr_text,
            d4z4_repeats=ai_results.get('d4z4_repeats'),
            methylation_value=ai_results.get('methylation_value'),
            serratus_fatigue_grade=ai_results.get('serratus_fatigue_grade'),
            deltoid_strength=ai_results.get('deltoid_strength'),
            biceps_strength=ai_results.get('biceps_strength'),
            triceps_strength=ai_results.get('triceps_strength'),
            quadriceps_strength=ai_results.get('quadriceps_strength'),
            liver_function=ai_results.get('liver_function'),
            creatine_kinase=ai_results.get('creatine_kinase'),
            stair_test_result=ai_results.get('stair_test_result'),
            ai_extraction=ai_results
        )
        
        db.add(new_report)
        db.commit()
        db.refresh(new_report)
        
        return new_report
    finally:
        # 清理临时文件
        if os.path.exists(temp_path):
            os.remove(temp_path)

@router.post("/upload-and-analyze", response_model=MedicalReportResponse)
async def upload_and_analyze_report(
    file: UploadFile = File(...),
    report_name: str = Form(...),
    user_id: int = Form(...),
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db)
):
    """Upload a PDF medical report, extract text using OCR, and analyze it with AI to extract key medical data items"""
    # 验证文件类型（PDF/JPG/PNG）
    is_pdf = file.content_type == "application/pdf" and file.filename.lower().endswith(".pdf")
    is_image = (
        file.content_type in {"image/jpeg", "image/png"}
        and file.filename.lower().endswith((".jpg", ".jpeg", ".png"))
    )
    if not (is_pdf or is_image):
        raise HTTPException(status_code=400, detail="Only PDF or JPG/PNG image files are allowed")
    
    # 保存文件到系统临时目录
    import tempfile
    temp_path = os.path.join(tempfile.gettempdir(), f"{uuid.uuid4()}_{file.filename}")
    with open(temp_path, "wb") as buffer:
        content = await file.read()
        buffer.write(content)
    
    # 生成唯一的文件名
    file_extension = os.path.splitext(file.filename)[1]
    unique_filename = f"{uuid.uuid4()}{file_extension}"

    # 上传文件到MinIO
    minio_file_path = f"reports/{user_id}/{unique_filename}"
    upload_file(temp_path, minio_file_path)

    # 获取文件大小
    file_size = os.path.getsize(temp_path)

    # 创建报告记录（先进入 processing）
    new_report = MedicalReport(
        user_id=user_id,
        report_name=report_name,
        file_path=minio_file_path,
        file_size=file_size,
        analysis_status='processing'
    )

    db.add(new_report)
    db.commit()
    db.refresh(new_report)

    # 后台处理 OCR + AI
    if background_tasks is not None:
        background_tasks.add_task(
            _process_report_async,
            new_report.id,
            temp_path,
            file.content_type,
        )
    else:
        # fallback: 同步处理
        _process_report_async(new_report.id, temp_path, file.content_type)

    return new_report


def _process_report_async(report_id: int, temp_path: str, content_type: str):
    db = SessionLocal()
    try:
        report = db.query(MedicalReport).filter(MedicalReport.id == report_id).first()
        if not report:
            return

        report.analysis_status = 'processing'
        report.processing_started_at = datetime.utcnow()
        db.commit()

        ocr_text = extract_text_from_file(temp_path, content_type)
        ai_results = analyze_medical_report(ocr_text)

        report.ocr_text = ocr_text
        report.d4z4_repeats = ai_results.get('d4z4_repeats')
        report.methylation_value = ai_results.get('methylation_value')
        report.serratus_fatigue_grade = ai_results.get('serratus_fatigue_grade')
        report.deltoid_strength = ai_results.get('deltoid_strength')
        report.biceps_strength = ai_results.get('biceps_strength')
        report.triceps_strength = ai_results.get('triceps_strength')
        report.quadriceps_strength = ai_results.get('quadriceps_strength')
        report.liver_function = ai_results.get('liver_function')
        report.creatine_kinase = ai_results.get('creatine_kinase')
        report.stair_test_result = ai_results.get('stair_test_result')
        report.ai_extraction = ai_results
        report.analysis_status = 'completed'
        report.analysis_error = None
        report.processing_finished_at = datetime.utcnow()
        db.commit()
    except Exception as e:
        if 'report' in locals() and report:
            report.analysis_status = 'failed'
            report.analysis_error = str(e)
            report.processing_finished_at = datetime.utcnow()
            db.commit()
    finally:
        db.close()
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass

@router.get("/", response_model=List[MedicalReportResponse])
def get_medical_reports(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """Get all medical reports"""
    reports = db.query(MedicalReport).offset(skip).limit(limit).all()
    return reports

@router.get("/{report_id}", response_model=MedicalReportResponse)
def get_medical_report(report_id: int, db: Session = Depends(get_db)):
    """Get a medical report by ID"""
    report = db.query(MedicalReport).filter(MedicalReport.id == report_id).first()
    if report is None:
        raise HTTPException(status_code=404, detail="Medical report not found")
    return report

@router.put("/{report_id}", response_model=MedicalReportResponse)
def update_medical_report(report_id: int, report: MedicalReportUpdate, db: Session = Depends(get_db)):
    """Update a medical report"""
    db_report = db.query(MedicalReport).filter(MedicalReport.id == report_id).first()
    if db_report is None:
        raise HTTPException(status_code=404, detail="Medical report not found")
    
    # 更新报告信息
    update_data = report.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_report, key, value)
    
    db.commit()
    db.refresh(db_report)
    
    return db_report

@router.delete("/{report_id}")
def delete_medical_report(report_id: int, db: Session = Depends(get_db)):
    """Delete a medical report"""
    db_report = db.query(MedicalReport).filter(MedicalReport.id == report_id).first()
    if db_report is None:
        raise HTTPException(status_code=404, detail="Medical report not found")
    
    db.delete(db_report)
    db.commit()
    
    return {"message": "Medical report deleted successfully"}

@router.get("/user/{user_id}", response_model=List[MedicalReportResponse])
def get_user_reports(user_id: int, skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """Get all reports for a specific user"""
    reports = db.query(MedicalReport).filter(MedicalReport.user_id == user_id).offset(skip).limit(limit).all()
    return reports

@router.get("/{report_id}/file")
def get_report_file(report_id: int, db: Session = Depends(get_db)):
    """Get the file URL for a medical report"""
    report = db.query(MedicalReport).filter(MedicalReport.id == report_id).first()
    if report is None:
        raise HTTPException(status_code=404, detail="Medical report not found")
    
    file_url = get_file_url(report.file_path)
    if not file_url:
        raise HTTPException(status_code=500, detail="Failed to get file URL")
    
    return {"file_url": file_url}
