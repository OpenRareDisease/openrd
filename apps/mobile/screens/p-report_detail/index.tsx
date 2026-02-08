import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import {
  ApiError,
  generatePatientDocumentSummary,
  getPatientDocumentOcr,
  type PatientDocument,
} from '../../lib/api';
import styles from './styles';

type OcrPayload = NonNullable<PatientDocument['ocrPayload']>;

const getAnalysisStatus = (payload: OcrPayload | null) => {
  const status = payload?.fields?.analysisStatus ?? payload?.fields?.analysis_status;
  return typeof status === 'string' ? status : undefined;
};

const isProcessing = (payload: OcrPayload | null) => {
  const status = getAnalysisStatus(payload);
  return status === 'processing' || status === 'pending';
};

const pickField = (fields: Record<string, string> | undefined, keys: string[]) => {
  if (!fields) return undefined;
  for (const key of keys) {
    const raw = fields[key];
    if (raw === null || raw === undefined) continue;
    const text = String(raw).trim();
    if (text) return text;
  }
  return undefined;
};

export default function ReportDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const documentId = useMemo(() => {
    const raw = params.documentId;
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params.documentId]);

  const poller = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [payload, setPayload] = useState<OcrPayload | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summary, setSummary] = useState<string>('');

  const load = async (id: string) => {
    const res = await getPatientDocumentOcr(id);
    const next = (res as any)?.ocrPayload ?? null;
    setPayload(next);
    const maybeSummary = next?.fields?.aiSummary;
    setSummary(typeof maybeSummary === 'string' ? maybeSummary : '');
    return next as OcrPayload | null;
  };

  useEffect(() => {
    if (!documentId) {
      setIsLoading(false);
      setErrorMessage('缺少 documentId');
      return;
    }

    let cancelled = false;

    const start = async () => {
      try {
        setIsLoading(true);
        setErrorMessage(null);
        const next = await load(documentId);
        if (cancelled) return;

        const startedAt = Date.now();
        const tick = async () => {
          try {
            const refreshed = await load(documentId);
            if (!refreshed || !isProcessing(refreshed)) {
              poller.current = null;
              return;
            }
          } catch (error) {
            // ignore; retry
          }

          if (Date.now() - startedAt > 10 * 60 * 1000) {
            poller.current = null;
            return;
          }

          poller.current = setTimeout(tick, 2000);
        };

        if (next && isProcessing(next)) {
          poller.current = setTimeout(tick, 1200);
        }
      } catch (error) {
        const message = error instanceof ApiError ? error.message : '无法获取报告详情';
        setErrorMessage(message);
        setPayload(null);
      } finally {
        setIsLoading(false);
      }
    };

    start();

    return () => {
      cancelled = true;
      if (poller.current) {
        clearTimeout(poller.current);
        poller.current = null;
      }
    };
  }, [documentId]);

  const fields = payload?.fields ?? undefined;
  const status = getAnalysisStatus(payload) ?? 'unknown';

  const structuredItems = useMemo(() => {
    if (!fields) return [];
    const items: Array<{ label: string; value?: string }> = [
      { label: '解析状态', value: status },
      { label: '报告时间', value: pickField(fields, ['reportTime', 'report_time']) },
      { label: '报告名称', value: pickField(fields, ['reportName', 'report_name']) },
      { label: 'D4Z4重复数', value: pickField(fields, ['d4z4Repeats', 'd4z4_repeats']) },
      { label: '甲基化值', value: pickField(fields, ['methylationValue', 'methylation_value']) },
      {
        label: '前锯肌脂肪化等级',
        value: pickField(fields, ['serratusFatigueGrade', 'serratus_fatigue_grade']),
      },
      { label: '三角肌肌力', value: pickField(fields, ['deltoidStrength', 'deltoid_strength']) },
      { label: '肱二头肌肌力', value: pickField(fields, ['bicepsStrength', 'biceps_strength']) },
      { label: '肱三头肌肌力', value: pickField(fields, ['tricepsStrength', 'triceps_strength']) },
      {
        label: '股四头肌肌力',
        value: pickField(fields, ['quadricepsStrength', 'quadriceps_strength']),
      },
      { label: '肝功能', value: pickField(fields, ['liverFunction', 'liver_function']) },
      { label: '肌酸激酶', value: pickField(fields, ['creatineKinase', 'creatine_kinase']) },
      { label: '楼梯测试', value: pickField(fields, ['stairTestResult', 'stair_test_result']) },
    ];
    return items.filter((item) => item.value);
  }, [fields, status]);

  const rawText = useMemo(() => {
    if (!payload) return '';
    const obj = payload as any;
    const aiExtraction = obj.aiExtraction ?? obj.ai_extraction ?? null;
    const extractedText = obj.extractedText ?? obj.extracted_text ?? '';
    const compact = {
      fields: obj.fields ?? null,
      aiExtraction,
      extractedText:
        typeof extractedText === 'string' ? extractedText.slice(0, 4000) : extractedText,
    };
    try {
      return JSON.stringify(compact, null, 2);
    } catch {
      return String(compact);
    }
  }, [payload]);

  const onGenerateSummary = async () => {
    if (!documentId) return;
    try {
      setSummaryLoading(true);
      const res = await generatePatientDocumentSummary(documentId);
      setSummary(res.summary);
      setPayload((prev) => {
        if (!prev) return prev;
        const prevAny = prev as any;
        const nextFields = { ...(prevAny.fields ?? {}), aiSummary: res.summary };
        return { ...prevAny, fields: nextFields };
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '生成 AI 总结失败';
      Alert.alert('失败', message);
    } finally {
      setSummaryLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <FontAwesome6 name="arrow-left" size={16} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>报告详情</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>概览</Text>
          <View style={styles.kvRow}>
            <Text style={styles.kvLabel}>documentId</Text>
            <Text style={styles.kvValue}>{documentId ?? '--'}</Text>
          </View>
          <View style={[styles.kvRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.kvLabel}>状态</Text>
            <Text style={styles.kvValue}>{status}</Text>
          </View>
          {isLoading && (
            <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color="#969FFF" />
              <Text style={styles.smallText}>加载中...</Text>
            </View>
          )}
          {errorMessage && <Text style={styles.smallText}>{errorMessage}</Text>}
          {!isLoading && payload && isProcessing(payload) && (
            <Text style={styles.smallText}>解析中，页面会自动刷新进度。</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>结构化字段</Text>
          {structuredItems.length === 0 ? (
            <Text style={styles.smallText}>暂无结构化字段（或仍在解析中）。</Text>
          ) : (
            structuredItems.map((item) => (
              <View key={item.label} style={styles.kvRow}>
                <Text style={styles.kvLabel}>{item.label}</Text>
                <Text style={styles.kvValue}>{item.value}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>AI 总结</Text>
          {summary ? (
            <>
              <Text style={styles.summaryText}>{summary}</Text>
              <Text style={[styles.smallText, { marginTop: 10 }]}>仅供参考，需结合医生意见。</Text>
            </>
          ) : (
            <>
              <Text style={styles.smallText}>
                当前报告暂无 AI 总结（可按需生成，生成后会缓存到该报告）。
              </Text>
              <View style={{ marginTop: 12 }}>
                <TouchableOpacity
                  style={[styles.button, summaryLoading && { opacity: 0.7 }]}
                  disabled={summaryLoading || isProcessing(payload)}
                  onPress={onGenerateSummary}
                >
                  {summaryLoading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.buttonText}>
                      {isProcessing(payload) ? '解析完成后可生成' : '生成 AI 总结'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>原始解析结果</Text>
          <Text style={styles.smallText}>用于调试/核对（包含字段、AI 抽取、OCR 文本片段）。</Text>
          <TouchableOpacity style={styles.toggleLink} onPress={() => setShowRaw((v) => !v)}>
            <Text style={styles.toggleLinkText}>{showRaw ? '收起' : '展开查看'}</Text>
          </TouchableOpacity>
          {showRaw && (
            <View style={styles.codeBlock}>
              <Text style={styles.codeText}>{rawText}</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
