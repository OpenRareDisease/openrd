import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

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
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    gap: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  item: {
    flexDirection: 'row',
    gap: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#969FFF',
    marginTop: 6,
  },
  content: {
    flex: 1,
    gap: 4,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  itemDesc: {
    fontSize: 12,
    color: '#D1D5DB',
  },
  itemTime: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  emptyText: {
    fontSize: 12,
    color: '#9CA3AF',
  },
});

export default RecordTimelineScreen;
