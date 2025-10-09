# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FSHD-openrd is a mobile application for FSHD (Facioscapulohumeral muscular dystrophy) patients, designed as a comprehensive management platform. The app provides intelligent Q&A, dynamic health records, disease progression management, patient community features, and clinical trial matching capabilities.

## Architecture

### Technology Stack
- **Framework**: Expo with React Native
- **Routing**: Expo Router (file-based routing)
- **Language**: TypeScript with React
- **Navigation**: React Navigation with bottom tabs
- **Styling**: React Native StyleSheet

### Project Structure
- `/app/` - Main application routes using Expo Router
  - `(tabs)/` - Bottom tab navigation screens
  - Individual page files following naming pattern `p-{page_name}.tsx`
- `/ui/` - Screen components organized by page
  - Each page has its own directory with `index.tsx` and `styles.ts`
  - Complex pages have additional component subdirectories

### Key Pages and Features
- **Home (P-HOME)**: Main dashboard with health status overview
- **Q&A (P-QNA)**: Intelligent question-answering system with FSHD knowledge base
- **Archive (P-ARCHIVE)**: Dynamic health records with timeline visualization
- **Community (P-COMMUNITY)**: Patient community with specialized forums
- **Settings (P-SETTINGS)**: User preferences and app settings
- **Additional Pages**: Data entry, clinical trials, expert consultation, privacy settings, etc.

## Development Commands

### Core Development
```bash
# Install dependencies
npm install

# Start development server
npm start
# or
npx expo start

# Platform-specific development
npm run android    # Android development
npm run ios        # iOS development
npm run web        # Web development
```

### Testing and Quality
```bash
# Run tests
npm test

# Run linting
npm run lint

# Reset project (moves starter code to app-example)
npm run reset-project
```

## Key Implementation Details

### Routing System
- Uses Expo Router with file-based routing
- Main navigation through bottom tabs in `(tabs)/_layout.tsx`
- Individual pages accessible via direct routes
- Root layout in `_layout.tsx` handles global navigation and messaging

### Component Organization
- Each major page has corresponding files in both `/app/` and `/screens/`
- Screen components contain the actual UI implementation
- App routes serve as entry points
- Styles are separated into dedicated `styles.ts` files

### Data Flow
- The app is designed to handle sensitive medical data (genetic reports, MRI images, muscle strength records)
- Implements privacy-first approach with granular data permissions
- Supports data donation for research purposes
- Integrates with clinical trial matching systems

## Important Notes

- This is a medical application handling sensitive patient data - prioritize privacy and security
- The app targets FSHD patients specifically with specialized features
- Uses TypeScript for type safety across the codebase
- Follows the established naming conventions for pages and components
- Includes accessibility features like large text mode and voice screen reading