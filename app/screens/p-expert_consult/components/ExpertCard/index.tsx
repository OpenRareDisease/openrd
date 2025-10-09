

import React from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import styles from './styles';

interface ExpertData {
  id: string;
  name: string;
  title: string;
  hospital: string;
  rating: string;
  patients: string;
  online: boolean;
  busy: boolean;
  avatar: string;
}

interface ExpertCardProps {
  expert: ExpertData;
  onPress: () => void;
  onTextConsult: () => void;
  onPhoneConsult: () => void;
}

const ExpertCard: React.FC<ExpertCardProps> = ({
  expert,
  onPress,
  onTextConsult,
  onPhoneConsult,
}) => {
  const getOnlineStatusColor = () => {
    if (!expert.online) return '#9CA3AF';
    if (expert.busy) return '#F59E0B';
    return '#10B981';
  };

  const getOnlineStatusText = () => {
    if (!expert.online) return '离线';
    if (expert.busy) return '忙碌';
    return '在线';
  };

  const isConsultDisabled = !expert.online;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.cardContent}>
        <View style={styles.avatarContainer}>
          <Image source={{ uri: expert.avatar }} style={styles.avatar} />
          <View style={[styles.onlineIndicator, { backgroundColor: getOnlineStatusColor() }]} />
        </View>
        
        <View style={styles.expertInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.expertName}>{expert.name}</Text>
            <Text style={[styles.onlineText, { color: getOnlineStatusColor() }]}>
              {getOnlineStatusText()}
            </Text>
          </View>
          
          <Text style={styles.expertTitle}>{expert.title}</Text>
          <Text style={styles.expertHospital}>{expert.hospital}</Text>
          
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <FontAwesome6 name="star" style={styles.starIcon} />
              <Text style={styles.statText}>{expert.rating}</Text>
            </View>
            <View style={styles.statItem}>
              <FontAwesome6 name="users" style={styles.usersIcon} />
              <Text style={styles.statText}>{expert.patients}</Text>
            </View>
          </View>
          
          <View style={styles.consultButtons}>
            <TouchableOpacity
              style={[
                styles.textConsultButton,
                isConsultDisabled && styles.consultButtonDisabled
              ]}
              onPress={onTextConsult}
              disabled={isConsultDisabled}
            >
              <FontAwesome6 name="comment-dots" style={styles.consultButtonIcon} />
              <Text style={[
                styles.textConsultButtonText,
                isConsultDisabled && styles.consultButtonTextDisabled
              ]}>
                图文咨询
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[
                styles.phoneConsultButton,
                isConsultDisabled && styles.consultButtonDisabled
              ]}
              onPress={onPhoneConsult}
              disabled={isConsultDisabled}
            >
              <FontAwesome6 name="phone" style={styles.consultButtonIcon} />
              <Text style={[
                styles.phoneConsultButtonText,
                isConsultDisabled && styles.consultButtonTextDisabled
              ]}>
                电话咨询
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

export default ExpertCard;

