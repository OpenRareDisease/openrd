import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import styles from './styles';
import { ApiError, getMyPatientProfile, upsertPatientProfile } from '../../lib/api';
import { CLINICAL_COLORS, CLINICAL_GRADIENTS } from '../../lib/clinical-visuals';
import { useAuth } from '../../contexts/AuthContext';
import ScreenBackButton from '../common/ScreenBackButton';

const genderOptions = [
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'non_binary', label: '非二元' },
  { value: 'prefer_not_to_say', label: '不透露' },
];

const isValidDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed);
};

const RegisterProfileScreen: React.FC = () => {
  const router = useRouter();
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(
    null,
  );
  const [form, setForm] = useState({
    fullName: '',
    dateOfBirth: '',
    gender: '',
    contactPhone: user?.phoneNumber ?? '',
    contactEmail: user?.email ?? '',
    regionProvince: '',
    regionCity: '',
    regionDistrict: '',
  });

  const contactHint = useMemo(() => {
    if (form.contactPhone || form.contactEmail) {
      return '用于账号验证与平台通知';
    }
    return '请输入手机号或邮箱';
  }, [form.contactPhone, form.contactEmail]);

  useEffect(() => {
    let isMounted = true;
    const loadProfile = async () => {
      try {
        const profile = await getMyPatientProfile();
        if (!isMounted || !profile) {
          return;
        }
        setForm((prev) => ({
          ...prev,
          fullName: profile.fullName ?? '',
          dateOfBirth: profile.dateOfBirth ?? '',
          gender: profile.gender ?? '',
          contactPhone: profile.contactPhone ?? prev.contactPhone,
          contactEmail: profile.contactEmail ?? prev.contactEmail,
          regionProvince: profile.regionProvince ?? '',
          regionCity: profile.regionCity ?? '',
          regionDistrict: profile.regionDistrict ?? '',
        }));
      } catch (error) {
        const message = error instanceof ApiError ? error.message : '加载档案失败';
        setFeedback({ type: 'error', message });
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadProfile();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleSubmit = async () => {
    setFeedback(null);
    if (!form.fullName.trim()) {
      setFeedback({ type: 'error', message: '请输入姓名' });
      return;
    }

    if (!form.dateOfBirth.trim()) {
      setFeedback({ type: 'error', message: '请输入出生日期' });
      return;
    }

    if (!isValidDate(form.dateOfBirth.trim())) {
      setFeedback({ type: 'error', message: '出生日期格式应为 YYYY-MM-DD' });
      return;
    }

    if (!form.gender) {
      setFeedback({ type: 'error', message: '请选择性别' });
      return;
    }

    if (!form.contactPhone.trim() && !form.contactEmail.trim()) {
      setFeedback({ type: 'error', message: '请至少填写手机号或邮箱' });
      return;
    }

    if (form.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)) {
      setFeedback({ type: 'error', message: '请输入正确的邮箱格式' });
      return;
    }

    if (!form.regionProvince.trim() || !form.regionCity.trim() || !form.regionDistrict.trim()) {
      setFeedback({ type: 'error', message: '请完整填写省市区信息' });
      return;
    }

    setIsSaving(true);

    try {
      const trimmedPhone = form.contactPhone.trim();
      const trimmedEmail = form.contactEmail.trim();
      await upsertPatientProfile({
        fullName: form.fullName.trim(),
        dateOfBirth: form.dateOfBirth.trim(),
        gender: form.gender,
        contactPhone: trimmedPhone ? trimmedPhone : null,
        contactEmail: trimmedEmail ? trimmedEmail : null,
        regionProvince: form.regionProvince.trim(),
        regionCity: form.regionCity.trim(),
        regionDistrict: form.regionDistrict.trim(),
      });
      setFeedback({ type: 'success', message: '档案已保存' });
      router.replace('/p-home');
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '保存失败，请重试';
      setFeedback({ type: 'error', message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={CLINICAL_GRADIENTS.page}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.backgroundGradient}
      >
        <View style={styles.header}>
          <ScreenBackButton />
          <Text style={styles.headerTitle}>编辑档案</Text>
          <View style={styles.headerPlaceholder} />
        </View>

        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color={CLINICAL_COLORS.accent} />
            </View>
          ) : (
            <>
              {feedback && (
                <View
                  style={[
                    styles.feedbackBanner,
                    feedback.type === 'error' ? styles.feedbackError : styles.feedbackSuccess,
                  ]}
                >
                  <Text style={styles.feedbackText}>{feedback.message}</Text>
                </View>
              )}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>基本信息</Text>
                <Text style={styles.sectionSubtitle}>用于年龄分层分析、病程关联研究</Text>
                <View style={styles.card}>
                  <Text style={styles.inputLabel}>姓名</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="请输入姓名"
                    placeholderTextColor={CLINICAL_COLORS.textMuted}
                    value={form.fullName}
                    onChangeText={(text) => setForm((prev) => ({ ...prev, fullName: text }))}
                  />

                  <Text style={styles.inputLabel}>出生日期</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={CLINICAL_COLORS.textMuted}
                    value={form.dateOfBirth}
                    onChangeText={(text) => setForm((prev) => ({ ...prev, dateOfBirth: text }))}
                  />

                  <Text style={styles.inputLabel}>性别</Text>
                  <View style={styles.optionRow}>
                    {genderOptions.map((option) => {
                      const isActive = form.gender === option.value;
                      return (
                        <TouchableOpacity
                          key={option.value}
                          style={[styles.optionButton, isActive && styles.optionButtonActive]}
                          onPress={() => setForm((prev) => ({ ...prev, gender: option.value }))}
                        >
                          <Text
                            style={[styles.optionText, isActive && styles.optionTextActive]}
                            numberOfLines={1}
                          >
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>联系方式</Text>
                <Text style={styles.sectionSubtitle}>{contactHint}</Text>
                <View style={styles.card}>
                  <Text style={styles.inputLabel}>手机号</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="请输入手机号"
                    placeholderTextColor={CLINICAL_COLORS.textMuted}
                    keyboardType="phone-pad"
                    value={form.contactPhone}
                    onChangeText={(text) => setForm((prev) => ({ ...prev, contactPhone: text }))}
                  />

                  <Text style={styles.inputLabel}>邮箱</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="请输入邮箱"
                    placeholderTextColor={CLINICAL_COLORS.textMuted}
                    keyboardType="email-address"
                    value={form.contactEmail}
                    onChangeText={(text) => setForm((prev) => ({ ...prev, contactEmail: text }))}
                  />
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>所在地区</Text>
                <Text style={styles.sectionSubtitle}>用于统计区域发病率与线下活动筹备</Text>
                <View style={styles.card}>
                  <Text style={styles.inputLabel}>省份</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="例如：浙江省"
                    placeholderTextColor={CLINICAL_COLORS.textMuted}
                    value={form.regionProvince}
                    onChangeText={(text) => setForm((prev) => ({ ...prev, regionProvince: text }))}
                  />

                  <Text style={styles.inputLabel}>城市</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="例如：杭州市"
                    placeholderTextColor={CLINICAL_COLORS.textMuted}
                    value={form.regionCity}
                    onChangeText={(text) => setForm((prev) => ({ ...prev, regionCity: text }))}
                  />

                  <Text style={styles.inputLabel}>区县</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="例如：西湖区"
                    placeholderTextColor={CLINICAL_COLORS.textMuted}
                    value={form.regionDistrict}
                    onChangeText={(text) => setForm((prev) => ({ ...prev, regionDistrict: text }))}
                  />
                </View>
              </View>

              <TouchableOpacity
                style={[styles.primaryButton, isSaving && styles.primaryButtonDisabled]}
                onPress={handleSubmit}
                disabled={isSaving}
              >
                <LinearGradient
                  colors={[CLINICAL_COLORS.accent, CLINICAL_COLORS.accentStrong]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.primaryButtonGradient}
                >
                  {isSaving ? (
                    <ActivityIndicator color={CLINICAL_COLORS.text} />
                  ) : (
                    <Text style={styles.primaryButtonText}>保存</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
};

export default RegisterProfileScreen;
