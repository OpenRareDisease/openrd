import { plainAnswerText } from './answer-format';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import Icon from './Icon';
import { formatDateLabel } from '../../lib/clinical-visuals';
import { COLOR, INTERACTION, RADIUS } from '../../lib/design';
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
    textColor: COLOR.warn,
    backgroundColor: COLOR.warnWash,
    borderColor: COLOR.warn,
  },
  日常记录: {
    textColor: COLOR.accent,
    backgroundColor: COLOR.accentWash,
    borderColor: COLOR.accent,
  },
  活动: {
    textColor: COLOR.accent,
    backgroundColor: COLOR.accentWash,
    borderColor: COLOR.accent,
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
    textColor: COLOR.inkSoft,
    backgroundColor: COLOR.well,
    borderColor: COLOR.line,
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
    // The full item rides in the route params so the detail screen is
    // self-contained: a cold start, refresh, or shared deep link
    // renders without any in-memory state. The memory cache stays as
    // a legacy fallback for old links that only carry detailId.
    const detailId = storeTimelineDetailItem(item);
    router.push({
      pathname: '/p-timeline_detail',
      params: {
        detailId,
        title: item.title,
        description: item.description,
        timestamp: item.timestamp,
        tag: item.tag,
        ...(item.documentId ? { documentId: item.documentId } : {}),
      },
    });
  };

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        style={styles.header}
        activeOpacity={INTERACTION.pressOpacity}
        accessibilityRole="button"
        accessibilityLabel={collapsed ? '展开时间轴' : '收起时间轴'}
        accessibilityState={{ expanded: !collapsed }}
        aria-expanded={!collapsed}
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
          <Icon name={collapsed ? 'chevron-down' : 'chevron-up'} size={13} color={COLOR.inkSoft} />
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
                activeOpacity={INTERACTION.pressOpacity}
                accessibilityRole="button"
                accessibilityLabel={item.title}
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
                    {/* Flattened, not block-rendered: this row clamps to one line
                and `numberOfLines` does not cross the <View> stack
                AnswerText builds. The detail screen shows the same
                string with its formatting intact. */}
                    <Text style={styles.itemDescription} numberOfLines={1}>
                      {plainAnswerText(item.description)}
                    </Text>
                  </View>
                  <Icon name="arrow-up-right-from-square" size={12} color={COLOR.inkMuted} />
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
    borderRadius: RADIUS.surface,
    padding: 14,
    backgroundColor: COLOR.surface,
    borderWidth: 1,
    borderColor: COLOR.line,
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
    color: COLOR.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 4,
    color: COLOR.inkMuted,
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
    backgroundColor: COLOR.well,
  },
  countPillText: {
    color: COLOR.inkSoft,
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
    borderRadius: RADIUS.surface,
    backgroundColor: COLOR.well,
    borderWidth: 1,
    borderColor: COLOR.line,
  },
  summaryLabel: {
    color: COLOR.inkMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  summaryValue: {
    marginTop: 6,
    color: COLOR.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  collapsedHint: {
    marginTop: 12,
    color: COLOR.inkMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  emptyText: {
    marginTop: 12,
    color: COLOR.inkMuted,
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
    borderRadius: RADIUS.surface,
    backgroundColor: COLOR.well,
    borderWidth: 1,
    borderColor: COLOR.line,
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
    color: COLOR.inkMuted,
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
    color: COLOR.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  itemDescription: {
    marginTop: 4,
    color: COLOR.inkSoft,
    fontSize: 11,
    lineHeight: 16,
  },
});
