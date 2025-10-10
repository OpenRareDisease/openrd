# FSHD-openrd (FSHD Management Platform)

[中文](./README.md)

---

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