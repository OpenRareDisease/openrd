

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import styles from './styles';

interface TrialData {
  id: string;
  title: string;
  institution: string;
  department: string;
  phase: string;
  status: string;
  matchPercentage: number;
  inclusionCriteria: string[];
  location: string;
  duration: string;
}

interface TrialCardProps {
  trial: TrialData;
  onPress: () => void;
  onApplyPress: () => void;
}

const TrialCard: React.FC<TrialCardProps> = ({ trial, onPress, onApplyPress }) => {
  const getMatchBadgeStyle = () => {
    if (trial.matchPercentage >= 80) {
      return styles.matchBadgeHigh;
    } else if (trial.matchPercentage >= 60) {
      return styles.matchBadgeMedium;
    } else {
      return styles.matchBadgeLow;
    }
  };

  const getMatchTextStyle = () => {
    if (trial.matchPercentage >= 80) {
      return styles.matchTextHigh;
    } else if (trial.matchPercentage >= 60) {
      return styles.matchTextMedium;
    } else {
      return styles.matchTextLow;
    }
  };

  const handleApplyPress = (event: any) => {
    event.stopPropagation();
    onApplyPress();
  };

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>{trial.title}</Text>
          <Text style={styles.institution}>
            {trial.institution} {trial.department ? `· ${trial.department}` : ''}
          </Text>
          <View style={styles.tagsContainer}>
            <View style={styles.phaseBadge}>
              <Text style={styles.phaseText}>{trial.phase}</Text>
            </View>
            <Text style={styles.statusText}>{trial.status}</Text>
          </View>
        </View>
        <View style={[styles.matchBadge, getMatchBadgeStyle()]}>
          <Text style={[styles.matchText, getMatchTextStyle()]}>
            {trial.matchPercentage}%匹配
          </Text>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.criteriaSection}>
        <View style={styles.criteriaHeader}>
          <Text style={styles.criteriaLabel}>主要入组条件:</Text>
          <Text style={styles.viewDetailsText}>查看详情</Text>
        </View>
        <View style={styles.criteriaList}>
          {trial.inclusionCriteria.slice(0, 3).map((criteria, index) => (
            <Text key={index} style={styles.criteriaText}>
              • {criteria}
            </Text>
          ))}
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.footer}>
        <View style={styles.footerLeft}>
          <View style={styles.infoItem}>
            <FontAwesome6 name="location-dot" size={10} color="rgba(255, 255, 255, 0.5)" />
            <Text style={styles.infoText}>{trial.location}</Text>
          </View>
          <View style={styles.infoItem}>
            <FontAwesome6 name="calendar" size={10} color="rgba(255, 255, 255, 0.5)" />
            <Text style={styles.infoText}>{trial.duration}</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.applyButton}
          onPress={handleApplyPress}
          activeOpacity={0.8}
        >
          <Text style={styles.applyButtonText}>申请入组</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};

export default TrialCard;

