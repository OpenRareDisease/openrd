from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from config import Config

# 创建数据库引擎
engine = create_engine(Config.SQLALCHEMY_DATABASE_URI)

# 创建会话工厂
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 创建基础模型类
Base = declarative_base()

# 创建FastAPI应用
app = FastAPI(
    title="Report Manager API",
    description="API for managing medical reports",
    version="1.0.0",
    docs_url="/swagger"
)

# 配置CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 导入模型
from app.models import user, medical_report

# 创建数据库表
Base.metadata.create_all(bind=engine)

# 导入路由
from app.routes import user_routes, report_routes

# 注册路由
app.include_router(user_routes.router, prefix="/api/users", tags=["users"])
app.include_router(report_routes.router, prefix="/api/reports", tags=["reports"])

@app.on_event("startup")
def log_config():
    # Production safety checks
    if Config.ENV == "production":
        if not Config.SECRET_KEY:
            raise RuntimeError("REPORT_MANAGER_SECRET_KEY (or SECRET_KEY) must be set in production")
        if not Config.API_KEY:
            raise RuntimeError("REPORT_MANAGER_API_KEY must be set in production")
        if Config.MINIO_ACCESS_KEY in {"", "minioadmin"} or Config.MINIO_SECRET_KEY in {"", "minioadmin", "minioadmin12345678"}:
            raise RuntimeError("MinIO credentials must be set to non-default values in production")
    print(
        "AI config: "
        f"enable_parallel={Config.AI_ENABLE_PARALLEL} "
        f"chunk_chars={Config.AI_CHUNK_CHARS} "
        f"parallelism={Config.AI_PARALLELISM} "
        f"connect_timeout={Config.AI_CONNECT_TIMEOUT} "
        f"read_timeout={Config.AI_READ_TIMEOUT}",
        flush=True
    )

@app.get("/")
def root():
    return {"message": "Report Manager API"}

@app.get("/healthz")
def healthz():
    status = {"status": "ok"}
    ok = True

    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        status["db"] = "ok"
    except Exception as exc:
        ok = False
        status["db"] = "error"
        status["db_error"] = str(exc)

    try:
        from app.services.minio_service import client as minio_client
        if minio_client.bucket_exists(Config.MINIO_BUCKET_NAME):
            status["minio"] = "ok"
        else:
            ok = False
            status["minio"] = "missing_bucket"
    except Exception as exc:
        ok = False
        status["minio"] = "error"
        status["minio_error"] = str(exc)

    if ok:
        return status
    return JSONResponse(status_code=503, content=status)
