import requests
import os

# 测试文件路径
TEST_PDF_PATH = "test_report.pdf"

# 创建一个简单的PDF文件（使用更可靠的方式）
def create_test_pdf():
    """Create a simple test PDF file"""
    with open(TEST_PDF_PATH, "w") as f:
        f.write("%PDF-1.4\n")
        f.write("1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n")
        f.write("2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n")
        f.write("3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<<>>>>endobj\n")
        f.write("4 0 obj<</Length 35>>stream\n")
        f.write("BT/F1 12 Tf 100 700 Td(Test Medical Report)Tj ET\n")
        f.write("endstream\n")
        f.write("endobj\n")
        f.write("xref 0 5\n")
        f.write("0000000000 65535 f \n")
        f.write("0000000009 00000 n \n")
        f.write("0000000052 00000 n \n")
        f.write("0000000095 00000 n \n")
        f.write("0000000186 00000 n \n")
        f.write("trailer<</Size 5/Root 1 0 R>>\n")
        f.write("startxref 286\n")
        f.write("%%EOF\n")

# 测试上传和分析端点
def test_upload_and_analyze():
    # 创建测试PDF文件
    create_test_pdf()
    
    # 测试上传和分析端点
    url = "http://127.0.0.1:8000/api/reports/upload-and-analyze"
    
    # 准备请求数据
    files = {
        "file": ("test_report.pdf", open(TEST_PDF_PATH, "rb"), "application/pdf")
    }
    
    data = {
        "report_name": "测试报告",
        "user_id": 1
    }
    
    print("正在测试 /upload-and-analyze 端点...")
    try:
        response = requests.post(url, files=files, data=data)
        print(f"响应状态码: {response.status_code}")
        print(f"响应内容: {response.text}")
        
        if response.status_code == 200:
            print("\n测试成功！/upload-and-analyze 端点正常工作")
        else:
            print(f"\n测试失败！状态码: {response.status_code}")
    except Exception as e:
        print(f"\n测试时发生错误: {e}")
    finally:
        # 关闭文件和清理
        files["file"][1].close()
        if os.path.exists(TEST_PDF_PATH):
            os.remove(TEST_PDF_PATH)

if __name__ == "__main__":
    test_upload_and_analyze()
