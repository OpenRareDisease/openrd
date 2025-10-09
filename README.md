# FSHD-openrd (肌愈通)

[English](#english) | [中文](#中文)

---

<a name="english"></a>
# FSHD-openrd (FSHD Management Platform)

A comprehensive mobile application designed specifically for FSHD (Facioscapulohumeral Muscular Dystrophy) patients, providing intelligent Q&A, dynamic health records, disease progression management, patient community features, and clinical trial matching capabilities.

## 🎯 Project Overview

FSHD-openrd is a mobile-first platform that empowers FSHD patients with tools for self-management, knowledge acquisition, community support, and clinical trial participation. The app integrates AI-powered insights with comprehensive data tracking to provide personalized care and support.

## ✨ Key Features

### 🤖 Intelligent Q&A System
- **FSHD Knowledge Base**: Comprehensive medical knowledge covering FSHD subtypes, symptom management, genetic counseling, rehabilitation, and medication guidance
- **Personalized Answers**: AI-powered responses that consider individual patient data and medical history
- **Local Resource Recommendations**: Smart suggestions for nearby FSHD treatment centers and clinical trials
- **Clinical Pathway Guidance**: Integration with 30+ top hospital FSHD clinical pathways

### 📊 Dynamic Health Records
- **Multi-modal Data Collection**: OCR/AI analysis of genetic reports, MRI images, blood tests with manual muscle strength recording
- **Visual Timeline**: Interactive timeline showing disease progression, muscle strength trends, and medical events
- **FSHD Clinical Passport**: Standardized medical record export for clinical trials and multi-center care
- **Risk Alert Dashboard**: Automated alerts for functional decline and rehabilitation recommendations

### 🏥 Disease Management Tools
- **Muscle Strength Assessment**: Radar charts comparing muscle group strength with age-matched FSHD patients
- **Activity Monitoring**: Integration with health app data for abnormal activity detection
- **AI Disease Progression Prediction**: 3/5-year trend predictions with personalized intervention plans
- **Medication Safety Management**: Blood test analysis for adverse drug reaction warnings

### 👥 Patient Community
- **Stratified Forums**: Specialized communities for different patient stages and muscle groups
- **Rehabilitation Experience Sharing**: Verified training videos with motion capture correction
- **Clinical Trial Matching**: Real-time trial matching based on patient profiles
- **Medical Resource Map**: Directory of FSHD treatment centers and rehabilitation facilities

### 🔬 Clinical Integration
- **Trial Enrollment Acceleration**: Automated generation of standardized trial data packages
- **Hospital Data Synchronization**: Integration with hospital HIS systems
- **Data Donation Mechanism**: Anonymous data contribution to FSHD research databases

## 🛠 Technology Stack

- **Framework**: Expo with React Native
- **Routing**: Expo Router (file-based routing)
- **Language**: TypeScript with React
- **Navigation**: React Navigation with bottom tabs
- **Styling**: React Native StyleSheet
- **State Management**: React Context/Hooks
- **Data Visualization**: React Native Chart Kit, React Native SVG

## 📁 Project Structure

```
openrd/
├── app/                    # Main application (Expo Router)
│   ├── (tabs)/            # Bottom tab navigation
│   │   ├── p-home.tsx     # Home dashboard
│   │   ├── p-qna.tsx      # Intelligent Q&A
│   │   ├── p-archive.tsx  # Dynamic health records
│   │   ├── p-community.tsx # Patient community
│   │   └── p-settings.tsx # App settings
│   ├── p-data_entry.tsx   # Data entry forms
│   ├── p-manage.tsx       # Disease management
│   ├── p-clinical_passport.tsx # Clinical passport
│   └── ... (other pages)
├── screens/               # Screen components
│   ├── home/             # Home screen components
│   ├── qna/              # Q&A screen components
│   └── ... (other screens)
├── ui/                   # UI components
├── assets/               # Images, icons, fonts
└── package.json          # Dependencies and scripts
```

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Expo CLI (optional)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd openrd
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start development server**
   ```bash
   npm start
   # or
   npx expo start
   ```

### Development Commands

```bash
# Start development server
npm start

# Platform-specific development
npm run android    # Android development
npm run ios        # iOS development
npm run web        # Web development

# Testing and quality
npm test           # Run tests
npm run lint       # Run linting

# Reset project
npm run reset-project
```

## 📱 Platform Support

- **iOS**: Full support with native features
- **Android**: Full support with native features
- **Web**: Progressive Web App capabilities

## 🔒 Privacy & Security

- **Medical-grade Data Encryption**: End-to-end encryption for sensitive health data
- **Privacy-first Approach**: Granular data permissions and user-controlled access
- **Blockchain Audit Trail**: Immutable logging of data operations
- **HIPAA/GDPR Compliance**: Adherence to international privacy standards
- **Anonymous Data Donation**: Secure, anonymized data contribution for research

## 🤝 Contributing

We welcome contributions from the FSHD community, healthcare professionals, and developers. Please see our contribution guidelines for more information.

## 📄 License

This project is licensed under the [License Name] - see the LICENSE file for details.

## 📞 Support

For technical support or questions about the application:
- Email: support@fshd-openrd.org
- Community: Join our patient forums
- Documentation: Check our comprehensive guides

---

<a name="中文"></a>
# FSHD-openrd (肌愈通)

专为FSHD（面肩肱型肌营养不良症）患者设计的综合性移动应用平台，提供智能问答、动态健康档案、病程管理、患者社区功能和临床试验匹配能力。

## 🎯 项目概述

FSHD-openrd 是一个以移动端为主的平台，为FSHD患者提供自我管理工具、知识获取、社区支持和临床试验参与功能。该应用集成了AI驱动的洞察与全面的数据跟踪，提供个性化护理和支持。

## ✨ 核心功能

### 🤖 智能问答系统
- **FSHD知识库**：涵盖FSHD分型鉴别、症状管理、遗传咨询、康复训练和用药指导的综合医学知识
- **个性化回答**：基于患者个人数据和医疗历史的AI驱动回答
- **本地资源推荐**：智能推荐附近的FSHD诊疗中心和临床试验
- **临床路径指引**：集成30+三甲医院FSHD临床路径

### 📊 动态健康档案
- **多模态数据采集**：基因报告、MRI影像、血检报告的OCR/AI分析，支持手动肌力记录
- **可视化时间轴**：展示病程发展、肌力趋势和医疗事件的交互式时间轴
- **FSHD临床护照**：标准化医疗记录导出，用于临床试验和多中心诊疗
- **风险预警看板**：功能衰退自动预警和康复建议

### 🏥 病程管理工具
- **肌肉力量评估**：肌群力量雷达图，与同年龄段FSHD患者对比
- **活动监测**：健康应用数据集成，异常活动检测
- **AI病程预测**：3/5年趋势预测，个性化干预计划
- **用药安全管理**：血检报告分析，药物不良反应预警

### 👥 患者社区
- **分层交流专区**：不同患者阶段和肌群的专业社区
- **康复经验分享**：经认证的训练视频，动作捕捉纠错
- **临床试验匹配**：基于患者档案的实时试验匹配
- **医疗资源地图**：FSHD诊疗中心和康复机构目录

### 🔬 临床对接枢纽
- **试验入组加速**：标准化试验数据包自动生成
- **医院数据同步**：医院HIS系统集成
- **数据捐赠机制**：匿名数据贡献至FSHD研究数据库

## 🛠 技术栈

- **框架**：Expo + React Native
- **路由**：Expo Router（基于文件的路由）
- **语言**：TypeScript + React
- **导航**：React Navigation + 底部标签
- **样式**：React Native StyleSheet
- **状态管理**：React Context/Hooks
- **数据可视化**：React Native Chart Kit, React Native SVG

## 📁 项目结构

```
openrd/
├── app/                    # 主应用（Expo Router）
│   ├── (tabs)/            # 底部标签导航
│   │   ├── p-home.tsx     # 首页仪表板
│   │   ├── p-qna.tsx      # 智能问答
│   │   ├── p-archive.tsx  # 动态健康档案
│   │   ├── p-community.tsx # 患者社区
│   │   └── p-settings.tsx # 应用设置
│   ├── p-data_entry.tsx   # 数据录入表单
│   ├── p-manage.tsx       # 病程管理
│   ├── p-clinical_passport.tsx # 临床护照
│   └── ... (其他页面)
├── screens/               # 屏幕组件
│   ├── home/             # 首页组件
│   ├── qna/              # 问答组件
│   └── ... (其他屏幕)
├── ui/                   # UI组件
├── assets/               # 图片、图标、字体
└── package.json          # 依赖和脚本
```

## 🚀 快速开始

### 环境要求

- Node.js (v18 或更高版本)
- npm 或 yarn
- Expo CLI (可选)

### 安装步骤

1. **克隆仓库**
   ```bash
   git clone <仓库地址>
   cd openrd
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **启动开发服务器**
   ```bash
   npm start
   # 或
   npx expo start
   ```

### 开发命令

```bash
# 启动开发服务器
npm start

# 平台特定开发
npm run android    # Android开发
npm run ios        # iOS开发
npm run web        # Web开发

# 测试和质量
npm test           # 运行测试
npm run lint       # 运行代码检查

# 重置项目
npm run reset-project
```

## 📱 平台支持

- **iOS**：完整支持，包含原生功能
- **Android**：完整支持，包含原生功能
- **Web**：渐进式Web应用能力

## 🔒 隐私与安全

- **医疗级数据加密**：敏感健康数据的端到端加密
- **隐私优先方法**：细粒度数据权限和用户控制访问
- **区块链审计追踪**：数据操作的不可变日志记录
- **HIPAA/GDPR合规**：符合国际隐私标准
- **匿名数据捐赠**：安全的匿名数据贡献用于研究

## 🤝 贡献

我们欢迎FSHD社区、医疗专业人员和开发者的贡献。请参阅我们的贡献指南了解更多信息。

## 📄 许可证

本项目采用 [许可证名称] 许可证 - 详见 LICENSE 文件。

## 📞 支持

如需技术支持或有关应用的疑问：
- 邮箱：support@fshd-openrd.org
- 社区：加入我们的患者论坛
- 文档：查看我们的综合指南