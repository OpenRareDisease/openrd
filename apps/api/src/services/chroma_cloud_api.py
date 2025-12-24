import os
import sys
from pathlib import Path

current_file = Path(__file__).resolve() 
project_root = current_file.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

print(f"📁 项目根目录: {project_root}")
print(f"📁 当前目录: {current_file.parent}")

try:
    from config import config
    print(f"✅ 成功导入配置模块")
except ImportError as e:
    print(f"❌ 导入配置模块失败: {e}")
    print(f"💡 Python路径: {sys.path}")
    sys.exit(1)

from flask import Flask, request, jsonify
from flask_cors import CORS
import chromadb
import traceback

app = Flask(__name__)
CORS(app)


cloud_processor = None

class CloudFSHDProcessor:
    """云端FSHD知识库处理器"""
    def __init__(self):
        print(f"🚀 正在连接到ChromaDB Cloud...")
        print(f"   数据库: {config.chroma.DATABASE}")
        print(f"   租户ID: {config.chroma.TENANT_ID[:8]}...")
        
        if not config.chroma.API_KEY:
            raise ValueError("CHROMA_API_KEY 未设置")
        if not config.chroma.TENANT_ID:
            raise ValueError("CHROMA_TENANT_ID 未设置")
        
        self.client = chromadb.CloudClient(
            api_key=config.chroma.API_KEY,
            tenant=config.chroma.TENANT_ID,
            database=config.chroma.DATABASE
        )
        self.collection = self.client.get_collection("fshd_knowledge_base")
        print("✅ ChromaDB Cloud 知识库连接成功！")
    
    def get_collection_stats_safe(self):
        """安全获取知识库统计信息（避免配额限制）"""
        try:
            count = self.collection.count()
            
            # 使用小样本避免配额问题
            sample_limit = min(50, count)
            language_dist = {}
            category_dist = {}
            
            if sample_limit > 0:
                sample_data = self.collection.peek(limit=sample_limit)
                
                for meta in sample_data.get("metadatas", []):
                    lang = meta.get("language", "unknown")
                    category = meta.get("category", "unknown")
                    
                    if isinstance(category, str) and '\\' in category:
                        category = category.split('\\')[-1]
                    
                    language_dist[lang] = language_dist.get(lang, 0) + 1
                    category_dist[category] = category_dist.get(category, 0) + 1
            
            return {
                "success": True,
                "data": {
                    "total_chunks": count,
                    "language_distribution": language_dist,
                    "category_distribution": category_dist
                }
            }
            
        except Exception as e:
            print(f"⚠️  获取统计信息失败: {e}")
            # 返回基本统计
            try:
                count = self.collection.count()
                return {
                    "success": True,
                    "data": {
                        "total_chunks": count,
                        "language_distribution": {},
                        "category_distribution": {}
                    }
                }
            except:
                return {
                    "success": False,
                    "error": "无法获取统计信息"
                }

def initialize_cloud_processor():
    """初始化云端处理器"""
    global cloud_processor
    try:
        cloud_processor = CloudFSHDProcessor()
        print(f"📊 云端知识库连接正常")
        return True
    except Exception as e:
        print(f"❌ 连接ChromaDB Cloud失败: {e}")
        print("💡 请检查:")
        print("   1. API密钥是否正确")
        print("   2. 网络连接是否正常")
        print("   3. .env文件配置")
        return False


@app.route('/api/health', methods=['GET'])
def health_check():
    """健康检查接口"""
    try:
        if cloud_processor is None:
            initialize_cloud_processor()
        
        if cloud_processor:
            # 测试连接
            test_count = cloud_processor.collection.count()
            status = 'healthy'
            message = f'✅ ChromaDB Cloud连接正常，知识库有{test_count}条数据'
        else:
            status = 'unhealthy'
            message = '❌ ChromaDB Cloud连接失败'
    except Exception as e:
        status = 'unhealthy'
        message = f'❌ 连接异常: {str(e)[:100]}'
    
    return jsonify({
        'status': status,
        'service': 'ChromaDB Cloud API',
        'message': message,
        'config': {
            'database': config.chroma.DATABASE,
            'api_port': config.chroma.API_PORT,
            'node_port': config.node.PORT
        },
        'endpoints': {
            'search': '/api/search (POST)',
            'stats': '/api/stats (GET)',
            'health': '/api/health (GET)'
        }
    })

