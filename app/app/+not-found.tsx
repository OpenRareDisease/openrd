import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, View, Text, Pressable, Platform } from 'react-native';

export default function NotFoundScreen() {
  const router = useRouter();

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>404</Text>
      <Text style={styles.textStyle}>页面未找到</Text>
      <Text style={styles.subTextStyle}>
        抱歉！您访问的页面不存在，当前页面功能待完善。
      </Text>
      <Pressable onPress={goBack} style={styles.button}>
        <Text style={styles.buttonText}>返回上一页</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f5ff',
    padding: 16,
  },
  heading: {
    fontSize: 120,
    fontWeight: '900',
    color: '#4a5568',
    textShadowColor: 'rgba(0, 0, 0, 0.05)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 8,
  },
  textStyle: {
    fontSize: 24,
    fontWeight: '500',
    marginTop: -16,
    marginBottom: 16,
    color: '#4a5568',
  },
  subTextStyle: {
    fontSize: 16,
    color: '#718096',
    marginBottom: 32,
    maxWidth: 400,
    textAlign: 'center',
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#6366f1',
    borderRadius: 9999,
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(0, 0, 0, 0.1)',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 1,
        shadowRadius: 15,
      },
      android: {
        elevation: 5,
      },
    }),
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
});