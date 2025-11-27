import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';

type MuscleSnapshot = {
  label: string;
  latest: number;
  previous: number;
};

const MOCK_DATA: MuscleSnapshot[] = [
  { label: '三角肌', latest: 3.5, previous: 4.0 },
  { label: '肱二头肌', latest: 4.0, previous: 4.2 },
  { label: '肱三头肌', latest: 4.5, previous: 4.6 },
  { label: '胫骨前肌', latest: 4.8, previous: 4.8 },
];

function getTrend(latest: number, previous: number) {
  const diff = latest - previous;

  if (diff > 0.1) return { label: '略有上升', color: '#22c55e' }; // green
  if (diff < -0.1) return { label: '略有下降', color: '#f97316' }; // orange
  return { label: '基本稳定', color: '#e5e7eb' }; // grey
}

// 👇 name matches the file & your import
const DataComparisonFeature: React.FC = () => {
  return (
    <View style={styles.card}>
      {/* 标题 */}
      <View style={styles.headerRow}>
        <Text style={styles.title}>数据对比</Text>
        <View style={styles.badge}>
          <FontAwesome6 name="chart-line" size={10} color="#a5b4fc" />
          <Text style={styles.badgeText}>最近 2 次评估</Text>
        </View>
      </View>
      <Text style={styles.subtitle}>
        对比最近两次肌力评估，帮助你快速了解哪些部位需要重点关注。
      </Text>

      {/* 表头 */}
      <View style={styles.tableHeader}>
        <Text style={[styles.headerCell, { flex: 2 }]}>肌群</Text>
        <Text style={styles.headerCell}>上次</Text>
        <Text style={styles.headerCell}>本次</Text>
        <Text style={[styles.headerCell, { flex: 1.5 }]}>趋势</Text>
      </View>

      {/* 数据行 */}
      {MOCK_DATA.map((row) => {
        const trend = getTrend(row.latest, row.previous);
        const diff = row.latest - row.previous;

        return (
          <View key={row.label} style={styles.row}>
            <Text style={[styles.cellText, { flex: 2 }]}>{row.label}</Text>
            <Text style={styles.cellText}>{row.previous.toFixed(1)}</Text>
            <Text style={styles.cellText}>{row.latest.toFixed(1)}</Text>
            <View style={[styles.trendPill, { borderColor: trend.color }]}>
              <View style={[styles.trendDot, { backgroundColor: trend.color }]} />
              <Text style={[styles.trendText, { color: trend.color }]}>
                {trend.label}{' '}
                <Text style={styles.diffText}>
                  ({diff >= 0 ? '+' : ''}
                  {diff.toFixed(1)})
                </Text>
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#151530',
    borderRadius: 16,
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(79,70,229,0.25)',
  },
  badgeText: {
    color: '#a5b4fc',
    fontSize: 11,
    marginLeft: 4,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginBottom: 12,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148,163,184,0.4)',
    marginBottom: 4,
  },
  headerCell: {
    flex: 1,
    color: 'rgba(148,163,184,0.9)',
    fontSize: 11,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  cellText: {
    flex: 1,
    color: '#e5e7eb',
    fontSize: 12,
  },
  trendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1.5,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  trendDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    marginRight: 6,
  },
  trendText: {
    fontSize: 11,
  },
  diffText: {
    color: 'rgba(156,163,175,0.9)', // subtle grey for the +0.3 part
    fontSize: 11,
  },
});

export default DataComparisonFeature;
