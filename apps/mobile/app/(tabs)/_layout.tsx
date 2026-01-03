import { Tabs } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';

export default function Layout() {
  return (
    <Tabs
      backBehavior="order"
      screenOptions={{
        tabBarActiveTintColor: '#969FFF',
        tabBarInactiveTintColor: 'rgba(255, 255, 255, 0.5)',
        tabBarStyle: {
          backgroundColor: '#0f0f23f2',
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
