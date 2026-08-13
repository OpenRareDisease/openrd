import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Button from '../common/Button';

import { addPatientMeasurement } from '../../lib/api';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, RADIUS } from '../../lib/design';
// Same press response as the rest of 记录数据 — see lib/press-scale.tsx.
import PressableScale from '../../lib/press-scale';

/**
 * Migrated with the rest of p-data_entry: this form renders *inside*
 * that screen as one of its four modes, so leaving it on the old
 * palette put a sand-and-shadow panel on the new paper page — visibly
 * a different app one tap away. Its buttons were also ~42pt (padding
 * only, no minHeight), under the floor lib/a11y.ts sets.
 */
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
            {/* No style at all before, so the hit frame was exactly the
                text — about 38pt. minHeight brings it to the target and
                the role/state make it announce as the expandable
                selector it is. */}
            <PressableScale
              style={styles.actionSelect}
              accessibilityRole="button"
              accessibilityLabel={saved ? `${action.label}，已记 ${saved}` : action.label}
              accessibilityState={{ expanded: isActive }}
              aria-expanded={isActive}
              onPress={() => selectAction(action)}
            >
              <View style={styles.actionHeader}>
                <Text style={styles.actionLabel}>{action.label}</Text>
                {saved ? <Text style={styles.savedBadge}>已记 {saved}</Text> : null}
              </View>
              <Text style={styles.actionHowTo}>{action.howTo}</Text>
            </PressableScale>

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
                      <PressableScale
                        key={value}
                        style={[styles.sideButton, side === value && styles.sideButtonActive]}
                        accessibilityRole="radio"
                        accessibilityLabel={label}
                        accessibilityState={{ selected: side === value }}
                        aria-checked={side === value}
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
                      </PressableScale>
                    ))}
                  </View>
                ) : null}

                {STRENGTH_LEVELS.map((level) => (
                  <PressableScale
                    key={level.score}
                    style={[styles.scoreButton, score === level.score && styles.scoreButtonActive]}
                    accessibilityRole="radio"
                    accessibilityLabel={`${level.score} 分 · ${level.label}`}
                    accessibilityState={{ selected: score === level.score }}
                    aria-checked={score === level.score}
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
                  </PressableScale>
                ))}

                {errorMessage ? (
                  <InlineNotice message={errorMessage} onRetry={() => void save()} />
                ) : null}

                {/* Had no role, and while saving it swapped label for a
                    spinner and became nameless. Button keeps the name
                    through `busy`. */}
                <Button
                  label="保存这一项"
                  icon="check"
                  variant="prominent"
                  fullWidth
                  busy={isSaving}
                  disabled={score === null}
                  accessibilityLabel={`保存${action.label}`}
                  onPress={() => void save()}
                />
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
    borderRadius: RADIUS.surface,
    backgroundColor: COLOR.surface,
    borderWidth: 1,
    borderColor: COLOR.line,
    padding: 16,
  },
  title: {
    color: COLOR.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 12,
    color: COLOR.inkMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  actionCard: {
    borderRadius: RADIUS.surface,
    borderWidth: 1,
    borderColor: COLOR.line,
    backgroundColor: COLOR.well,
    padding: 13,
    marginBottom: 10,
  },
  actionCardActive: {
    borderColor: COLOR.accent,
    backgroundColor: COLOR.accentWash,
  },
  /** The card's tap target. Without a minHeight the frame was
   *  exactly the text (~38pt) — under lib/a11y.ts MIN_TOUCH_TARGET. */
  actionSelect: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  actionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  actionLabel: {
    color: COLOR.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  savedBadge: {
    color: COLOR.good,
    fontSize: 11,
    fontWeight: '700',
  },
  actionHowTo: {
    marginTop: 4,
    color: COLOR.inkSoft,
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
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    flex: 1,
    paddingVertical: 12,
    borderRadius: RADIUS.control,
    borderWidth: 1,
    borderColor: COLOR.line,
    backgroundColor: COLOR.surface,
    alignItems: 'center',
  },
  sideButtonActive: {
    borderColor: COLOR.accent,
    backgroundColor: COLOR.accent,
  },
  sideButtonText: {
    color: COLOR.inkSoft,
    fontSize: 13,
    fontWeight: '700',
  },
  sideButtonTextActive: {
    color: COLOR.onAccent,
  },
  scoreButton: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: RADIUS.control,
    borderWidth: 1,
    borderColor: COLOR.line,
    backgroundColor: COLOR.surface,
  },
  scoreButtonActive: {
    borderColor: COLOR.accent,
    backgroundColor: COLOR.accent,
  },
  scoreValue: {
    width: 26,
    textAlign: 'center',
    color: COLOR.ink,
    fontSize: 17,
    fontWeight: '800',
  },
  scoreValueActive: {
    color: COLOR.onAccent,
  },
  scoreLabel: {
    flex: 1,
    color: COLOR.inkSoft,
    fontSize: 13,
  },
  scoreLabelActive: {
    color: COLOR.onAccent,
  },
});

export default MuscleSelfTestForm;
