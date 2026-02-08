import os
from pathlib import Path
from dotenv import load_dotenv

_env_path = Path(__file__).resolve().parents[2] / '.env'
if _env_path.exists():
    load_dotenv(_env_path)
else:
    load_dotenv()

class Config:
    ENV = (os.environ.get('REPORT_MANAGER_ENV') or os.environ.get('NODE_ENV') or 'development').lower()
    SECRET_KEY = os.environ.get('REPORT_MANAGER_SECRET_KEY') or os.environ.get('SECRET_KEY') or ''
    API_KEY = os.environ.get('REPORT_MANAGER_API_KEY') or ''
    SQLALCHEMY_DATABASE_URI = os.environ.get('REPORT_MANAGER_DATABASE_URL') or \
        os.environ.get('DATABASE_URL') or \
        'postgresql://postgres:postgres@127.0.0.1:5432/report_manager'
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ECHO = (os.environ.get('REPORT_MANAGER_SQLALCHEMY_ECHO') or \
        os.environ.get('SQLALCHEMY_ECHO') or 'false').lower() == 'true'
    
    # MinIO Configuration
    MINIO_ENDPOINT = os.environ.get('REPORT_MANAGER_MINIO_ENDPOINT') or \
        os.environ.get('MINIO_ENDPOINT') or '127.0.0.1:9000'
    MINIO_ACCESS_KEY = os.environ.get('REPORT_MANAGER_MINIO_ACCESS_KEY') or \
        os.environ.get('MINIO_ACCESS_KEY') or 'minioadmin'
    MINIO_SECRET_KEY = os.environ.get('REPORT_MANAGER_MINIO_SECRET_KEY') or \
        os.environ.get('MINIO_SECRET_KEY') or 'minioadmin12345678'
    MINIO_BUCKET_NAME = os.environ.get('REPORT_MANAGER_MINIO_BUCKET_NAME') or \
        os.environ.get('MINIO_BUCKET_NAME') or 'medical-reports'
    MINIO_USE_HTTPS = os.environ.get('REPORT_MANAGER_MINIO_USE_HTTPS') == 'true'
    
    # AI Model Configuration
    AI_API_KEY = os.environ.get('REPORT_MANAGER_AI_API_KEY') or \
        os.environ.get('AI_API_KEY') or ''
    AI_API_URL = os.environ.get('REPORT_MANAGER_AI_API_URL') or \
        os.environ.get('AI_API_URL') or 'https://api.siliconflow.cn/v1/chat/completions'
    AI_MODEL = os.environ.get('REPORT_MANAGER_AI_MODEL') or \
        os.environ.get('AI_MODEL') or 'gpt-3.5-turbo'
    AI_CONNECT_TIMEOUT = float(os.environ.get('REPORT_MANAGER_AI_CONNECT_TIMEOUT') or \
        os.environ.get('AI_CONNECT_TIMEOUT') or 10)
    AI_READ_TIMEOUT = float(os.environ.get('REPORT_MANAGER_AI_READ_TIMEOUT') or \
        os.environ.get('AI_READ_TIMEOUT') or 120)
    AI_MAX_RETRIES = int(os.environ.get('REPORT_MANAGER_AI_MAX_RETRIES') or \
        os.environ.get('AI_MAX_RETRIES') or 2)
    AI_RETRY_BACKOFF = float(os.environ.get('REPORT_MANAGER_AI_RETRY_BACKOFF') or \
        os.environ.get('AI_RETRY_BACKOFF') or 0.5)
    AI_CHUNK_CHARS = int(os.environ.get('REPORT_MANAGER_AI_CHUNK_CHARS') or \
        os.environ.get('AI_CHUNK_CHARS') or 8000)
    AI_PARALLELISM = int(os.environ.get('REPORT_MANAGER_AI_PARALLELISM') or \
        os.environ.get('AI_PARALLELISM') or 3)
    AI_ENABLE_PARALLEL = (os.environ.get('REPORT_MANAGER_AI_ENABLE_PARALLEL') or \
        os.environ.get('AI_ENABLE_PARALLEL') or 'true').lower() == 'true'
