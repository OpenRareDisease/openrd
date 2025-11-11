const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// 安全地获取 Expo 的默认排除列表
const existingBlockList = [].concat(config.resolver.blockList || []);

config.resolver.blockList = [
    ...existingBlockList,
    /.*\/\.expo\/.*/,    // Expo 的缓存和构建产物目录

    // 1. 原生代码 (Java/C++/Objective-C)
    /.*\/react-native\/ReactAndroid\/.*/,
    /.*\/react-native\/ReactCommon\/.*/,

    // 2. 纯开发和调试工具
    // 这些工具只在开发电脑上运行，不会被打包到应用中
    /.*\/@typescript-eslint\/eslint-plugin\/.*/,

    // 3. 构建时数据
    // 这个数据库只在打包过程中使用，应用运行时不需要
    /.*\/caniuse-lite\/data\/.*/,
    
    // 4. 通用规则
    /.*\/__tests__\/.*/, // 排除所有测试目录
    /.*\.git\/.*/,       // 排除 Git 目录
];

module.exports = config;