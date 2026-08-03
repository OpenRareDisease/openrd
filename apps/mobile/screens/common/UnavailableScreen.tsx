import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Icon from './Icon';

import { COLOR, RADIUS } from '../../lib/design';
import { goBackOrFallback } from '../../lib/navigation';

interface UnavailableScreenProps {
  title: string;
  description?: string;
}

const UnavailableScreen: React.FC<UnavailableScreenProps> = ({ title, description }) => {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      {/* Flat paper, not the sand gradient. CLINICAL_GRADIENTS.page is
          ['#F8F2EA', …], the palette lib/design.ts explicitly rejected
          — its own comment says #F8F2EA "pulled yellow enough to grey
          out the teal sitting on it" — so the last four screens using
          it were painting their page in the rejected colour underneath
          the accent it greys out. */}
      <View style={styles.backgroundGradient}>
        <View style={styles.content}>
          <View style={styles.iconCircle}>
            <Icon name="circle-exclamation" size={22} color={COLOR.warn} />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.description}>
            {description ?? '该服务当前仅面向试运行开放，暂未开放使用。'}
          </Text>
          <TouchableOpacity
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="返回"
            onPress={() => goBackOrFallback(router)}
          >
            <Text style={styles.backButtonText}>返回</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLOR.paper,
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
    borderRadius: RADIUS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLOR.warnWash,
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    color: COLOR.ink,
    fontWeight: '600',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: COLOR.inkSoft,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  backButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: COLOR.accent,
  },
  backButtonText: {
    color: COLOR.ink,
    fontSize: 14,
    fontWeight: '600',
  },
});

export default UnavailableScreen;
