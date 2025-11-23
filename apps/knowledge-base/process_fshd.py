import os
import sys

# 添加 knowledge-base 路径到 Python 路径
sys.path.append(os.path.join(os.path.dirname(__file__), 'apps', 'knowledge-base'))

# 导入核心处理器
from fshd_pdf_processor import FSHDPDFProcessor

def main():
    """主函数 - 专门处理疾病定义和科普分类"""
    processor = FSHDPDFProcessor()
    
    # 专门处理疾病定义和科普分类
    folder_path = r"C:\yoyo\openrd-master\FSHD_知识库\01.疾病定义和科普\第一批：2025年3月31日"
    category = "疾病定义和科普"
    
    print("🎯 开始处理: 疾病定义和科普分类")
    print(f"📍 文档位置: {folder_path}")
    print("⏳ 这可能需要几分钟时间，请耐心等待...\n")
    
    # 处理该分类
    total_chunks = processor.process_single_category(folder_path, category)
    
    # 显示统计信息
    stats = processor.get_collection_stats()
    
    print(f"\n{'🎉' * 20}")
    print("知识库处理完成！")
    print(f"{'🎉' * 20}")
    print(f"📊 本次处理统计:")
    print(f"   📁 分类: {category}")
    print(f"   📄 处理的PDF数量: 9个 (8英文 + 1中文)")
    print(f"   🧩 生成的文本块: {total_chunks} 个")
    print(f"\n📈 知识库总体统计:")
    print(f"   🧩 总文本块数: {stats['total_chunks']}")
    print(f"   🌐 语言分布: {stats['language_distribution']}")
    print(f"   📂 分类分布: {stats['category_distribution']}")
    
    # 测试搜索
    print(f"\n🔍 测试搜索功能...")
    test_questions = [
        "What is Facioscapulohumeral Muscular Dystrophy?",
        "FSHD的主要症状是什么？"
    ]
    
    for question in test_questions:
        results = processor.search_knowledge(question, n_results=2)
        print(f"\n❓ 问题: {question}")
        print(f"📋 找到 {len(results['documents'][0])} 个相关结果")
        for j, doc in enumerate(results['documents'][0]):
            print(f"   {j+1}. {doc[:100]}...")
            print(f"      语言: {results['metadatas'][0][j]['language']}")
            print(f"      来源: {results['metadatas'][0][j]['source_file']}")

if __name__ == "__main__":
    main()