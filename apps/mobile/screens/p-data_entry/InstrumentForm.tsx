import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import Button from '../common/Button';
import InlineNotice from '../common/feedback/InlineNotice';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, RADIUS } from '../../lib/design';
// Same press response as the rest of 记录数据 — see lib/press-scale.tsx.
import PressableScale from '../../lib/press-scale';
import {
  getInstrumentAdministrations,
  getInstrumentCatalogue,
  recordInstrumentAdministration,
  type InstrumentAdministration,
  type InstrumentCatalogueEntry,
} from '../../lib/api';
import { summarizeInstrument, type InstrumentSummary } from './instruments';

/**
 * 功能分级自评 — the published scales, administered by the patient.
 *
 * Shaped after MuscleSelfTestForm: open a scale, pick the sentence that
 * sounds most like your ordinary day, 保存. Each scale saves on its own,
 * so someone whose arms changed but whose walking did not records the
 * one that moved.
 *
 * FOUR THINGS THIS SCREEN WILL NOT DO
 *
 *  1. **It does not carry its own copy of the anchors.** Everything
 *     rendered below — the prompt, the level sentences, the citation,
 *     the limitations — is fetched from `/profiles/me/instruments`. The
 *     anchor wording IS the measurement (see the freeze comment in the
 *     API's brooke.ts), so a second copy in this bundle would be a
 *     second definition of what a grade means, drifting the first time
 *     either side was reworded. If the catalogue does not load, this
 *     card says so and offers a retry — it does not fall back to
 *     remembered text.
 *
 *  2. **It does not ask the patient to perform anything.** Brooke
 *     grade 1 is literally "raise both arms in a full circle overhead",
 *     the first thing FSHD takes. The prompt the server sends already
 *     says「按你大多数日子的状态」; this card repeats above the options
 *     that nothing needs to be attempted right now.
 *
 *  3. **It does not show a grade without its sentence** — not in the
 *     picker, not in the saved badge, not in the 上次 line.
 *
 *  4. **It does not print the scale without its caveats.** The
 *     catalogue serves `limitationsZh` and `selfReportEvidenceZh`
 *     alongside the anchors specifically so a client cannot render one
 *     without the other. Brooke has a documented floor effect in slowly
 *     progressive dystrophies, and its patient/clinician agreement
 *     (ICC 0.66) is materially weaker than Vignos's (0.86). A patient
 *     deciding whether to show a doctor this number is entitled to
 *     both facts.
 */

interface InstrumentFormProps {
  /** The screen's PIPL gate. Recording an administration stores health
   *  data, so the same consent the rest of 记录数据 asks for applies —
   *  and asking here, before the POST, turns a server 403 into the
   *  document the patient is supposed to see. */
  ensureConsent?: () => Promise<boolean>;
}

