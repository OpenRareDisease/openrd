import chromadb
import os
import PyPDF2
from typing import List, Dict
import re
import langdetect
from langdetect import detect, DetectorFactory

DetectorFactory.seed = 0

class FSHDPDFProcessor:
    def __init__(self):
        self.client = chromadb.PersistentClient(path="./chroma_db")
        self.collection = self.client.get_or_create_collection("fshd_knowledge_base")
        print("🚀 FSHD多语言知识库初始化完成！")
    
    def detect_language(self, text: str) -> str:
        """检测文本语言"""
        try:
            sample_text = text[:1000] if len(text) > 1000 else text
            if len(sample_text.strip()) < 10:  
                return "unknown"
            return detect(sample_text)
        except:
            return "unknown"
    
    def extract_text_from_pdf(self, pdf_path: str) -> Dict:
        """从PDF提取文本并检测语言"""
        text = ""
        try:
            with open(pdf_path, 'rb') as file:
                reader = PyPDF2.PdfReader(file)
                total_pages = len(reader.pages)
                for page_num, page in enumerate(reader.pages):
                    page_text = page.extract_text()
                    text += page_text + "\n"
                    print(f"    📄 页面 {page_num+1}/{total_pages} 提取完成")
            
            language = self.detect_language(text)
            return {
                "text": text,
                "language": language,
                "success": True,
                "pages": total_pages
            }
        except Exception as e:
            print(f"❌ 读取PDF失败 {pdf_path}: {e}")
            return {"success": False, "error": str(e)}
    
    def smart_chunking(self, text: str, language: str, chunk_size: int = 500) -> List[str]:
        """根据语言智能分块"""
        if language == 'en':
            # 英文分块策略
            sentences = re.split(r'[.!?]+', text)
            chunks = []
            current_chunk = ""
            
            for sentence in sentences:
                clean_sentence = sentence.strip()
                if len(clean_sentence) == 0:
                    continue
                    
                if len(current_chunk) + len(clean_sentence) <= chunk_size:
                    current_chunk += clean_sentence + ". "
                else:
                    if current_chunk:
                        chunks.append(current_chunk.strip())
                    current_chunk = clean_sentence + ". "
            
            if current_chunk:
                chunks.append(current_chunk.strip())
        else:
            # 中文分块策略
            paragraphs = re.split(r'\n\s*\n', text)
            chunks = []
            current_chunk = ""
            
            for paragraph in paragraphs:
                clean_para = re.sub(r'\s+', ' ', paragraph.strip())
                if len(clean_para) == 0:
                    continue
                    
                if len(current_chunk) + len(clean_para) <= chunk_size:
                    current_chunk += clean_para + "\n\n"
                else:
                    if current_chunk:
                        chunks.append(current_chunk.strip())
                    current_chunk = clean_para + "\n\n"
            
            if current_chunk:
                chunks.append(current_chunk.strip())
        
        return chunks
    
    def process_single_category(self, folder_path: str, category: str):
        """处理单个分类的所有PDF"""
        if not os.path.exists(folder_path):
            print(f"❌ 文件夹不存在: {folder_path}")
            return 0
        
        pdf_files = [f for f in os.listdir(folder_path) if f.lower().endswith('.pdf')]
        
        if not pdf_files:
            print(f"📁 文件夹中没有PDF文件: {folder_path}")
            return 0
        
        print(f"\n{'='*50}")
        print(f"📂 开始处理分类: {category}")
        print(f"📄 找到 {len(pdf_files)} 个PDF文件")
        print(f"📁 文件夹路径: {folder_path}")
        print(f"{'='*50}")
        
        total_chunks = 0
        
        for i, pdf_file in enumerate(pdf_files, 1):
            pdf_path = os.path.join(folder_path, pdf_file)
            print(f"\n[{i}/{len(pdf_files)}] 🔄 处理: {pdf_file}")
            
            # 提取文本和语言信息
            result = self.extract_text_from_pdf(pdf_path)
            if not result["success"]:
                continue
            
            text = result["text"]
            language = result["language"]
            pages = result["pages"]
            
            if not text or len(text.strip()) < 50:
                print("   ⚠️  文档内容过少，跳过处理")
                continue
            
            # 根据语言分块
            chunks = self.smart_chunking(text, language)
            print(f"   📝 生成 {len(chunks)} 个文本块 | 语言: {language} | 页数: {pages}")
            
            # 准备数据
            documents = []
            metadatas = []
            ids = []
            
            for j, chunk in enumerate(chunks):
                if len(chunk.strip()) > 30:
                    documents.append(chunk)
                    metadatas.append({
                        "category": category,
                        "doc_type": "医学文档",
                        "source_file": pdf_file,
                        "language": language,
                        "chunk_index": j,
                        "total_pages": pages
                    })
                    ids.append(f"{category}_{pdf_file}_{language}_{j}")
            
            if documents:
                self.collection.add(
                    documents=documents,
                    metadatas=metadatas,
                    ids=ids
                )
                total_chunks += len(documents)
                print(f"   ✅ 成功添加: {len(documents)} 个文本块")
            else:
                print("   ⚠️  没有有效的文本块可添加")
        
        return total_chunks
    
    def search_fshd_knowledge(self, question: str, n_results: int = 3, language_filter: str = None):
        """搜索FSHD知识库"""
        # 可选的语言过滤
        where_filter = None
        if language_filter:
            where_filter = {"language": language_filter}
        
        # 执行向量搜索
        results = self.collection.query(
            query_texts=[question],
            n_results=n_results,
            where=where_filter
        )
        return results
    
    def search_knowledge(self, question: str, n_results: int = 3, language_filter: str = None):
        """搜索FSHD知识库（兼容性方法）"""
        return self.search_fshd_knowledge(question, n_results, language_filter)
    
    def get_collection_stats(self):
        """获取知识库统计信息"""
        count = self.collection.count()
        all_metadatas = self.collection.get()["metadatas"]
        
        language_dist = {}
        category_dist = {}
        
        for meta in all_metadatas:
            lang = meta.get("language", "unknown")
            category = meta.get("category", "unknown")
            
            language_dist[lang] = language_dist.get(lang, 0) + 1
            category_dist[category] = category_dist.get(category, 0) + 1
        
        return {
            "total_chunks": count,
            "language_distribution": language_dist,
            "category_distribution": category_dist
        }

def main():
    """主函数 - 专门处理疾病定义和科普分类"""
    processor = FSHDPDFProcessor()
    
    # 专门处理疾病定义和科普分类 - 使用绝对路径
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