import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AnswerText from '../common/AnswerText';
import { INTERACTION } from '../../lib/design';
import Icon from '../common/Icon';

import { ApiError } from '../../lib/api';
import { getTimelineDetailItem } from '../../lib/timeline-detail';
import ScreenHeader from '../common/ScreenHeader';
import { useAppDialog } from '../common/feedback/AppDialog';
import { deleteTimelineRecord, type DeletableRecordKind } from './api';
import styles from './styles';

const formatFullDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}.${month}.${day} ${hour}:${minute}`;
};

/**
 * What this record actually is, per tag. The screen used to print one
 * hardcoded sentence («这条记录来自时间轴…») under every single item,
 * which told the patient nothing and was wrong for half of them. An
 * unknown tag now renders no blurb at all — silence beats a sentence
 * that may not be true of the record on screen.
 */
const TAG_BLURB: Record<string, string> = {
  事件: '你手动记录的一次病程事件。它会进入病程时间轴和临床护照，也会作为 AI 回答你问题时的依据。',
  功能测试:
    '一次功能测试结果。它会画进趋势线，并参与「最近有没有加重」的判断，所以填错的数值值得删掉重记。',
  报告: '一份你上传的报告。识别出的关键信息会自动补进档案，可以在报告详情里核对或修正。',
  日常记录:
    '根据你最近的记录自动生成的变化摘要，本身没有独立的原始数据——删掉对应的原始记录后它会自动消失。',
  肌力: '一次肌力记录，会进入肌力趋势和临床护照。',
  活动: '一条日常活动记录。',
};

/**
 * Which timeline tags map onto a record the API can retract. Tags
 * outside this map are either derived (日常记录 is computed from other
 * rows) or deleted elsewhere (报告 has its own flow on the report
 * detail screen).
 */
const DELETABLE_KIND_BY_TAG: Record<string, DeletableRecordKind> = {
  事件: 'followup_event',
  功能测试: 'function_test',
};

/** Why this record can't be retracted here — shown instead of the
 *  delete card, so the absence of the button is never a dead end. */
const UNDELETABLE_REASON: Record<string, string> = {
  报告: '报告要在「报告详情」里删除，那里会一并清理上传的原件。',
  日常记录: '这条是系统根据其它记录自动算出来的，删掉对应的原始记录后它会自己消失。',
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Recover the database id of the record behind this screen.
 *
 * TimelineSectionCard builds `detailId` as `${row.id}:${timestamp}`,
 * and `row.id` is the real table UUID for every source that can be
 * retracted. Derived summary cards use a `change-…` id instead and
 * fail the UUID test, which is exactly the outcome we want: no id, no
 * delete button. Parsing it back out is what lets this screen name
 * the record without changing the param contract every caller of the
 * shared timeline component relies on.
 */
const parseRecordId = (detailId?: string): string | null => {
  const head = detailId?.split(':')[0] ?? '';
  return UUID_PATTERN.test(head) ? head : null;
};

export default function TimelineDetailScreen() {
  const router = useRouter();
  const { confirm } = useAppDialog();
  const params = useLocalSearchParams();
  const [deleting, setDeleting] = useState(false);
  // `deletedAt` stays null on the 404 path: the record is gone either
  // way, but only the server can tell us *when*, and inventing a
  // client-clock timestamp would be a lie printed back at the patient.
  const [deletion, setDeletion] = useState<{ deletedAt: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const item = useMemo(() => {
    const pick = (value: string | string[] | undefined): string | undefined => {
      const raw = Array.isArray(value) ? value[0] : value;
      return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
    };

    // Route params are the primary source: they make this screen
    // fully self-contained (cold start / refresh / deep link all
    // render). The in-memory cache remains only as a fallback for
    // legacy links that carry just a detailId.
    const title = pick(params.title);
    const description = pick(params.description);
    const timestamp = pick(params.timestamp);
    const tag = pick(params.tag);
    if (title && timestamp && tag) {
      return {
        id: pick(params.detailId) ?? `${title}:${timestamp}`,
        title,
        description: description ?? '',
        timestamp,
        tag,
        documentId: pick(params.documentId) ?? null,
      };
    }

    const detailId = pick(params.detailId);
    return detailId ? getTimelineDetailItem(detailId) : null;
  }, [params]);

  const recordKind = item ? (DELETABLE_KIND_BY_TAG[item.tag] ?? null) : null;
  const recordId = item ? parseRecordId(item.id) : null;
  const canDelete = Boolean(recordKind && recordId);
  const blurb = item ? TAG_BLURB[item.tag] : undefined;
  // A retractable tag whose id didn't survive the link (an old
  // detailId-only route) still gets an explanation and a way out,
  // rather than a silently missing button.
  const missingIdReason = recordKind
    ? '这条记录是从旧链接打开的，缺少定位它的编号。回到病程页重新点开这条记录就能删除。'
    : null;
  const deleteBlockedReason =
    !item || canDelete ? null : (UNDELETABLE_REASON[item.tag] ?? missingIdReason);

  const runDelete = async () => {
    if (!recordKind || !recordId) return;

    setNotice(null);
    setDeleting(true);
    try {
      const result = await deleteTimelineRecord(recordKind, recordId);
      setDeletion({ deletedAt: result.deletedAt });
    } catch (error) {
      // 404 means the record is gone from the server's point of view
      // too — treat it as done rather than parking the patient on a
      // record they can no longer act on.
      if (error instanceof ApiError && error.status === 404) {
        setDeletion({ deletedAt: null });
        return;
      }
      setNotice(
        error instanceof ApiError ? `删除失败：${error.message}` : '删除失败，请稍后重试。',
      );
    } finally {
      setDeleting(false);
    }
  };

  /**
   * Irreversible, and until now unconfirmed on web: `Alert.alert` is an
   * empty function there, so the "are you sure" step silently never
   * happened — one press retracted the record. The in-app dialog makes
   * the confirmation real on every platform.
   */
  const confirmDelete = async () => {
    if (deleting) return;
    const confirmed = await confirm({
      title: '删除这条记录',
      message: '删除后它会从病程趋势、临床护照和 AI 回答里移除，无法在应用内恢复。',
      confirmLabel: '删除',
      destructive: true,
    });
    if (!confirmed) return;
    await runDelete();
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Flat paper, not the sand gradient — see p-clinical_passport. */}
      <View style={styles.backgroundGradient}>
        {/* The `TIMELINE DETAIL` eyebrow is finally gone rather than
            just `display:none`, and back/home come from the shared
            header — this screen is two deep from 病程. The opaque
            paper fill that hid the legacy page gradient stays on
            styles.header, which now wraps the shared component. */}
        <View style={styles.header}>
          <ScreenHeader title="时间轴详情" />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {item ? (
            <>
              <View style={styles.heroCard}>
                <View style={styles.heroTopRow}>
                  <View style={styles.tagPill}>
                    <Text style={styles.tagPillText}>{item.tag}</Text>
                  </View>
                  <Text style={styles.heroTime}>{formatFullDate(item.timestamp)}</Text>
                </View>
                <Text style={styles.heroTitle}>{item.title}</Text>
                {blurb ? <Text style={styles.heroDescription}>{blurb}</Text> : null}
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>记录内容</Text>
                <AnswerText style={styles.cardText}>{item.description}</AnswerText>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>记录信息</Text>
                <View style={styles.metaGrid}>
                  <View style={styles.metaCard}>
                    <Text style={styles.metaLabel}>类型</Text>
                    <Text style={styles.metaValue}>{item.tag}</Text>
                  </View>
                  <View style={styles.metaCard}>
                    <Text style={styles.metaLabel}>时间</Text>
                    <Text style={styles.metaValue}>{formatFullDate(item.timestamp)}</Text>
                  </View>
                </View>
              </View>

              {item.documentId ? (
                <TouchableOpacity
                  style={styles.primaryAction}
                  activeOpacity={INTERACTION.pressOpacity}
                  accessibilityRole="button"
                  accessibilityLabel="查看报告详情"
                  onPress={() =>
                    router.push({
                      pathname: '/p-report_detail',
                      params: { documentId: item.documentId ?? '' },
                    })
                  }
                >
                  <Icon name="file-lines" size={13} color="#FFFFFF" />
                  <Text style={styles.primaryActionText}>查看报告详情</Text>
                </TouchableOpacity>
              ) : null}

              {deletion ? (
                <View style={[styles.card, styles.doneCard]}>
                  <Text style={styles.cardTitle}>已删除</Text>
                  <Text style={styles.cardText}>
                    {deletion.deletedAt
                      ? `这条记录已在 ${formatFullDate(deletion.deletedAt)} 移除，之后的趋势、护照和 AI 回答都不会再用到它。`
                      : '这条记录已经不在你的档案里了，趋势、护照和 AI 回答都不会再用到它。'}
                    {'\n'}返回上一页后下拉刷新，就能看到更新后的时间轴。
                  </Text>
                </View>
              ) : canDelete ? (
                <View style={[styles.card, styles.dangerCard]}>
                  <Text style={styles.cardTitle}>记错了？</Text>
                  <Text style={styles.cardText}>
                    数值打错、记成了别的日期、或者根本不该记这一条，都可以直接删掉。删除后趋势线和摘要会按剩下的记录重新计算。
                  </Text>
                  <TouchableOpacity
                    style={[styles.dangerButton, deleting && styles.dangerButtonDisabled]}
                    activeOpacity={INTERACTION.pressOpacity}
                    accessibilityRole="button"
                    accessibilityLabel="删除这条记录"
                    accessibilityState={{ disabled: deleting, busy: deleting }}
                    aria-disabled={deleting}
                    aria-busy={deleting}
                    disabled={deleting}
                    onPress={() => {
                      void confirmDelete();
                    }}
                  >
                    {deleting ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Icon name="trash-can" size={13} color="#FFFFFF" />
                    )}
                    <Text style={styles.dangerButtonText}>
                      {deleting ? '删除中…' : '删除这条记录'}
                    </Text>
                  </TouchableOpacity>
                  {notice ? <Text style={styles.noticeText}>{notice}</Text> : null}
                </View>
              ) : deleteBlockedReason ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>想删掉这条？</Text>
                  <Text style={styles.cardText}>{deleteBlockedReason}</Text>
                </View>
              ) : null}
            </>
          ) : (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>时间轴详情不可用</Text>
              <Text style={styles.cardText}>
                这条记录已经失效或当前会话中没有缓存，请返回上一页后重新打开。
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
