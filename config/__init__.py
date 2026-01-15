import os
import sys
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

# 获取项目根目录
BASE_DIR = Path(__file__).parent.parent

# 加载环境变量文件
env_file = BASE_DIR / '.env'
if env_file.exists():
    load_dotenv(env_file)
    print(f"✅ 已加载环境变量文件: {env_file}")
else:
    print(f"⚠️  环境变量文件不存在: {env_file}")
    print("💡 请确保项目根目录有.env文件")

class ChromaConfig:
    """ChromaDB Cloud配置"""
    # API配置
    API_KEY: Optional[str] = os.getenv("CHROMA_API_KEY")
    TENANT_ID: Optional[str] = os.getenv("CHROMA_TENANT_ID")
    DATABASE: str = os.getenv("CHROMA_DATABASE", "FSHD")
    
    # 本地API服务配置
    API_PORT: int = int(os.getenv("CHROMA_API_PORT", "5000"))
    API_HOST: str = os.getenv("CHROMA_API_HOST", "localhost")
    
    @classmethod
    def get_api_url(cls) -> str:
        """获取本地API服务URL"""
        return f"http://{cls.API_HOST}:{cls.API_PORT}"
    
    @classmethod
    def get_client_config(cls) -> dict:
        """获取ChromaDB客户端配置"""
        return {
            'api_key': cls.API_KEY,
            'tenant_id': cls.TENANT_ID,
            'database': cls.DATABASE
        }
    
    @classmethod
    def validate(cls) -> bool:
        """验证配置是否完整"""
        errors = []
        
        if not cls.API_KEY:
            errors.append("CHROMA_API_KEY 未设置")
        if not cls.TENANT_ID:
            errors.append("CHROMA_TENANT_ID 未设置")
        
        if errors:
            error_msg = "❌ 配置错误:\n" + "\n".join(f"   - {err}" for err in errors)
            error_msg += "\n💡 请在.env文件中设置这些环境变量"
            raise ValueError(error_msg)
        
        # 检查API密钥格式
        if cls.API_KEY and not cls.API_KEY.startswith("ck-"):
            print("⚠️  API密钥格式可能不正确（应以'ck-'开头）")
        
        return True

class NodeConfig:
    """Node.js应用配置（与您的现有配置保持一致）"""
    NODE_ENV: str = os.getenv("NODE_ENV", "development")
    PORT: int = int(os.getenv("PORT", "4000"))
    CORS_ORIGIN: str = os.getenv("CORS_ORIGIN", "http://localhost:8081")

class AIConfig:
    """AI服务配置"""
    OPENAI_API_KEY: Optional[str] = os.getenv("OPENAI_API_KEY")
    AI_API_BASE_URL: str = os.getenv("AI_API_BASE_URL", "https://api.siliconflow.cn/v1")
    AI_API_MODEL: str = os.getenv("AI_API_MODEL", "Qwen/Qwen2.5-72B-Instruct")
    AI_API_TIMEOUT: int = int(os.getenv("AI_API_TIMEOUT", "120000"))

class DatabaseConfig:
    """数据库配置"""
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgres://postgres:142857@localhost:5432/fshd_openrd")
    JWT_SECRET: str = os.getenv("JWT_SECRET", "change-me-super-secret")
    JWT_EXPIRES_IN: str = os.getenv("JWT_EXPIRES_IN", "7d")
    BCRYPT_SALT_ROUNDS: int = int(os.getenv("BCRYPT_SALT_ROUNDS", "10"))

class AppConfig:
    """统一应用配置"""
    chroma = ChromaConfig
    node = NodeConfig
    ai = AIConfig
    db = DatabaseConfig
    
    @classmethod
    def validate_all(cls):
        """验证所有配置"""
        print("🔧 验证应用配置...")
        
        # 验证ChromaDB配置
        try:
            cls.chroma.validate()
            print("✅ ChromaDB配置验证通过")
        except ValueError as e:
            print(str(e))
            sys.exit(1)
        
        # 验证其他配置（可选）
        if not cls.ai.OPENAI_API_KEY:
            print("⚠️  OPENAI_API_KEY未设置，AI服务可能受影响")
        
        print("🎉 所有配置验证完成")
        return True
    
    @classmethod
    def show_config_summary(cls):
        """显示配置摘要（不显示敏感信息）"""
        print("\n📋 配置摘要:")
        print(f"   环境: {cls.node.NODE_ENV}")
        print(f"   Node端口: {cls.node.PORT}")
        print(f"   ChromaDB API端口: {cls.chroma.API_PORT}")
        print(f"   AI模型: {cls.ai.AI_API_MODEL}")
        print(f"   ChromaDB租户: {cls.chroma.TENANT_ID[:8]}...")
        print(f"   API密钥: {'已设置' if cls.chroma.API_KEY else '未设置'}")
        
        # 检查服务状态
        print("\n🔗 服务地址:")
        print(f"   Node API: http://localhost:{cls.node.PORT}")
        print(f"   Chroma API: {cls.chroma.get_api_url()}")

# 创建全局配置实例
config = AppConfig

# 如果直接运行此文件，显示配置信息
if __name__ == "__main__":
    print("🧪 测试配置模块...")
    try:
        config.validate_all()
        config.show_config_summary()
    except Exception as e:
        print(f"❌ 配置测试失败: {e}")