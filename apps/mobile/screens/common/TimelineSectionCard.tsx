import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import { CLINICAL_COLORS, CLINICAL_TINTS, formatDateLabel } from '../../lib/clinical-visuals';
import { storeTimelineDetailItem, type TimelineDetailItem } from '../../lib/timeline-detail';

type TimelineSectionCardProps = {
  items: TimelineDetailItem[];
  subtitle?: string;
  emptyText: string;
  defaultCollapsed?: boolean;
};

const cardShadow =
  Platform.select({
    ios: {
      shadowColor: '#182B36',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.1,
      shadowRadius: 24,
    },
    android: {
      elevation: 5,
    },
    default: {},
  }) ?? {};

const tagStyleMap: Record<
  string,
  { textColor: string; backgroundColor: string; borderColor: string }
> = {
  报告: {
    textColor: '#2563EB',
    backgroundColor: 'rgba(37, 99, 235, 0.1)',
    borderColor: 'rgba(37, 99, 235, 0.2)',
  },
  事件: {
    textColor: CLINICAL_COLORS.warning,
    backgroundColor: CLINICAL_TINTS.warningSoft,
    borderColor: CLINICAL_TINTS.warningBorder,
  },
  随访: {
    textColor: CLINICAL_COLORS.accentStrong,
    backgroundColor: CLINICAL_TINTS.accentSoft,
    borderColor: CLINICAL_TINTS.accentBorder,
  },
  活动: {
    textColor: CLINICAL_COLORS.accentStrong,
    backgroundColor: CLINICAL_TINTS.accentSoft,
    borderColor: CLINICAL_TINTS.accentBorder,
  },
  功能测试: {
    textColor: '#7C3AED',
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    borderColor: 'rgba(124, 58, 237, 0.18)',
  },
  肌力: {
    textColor: '#7C3AED',
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    borderColor: 'rgba(124, 58, 237, 0.18)',
  },
};

const getTagStyle = (tag: string) =>
  tagStyleMap[tag] ?? {
    textColor: CLINICAL_COLORS.textSoft,
    backgroundColor: CLINICAL_TINTS.neutralSoft,
    borderColor: CLINICAL_TINTS.borderSubtle,
  };

export default function TimelineSectionCard({
  items,
  subtitle,
  emptyText,
  defaultCollapsed = true,
}: TimelineSectionCardProps) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const latestDate = useMemo(() => {
    if (!items.length) return '—';
    return formatDateLabel(items[0]?.timestamp);
  }, [items]);

  const openDetail = (item: TimelineDetailItem) => {
    const detailId = storeTimelineDetailItem(item);
    router.push({
      pathname: '/p-timeline_detail',
      params: { detailId },
    });
  };

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        style={styles.header}
        activeOpacity={0.88}
        onPress={() => setCollapsed((value) => !value)}
      >
        <View style={styles.headerCopy}>
          <Text style={styles.title}>时间轴</Text>
          <Text style={styles.subtitle}>
            {subtitle ?? '按时间整理最近记录，展开后可点击卡片查看详情。'}
          </Text>
        </View>
        <View style={styles.headerMeta}>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{items.length} 条</Text>
          </View>
          <FontAwesome6
            name={collapsed ? 'chevron-down' : 'chevron-up'}
            size={13}
            color={CLINICAL_COLORS.textSoft}
          />
        </View>
      </TouchableOpacity>

      <View style={styles.summaryGrid}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>最近日期</Text>
          <Text style={styles.summaryValue}>{latestDate}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>记录数量</Text>
          <Text style={styles.summaryValue}>{items.length}</Text>
        </View>
      </View>

      {collapsed ? (
        <Text style={styles.collapsedHint}>展开后查看完整时间轴卡片。</Text>
      ) : items.length === 0 ? (
        <Text style={styles.emptyText}>{emptyText}</Text>
      ) : (
        <View style={styles.cardList}>
          {items.map((item) => {
            const tagStyle = getTagStyle(item.tag);
            return (
              <TouchableOpacity
                key={`${item.id}-${item.timestamp}`}
                style={styles.itemCard}
                activeOpacity={0.88}
                onPress={() => openDetail(item)}
              >
                <View style={styles.itemHeader}>
                  <View
                    style={[
                      styles.tag,
                      {
                        backgroundColor: tagStyle.backgroundColor,
                        borderColor: tagStyle.borderColor,
                      },
                    ]}
                  >
                    <Text style={[styles.tagText, { color: tagStyle.textColor }]}>{item.tag}</Text>
                  </View>
                  <Text style={styles.itemTime}>{formatDateLabel(item.timestamp)}</Text>
                </View>

                <View style={styles.itemBody}>
                  <View style={styles.itemCopy}>
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.itemDescription} numberOfLines={1}>
                      {item.description}
                    </Text>
                  </View>
                  <FontAwesome6
                    name="arrow-up-right-from-square"
                    size={12}
                    color={CLINICAL_COLORS.textMuted}
                  />
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: 22,
    padding: 14,
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    ...cardShadow,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    color: CLINICAL_COLORS.text,
    fontSize: 15,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 4,
    color: CLINICAL_COLORS.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  headerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  countPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: CLINICAL_TINTS.neutralSoft,
  },
  countPillText: {
    color: CLINICAL_COLORS.textSoft,
    fontSize: 11,
    fontWeight: '700',
  },
  summaryGrid: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 10,
  },
  summaryCard: {
    flex: 1,
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(248, 242, 234, 0.82)',
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
  },
  summaryLabel: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  summaryValue: {
    marginTop: 6,
    color: CLINICAL_COLORS.text,
    fontSize: 14,
    fontWeight: '800',
  },
  collapsedHint: {
    marginTop: 12,
    color: CLINICAL_COLORS.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  emptyText: {
    marginTop: 12,
    color: CLINICAL_COLORS.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  cardList: {
    marginTop: 12,
    gap: 8,
  },
  itemCard: {
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 16,
    backgroundColor: 'rgba(248, 242, 234, 0.82)',
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  tagText: {
    fontSize: 10,
    fontWeight: '800',
  },
  itemTime: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 10,
  },
  itemBody: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  itemCopy: {
    flex: 1,
  },
  itemTitle: {
    color: CLINICAL_COLORS.text,
    fontSize: 13,
    fontWeight: '800',
  },
  itemDescription: {
    marginTop: 4,
    color: CLINICAL_COLORS.textSoft,
    fontSize: 11,
    lineHeight: 16,
  },
});
