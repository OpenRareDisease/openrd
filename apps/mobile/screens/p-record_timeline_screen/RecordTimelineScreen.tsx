import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CLINICAL_COLORS } from '../../lib/clinical-visuals';

export interface TimelineItem {
  title: string;
  description: string;
  time: string;
}

const RecordTimelineScreen: React.FC<{ items: TimelineItem[] }> = ({ items }) => {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>动态记录</Text>
      {items.length === 0 ? (
        <Text style={styles.emptyText}>暂无动态记录，录入后会展示在这里。</Text>
      ) : (
        items.map((item, idx) => (
          <View key={`${item.title}-${idx}`} style={styles.item}>
            <View style={styles.dot} />
            <View style={styles.content}>
              <Text style={styles.itemTitle}>{item.title}</Text>
              <Text style={styles.itemDesc}>{item.description}</Text>
              <Text style={styles.itemTime}>{item.time}</Text>
            </View>
          </View>
        ))
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: CLINICAL_COLORS.panel,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    gap: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: CLINICAL_COLORS.text,
  },
  item: {
    flexDirection: 'row',
    gap: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: CLINICAL_COLORS.accent,
    marginTop: 6,
  },
  content: {
    flex: 1,
    gap: 4,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: CLINICAL_COLORS.text,
  },
  itemDesc: {
    fontSize: 12,
    color: CLINICAL_COLORS.textSoft,
  },
  itemTime: {
    fontSize: 12,
    color: CLINICAL_COLORS.textMuted,
  },
  emptyText: {
    fontSize: 12,
    color: CLINICAL_COLORS.textMuted,
  },
});

export default RecordTimelineScreen;
