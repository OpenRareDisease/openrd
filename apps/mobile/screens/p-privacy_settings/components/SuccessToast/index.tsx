import { COLOR } from '../../../../lib/design';
import React from 'react';
import { View, Text, Modal } from 'react-native';
import Icon from '../../../common/Icon';
import styles from './styles';

interface SuccessToastProps {
  isVisible: boolean;
  message: string;
}

const SuccessToast: React.FC<SuccessToastProps> = ({ isVisible, message }) => {
  return (
    <Modal visible={isVisible} transparent animationType="fade" pointerEvents="none">
      <View style={styles.toastContainer}>
        <View style={styles.toastContent}>
          <Icon name="circle-check" size={14} color={COLOR.good} />
          <Text style={styles.toastMessage}>{message}</Text>
        </View>
      </View>
    </Modal>
  );
};

export default SuccessToast;