const InstrumentForm = ({ ensureConsent }: InstrumentFormProps) => {
  const [catalogue, setCatalogue] = useState<InstrumentCatalogueEntry[]>([]);
  const [administrations, setAdministrations] = useState<InstrumentAdministration[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  /** The history read is best-effort; the catalogue read is not.
   *  Without anchors there is nothing to put on screen, so its failure
   *  is the one the patient is told about. */
  const load = async () => {
    setIsLoading(true);
    setCatalogueError(null);
    try {
      const entries = await getInstrumentCatalogue();
      setCatalogue(entries);
    } catch (error) {
      setCatalogue([]);
      setCatalogueError(
        error instanceof Error ? error.message : '暂时读不到分级量表，请稍后再试。',
      );
    }
    try {
      setAdministrations(await getInstrumentAdministrations({ limit: 200 }));
    } catch {
      // Silent: a missing 上次 line is not something the patient can
      // act on, and an error banner over a form that still saves reads
      // as「保存坏了」.
      setAdministrations([]);
    }
    setIsLoading(false);
  };

  // Mount only. Re-running per render would loop this endpoint for a
  // screen a patient may sit on for minutes.
  useEffect(() => {
    void load();
  }, []);

  const openScale = (entry: InstrumentCatalogueEntry, currentLevel: number | null) => {
    const next = entry.key === activeKey ? null : entry.key;
    setActiveKey(next);
    // Pre-select what is already on file so an unchanged patient
    // confirms in one tap instead of re-reading ten sentences. Still an
    // explicit 保存 — opening a card writes nothing.
    setSelectedLevel(next ? currentLevel : null);
    setSaveError(null);
  };

  const save = async (entry: InstrumentCatalogueEntry) => {
    const item = entry.items[0];
    if (!item || selectedLevel === null || savingKey) return;
    setSavingKey(entry.key);
    setSaveError(null);
    try {
      if (ensureConsent) {
        const consented = await ensureConsent();
        if (!consented) {
          setSaveError('未记录敏感个人信息处理同意，这一项没有保存。你可以稍后再来。');
          return;
        }
      }
      await recordInstrumentAdministration({
        instrumentKey: entry.key,
        responses: [{ itemCode: item.code, responseValue: selectedLevel }],
        source: 'self',
      });
      // Re-read rather than synthesising a row from what was sent: the
      // server decides the score and resolves the anchor against the
      // version answered, and a locally-built reading would be this
      // client's opinion of both.
      try {
        setAdministrations(await getInstrumentAdministrations({ limit: 200 }));
      } catch {
        // The write landed; only the refresh failed. Leaving the old
        // history on screen is honest — it is what we last read — and
        // the next open re-reads it.
      }
      setActiveKey(null);
      setSelectedLevel(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存失败，请稍后重试。');
    } finally {
      setSavingKey(null);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={COLOR.accent} />
        <Text style={styles.subtitle}>正在加载分级量表…</Text>
      </View>
    );
  }

  // No catalogue means no anchors, and a grade picker with no sentences
  // is a row of numbers whose meaning is nowhere on screen.
  if (catalogue.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>功能分级自评</Text>
        <Text style={styles.subtitle}>
          {catalogueError
            ? '分级量表暂时读不出来，所以这里先不显示选项——量表的每一级都必须连着它的说明一起看，只给数字没有意义。'
            : '目前还没有可以自评的分级量表。'}
        </Text>
        {catalogueError ? (
          <InlineNotice message={catalogueError} onRetry={() => void load()} />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>功能分级自评</Text>
      <Text style={styles.subtitle}>
        每个量表选一句最接近你平时情况的话就行，现在不用做任何动作。这些是门诊和临床试验通用的分级，填过之后会印在临床护照上，医生一眼能看懂。
      </Text>

      {catalogue.map((entry) => {
        const item = entry.items[0];
        const summary: InstrumentSummary | null = summarizeInstrument(
          entry.key,
          administrations,
          entry,
        );
        const isActive = entry.key === activeKey;
        const isSaving = savingKey === entry.key;

        return (
          <View
            key={entry.key}
            style={[styles.instrumentCard, isActive && styles.instrumentCardActive]}
          >
            <PressableScale
              style={styles.instrumentSelect}
              accessibilityRole="button"
              accessibilityLabel={
                summary
                  ? `${entry.nameZh}，当前记录 ${summary.latest.level} 级，${summary.latest.anchor}`
                  : entry.nameZh
              }
              accessibilityState={{ expanded: isActive }}
              aria-expanded={isActive}
              onPress={() => openScale(entry, summary?.latest.level ?? null)}
            >
              <View style={styles.instrumentHeader}>
                <Text style={styles.instrumentLabel}>{entry.nameZh}</Text>
                {summary ? (
                  <Text style={styles.savedBadge}>已记 {summary.latest.level} 级</Text>
                ) : null}
              </View>
              {/* The badge above carries the number; this line carries
                  what the number means. Neither ships without the other. */}
              {summary ? (
                <Text style={styles.savedAnchor}>{summary.latest.anchor}</Text>
              ) : (
                <Text style={styles.instrumentHint}>
                  {entry.descriptionZh || '还没有记录，点开选一句就行。'}
                </Text>
              )}
            </PressableScale>

            {isActive && item ? (
              <View style={styles.levelPanel}>
                <Text style={styles.question}>{item.promptZh}</Text>
                <Text style={styles.performanceNote}>
                  现在不用起身、不用抬手去试，按你平时的情况选最接近的一句就行。
                  {typeof entry.adminMinutes === 'number' && entry.adminMinutes > 0
                    ? ` 大约 ${entry.adminMinutes} 分钟。`
                    : ''}
                </Text>

                {/* Vertical rows, never a horizontal strip of ten —
                    lib/a11y.ts rule 2: change the layout before the
                    target size. */}
                {item.levels.map((level) => {
                  const selected = selectedLevel === level.value;
                  return (
                    <PressableScale
                      key={level.value}
                      style={[styles.levelButton, selected && styles.levelButtonActive]}
                      accessibilityRole="radio"
                      accessibilityLabel={`${level.value} 级 · ${level.labelZh}`}
                      accessibilityState={{ selected }}
                      aria-checked={selected}
                      onPress={() => setSelectedLevel(level.value)}
                    >
                      <Text style={[styles.levelValue, selected && styles.levelValueActive]}>
                        {level.value}
                      </Text>
                      <Text style={[styles.levelAnchor, selected && styles.levelAnchorActive]}>
                        {level.labelZh}
                      </Text>
                    </PressableScale>
                  );
                })}

                {summary?.comparison ? (
                  <Text style={styles.previousLine}>
                    {summary.comparison.label}：{summary.comparison.reading.level} 级 ·{' '}
                    {summary.comparison.reading.anchor}
                  </Text>
                ) : null}

                {saveError ? (
                  <InlineNotice message={saveError} onRetry={() => void save(entry)} />
                ) : null}

                <Button
                  label="保存这一项"
                  icon="check"
                  variant="prominent"
                  fullWidth
                  busy={isSaving}
                  disabled={selectedLevel === null}
                  accessibilityLabel={`保存${entry.nameZh}`}
                  onPress={() => void save(entry)}
                />

                {/* The caveats travel with the scale, never on a
                    separate screen the patient may not open. A grade
                    that has not moved in three years does not mean the
                    disease has not — that is the floor effect, and it
                    is the single most likely way this number gets
                    misread. */}
                {entry.limitationsZh.length > 0 ? (
                  <View style={styles.caveatBlock}>
                    <Text style={styles.caveatTitle}>这个分级看不出什么</Text>
                    {entry.limitationsZh.map((limitation) => (
                      <Text key={limitation} style={styles.caveatText}>
                        · {limitation}
                      </Text>
                    ))}
                  </View>
                ) : null}

                {entry.selfReportEvidenceZh ? (
                  <View style={styles.caveatBlock}>
                    <Text style={styles.caveatTitle}>自己填的准不准</Text>
                    <Text style={styles.caveatText}>{entry.selfReportEvidenceZh}</Text>
                  </View>
                ) : null}

                {entry.sourceCitation ? (
                  <Text style={styles.sourceNote}>{entry.sourceCitation}</Text>
                ) : null}
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
    gap: 4,
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
    lineHeight: 18,
  },
  instrumentCard: {
    borderRadius: RADIUS.surface,
    borderWidth: 1,
    borderColor: COLOR.line,
    backgroundColor: COLOR.well,
    padding: 13,
    marginBottom: 10,
  },
  instrumentCardActive: {
    borderColor: COLOR.accent,
    backgroundColor: COLOR.accentWash,
  },
  /** Without a minHeight the frame is exactly the text (~38pt), under
   *  lib/a11y.ts MIN_TOUCH_TARGET. */
  instrumentSelect: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  instrumentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  instrumentLabel: {
    flex: 1,
    color: COLOR.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  savedBadge: {
    color: COLOR.good,
    fontSize: 11,
    fontWeight: '700',
  },
  savedAnchor: {
    marginTop: 4,
    color: COLOR.inkSoft,
    fontSize: 12,
    lineHeight: 17,
  },
  instrumentHint: {
    marginTop: 4,
    color: COLOR.inkMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  levelPanel: {
    marginTop: 12,
    gap: 8,
  },
  question: {
    color: COLOR.ink,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
  },
  performanceNote: {
    color: COLOR.inkMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  levelButton: {
    minHeight: MIN_TOUCH_TARGET,
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
  levelButtonActive: {
    borderColor: COLOR.accent,
    backgroundColor: COLOR.accent,
  },
  levelValue: {
    width: 26,
    textAlign: 'center',
    color: COLOR.ink,
    fontSize: 17,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  levelValueActive: {
    color: COLOR.onAccent,
  },
  levelAnchor: {
    flex: 1,
    color: COLOR.inkSoft,
    fontSize: 13,
    lineHeight: 19,
  },
  levelAnchorActive: {
    color: COLOR.onAccent,
  },
  previousLine: {
    color: COLOR.inkMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  caveatBlock: {
    marginTop: 4,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: COLOR.line,
    gap: 3,
  },
  caveatTitle: {
    color: COLOR.inkSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  caveatText: {
    color: COLOR.inkMuted,
    fontSize: 11,
    lineHeight: 17,
  },
  sourceNote: {
    marginTop: 2,
    color: COLOR.inkFaint,
    fontSize: 11,
    lineHeight: 16,
  },
});

export default InstrumentForm;
