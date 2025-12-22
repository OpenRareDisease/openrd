import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const mockTimeline = [
  { title: 'MRI 影像上传', description: '影像清晰可读', time: '2025-12-18' },
  { title: '日常活动记录', description: '步行 2 公里，拉伸 20 分钟', time: '2025-12-17' },
  { title: '肌力评估', description: '三角肌评分 4.0', time: '2025-12-16' },
];

const RecordTimelineScreen: React.FC = () => {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>动态记录</Text>
      {mockTimeline.map((item, idx) => (
        <View key={idx} style={styles.item}>
          <View style={styles.dot} />
          <View style={styles.content}>
            <Text style={styles.itemTitle}>{item.title}</Text>
            <Text style={styles.itemDesc}>{item.description}</Text>
            <Text style={styles.itemTime}>{item.time}</Text>
          </View>
        </View>
      ))}
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
});

export default RecordTimelineScreen;
