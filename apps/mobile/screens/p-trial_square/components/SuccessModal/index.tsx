

import React from 'react';
import { View, Text, TouchableOpacity, Modal } from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import styles from './styles';

interface SuccessModalProps {
  visible: boolean;
  onClose: () => void;
}

const SuccessModal: React.FC<SuccessModalProps> = ({ visible, onClose }) => {
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          style={styles.modal}
          activeOpacity={1}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.iconContainer}>
            <FontAwesome6 name="check" size={20} color="#10B981" />
          </View>
          
          <Text style={styles.title}>申请提交成功</Text>
          <Text style={styles.description}>
            您的申请已成功提交，临床试验机构将在3-5个工作日内审核并联系您。
          </Text>
          
          <TouchableOpacity
            style={styles.confirmButton}
            onPress={onClose}
            activeOpacity={0.8}
          >
            <Text style={styles.confirmButtonText}>确定</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

export default SuccessModal;

