import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FontAwesome5, FontAwesome6 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import styles from './styles';
import { PRIVACY_POLICY_TEXT, USER_AGREEMENT_TEXT } from '../../lib/legal-content';
import { CLINICAL_COLORS, CLINICAL_GRADIENTS, CLINICAL_TINTS } from '../../lib/clinical-visuals';
import ScreenBackButton from '../common/ScreenBackButton';

const AboutUsScreen = () => {
  const [isAgreementModalVisible, setIsAgreementModalVisible] = useState(false);
  const [isPrivacyModalVisible, setIsPrivacyModalVisible] = useState(false);

  const handlePhonePress = () => {
    const phoneNumber = 'tel:18099610336';
    Linking.canOpenURL(phoneNumber).then((supported) => {
      if (supported) {
        Linking.openURL(phoneNumber);
      } else {
        Alert.alert('错误', '无法拨打电话');
      }
    });
  };

  const handleEmailPress = () => {
    const email = 'mailto:ailiyaer201025@outlook.com';
    Linking.canOpenURL(email).then((supported) => {
      if (supported) {
        Linking.openURL(email);
      } else {
        Alert.alert('错误', '无法打开邮件应用');
      }
    });
  };

  const handleWebsitePress = () => {
    const website = 'https://fshdyouth.com';
    Linking.canOpenURL(website).then((supported) => {
      if (supported) {
        Linking.openURL(website);
      } else {
        Alert.alert('错误', '无法打开网页浏览器');
      }
    });
  };

  const handleUserAgreementPress = () => {
    setIsAgreementModalVisible(true);
  };

  const handlePrivacyPolicyPress = () => {
    setIsPrivacyModalVisible(true);
  };

  const closeAgreementModal = () => {
    setIsAgreementModalVisible(false);
  };

  const closePrivacyModal = () => {
    setIsPrivacyModalVisible(false);
  };

  const renderFeatureItem = (
    icon: string,
    title: string,
    description: string,
    iconColor: string,
  ) => (
    <View style={styles.featureItem}>
      <View style={[styles.featureIconContainer, { backgroundColor: iconColor }]}>
        <FontAwesome6 name={icon} size={14} color={CLINICAL_COLORS.text} />
      </View>
      <View style={styles.featureTextContainer}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureDescription}>{description}</Text>
      </View>
    </View>
  );

  const renderContactItem = (
    icon: string,
    title: string,
    description: string,
    iconColor: string,
    onPress: () => void,
  ) => (
    <TouchableOpacity style={styles.contactItem} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.contactItemContent}>
        <View style={[styles.contactIconContainer, { backgroundColor: iconColor }]}>
          <FontAwesome6 name={icon} size={14} color={CLINICAL_COLORS.text} />
        </View>
        <View style={styles.contactTextContainer}>
          <Text style={styles.contactTitle}>{title}</Text>
          <Text style={styles.contactDescription}>{description}</Text>
        </View>
      </View>
      <FontAwesome6 name="chevron-right" size={12} color={CLINICAL_COLORS.textMuted} />
    </TouchableOpacity>
  );

  const renderLinkItem = (icon: string, title: string, iconColor: string, onPress: () => void) => (
    <TouchableOpacity style={styles.linkItem} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.linkItemContent}>
        <View style={[styles.linkIconContainer, { backgroundColor: iconColor }]}>
          <FontAwesome6 name={icon} size={14} color={CLINICAL_COLORS.text} />
        </View>
        <Text style={styles.linkTitle}>{title}</Text>
      </View>
      <FontAwesome6 name="chevron-right" size={12} color={CLINICAL_COLORS.textMuted} />
    </TouchableOpacity>
  );

  return (
    <LinearGradient colors={CLINICAL_GRADIENTS.page} style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {/* Header */}
        <View style={styles.header}>
          <ScreenBackButton />
          <Text style={styles.headerTitle}>关于我们</Text>
          <View style={styles.headerPlaceholder} />
        </View>

        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          {/* App Info */}
          <View style={styles.appInfoSection}>
            <View style={styles.appLogo}>
              <FontAwesome5 name="heartbeat" size={32} color={CLINICAL_COLORS.accent} />
            </View>
            <Text style={styles.appName}>FSHD青年社区患者平台</Text>
            <Text style={styles.appVersion}>版本 1.0.0</Text>
            <View style={styles.appTaglineContainer}>
              <Text style={styles.appTagline}>面向FSHD患者的移动智能互助平台</Text>
            </View>
          </View>

          {/* Product Intro */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>产品介绍</Text>
            <View style={styles.introContent}>
              <Text style={styles.introText}>
                FSHD青年社区患者平台是专为面肩肱型肌营养不良症（FSHD）患者打造的移动智能互助平台。我们以数据驱动为核心，融合智能分析与社区互助能力，助力患者实现疾病自我管理、优化医疗资源对接效率，同时为FSHD科研进展提供真实数据支撑。
              </Text>
            </View>
          </View>

          {/* Features */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>核心功能</Text>
            <View style={styles.featuresContainer}>
              {renderFeatureItem(
                'question-circle',
                '智能问答',
                '专业FSHD疾病知识库检索，支持个性化症状、用药、康复问题解答',
                CLINICAL_TINTS.accentSoft,
              )}
              {renderFeatureItem(
                'chart-line',
                '病程管理',
                '标准化肌力评估与趋势分析，辅助医患沟通决策',
                CLINICAL_TINTS.accentStrong,
              )}
              {renderFeatureItem(
                'users',
                '患者社区',
                '症状经验分享、康复方法探讨与心理互助陪伴',
                CLINICAL_TINTS.successSoft,
              )}
            </View>
          </View>

          {/* Contact Info */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>联系我们</Text>
            <View style={styles.contactContainer}>
              {renderContactItem(
                'phone',
                '联系方式',
                '18099610336',
                CLINICAL_TINTS.accentSoft,
                handlePhonePress,
              )}
              {renderContactItem(
                'envelope',
                '邮箱',
                'ailiyaer201025@outlook.com',
                CLINICAL_TINTS.successSoft,
                handleEmailPress,
              )}
              {renderContactItem(
                'globe',
                '网站',
                'fshdyouth.com',
                CLINICAL_TINTS.accentStrong,
                handleWebsitePress,
              )}
            </View>
          </View>

          {/* Legal Links */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>法律条款</Text>
            <View style={styles.legalContainer}>
              {renderLinkItem(
                'file-contract',
                '用户协议',
                CLINICAL_TINTS.warningSoft,
                handleUserAgreementPress,
              )}
              {renderLinkItem(
                'shield-alt',
                '隐私政策',
                CLINICAL_TINTS.dangerSoft,
                handlePrivacyPolicyPress,
              )}
            </View>
          </View>

          {/* Copyright */}
          <View style={styles.copyrightSection}>
            <Text style={styles.copyrightText}>© 2024 FSHD青年社区患者平台. 保留所有权利。</Text>
            <Text style={styles.copyrightSubText}>致力于为FSHD患者提供更好的互助与数据服务</Text>
          </View>
        </ScrollView>

        {/* User Agreement Modal */}
        <Modal
          visible={isAgreementModalVisible}
          transparent={true}
          animationType="slide"
          onRequestClose={closeAgreementModal}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={closeAgreementModal}
          >
            <View style={styles.modalContainer}>
              <TouchableOpacity activeOpacity={1}>
                <View style={styles.modalContent}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>用户协议</Text>
                    <TouchableOpacity style={styles.modalCloseButton} onPress={closeAgreementModal}>
                      <FontAwesome5 name="times" size={14} color={CLINICAL_COLORS.textMuted} />
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={styles.modalScrollView} showsVerticalScrollIndicator={false}>
                    <View style={styles.modalTextContainer}>
                      <Text style={styles.modalSectionText}>{USER_AGREEMENT_TEXT}</Text>
                    </View>
                  </ScrollView>
                </View>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Privacy Policy Modal */}
        <Modal
          visible={isPrivacyModalVisible}
          transparent={true}
          animationType="slide"
          onRequestClose={closePrivacyModal}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={closePrivacyModal}
          >
            <View style={styles.modalContainer}>
              <TouchableOpacity activeOpacity={1}>
                <View style={styles.modalContent}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>隐私政策</Text>
                    <TouchableOpacity style={styles.modalCloseButton} onPress={closePrivacyModal}>
                      <FontAwesome5 name="times" size={14} color={CLINICAL_COLORS.textMuted} />
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={styles.modalScrollView} showsVerticalScrollIndicator={false}>
                    <View style={styles.modalTextContainer}>
                      <Text style={styles.modalSectionText}>{PRIVACY_POLICY_TEXT}</Text>
                    </View>
                  </ScrollView>
                </View>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
    </LinearGradient>
  );
};

export default AboutUsScreen;