@app.route('/api/search', methods=['POST'])
def search_knowledge():
    """云端知识库搜索接口"""
    global cloud_processor
    try:
        if cloud_processor is None:
            if not initialize_cloud_processor():
                return jsonify({
                    'success': False,
                    'error': '云端知识库连接失败'
                }), 500
        
        data = request.json
        if not data:
            return jsonify({'success': False, 'error': '请求数据为空'}), 400
            
        question = data.get('question', '')
        n_results = data.get('n_results', 3)
        language_filter = data.get('language_filter', None)
        
        if not question:
            return jsonify({'success': False, 'error': '问题不能为空'}), 400
        
        print(f"🔍 云端搜索请求: {question[:50]}...")
        
        # 构建查询条件
        where_filter = None
        if language_filter:
            where_filter = {"language": language_filter}
        
        # 从云端检索
        results = cloud_processor.collection.query(
            query_texts=[question],
            n_results=n_results,
            where=where_filter,
            include=["documents", "metadatas", "distances"]
        )
        
        # 格式化响应
        formatted_results = []
        if results['documents'] and results['documents'][0]:
            for i in range(len(results['documents'][0])):
                formatted_results.append({
                    'content': results['documents'][0][i],
                    'metadata': results['metadatas'][0][i],
                    'similarity': 1 - results['distances'][0][i] if results.get('distances') else None,
                    'source': results['metadatas'][0][i].get('source_file', '未知'),
                    'category': results['metadatas'][0][i].get('category', '未知')
                })
        
        return jsonify({
            'success': True,
            'data': {
                'results': formatted_results,
                'total_found': len(formatted_results),
                'question': question
            }
        })
        
    except Exception as e:
        print(f"❌ 云端搜索错误: {e}")
        print(traceback.format_exc())
        return jsonify({
            'success': False,
            'error': f'搜索失败: {str(e)[:100]}'
        }), 500

@app.route('/api/stats', methods=['GET'])
def get_stats():
    """获取云端知识库统计信息"""
    global cloud_processor
    try:
        if cloud_processor is None:
            if not initialize_cloud_processor():
                return jsonify({
                    'success': False,
                    'error': '云端知识库连接失败'
                }), 500
        
        stats = cloud_processor.get_collection_stats_safe()
        return jsonify(stats)
        
    except Exception as e:
        print(f"❌ 获取统计错误: {e}")
        return jsonify({
            'success': False,
            'error': f'获取统计失败: {str(e)[:100]}'
        }), 500

# ==================== 主程序 ====================

if __name__ == '__main__':
    print("=" * 60)
    print("🚀 启动 ChromaDB Cloud API 服务")
    print("=" * 60)
    
    # 显示配置信息
    try:
        config.show_config_summary()
    except:
        print("⚠️  无法显示配置摘要")
    
    print(f"\n📍 服务地址: http://{config.chroma.API_HOST}:{config.chroma.API_PORT}")
    print("📋 可用接口:")
    print("   GET  /api/health  - 健康检查")
    print("   GET  /api/stats   - 获取统计")
    print("   POST /api/search  - 搜索知识")
    print("\n⏳ 正在初始化服务...")
    
    # 初始化云端处理器
    if initialize_cloud_processor():
        print("🎉 云端知识库API服务准备就绪！")
        
        # 启动Flask应用
        app.run(
            host=config.chroma.API_HOST,
            port=config.chroma.API_PORT,
            debug=False,
            threaded=True
        )
    else:
        print("❌ 无法连接云端知识库，服务启动失败")
        sys.exit(1)