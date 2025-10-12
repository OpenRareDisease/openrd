

import React from 'react';
import { View, Text, Modal } from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import styles from './styles';

interface SuccessToastProps {
  isVisible: boolean;
  message: string;
}

const SuccessToast: React.FC<SuccessToastProps> = ({ isVisible, message }) => {
  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="fade"
      pointerEvents="none"
    >
      <View style={styles.toastContainer}>
        <View style={styles.toastContent}>
          <FontAwesome6 name="circle-check" size={14} color="#34C759" />
          <Text style={styles.toastMessage}>{message}</Text>
        </View>
      </View>
    </Modal>
  );
};

export default SuccessToast;

