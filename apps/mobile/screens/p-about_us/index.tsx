import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Pressable, Modal, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../common/Icon';
import ListGroup, { Row } from '../common/ListGroup';
import { COLOR } from '../../lib/design';
import styles from './styles';
import { PRIVACY_POLICY_SECTIONS, USER_AGREEMENT_SECTIONS } from '../../lib/legal-content';
import ScreenHeader from '../common/ScreenHeader';
import { useAppDialog } from '../common/feedback/AppDialog';

/**
 * 用户协议 / 隐私政策 in a sheet.
 *
 * There are two of these and they used to be two copies of the same
 * JSX, which is how they came to share the same three defects:
 *
 *  - The scrim was a `TouchableOpacity`, which defaults `accessible`
 *    to true and so groups everything under it into ONE accessibility
 *    element. iOS then synthesises a label by concatenating every
 *    descendant — so VoiceOver announced the title plus the entire
 *    legal document as a single unstoppable string, with no way to
 *    reach the close button or scroll section by section. The consent
 *    documents a patient is asked to agree to were the least readable
 *    thing in the app.
 *  - Same for the inner bubble-stopper, which exists only to keep a
 *    tap on the sheet from closing it and should never be an element.
 *  - The close button was an icon with no role, no label and a 32pt
 *    box.
 *
 * One component now, so the next fix cannot land on one and miss the
 * other.
 */
const LegalModal = ({
  visible,
  title,
  sections,
  onClose,
}: {
  visible: boolean;
  title: string;
  sections: readonly { title: string; body: string }[];
  onClose: () => void;
}) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <Pressable style={styles.modalOverlay} accessible={false} onPress={onClose}>
      <View style={styles.modalContainer}>
        <Pressable accessible={false}>
          {/* Holds VoiceOver inside the sheet while it is up. */}
          <View style={styles.modalContent} accessibilityViewIsModal>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{title}</Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`关闭${title}`}
                onPress={onClose}
              >
                <Icon name="xmark" size={14} color={COLOR.inkMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalScrollView} showsVerticalScrollIndicator={false}>
              <View style={styles.modalTextContainer}>
                {sections.map((section) => (
                  <View key={section.title} style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>{section.title}</Text>
                    <Text style={styles.modalSectionText}>{section.body}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        </Pressable>
      </View>
    </Pressable>
  </Modal>
);

const AboutUsScreen = () => {
  const [isAgreementModalVisible, setIsAgreementModalVisible] = useState(false);
  const [isPrivacyModalVisible, setIsPrivacyModalVisible] = useState(false);
  const { notify } = useAppDialog();

  // `canOpenURL` false is the only branch the patient ever sees here,
  // and on web it is the common one: a desktop browser with no mail or
  // tel handler registered. The old Alert.alert made that branch
  // literally invisible — the contact row simply did nothing, on the
  // platform where it fails most often. The message now says what to
  // do instead of just naming the failure.
  const handlePhonePress = () => {
    const phoneNumber = 'tel:18099610336';
    Linking.canOpenURL(phoneNumber).then((supported) => {
      if (supported) {
        Linking.openURL(phoneNumber);
      } else {
        notify({
          title: '无法拨打电话',
          message: '这台设备没有可用的拨号功能，可以手动拨打 180 9961 0336。',
          tone: 'error',
        });
      }
    });
  };

  const handleEmailPress = () => {
    const email = 'mailto:ailiyaer201025@outlook.com';
    Linking.canOpenURL(email).then((supported) => {
      if (supported) {
        Linking.openURL(email);
      } else {
        notify({
          title: '无法打开邮件应用',
          message: '这台设备没有配置邮件客户端，可以手动发送到 ailiyaer201025@outlook.com。',
          tone: 'error',
        });
      }
    });
  };

  const handleWebsitePress = () => {
    const website = 'https://fshdyouth.com';
    Linking.canOpenURL(website).then((supported) => {
      if (supported) {
        Linking.openURL(website);
      } else {
        notify({
          title: '无法打开网页',
          message: '这台设备没有可用的浏览器，可以手动访问 fshdyouth.com。',
          tone: 'error',
        });
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
        <Icon name={icon} size={14} color={COLOR.ink} />
      </View>
      <View style={styles.featureTextContainer}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureDescription}>{description}</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {/* One header component app-wide, so back sits in the same
            place and looks the same on every stack screen — and this
            one gains the home control it never had. */}
        <ScreenHeader title="关于我们" />

        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          {/* App Info */}
          <View style={styles.appInfoSection}>
            <View style={styles.appLogo}>
              <Icon name="heartbeat" size={32} color={COLOR.accent} />
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
                COLOR.accentWash,
              )}
              {renderFeatureItem(
                'chart-line',
                '病程管理',
                '标准化肌力评估与趋势分析，辅助医患沟通决策',
                COLOR.accentWash,
              )}
              {renderFeatureItem(
                'users',
                '患者社区',
                '症状经验分享、康复方法探讨与心理互助陪伴',
                COLOR.goodWash,
              )}
            </View>
          </View>

          {/* Contact Info */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>联系我们</Text>
            {/* Hand-rolled Touchables with no accessibilityRole, each
                wrapping its icon in a tinted square. ListGroup.Row is
                the shape and carries the role, the name and the 48pt
                target — same rows as 我的 and 档案, which is where a
                patient arrives here from. */}
            <ListGroup>
              <Row icon="phone" label="联系方式" detail="18099610336" onPress={handlePhonePress} />
              <Row
                icon="envelope"
                label="邮箱"
                detail="ailiyaer201025@outlook.com"
                onPress={handleEmailPress}
              />
              <Row icon="globe" label="网站" detail="fshdyouth.com" onPress={handleWebsitePress} />
            </ListGroup>
          </View>

          {/* Legal Links */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>法律条款</Text>
            <ListGroup>
              <Row icon="file-contract" label="用户协议" onPress={handleUserAgreementPress} />
              <Row icon="shield-alt" label="隐私政策" onPress={handlePrivacyPolicyPress} />
            </ListGroup>
          </View>

          {/* Copyright */}
          <View style={styles.copyrightSection}>
            <Text style={styles.copyrightText}>© 2024 FSHD青年社区患者平台. 保留所有权利。</Text>
            <Text style={styles.copyrightSubText}>致力于为FSHD患者提供更好的互助与数据服务</Text>
          </View>
        </ScrollView>

        <LegalModal
          visible={isAgreementModalVisible}
          title="用户协议"
          sections={USER_AGREEMENT_SECTIONS}
          onClose={closeAgreementModal}
        />

        <LegalModal
          visible={isPrivacyModalVisible}
          title="隐私政策"
          sections={PRIVACY_POLICY_SECTIONS}
          onClose={closePrivacyModal}
        />
      </SafeAreaView>
    </View>
  );
};

export default AboutUsScreen;
