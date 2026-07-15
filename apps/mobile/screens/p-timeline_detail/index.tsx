import { useMemo } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import { CLINICAL_COLORS, CLINICAL_GRADIENTS } from '../../lib/clinical-visuals';
import { LinearGradient } from 'expo-linear-gradient';
import { getTimelineDetailItem } from '../../lib/timeline-detail';
import ScreenBackButton from '../common/ScreenBackButton';
import styles from './styles';

const formatFullDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}.${month}.${day} ${hour}:${minute}`;
};

export default function TimelineDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const item = useMemo(() => {
    const pick = (value: string | string[] | undefined): string | undefined => {
      const raw = Array.isArray(value) ? value[0] : value;
      return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
    };

    // Route params are the primary source: they make this screen
    // fully self-contained (cold start / refresh / deep link all
    // render). The in-memory cache remains only as a fallback for
    // legacy links that carry just a detailId.
    const title = pick(params.title);
    const description = pick(params.description);
    const timestamp = pick(params.timestamp);
    const tag = pick(params.tag);
    if (title && timestamp && tag) {
      return {
        id: pick(params.detailId) ?? `${title}:${timestamp}`,
        title,
        description: description ?? '',
        timestamp,
        tag,
        documentId: pick(params.documentId) ?? null,
      };
    }

    const detailId = pick(params.detailId);
    return detailId ? getTimelineDetailItem(detailId) : null;
  }, [params]);

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={CLINICAL_GRADIENTS.page}
        style={styles.backgroundGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.header}>
          <View style={styles.headerLead}>
            <ScreenBackButton />
            <View>
              <Text style={styles.eyebrow}>TIMELINE DETAIL</Text>
              <Text style={styles.pageTitle}>时间轴详情</Text>
            </View>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {item ? (
            <>
              <LinearGradient colors={CLINICAL_GRADIENTS.surface} style={styles.heroCard}>
                <View style={styles.heroTopRow}>
                  <View style={styles.tagPill}>
                    <Text style={styles.tagPillText}>{item.tag}</Text>
                  </View>
                  <Text style={styles.heroTime}>{formatFullDate(item.timestamp)}</Text>
                </View>
                <Text style={styles.heroTitle}>{item.title}</Text>
                <Text style={styles.heroDescription}>
                  这条记录来自时间轴，支持回顾最近病程和报告来源。
                </Text>
              </LinearGradient>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>记录内容</Text>
                <Text style={styles.cardText}>{item.description}</Text>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>记录信息</Text>
                <View style={styles.metaGrid}>
                  <View style={styles.metaCard}>
                    <Text style={styles.metaLabel}>类型</Text>
                    <Text style={styles.metaValue}>{item.tag}</Text>
                  </View>
                  <View style={styles.metaCard}>
                    <Text style={styles.metaLabel}>时间</Text>
                    <Text style={styles.metaValue}>{formatFullDate(item.timestamp)}</Text>
                  </View>
                </View>
              </View>

              {item.documentId ? (
                <TouchableOpacity
                  style={styles.primaryAction}
                  activeOpacity={0.88}
                  onPress={() =>
                    router.push({
                      pathname: '/p-report_detail',
                      params: { documentId: item.documentId ?? '' },
                    })
                  }
                >
                  <FontAwesome6 name="file-lines" size={13} color="#FFFFFF" />
                  <Text style={styles.primaryActionText}>查看报告详情</Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>时间轴详情不可用</Text>
              <Text style={styles.cardText}>
                这条记录已经失效或当前会话中没有缓存，请返回上一页后重新打开。
              </Text>
            </View>
          )}
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}
