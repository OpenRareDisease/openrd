

import React from 'react';
import { View, Text, Modal, TouchableOpacity, Image, TouchableWithoutFeedback } from 'react-native';
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
  specialty: string;
  experience: string;
  availableTime: string;
}

interface ExpertDetailModalProps {
  visible: boolean;
  expert: ExpertData | null;
  onClose: () => void;
}

const ExpertDetailModal: React.FC<ExpertDetailModalProps> = ({
  visible,
  expert,
  onClose,
}) => {
  if (!expert) return null;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.modalContainer}>
              <View style={styles.modalContent}>
                {/* 模态框头部 */}
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>专家详情</Text>
                  <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                    <FontAwesome6 name="xmark" style={styles.closeIcon} />
                  </TouchableOpacity>
                </View>

                {/* 专家信息 */}
                <View style={styles.expertDetailInfo}>
                  <View style={styles.expertDetailHeader}>
                    <Image source={{ uri: expert.avatar }} style={styles.expertDetailAvatar} />
                    <View style={styles.expertDetailBasicInfo}>
                      <Text style={styles.expertDetailName}>{expert.name}</Text>
                      <Text style={styles.expertDetailTitle}>{expert.title}</Text>
                      <Text style={styles.expertDetailHospital}>{expert.hospital}</Text>
                    </View>
                  </View>

                  <View style={styles.expertDetailDetails}>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>擅长领域</Text>
                      <Text style={styles.detailValue}>{expert.specialty}</Text>
                    </View>

                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>临床经验</Text>
                      <Text style={styles.detailValue}>{expert.experience}</Text>
                    </View>

                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>评分</Text>
                      <View style={styles.ratingContainer}>
                        <FontAwesome6 name="star" style={styles.detailStarIcon} />
                        <Text style={styles.detailValue}>{expert.rating}</Text>
                      </View>
                    </View>

                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>服务患者</Text>
                      <Text style={styles.detailValue}>{expert.patients}</Text>
                    </View>

                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>出诊时间</Text>
                      <Text style={styles.detailValue}>{expert.availableTime}</Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

export default ExpertDetailModal;

