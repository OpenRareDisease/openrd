import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome6 } from '@expo/vector-icons';
import { CLINICAL_COLORS, CLINICAL_GRADIENTS, CLINICAL_TINTS } from '../../lib/clinical-visuals';
import { goBackOrFallback } from '../../lib/navigation';

interface UnavailableScreenProps {
  title: string;
  description?: string;
}

const UnavailableScreen: React.FC<UnavailableScreenProps> = ({ title, description }) => {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={CLINICAL_GRADIENTS.page}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.backgroundGradient}
      >
        <View style={styles.content}>
          <View style={styles.iconCircle}>
            <FontAwesome6 name="circle-exclamation" size={22} color={CLINICAL_COLORS.warning} />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.description}>
            {description ?? '该服务当前仅面向试运行开放，暂未开放使用。'}
          </Text>
          <TouchableOpacity style={styles.backButton} onPress={() => goBackOrFallback(router)}>
            <Text style={styles.backButtonText}>返回</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CLINICAL_COLORS.background,
  },
  backgroundGradient: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CLINICAL_TINTS.warningSoft,
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    color: CLINICAL_COLORS.text,
    fontWeight: '600',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: CLINICAL_COLORS.textSoft,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  backButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: CLINICAL_COLORS.accent,
  },
  backButtonText: {
    color: CLINICAL_COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
});

export default UnavailableScreen;
