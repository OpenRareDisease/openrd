#!/usr/bin/env python3
# MinIO初始化脚本
# 适用于report_manager_002项目

from minio import Minio
from minio.error import S3Error
import os
from dotenv import load_dotenv
import json

load_dotenv()

# 配置信息
MINIO_ENDPOINT = os.environ.get('MINIO_ENDPOINT') or '192.168.56.1:9000'
MINIO_ACCESS_KEY = os.environ.get('MINIO_ACCESS_KEY') or 'minioadmin'
MINIO_SECRET_KEY = os.environ.get('MINIO_SECRET_KEY') or 'minioadmin12345678'
MINIO_BUCKET_NAME = os.environ.get('MINIO_BUCKET_NAME') or 'medical-reports'
MINIO_USE_HTTPS = False

# 初始化MinIO客户端
def init_minio_client():
    """初始化MinIO客户端"""
    try:
        client = Minio(
            MINIO_ENDPOINT,
            access_key=MINIO_ACCESS_KEY,
            secret_key=MINIO_SECRET_KEY,
            secure=MINIO_USE_HTTPS
        )
        print("✓ MinIO客户端初始化成功")
        return client
    except Exception as e:
        print(f"✗ MinIO客户端初始化失败: {e}")
        return None

# 创建存储桶
def create_bucket(client):
    """创建存储桶（如果不存在）"""
    try:
        if not client.bucket_exists(MINIO_BUCKET_NAME):
            client.make_bucket(MINIO_BUCKET_NAME)
            print(f"✓ 存储桶 '{MINIO_BUCKET_NAME}' 创建成功")
        else:
            print(f"✓ 存储桶 '{MINIO_BUCKET_NAME}' 已存在")
        return True
    except S3Error as err:
        print(f"✗ 存储桶操作失败: {err}")
        return False

# 设置存储桶策略
def set_bucket_policy(client):
    """设置存储桶策略，允许公共读取（可选）"""
    try:
        # 示例：设置只读策略
        policy = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Principal": {"AWS": ["*"]},
                    "Action": ["s3:GetObject"],
                    "Resource": [f"arn:aws:s3:::{MINIO_BUCKET_NAME}/*"]
                }
            ]
        }
        
        client.set_bucket_policy(MINIO_BUCKET_NAME, json.dumps(policy))
        print(f"✓ 存储桶 '{MINIO_BUCKET_NAME}' 策略设置成功")
        return True
    except S3Error as err:
        print(f"✗ 存储桶策略设置失败: {err}")
        return False

# 测试上传文件
def test_file_upload(client):
    """测试上传文件到MinIO"""
    try:
        # 创建一个测试文件
        test_file_path = "test_minio.txt"
        with open(test_file_path, "w") as f:
            f.write("This is a test file for MinIO upload test.")
        
        # 上传文件
        object_name = "test/test_minio.txt"
        client.fput_object(
            MINIO_BUCKET_NAME,
            object_name,
            test_file_path,
        )
        
        print(f"✓ 测试文件上传成功: {object_name}")
        
        # 获取文件URL
        file_url = client.presigned_get_object(MINIO_BUCKET_NAME, object_name)
        print(f"✓ 文件访问URL: {file_url}")
        
        # 清理测试文件
        os.remove(test_file_path)
        return True
    except S3Error as err:
        print(f"✗ 测试文件上传失败: {err}")
        # 清理测试文件
        if os.path.exists("test_minio.txt"):
            os.remove("test_minio.txt")
        return False
    except Exception as e:
        print(f"✗ 测试文件上传失败: {e}")
        # 清理测试文件
        if os.path.exists("test_minio.txt"):
            os.remove("test_minio.txt")
        return False

# 列出存储桶中的文件
def list_files(client):
    """列出存储桶中的文件"""
    try:
        objects = client.list_objects(MINIO_BUCKET_NAME, recursive=True)
        print(f"\n📁 存储桶 '{MINIO_BUCKET_NAME}' 中的文件:")
        for obj in objects:
            print(f"  - {obj.object_name} (大小: {obj.size} bytes, 修改时间: {obj.last_modified})")
        return True
    except S3Error as err:
        print(f"✗ 列出文件失败: {err}")
        return False

# 主函数
def main():
    print("🚀 MinIO初始化脚本启动")
    print(f"配置信息:")
    print(f"  端点: {MINIO_ENDPOINT}")
    print(f"  访问密钥: {MINIO_ACCESS_KEY}")
    print(f"  存储桶: {MINIO_BUCKET_NAME}")
    print(f"  使用HTTPS: {MINIO_USE_HTTPS}")
    print()
    
    # 初始化客户端
    client = init_minio_client()
    if not client:
        return
    
    # 创建存储桶
    if not create_bucket(client):
        return
    
    # 设置存储桶策略
    set_bucket_policy(client)
    
    # 测试文件上传
    test_file_upload(client)
    
    # 列出文件
    list_files(client)
    
    print("\n🎉 MinIO初始化脚本执行完成")

if __name__ == "__main__":
    main()
