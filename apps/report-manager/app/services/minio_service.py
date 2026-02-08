from minio import Minio
from minio.error import S3Error
from config import Config
import os

# 初始化MinIO客户端
client = Minio(
    Config.MINIO_ENDPOINT,
    access_key=Config.MINIO_ACCESS_KEY,
    secret_key=Config.MINIO_SECRET_KEY,
    secure=Config.MINIO_USE_HTTPS
)

# 确保存储桶存在
try:
    if not client.bucket_exists(Config.MINIO_BUCKET_NAME):
        client.make_bucket(Config.MINIO_BUCKET_NAME)
except S3Error as err:
    print(f"MinIO bucket error: {err}")

def upload_file(file_path, object_name):
    """
    Upload a file to MinIO
    """
    try:
        # 上传文件
        client.fput_object(
            Config.MINIO_BUCKET_NAME,
            object_name,
            file_path,
        )
        return True
    except S3Error as err:
        print(f"MinIO upload error: {err}")
        return False

def get_file_url(object_name):
    """
    Get a presigned URL for accessing the file
    """
    try:
        # 生成预签名URL，有效期为7天
        url = client.presigned_get_object(
            Config.MINIO_BUCKET_NAME,
            object_name,
            expires=604800  # 7 days in seconds
        )
        return url
    except S3Error as err:
        print(f"MinIO URL error: {err}")
        return None

def download_file(object_name, file_path):
    """
    Download a file from MinIO
    """
    try:
        client.fget_object(
            Config.MINIO_BUCKET_NAME,
            object_name,
            file_path,
        )
        return True
    except S3Error as err:
        print(f"MinIO download error: {err}")
        return False

def delete_file(object_name):
    """
    Delete a file from MinIO
    """
    try:
        client.remove_object(
            Config.MINIO_BUCKET_NAME,
            object_name,
        )
        return True
    except S3Error as err:
        print(f"MinIO delete error: {err}")
        return False