import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';

import { addPatientMeasurement } from '../../lib/api';
import { CLINICAL_COLORS, CLINICAL_TINTS } from '../../lib/clinical-visuals';
import InlineNotice from '../common/feedback/InlineNotice';
import {
  SELF_TEST_ACTIONS,
  STRENGTH_LEVELS,
  buildSelfTestPayload,
  type SelfTestAction,
  type SelfTestSide,
} from './muscle-self-test';

/**
 * Muscle self-test: five FSHD-core movements, each scored MRC 0-5
 * with big one-hand-friendly buttons. Every action is an independent
 * save (pick action → pick side → tap a score → 保存), so a patient
 * can record just the one movement that changed today. Saved scores
 * light up the passport/archive body figure via the metricKey
 * mapping in clinical-visuals.ts.
 */
const MuscleSelfTestForm = () => {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [side, setSide] = useState<SelfTestSide>('bilateral');
  const [score, setScore] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** action key → human summary of what was saved this session. */
  const [savedToday, setSavedToday] = useState<Record<string, string>>({});

  const activeAction: SelfTestAction | null = useMemo(
    () => SELF_TEST_ACTIONS.find((action) => action.metricKey === activeKey) ?? null,
    [activeKey],
  );

  const selectAction = (action: SelfTestAction) => {
    setActiveKey(action.metricKey);
    setSide('bilateral');
    setScore(null);
    setErrorMessage(null);
  };

  const save = async () => {
    if (!activeAction || score === null || isSaving) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await addPatientMeasurement(buildSelfTestPayload(activeAction, side, score));
      const sideLabel = !activeAction.sided
        ? ''
        : side === 'left'
          ? '左侧 '
          : side === 'right'
            ? '右侧 '
            : '双侧 ';
      setSavedToday((prev) => ({
        ...prev,
        [activeAction.metricKey]: `${sideLabel}${score} 分`,
      }));
      setActiveKey(null);
      setScore(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '保存失败，请稍后重试。');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>肌力自测</Text>
      <Text style={styles.subtitle}>
        选一个动作试一试，再按感受打分（0-5）。记录会自动汇入档案的受累可视化。
      </Text>

      {SELF_TEST_ACTIONS.map((action) => {
        const isActive = action.metricKey === activeKey;
        const saved = savedToday[action.metricKey];
        return (
          <View
            key={action.metricKey}
            style={[styles.actionCard, isActive && styles.actionCardActive]}
          >
            <TouchableOpacity activeOpacity={0.85} onPress={() => selectAction(action)}>
              <View style={styles.actionHeader}>
                <Text style={styles.actionLabel}>{action.label}</Text>
                {saved ? <Text style={styles.savedBadge}>已记 {saved}</Text> : null}
              </View>
              <Text style={styles.actionHowTo}>{action.howTo}</Text>
            </TouchableOpacity>

            {isActive ? (
              <View style={styles.scorePanel}>
                {action.sided ? (
                  <View style={styles.sideRow}>
                    {(
                      [
                        ['left', '左侧'],
                        ['right', '右侧'],
                        ['bilateral', '双侧'],
                      ] as const
                    ).map(([value, label]) => (
                      <TouchableOpacity
                        key={value}
                        style={[styles.sideButton, side === value && styles.sideButtonActive]}
                        activeOpacity={0.85}
                        onPress={() => setSide(value)}
                      >
                        <Text
                          style={[
                            styles.sideButtonText,
                            side === value && styles.sideButtonTextActive,
                          ]}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}

                {STRENGTH_LEVELS.map((level) => (
                  <TouchableOpacity
                    key={level.score}
                    style={[styles.scoreButton, score === level.score && styles.scoreButtonActive]}
                    activeOpacity={0.85}
                    onPress={() => setScore(level.score)}
                  >
                    <Text
                      style={[styles.scoreValue, score === level.score && styles.scoreValueActive]}
                    >
                      {level.score}
                    </Text>
                    <Text
                      style={[styles.scoreLabel, score === level.score && styles.scoreLabelActive]}
                    >
                      {level.label}
                    </Text>
                  </TouchableOpacity>
                ))}

                {errorMessage ? (
                  <InlineNotice message={errorMessage} onRetry={() => void save()} />
                ) : null}

                <TouchableOpacity
                  style={[styles.saveButton, (score === null || isSaving) && { opacity: 0.5 }]}
                  disabled={score === null || isSaving}
                  activeOpacity={0.85}
                  onPress={() => void save()}
                >
                  {isSaving ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <FontAwesome6 name="check" size={13} color="#FFFFFF" />
                      <Text style={styles.saveButtonText}>保存这一项</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    padding: 16,
  },
  title: {
    color: CLINICAL_COLORS.text,
    fontSize: 15,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 12,
    color: CLINICAL_COLORS.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  actionCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    backgroundColor: 'rgba(248, 242, 234, 0.6)',
    padding: 13,
    marginBottom: 10,
  },
  actionCardActive: {
    borderColor: CLINICAL_TINTS.accentBorder,
    backgroundColor: CLINICAL_TINTS.accentSoft,
  },
  actionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  actionLabel: {
    color: CLINICAL_COLORS.text,
    fontSize: 14,
    fontWeight: '800',
  },
  savedBadge: {
    color: CLINICAL_COLORS.success,
    fontSize: 11,
    fontWeight: '700',
  },
  actionHowTo: {
    marginTop: 4,
    color: CLINICAL_COLORS.textSoft,
    fontSize: 12,
    lineHeight: 17,
  },
  scorePanel: {
    marginTop: 12,
    gap: 8,
  },
  sideRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sideButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    backgroundColor: CLINICAL_COLORS.panel,
    alignItems: 'center',
  },
  sideButtonActive: {
    borderColor: CLINICAL_COLORS.accentStrong,
    backgroundColor: CLINICAL_COLORS.accentStrong,
  },
  sideButtonText: {
    color: CLINICAL_COLORS.textSoft,
    fontSize: 13,
    fontWeight: '700',
  },
  sideButtonTextActive: {
    color: '#FFFFFF',
  },
  scoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    backgroundColor: CLINICAL_COLORS.panel,
  },
  scoreButtonActive: {
    borderColor: CLINICAL_COLORS.accentStrong,
    backgroundColor: CLINICAL_COLORS.accentStrong,
  },
  scoreValue: {
    width: 26,
    textAlign: 'center',
    color: CLINICAL_COLORS.text,
    fontSize: 17,
    fontWeight: '800',
  },
  scoreValueActive: {
    color: '#FFFFFF',
  },
  scoreLabel: {
    flex: 1,
    color: CLINICAL_COLORS.textSoft,
    fontSize: 13,
  },
  scoreLabelActive: {
    color: '#FFFFFF',
  },
  saveButton: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 999,
    backgroundColor: CLINICAL_COLORS.accentStrong,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});

export default MuscleSelfTestForm;
