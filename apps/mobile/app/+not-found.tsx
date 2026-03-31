import { useRouter } from 'expo-router';
import { StyleSheet, View, Text, Pressable, Platform } from 'react-native';
import { CLINICAL_COLORS } from '../lib/clinical-visuals';
import { goBackOrFallback } from '../lib/navigation';

export default function NotFoundScreen() {
  const router = useRouter();

  const goBack = () => {
    goBackOrFallback(router);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>404</Text>
      <Text style={styles.textStyle}>页面未找到</Text>
      <Text style={styles.subTextStyle}>抱歉！您访问的页面不存在，当前页面功能待完善。</Text>
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
    backgroundColor: CLINICAL_COLORS.background,
    padding: 24,
  },
  heading: {
    fontSize: 120,
    fontWeight: '900',
    color: CLINICAL_COLORS.accent,
    textShadowColor: 'rgba(0, 0, 0, 0.05)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 8,
  },
  textStyle: {
    fontSize: 24,
    fontWeight: '500',
    marginTop: -16,
    marginBottom: 16,
    color: CLINICAL_COLORS.text,
  },
  subTextStyle: {
    fontSize: 16,
    color: CLINICAL_COLORS.textSoft,
    marginBottom: 32,
    maxWidth: 400,
    textAlign: 'center',
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: CLINICAL_COLORS.accent,
    borderRadius: 9999,
    ...Platform.select({
      ios: {
        shadowColor: CLINICAL_COLORS.accent,
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.25,
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
    color: CLINICAL_COLORS.text,
  },
});
