

import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, Linking, Alert, } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome5, FontAwesome6 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import styles from './styles';

const AboutUsScreen = () => {
  const router = useRouter();
  const [isAgreementModalVisible, setIsAgreementModalVisible] = useState(false);
  const [isPrivacyModalVisible, setIsPrivacyModalVisible] = useState(false);

  const handleBackPress = () => {
    if (router.canGoBack()) {
      router.back();
    }
  };

  const handlePhonePress = () => {
    const phoneNumber = 'tel:400-123-4567';
    Linking.canOpenURL(phoneNumber).then((supported) => {
      if (supported) {
        Linking.openURL(phoneNumber);
      } else {
        Alert.alert('错误', '无法拨打电话');
      }
    });
  };

  const handleEmailPress = () => {
    const email = 'mailto:support@fshd-openrd.com';
    Linking.canOpenURL(email).then((supported) => {
      if (supported) {
        Linking.openURL(email);
      } else {
        Alert.alert('错误', '无法打开邮件应用');
      }
    });
  };

  const handleWebsitePress = () => {
    const website = 'https://www.fshd-openrd.com';
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

  const renderFeatureItem = (icon: string, title: string, description: string, iconColor: string) => (
    <View style={styles.featureItem}>
      <View style={[styles.featureIconContainer, { backgroundColor: iconColor }]}>
        <FontAwesome6 name={icon} size={14} color="#FFFFFF" />
      </View>
      <View style={styles.featureTextContainer}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureDescription}>{description}</Text>
      </View>
    </View>
  );

  const renderContactItem = (icon: string, title: string, description: string, iconColor: string, onPress: () => void) => (
    <TouchableOpacity style={styles.contactItem} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.contactItemContent}>
        <View style={[styles.contactIconContainer, { backgroundColor: iconColor }]}>
          <FontAwesome6 name={icon} size={14} color="#FFFFFF" />
        </View>
        <View style={styles.contactTextContainer}>
          <Text style={styles.contactTitle}>{title}</Text>
          <Text style={styles.contactDescription}>{description}</Text>
        </View>
      </View>
      <FontAwesome6 name="chevron-right" size={12} color="rgba(255, 255, 255, 0.5)" />
    </TouchableOpacity>
  );

  const renderLinkItem = (icon: string, title: string, iconColor: string, onPress: () => void) => (
    <TouchableOpacity style={styles.linkItem} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.linkItemContent}>
        <View style={[styles.linkIconContainer, { backgroundColor: iconColor }]}>
          <FontAwesome6 name={icon} size={14} color="#FFFFFF" />
        </View>
        <Text style={styles.linkTitle}>{title}</Text>
      </View>
      <FontAwesome6 name="chevron-right" size={12} color="rgba(255, 255, 255, 0.5)" />
    </TouchableOpacity>
  );

  return (
    <LinearGradient colors={['#0F0F23', '#1A1A3A', '#0F0F23']} style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={handleBackPress} activeOpacity={0.7}>
            <FontAwesome6 name="arrow-left" size={16} color="rgba(255, 255, 255, 0.7)" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>关于我们</Text>
          <View style={styles.headerPlaceholder} />
        </View>

        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          {/* App Info */}
          <View style={styles.appInfoSection}>
            <View style={styles.appLogo}>
              <FontAwesome5 name="heartbeat" size={32} color="#969FFF" />
            </View>
            <Text style={styles.appName}>FSHD-openrd</Text>
            <Text style={styles.appVersion}>版本 1.0.0</Text>
            <View style={styles.appTaglineContainer}>
              <Text style={styles.appTagline}>专为FSHD患者设计的智能管理平台</Text>
            </View>
          </View>

          {/* Product Intro */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>产品介绍</Text>
            <View style={styles.introContent}>
              <Text style={styles.introText}>
                FSHD-openrd是一款专为面肩肱型肌营养不良症（FSHD）患者设计的移动端智能管理平台。我们致力于通过数据驱动、智能分析和社区互助，赋能患者自我管理，优化医疗资源对接，加速科研进展。
              </Text>
            </View>
          </View>

          {/* Features */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>核心功能</Text>
            <View style={styles.featuresContainer}>
              {renderFeatureItem('question-circle', '智能问答', '专业FSHD知识查询与个性化问答', 'rgba(150, 159, 255, 0.2)')}
              {renderFeatureItem('chart-line', '病程管理', '肌力评估与AI病程预测', 'rgba(81, 71, 255, 0.2)')}
              {renderFeatureItem('users', '患者社区', '经验分享与互助交流', 'rgba(34, 197, 94, 0.2)')}
            </View>
          </View>

          {/* Contact Info */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>联系我们</Text>
            <View style={styles.contactContainer}>
              {renderContactItem('phone', '客服电话', '400-123-4567', 'rgba(59, 130, 246, 0.2)', handlePhonePress)}
              {renderContactItem('envelope', '客服邮箱', 'support@fshd-openrd.com', 'rgba(34, 197, 94, 0.2)', handleEmailPress)}
              {renderContactItem('globe', '官方网站', 'www.fshd-openrd.com', 'rgba(168, 85, 247, 0.2)', handleWebsitePress)}
            </View>
          </View>

          {/* Legal Links */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>法律条款</Text>
            <View style={styles.legalContainer}>
              {renderLinkItem('file-contract', '用户协议', 'rgba(234, 179, 8, 0.2)', handleUserAgreementPress)}
              {renderLinkItem('shield-alt', '隐私政策', 'rgba(239, 68, 68, 0.2)', handlePrivacyPolicyPress)}
            </View>
          </View>

          {/* Copyright */}
          <View style={styles.copyrightSection}>
            <Text style={styles.copyrightText}>© 2024 FSHD-openrd. 保留所有权利。</Text>
            <Text style={styles.copyrightSubText}>致力于为FSHD患者提供更好的医疗服务</Text>
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
                      <FontAwesome5 name="times" size={14} color="rgba(255, 255, 255, 0.5)" />
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={styles.modalScrollView} showsVerticalScrollIndicator={false}>
                    <View style={styles.modalTextContainer}>
                      <View style={styles.modalSection}>
                        <Text style={styles.modalSectionTitle}>1. 服务条款</Text>
                        <Text style={styles.modalSectionText}>
                          欢迎使用FSHD-openrd应用程序。在使用我们的服务前，请仔细阅读并理解本协议的所有条款。
                        </Text>
                      </View>
                      <View style={styles.modalSection}>
                        <Text style={styles.modalSectionTitle}>2. 用户责任</Text>
                        <Text style={styles.modalSectionText}>
                          用户应确保所提供的信息真实有效，并对其账户下的所有活动承担责任。
                        </Text>
                      </View>
                      <View style={styles.modalSection}>
                        <Text style={styles.modalSectionTitle}>3. 隐私保护</Text>
                        <Text style={styles.modalSectionText}>
                          我们严格保护用户隐私，详细的隐私政策请查看隐私政策条款。
                        </Text>
                      </View>
                      <View style={styles.modalSection}>
                        <Text style={styles.modalSectionTitle}>4. 免责声明</Text>
                        <Text style={styles.modalSectionText}>
                          本应用提供的信息仅供参考，不能替代专业医疗建议。如有健康问题，请咨询专业医生。
                        </Text>
                      </View>
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
                      <FontAwesome5 name="times" size={14} color="rgba(255, 255, 255, 0.5)" />
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={styles.modalScrollView} showsVerticalScrollIndicator={false}>
                    <View style={styles.modalTextContainer}>
                      <View style={styles.modalSection}>
                        <Text style={styles.modalSectionTitle}>1. 信息收集</Text>
                        <Text style={styles.modalSectionText}>
                          我们收集您提供的医疗信息、使用数据等，用于提供更好的服务体验。
                        </Text>
                      </View>
                      <View style={styles.modalSection}>
                        <Text style={styles.modalSectionTitle}>2. 信息使用</Text>
                        <Text style={styles.modalSectionText}>
                          您的信息仅用于FSHD管理、分析和改善服务质量，不会用于其他商业目的。
                        </Text>
                      </View>
                      <View style={styles.modalSection}>
                        <Text style={styles.modalSectionTitle}>3. 信息保护</Text>
                        <Text style={styles.modalSectionText}>
                          我们采用医疗级加密技术保护您的数据安全，符合HIPAA、GDPR等国际标准。
                        </Text>
                      </View>
                      <View style={styles.modalSection}>
                        <Text style={styles.modalSectionTitle}>4. 数据共享</Text>
                        <Text style={styles.modalSectionText}>
                          未经您同意，我们不会与第三方分享您的个人信息，除非法律要求。
                        </Text>
                      </View>
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

