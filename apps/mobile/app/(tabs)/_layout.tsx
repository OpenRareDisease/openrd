import { Tabs } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import { CLINICAL_COLORS } from '../../lib/clinical-visuals';

export default function Layout() {
  return (
    <Tabs
      backBehavior="order"
      screenOptions={{
        tabBarActiveTintColor: CLINICAL_COLORS.accent,
        tabBarInactiveTintColor: CLINICAL_COLORS.textMuted,
        tabBarStyle: {
          backgroundColor: CLINICAL_COLORS.panel,
          borderTopColor: CLINICAL_COLORS.border,
          height: 72,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
          paddingBottom: 6,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ href: null }} />

      <Tabs.Screen
        name="p-home"
        options={{
          title: '首页',
          headerShown: false,
          tabBarIcon: ({ color }) => <FontAwesome6 name="house" size={18} color={color} />,
        }}
      />

      <Tabs.Screen
        name="p-qna"
        options={{
          title: '问答',
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <FontAwesome6 name="circle-question" size={18} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="p-archive"
        options={{
          title: '档案',
          headerShown: false,
          tabBarIcon: ({ color }) => <FontAwesome6 name="file-medical" size={18} color={color} />,
        }}
      />

      <Tabs.Screen
        name="p-community"
        options={{
          title: '社区',
          headerShown: false,
          tabBarIcon: ({ color }) => <FontAwesome6 name="users" size={18} color={color} />,
        }}
      />

      <Tabs.Screen
        name="p-settings"
        options={{
          title: '我的',
          headerShown: false,
          tabBarIcon: ({ color }) => <FontAwesome6 name="user" size={18} color={color} />,
        }}
      />
    </Tabs>
  );
}
