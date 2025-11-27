import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';

type RecordEntry = {
  date: string;
  title: string;
  strength: number;
  fatigue: number;
  pain: number;
};

const MOCK_ENTRIES: RecordEntry[] = [
  {
    date: '2024-01-15',
    title: 'Stair-climbing test',
    strength: 3.5,
    fatigue: 2,
    pain: 1,
  },
  {
    date: '2024-01-10',
    title: 'Muscle assessment',
    strength: 4.0,
    fatigue: 1,
    pain: 1,
  },
  {
    date: '2024-01-05',
    title: 'Blood test',
    strength: 4.2,
    fatigue: 1,
    pain: 0,
  },
];

function getRiskLevel(latest: RecordEntry): { label: string; color: string } {
  if (latest.strength < 3.5) return { label: 'High risk', color: '#f97316' };
  if (latest.strength < 4.0) return { label: 'Medium risk', color: '#fbbf24' };
  return { label: 'Low risk', color: '#22c55e' };
}

const RecordTimelineScreen: React.FC = () => {
  const latest = MOCK_ENTRIES[0];
  const risk = getRiskLevel(latest);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <Text style={styles.title}>Dynamic record timeline</Text>
        <View style={[styles.riskPill, { borderColor: risk.color }]}>
          <View style={[styles.riskDot, { backgroundColor: risk.color }]} />
          <Text style={[styles.riskText, { color: risk.color }]}>{risk.label}</Text>
        </View>
      </View>

      <Text style={styles.subtitle}>
        Multi-visit summary with simple risk warning based on recent strength.
      </Text>

      {/* Timeline list */}
      <View style={styles.timelineContainer}>
        {MOCK_ENTRIES.map((entry, index) => (
          <View key={entry.date} style={styles.timelineRow}>
            {/* left line + dot */}
            <View style={styles.timelineLeft}>
              <View style={styles.timelineLine} />
              <View style={styles.timelineDot} />
              {index !== MOCK_ENTRIES.length - 1 && <View style={styles.timelineLineBottom} />}
            </View>

            {/* right content */}
            <View style={styles.timelineContent}>
              <Text style={styles.dateText}>{entry.date}</Text>
              <Text style={styles.entryTitle}>{entry.title}</Text>

              <View style={styles.metricsRow}>
                <View style={styles.metricBadge}>
                  <FontAwesome6 name="dumbbell" size={10} color="#a5b4fc" />
                  <Text style={styles.metricText}>Strength {entry.strength.toFixed(1)}</Text>
                </View>

                <View style={styles.metricBadge}>
                  <FontAwesome6 name="bolt" size={10} color="#fbbf24" />
                  <Text style={styles.metricText}>Fatigue {entry.fatigue}</Text>
                </View>

                <View style={styles.metricBadge}>
                  <FontAwesome6 name="heart-pulse" size={10} color="#f87171" />
                  <Text style={styles.metricText}>Pain {entry.pain}</Text>
                </View>
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // no backgroundColor or margin here – outer card comes from p-manage styles.card
  container: {
    flexDirection: 'column',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginBottom: 12,
  },
  riskPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: 'rgba(15,15,35,0.9)',
  },
  riskDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    marginRight: 6,
  },
  riskText: {
    fontSize: 12,
    fontWeight: '500',
  },
  timelineContainer: {
    marginTop: 8,
  },
  timelineRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  timelineLeft: {
    width: 16,
    alignItems: 'center',
  },
  timelineLine: {
    width: 2,
    flexGrow: 1,
    backgroundColor: 'rgba(148,163,184,0.4)',
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#6366f1',
    borderWidth: 2,
    borderColor: '#0f172a',
    position: 'absolute',
    top: 8,
  },
  timelineLineBottom: {
    width: 2,
    flexGrow: 1,
    backgroundColor: 'rgba(148,163,184,0.4)',
    marginTop: 12,
  },
  timelineContent: {
    flex: 1,
    marginLeft: 12,
  },
  dateText: {
    color: 'rgba(148,163,184,0.9)',
    fontSize: 11,
  },
  entryTitle: {
    color: '#e5e7eb',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
    marginBottom: 4,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  metricBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.8)',
    marginRight: 6,
    marginBottom: 4,
  },
  metricText: {
    color: 'rgba(226,232,240,0.9)',
    fontSize: 11,
    marginLeft: 4,
  },
});

export default RecordTimelineScreen;
