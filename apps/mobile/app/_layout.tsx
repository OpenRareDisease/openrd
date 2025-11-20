import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack, usePathname, useGlobalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LogBox } from 'react-native';
import { AuthProvider } from '../contexts/AuthContext';

LogBox.ignoreLogs([
  "TurboModuleRegistry.getEnforcing(...): 'RNMapsAirModule' could not be found",
  // 添加其它想暂时忽略的错误或警告信息
]);

export default function RootLayout() {
  const pathname = usePathname();
  const searchParams = useGlobalSearchParams();

  useEffect(() => {
    if (!pathname) {
      return;
    }
    let searchString = '';
    if (Object.keys(searchParams).length > 0) {
      const queryString = Object.keys(searchParams)
        .map((key) => {
          const value = searchParams[key];
          if (typeof value === 'string') {
            return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
          }
          return '';
        })
        .filter(Boolean)
        .join('&');

      searchString = '?' + queryString;
    }

    const pageId = pathname.replace('/', '').toUpperCase();
    console.log('当前pageId:', pageId, ', pathname:', pathname, ', search:', searchString);
    if (typeof window === 'object' && window.parent && window.parent.postMessage) {
      window.parent.postMessage(
        {
          type: 'chux-path-change',
          pageId: pageId,
          pathname: pathname,
          search: searchString,
        },
        '*',
      );
    }
  }, [pathname, searchParams]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <StatusBar style="light"></StatusBar>
        <Stack
          screenOptions={{
            // 设置所有页面的切换动画为从右侧滑入，适用于iOS 和 Android
            animation: 'slide_from_right',
            gestureEnabled: true,
            gestureDirection: 'horizontal',
            // 隐藏自带的头部
            headerShown: false,
          }}
        >
          <Stack.Screen name="(tabs)" options={{ title: '底部导航栏' }} />
          <Stack.Screen name="p-login_register" options={{ title: '登录注册页' }} />
          <Stack.Screen name="p-data_entry" options={{ title: '数据录入页' }} />
          <Stack.Screen name="p-manage" options={{ title: '病程管理页' }} />
          <Stack.Screen name="p-rehab_share" options={{ title: '康复经验分享页' }} />
          <Stack.Screen name="p-trial_square" options={{ title: '临床试验广场页' }} />
          <Stack.Screen name="p-expert_consult" options={{ title: '专家咨询页' }} />
          <Stack.Screen name="p-privacy_settings" options={{ title: '隐私设置页' }} />
          <Stack.Screen name="p-about_us" options={{ title: '关于我们页' }} />
          <Stack.Screen name="p-clinical_passport" options={{ title: 'FSHD临床护照页' }} />
          <Stack.Screen name="p-data_donation" options={{ title: '数据捐赠页' }} />
          <Stack.Screen name="p-resource_map" options={{ title: '医疗资源地图页' }} />
        </Stack>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
