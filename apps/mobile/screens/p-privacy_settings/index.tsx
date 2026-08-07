import { COLOR } from '../../lib/design';
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Icon from '../common/Icon';
import { useCallback } from 'react';
import {
  getLegalAcceptances,
  withdrawLegalAcceptance,
  type LegalAcceptanceSummary,
} from '../../lib/api';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_TITLES } from '../../lib/legal-content';
import styles from './styles';

import { bumpConsentEpoch } from '../../lib/consent-epoch';
import {
  createPassportPickup,
  createPassportShare,
  listPassportShares,
  revokePassportShare,
} from '../../lib/passport-share-api';
import {
  buildPickupUrl,
  buildShareUrl,
  describePickupState,
  describeShareLife,
  isShareRowLive,
  PICKUP_TTL_MINUTES,
  type PassportShare,
} from '../../lib/passport-share';
import PickupCodeCard from './components/PickupCodeCard';
import ScreenHeader from '../common/ScreenHeader';
import { useAppDialog } from '../common/feedback/AppDialog';
import Button from '../common/Button';
import ToggleSwitch from '../common/ToggleSwitch';
import SuccessToast from './components/SuccessToast';
import {
  ApiError,
  type ConsentDetails,
  type ConsentUpdatePayload,
  type SharingPreferences,
  type SharingPreferencesUpdatePayload,
  getMyConsent,
  getMySharingPreferences,
  getSubmissionTimeline,
  updateMyConsent,
  updateMySharingPreferences,
} from '../../lib/api';

interface ToggleCopy {
  title: string;
  message: string;
}

type AiConsentField = 'personal' | 'thirdParty' | 'preciseValues';

const AI_TOGGLE_IDS: Record<AiConsentField, string> = {
  personal: 'ai-personal',
  thirdParty: 'ai-third-party',
  preciseValues: 'ai-precise-values',
};

const formatGrantDate = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Render the parenthetical date hint next to a consent toggle.
 *  When the flag is currently on we say "同意于 …"; when it's off
 *  but a timestamp exists (i.e. the user had granted then revoked)
 *  we say "上次更新 …" so the label isn't misleading. Returns the
 *  full parenthetical including the surrounding "（…）", or '' when
 *  there's no date to show. */
const formatConsentDateLabel = (iso: string | null, granted: boolean): string => {
  const date = formatGrantDate(iso);
  if (!date) return '';
  return granted ? `（同意于 ${date}）` : `（上次更新 ${date}）`;
};

const PrivacySettingsScreen = () => {
  const router = useRouter();
  const { confirm, notify } = useAppDialog();

  /**
   * The acceptance ledger, and the withdrawal the documents promise.
   *
   * 《敏感个人信息处理单独同意》 tells the user 「同意后可随时在「隐私
   * 设置」中撤回」 and the privacy policy lists 撤回同意 among the
   * rights it grants — this screen is the place both sentences name,
   * and until now neither was reachable from it. A promise a product
   * makes in a legal document and does not implement is the worst of
   * both: it reads as compliance and is not.
   */
  const [acceptances, setAcceptances] = useState<LegalAcceptanceSummary | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  const loadAcceptances = useCallback(() => {
    getLegalAcceptances()
      .then(setAcceptances)
      .catch(() => {
        // A failed read must not blank the rest of the screen; the
        // section simply does not render.
        setAcceptances(null);
      });
  }, []);

  useEffect(loadAcceptances, [loadAcceptances]);

  const onWithdrawSensitive = async () => {
    const ok = await confirm({
      title: '撤回敏感信息处理同意',
      message:
        '撤回后将无法继续上传报告或记录健康数据；已上传的内容不会被删除，你可以在「报告管理」中单独删除。撤回不影响撤回前已进行的处理，需要时可以再次同意。',
      confirmLabel: '确认撤回',
      cancelLabel: '取消',
      destructive: true,
    });
    if (!ok) return;

    setWithdrawing(true);
    try {
      await withdrawLegalAcceptance(LEGAL_DOCUMENTS.sensitiveData);
      // The AI surfaces cache consent state; without this the app would
      // keep offering features the server will now refuse.
      bumpConsentEpoch();
      loadAcceptances();
      notify({ title: '已撤回', message: '敏感个人信息处理同意已撤回。', tone: 'success' });
    } catch (error) {
      notify({
        title: '撤回失败',
        message: error instanceof ApiError ? error.message : '请检查网络后重试',
        tone: 'error',
      });
    } finally {
      setWithdrawing(false);
    }
  };

  // AI 同意状态（来自后端）
  const [aiConsent, setAiConsent] = useState<ConsentDetails | null>(null);
  const [aiConsentLoading, setAiConsentLoading] = useState(true);
  const [aiConsentError, setAiConsentError] = useState<string | null>(null);
  const [aiConsentSaving, setAiConsentSaving] = useState(false);

  // 四个数据共享开关（同样来自后端，backed by migration 010）
  const [sharingPrefs, setSharingPrefs] = useState<SharingPreferences | null>(null);
  const [sharingLoading, setSharingLoading] = useState(true);
  const [sharingError, setSharingError] = useState<string | null>(null);
  const [sharingSaving, setSharingSaving] = useState(false);

  /**
   * 「谁现在能读我的记录」.
   *
   * The share links live here rather than beside the export button
   * because that is the question they answer. Exporting is something
   * you do once; a live link is a standing permission, and the only
   * place a patient looks for standing permissions is 隐私设置.
   */
  const [shares, setShares] = useState<PassportShare[] | null>(null);
  const [sharesError, setSharesError] = useState<string | null>(null);
  const [creatingShare, setCreatingShare] = useState(false);
  const [revokingShareId, setRevokingShareId] = useState<string | null>(null);
  // Held in component state and nowhere else. See passport-share-api.ts:
  // the server keeps only a digest and cannot reissue this.
  const [freshLink, setFreshLink] = useState<{ url: string | null; token: string } | null>(null);
  /**
   * The pickup code, held in component state and nowhere else, exactly
   * like `freshLink`. The server stores a digest of it and cannot
   * reissue it — see db/migrations/024.
   *
   * What is stored here is the SERVER'S numbers, not a rendered
   * countdown. This used to hold a `minutesLeft` computed once at mint,
   * on the argument that the card is looked at for thirty seconds — but
   * the card stays mounted, so a code minted in the waiting room and
   * shown twelve minutes later still claimed fifteen minutes. The card
   * owns the clock now; this owns the facts it counts from.
   */
  const [creatingPickup, setCreatingPickup] = useState(false);
  const [freshPickup, setFreshPickup] = useState<{
    code: string;
    qrUrl: string | null;
    expiresAt: string;
    ttlMinutes: number | null;
    maxAttempts: number | null;
  } | null>(null);

  const loadShares = useCallback(async () => {
    try {
      setSharesError(null);
      setShares(await listPassportShares());
    } catch (error) {
      setShares(null);
      setSharesError(error instanceof ApiError ? error.message : '无法读取分享链接，请稍后重试');
    }
  }, []);

  /**
   * The clock the share list is read against.
   *
   * `describePickupState` and `isShareRowLive` default to `new Date()`,
   * which samples RENDER time — and this screen has no reason to
   * re-render on its own. So a pickup row minted in a waiting room kept
   * saying 「还能用约 15 分钟」 and kept offering 作废 for as long as the
   * screen stayed open, while PickupCodeCard three centimetres above it
   * — which does tick — had already moved on to 「已过期，请重新生成」.
   * Two answers about the same credential on one screen, and a live
   * button on a door that is shut: the thing `isShareRowLive` exists to
   * prevent, reached through staleness instead of a wrong predicate.
   */
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const rows = shares ?? [];
    /**
     * Everything on this screen that the clock can move: per row, the
     * one line of text under it and whether it still gets a button.
     * Two clocks that produce the same string here render the same
     * pixels, so keeping the older of the two lets React bail out of
     * the render entirely — the trick PickupCodeCard already plays on
     * its own minute counter.
     *
     * Derived from the same three calls the row itself makes rather
     * than from a granularity constant, so a row kind added later, or
     * a threshold moved inside describeShareLife, cannot leave this
     * behind claiming nothing changed while the row says otherwise.
     */
    const readingAt = (at: Date) =>
      rows
        .map(
          (share) =>
            `${isShareRowLive(share, at) ? '1' : '0'} ${
              describePickupState(share, at) ?? describeShareLife(share, at)
            }`,
        )
        .join('\n');
    const advanceTo = (at: Date) =>
      setNow((prev) => (readingAt(prev) === readingAt(at) ? prev : at));
    // Once immediately, before anything else: a list that arrives from
    // loadShares() is read against whatever `now` was last set, which
    // may be minutes old. This used to sit under an early return for
    // 「no pickup rows」, so a list of nothing but links was read against
    // the mount-time clock for the whole life of the screen.
    const at = new Date();
    advanceTo(at);
    // Keep ticking while ANY row is still an open door — link rows
    // included. The condition is not 「is there a pickup code」: what the
    // clock is for is the moment a row stops being live, because that is
    // the moment the 撤销/作废 button has to go. A seven-day link crosses
    // that moment exactly like a fifteen-minute code does, just later,
    // and a patient who has this screen open when it happens is the one
    // being told the door is still open.
    //
    // Once every row has reached a terminal reading (已过期 / 已撤销 /
    // 已被医生取走一次), nothing on the screen can change again without a
    // refetch, so the clock stops and the rows keep that reading.
    if (!rows.some((share) => isShareRowLive(share, at))) return;
    const handle: { id?: ReturnType<typeof setInterval> } = {};
    const stop = () => {
      if (handle.id !== undefined) clearInterval(handle.id);
    };
    const tick = () => {
      const t = new Date();
      advanceTo(t);
      if (!rows.some((share) => isShareRowLive(share, t))) stop();
    };
    // Ten seconds, not one: the finest thing on screen is a minute
    // (「还能用约 N 分钟」 on a pickup code), and a per-second interval
    // would sample 900 times over one code's life to move a number 15
    // times. Not a minute either — that is how long a dead row would
    // keep offering 作废.
    //
    // Ten seconds is the SAMPLING rate, and it is only the re-render
    // rate for a row whose text is that fine. A link is day-granular
    // above 24 hours, so for six of a seven-day link's seven days every
    // sample reads 「N 天后过期」 and `advanceTo` keeps the previous
    // clock — no state change, no render. Without that bail-out this
    // interval bought 360 full renders an hour of a screen this size,
    // for six days, to move one digit; the stop inside `tick` does not
    // bound that, because for a link the stop is seven days away.
    handle.id = setInterval(tick, 10_000);
    return stop;
  }, [shares]);

  // The list has to load on open, not only after a create or a revoke.
  // Without this the section renders empty for a patient who made a
  // link last week — which reads as「我没分享过任何东西」, the exact
  // opposite of the truth, on the screen whose job is to tell them who
  // can currently read their record.
  useEffect(() => {
    void loadShares();
  }, [loadShares]);

  const onCreateShare = async () => {
    setCreatingShare(true);
    try {
      // createPassportShare throws rather than resolving without a
      // token: by that point the server has already issued a live
      // credential, and a silent success is what let a patient press
      // this five times and mint five invisible links.
      const link = await createPassportShare();
      {
        setFreshLink({
          // window.location only exists on the web export, which is how
          // essentially every patient reaches this app. On native the
          // token is shown with an explanation instead of a URL that
          // would carry the wrong host.
          url: buildShareUrl(
            link.token,
            typeof window !== 'undefined' ? window.location?.origin : null,
          ),
          token: link.token,
        });
      }
      // One credential on screen at a time. Two of them under one
      // heading is how a patient reads out the wrong one.
      setFreshPickup(null);
      await loadShares();
    } catch (error) {
      notify({
        // Any Error's message, not just ApiError's — the shape check in
        // passport-share-api throws a plain Error whose text tells the
        // patient to go look at this very list, and swallowing it into
        //「请稍后重试」would send them back to press the button again.
        message: error instanceof Error ? error.message : '请稍后重试',
        title: '没能生成链接',
      });
    } finally {
      setCreatingShare(false);
    }
  };

  const onCreatePickup = async () => {
    setCreatingPickup(true);
    try {
      // Throws rather than resolving without a code, for the same
      // reason createPassportShare does: the server has already opened
      // a door by the time this returns.
      const created = await createPassportPickup();
      setFreshPickup({
        code: created.share.code,
        // window.location exists only on the web export, which is how
        // essentially every patient reaches this app. On native there
        // is no origin, so no QR — the card says the code alone, and
        // the doctor types the address once. A QR built from a guessed
        // host would send them to a page that does not exist.
        qrUrl: buildPickupUrl(typeof window !== 'undefined' ? window.location?.origin : null),
        expiresAt: created.share.pickup.expiresAt,
        // Straight through, nulls and all. The old code turned an
        // unusable expiry into the literal 15, which put a number the
        // device had no evidence for on a live credential.
        ttlMinutes: created.ttlMinutes,
        maxAttempts: created.maxAttempts,
      });
      // Showing a pickup code and an old link at once is two doors on
      // one screen with one heading; the list below still lists both.
      setFreshLink(null);
      await loadShares();
    } catch (error) {
      notify({
        // Any Error, not just ApiError: the server's 「请先填写出生日期」
        // and the client's shape-check message both tell the patient
        // what to actually do, and 「请稍后重试」 would send them back
        // to press the button again.
        message: error instanceof Error ? error.message : '请稍后重试',
        title: '没能生成取件码',
      });
    } finally {
      setCreatingPickup(false);
    }
  };

  const onRevokeShare = async (share: PassportShare) => {
    // A pickup code is not a link and the dialog must not call it one:
    // 「拿到这个链接的人」 means nothing to a patient who read eight
    // characters out loud across a desk.
    const ok = await confirm({
      title: share.pickup ? '作废这个取件码？' : '撤销这个链接？',
      message: share.pickup
        ? '作废之后，你刚才念出去的那个取件码就打不开了。医生已经看过的内容我们收不回来。'
        : '撤销之后，拿到这个链接的人就再也打不开了。他们已经看过的内容我们收不回来。',
      confirmLabel: share.pickup ? '作废' : '撤销',
      destructive: true,
    });
    if (!ok) return;
    setRevokingShareId(share.id);
    try {
      await revokePassportShare(share.id);
      // The credential on screen may be the one just revoked; clearing
      // both stops the patient handing a dead URL — or reading out a
      // dead code — to someone standing in front of them.
      setFreshLink(null);
      setFreshPickup(null);
      await loadShares();
    } catch (error) {
      notify({
        title: '撤销失败',
        message: error instanceof ApiError ? error.message : '请稍后重试',
      });
    } finally {
      setRevokingShareId(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getMyConsent();
        if (!cancelled) {
          setAiConsent(data);
          setAiConsentError(null);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setAiConsentError('请先完成基础档案后再设置 AI 同意。');
        } else {
          setAiConsentError(err instanceof Error ? err.message : '加载 AI 同意状态失败');
        }
      } finally {
        if (!cancelled) setAiConsentLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Sharing preferences load — uses the same 404→prompt-for-onboarding
  // pattern as AI consent so the screen behaves consistently for
  // users without a profile row yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getMySharingPreferences();
        if (!cancelled) {
          setSharingPrefs(data);
          setSharingError(null);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setSharingError('请先完成基础档案后再设置数据共享。');
        } else {
          setSharingError(err instanceof Error ? err.message : '加载数据共享设置失败');
        }
      } finally {
        if (!cancelled) setSharingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 弹窗和提示状态
  const [isSuccessToastVisible, setIsSuccessToastVisible] = useState(false);
  // A confirmation is on screen. It disables every switch, so a second
  // press can't open a second dialog and orphan the first promise.
  const [isConfirming, setIsConfirming] = useState(false);

  const handleDonationDetailsPress = () => {
    router.push('/p-data_donation');
  };

  /** Resulting consent level if `toggleId` were flipped to
   *  `newState` — mirrors the backend rule (personal + thirdParty
   *  both on = basic; + preciseValues = precise; anything else =
   *  none/403), so the confirm dialog can state the outcome instead
   *  of making the user derive it. */
  const projectAiLevel = (toggleId: string, newState: boolean): string | null => {
    if (!aiConsent) return null;
    const next = { ...aiConsent.flags };
    if (toggleId === AI_TOGGLE_IDS.personal) next.personal = newState;
    else if (toggleId === AI_TOGGLE_IDS.thirdParty) next.thirdParty = newState;
    else if (toggleId === AI_TOGGLE_IDS.preciseValues) next.preciseValues = newState;
    else return null;

    if (!next.personal || !next.thirdParty) {
      return '操作后等级：未授权 —— 智能问答将无法使用。';
    }
    return next.preciseValues
      ? '操作后等级：精确 —— AI 可读取 D4Z4 等原始数值。'
      : '操作后等级：基础 —— AI 仅可引用脱敏后的档案字段。';
  };

  /** Copy for the confirmation of one toggle. Kept separate from the
   *  asking so the wording stays a pure function of (toggle, target
   *  state) and can be read in one place. */
  const describeToggle = (toggleId: string, newState: boolean): ToggleCopy => {
    let title = '';
    let message = '';

    switch (toggleId) {
      case 'trial-permission':
        title = newState ? '开启临床试验授权' : '关闭临床试验授权';
        message = newState
          ? '开启后，临床试验机构将能够访问您的档案数据以评估入组资格。您可以随时在此页面关闭此授权。'
          : '关闭后，临床试验机构将无法访问您的档案数据，可能影响您参与临床试验的机会。';
        break;
      case 'donation-permission':
        title = newState ? '开启数据捐赠' : '关闭数据捐赠';
        message = newState
          ? '开启后，您的匿名化数据将被捐赠给FSHD科研项目，助力医学研究。我们会严格保护您的隐私。'
          : '关闭后，您的数据将不再被捐赠给科研项目。之前捐赠的数据仍将用于科研。';
        break;
      case 'hospital-sync':
        title = newState ? '开启医院数据同步' : '关闭医院数据同步';
        message = newState
          ? '开启后，医院HIS系统将自动同步您的日常记录数据到个人档案，减少重复录入。'
          : '关闭后，医院数据将不会自动同步，您需要手动录入日常记录。';
        break;
      case 'community-share':
        title = newState ? '开启社区分享' : '关闭社区分享';
        message = newState
          ? '开启后，您可以在社区中分享康复经验和训练视频，帮助其他患者。'
          : '关闭后，您将无法在社区中发布内容，但仍可浏览他人分享。';
        break;
      case AI_TOGGLE_IDS.personal:
        title = newState ? '开启个人数据用于 AI' : '关闭个人数据用于 AI';
        message = newState
          ? '开启后，AI 助手在回答问题时可以引用你的档案和报告中已脱敏的字段。原始姓名、身份证、电话等绝不会出现在提示词里。'
          : '关闭后，AI 助手将无法引用你的任何个人数据；为了完全停用 AI 还需要同时关闭"第三方 LLM 处理"。';
        break;
      case AI_TOGGLE_IDS.thirdParty:
        title = newState ? '允许第三方 LLM 处理' : '关闭第三方 LLM 处理';
        // PIPL Art. 17(1)/23 wants the RECIPIENT named, not just the
        // fact that「云端大模型」is involved. The old copy said
        //「SiliconFlow / DeepSeek」as if they were two interchangeable
        // vendors; one is the processor we contract with, the other is
        // the model it runs — a user cannot check who holds their data
        // from that. Endpoint and data location are stated for the same
        // reason: whether the prompt crosses a border is the question
        // Art. 38-39 turns on, and the .cn host is the answer.
        message = newState
          ? '开启后，你的问题会经我们的服务器发送给受托处理方「硅基流动 SiliconFlow」（接入地址 api.siliconflow.cn，位于中国境内）做推理，运行的模型为 DeepSeek-V3。我们只发送脱敏后的提示词——姓名、手机号、身份证号在送出前会被移除——并保留每一次调用的审计记录。详见《隐私政策》第 5 条。'
          : '关闭后，AI 助手将无法回答你的问题。';
        break;
      case AI_TOGGLE_IDS.preciseValues:
        title = newState ? '开启精确数值授权' : '关闭精确数值授权';
        message = newState
          ? '开启后，AI 可以看到精确的 D4Z4 重复数、甲基化百分比、具体报告日期等原始数值。这些数据更有助于精准建议，但属于敏感信息。需要同时开启上面两项。'
          : '关闭后，AI 只会看到临床化的描述（如"D4Z4 短"），具体数值不会进入提示词。';
        break;
    }

    const projectedLevel = projectAiLevel(toggleId, newState);
    if (projectedLevel) {
      message = `${message}\n\n${projectedLevel}`;
    }

    return { title, message };
  };

  /**
   * Ask, then apply.
   *
   * This used to drive a screen-local `<ConfirmModal>` whose 确认
   * button looked the same whichever way the switch was moving. Every
   * one of these switches is a consent grant, so turning one *off* is
   * a revocation — `destructive` puts that button in the alert colour
   * and off the default position, which is the only visual difference
   * between "start sharing my genome with a cloud model" and "stop".
   */
  const requestToggle = async (toggleId: string, newState: boolean) => {
    if (isConfirming) return;
    const { title, message } = describeToggle(toggleId, newState);

    setIsConfirming(true);
    let confirmed = false;
    try {
      confirmed = await confirm({
        title,
        message,
        confirmLabel: newState ? '开启' : '关闭',
        cancelLabel: '取消',
        destructive: !newState,
      });
    } finally {
      setIsConfirming(false);
    }
    if (!confirmed) return;

    applyToggle(toggleId, newState);
  };

  const applyAiConsentUpdate = async (payload: ConsentUpdatePayload) => {
    setAiConsentSaving(true);
    try {
      const updated = await updateMyConsent(payload);
      setAiConsent(updated);
      // Any AI-consent change starts a new QnA history epoch: answers
      // generated under the OLD switches must not replay as context
      // for questions asked under the new ones (most importantly on
      // a precise→basic downgrade). See lib/consent-epoch.ts.
      await bumpConsentEpoch();
      showSuccessToast();
    } catch (err) {
      const message = err instanceof Error ? err.message : '同意状态更新失败，请稍后重试。';
      notify({ title: '更新失败', message, tone: 'error' });
    } finally {
      setAiConsentSaving(false);
    }
  };

  const applySharingUpdate = async (payload: SharingPreferencesUpdatePayload) => {
    setSharingSaving(true);
    try {
      const updated = await updateMySharingPreferences(payload);
      setSharingPrefs(updated);
      showSuccessToast();
    } catch (err) {
      const message = err instanceof Error ? err.message : '设置更新失败，请稍后重试。';
      notify({ title: '更新失败', message, tone: 'error' });
    } finally {
      setSharingSaving(false);
    }
  };

  const applyToggle = (id: string, newState: boolean) => {
    switch (id) {
      case 'trial-permission':
        void applySharingUpdate({ clinicalTrial: newState });
        break;
      case 'donation-permission':
        void applySharingUpdate({ dataDonation: newState });
        break;
      case 'hospital-sync':
        void applySharingUpdate({ hospitalSync: newState });
        break;
      case 'community-share':
        void applySharingUpdate({ communityShare: newState });
        break;
      case AI_TOGGLE_IDS.personal:
        void applyAiConsentUpdate({ personal: newState });
        break;
      case AI_TOGGLE_IDS.thirdParty:
        void applyAiConsentUpdate({ thirdParty: newState });
        break;
      case AI_TOGGLE_IDS.preciseValues:
        void applyAiConsentUpdate({ preciseValues: newState });
        break;
    }
  };

  const showSuccessToast = () => {
    setIsSuccessToastVisible(true);
    setTimeout(() => {
      setIsSuccessToastVisible(false);
    }, 3000);
  };

  // Real record count for the donation card. There is no donation
  // pipeline yet, so the honest number to show is "how many of my
  // records are in scope for sharing" — the submission total. An
  // earlier version hard-coded "12 条" here, which showed users a
  // donation history that never happened.
  const [shareableCount, setShareableCount] = useState<number | null>(null);
  const donationGranted = sharingPrefs?.flags.dataDonation ?? false;

  useEffect(() => {
    if (!donationGranted) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // page/pageSize 1: we only need the `total` counter.
        const timeline = await getSubmissionTimeline(1, 1);
        if (!cancelled) setShareableCount(timeline.total);
      } catch {
        // Leave as null → the card renders "—" instead of a made-up
        // number. The count is informational, never block the screen.
        if (!cancelled) setShareableCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [donationGranted]);

  const getDonationStatus = () => {
    // `sharingPrefs === null` is "not loaded yet / the request failed",
    // and `?? false` collapsed it into the same value as an explicit
    // denial — so the screen asserted 未授权 about a state it had not
    // read. On a consent screen that is the assertion that matters
    // most, and the patient's next move is to grant something they may
    // already have granted.
    if (!sharingPrefs) {
      return {
        status: '读取中',
        statusColor: COLOR.inkMuted,
        grantedAt: '--',
        shareableRecords: '--',
      };
    }
    if (!donationGranted) {
      return {
        status: '未授权',
        statusColor: COLOR.inkMuted,
        grantedAt: '--',
        shareableRecords: '--',
      };
    }

    return {
      status: '已授权',
      statusColor: COLOR.good,
      // Same YYYY-MM-DD formatter the AI-consent rows use, so the
      // screen doesn't mix date formats.
      grantedAt: formatGrantDate(sharingPrefs?.timestamps.dataDonationAt ?? null) ?? '—',
      shareableRecords: shareableCount === null ? '—' : `${shareableCount} 条`,
    };
  };

  const donationStatus = getDonationStatus();

  const renderAiConsentSection = () => {
    if (aiConsentLoading) {
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>AI 数据授权</Text>
          <Text
            style={{
              paddingHorizontal: 24,
              paddingVertical: 12,
              color: COLOR.inkMuted,
              fontSize: 13,
            }}
          >
            正在加载同意状态...
          </Text>
        </View>
      );
    }

    if (aiConsentError) {
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>AI 数据授权</Text>
          <Text
            style={{
              paddingHorizontal: 24,
              paddingVertical: 12,
              color: COLOR.inkMuted,
              fontSize: 13,
            }}
          >
            {aiConsentError}
          </Text>
        </View>
      );
    }

    if (!aiConsent) return null;

    const { flags, timestamps, level } = aiConsent;
    const personalLabel = formatConsentDateLabel(timestamps.personalAt, flags.personal);
    const thirdPartyLabel = formatConsentDateLabel(timestamps.thirdPartyAt, flags.thirdParty);
    const preciseLabel = formatConsentDateLabel(timestamps.preciseValuesAt, flags.preciseValues);
    const preciseAllowed = flags.personal && flags.thirdParty;
    const levelLabel =
      level === 'precise'
        ? '当前等级：精确（AI 可读原始数值）'
        : level === 'basic'
          ? '当前等级：基础（AI 可读临床化字段）'
          : '当前等级：未授权（AI 拒绝回答）';
    // The two-switch requirement was previously undocumented — users
    // enabled one switch, still got the consent wall in QnA, and had
    // no way to know why.
    const comboHint =
      '「个人数据」和「第三方 LLM」两项都开启后，智能问答才可用；精确数值是可选的第三档。';

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>AI 数据授权</Text>
        <Text
          style={{
            paddingHorizontal: 24,
            paddingTop: 4,
            color: COLOR.inkMuted,
            fontSize: 12,
          }}
        >
          {levelLabel}
        </Text>
        <Text
          style={{
            paddingHorizontal: 24,
            paddingTop: 6,
            paddingBottom: 12,
            color: COLOR.inkMuted,
            fontSize: 12,
            lineHeight: 18,
          }}
        >
          {comboHint}
        </Text>

        <View style={styles.settingItem}>
          <View style={styles.settingContent}>
            <Text style={styles.settingTitle}>个人数据用于 AI</Text>
            <Text style={styles.settingDescription}>
              允许 AI 在回答问题时引用你档案/报告中已脱敏的字段
              {personalLabel}
            </Text>
          </View>
          <ToggleSwitch
            accessibilityLabel="个人数据用于 AI"
            isEnabled={flags.personal}
            disabled={aiConsentSaving || isConfirming}
            onToggle={(newState) => void requestToggle(AI_TOGGLE_IDS.personal, newState)}
          />
        </View>

        <View style={styles.settingItem}>
          <View style={styles.settingContent}>
            <Text style={styles.settingTitle}>第三方 LLM 处理</Text>
            <Text style={styles.settingDescription}>
              问题发送给受托处理方「硅基流动 SiliconFlow」（api.siliconflow.cn，境内）推理，模型
              DeepSeek-V3
              {thirdPartyLabel}
            </Text>
          </View>
          <ToggleSwitch
            accessibilityLabel="第三方 LLM 处理"
            isEnabled={flags.thirdParty}
            disabled={aiConsentSaving || isConfirming}
            onToggle={(newState) => void requestToggle(AI_TOGGLE_IDS.thirdParty, newState)}
          />
        </View>

        <View style={styles.settingItem}>
          <View style={styles.settingContent}>
            <Text style={styles.settingTitle}>精确数值授权</Text>
            <Text style={styles.settingDescription}>
              允许 AI 看到 D4Z4 重复数、甲基化百分比等原始数值
              {preciseLabel}
              {!preciseAllowed ? '\n需要先开启上面两项' : ''}
            </Text>
          </View>
          <ToggleSwitch
            accessibilityLabel="精确数值授权"
            isEnabled={flags.preciseValues}
            disabled={aiConsentSaving || isConfirming || !preciseAllowed}
            onToggle={(newState) => void requestToggle(AI_TOGGLE_IDS.preciseValues, newState)}
          />
        </View>

        {/* A row that navigates, so it says so. It was a bare Touchable
            with a chevron and no accessibilityRole — on the privacy
            screen of all places, the audit trail was unreachable by
            screen reader. */}
        <Pressable
          style={styles.settingItem}
          accessibilityRole="button"
          accessibilityLabel="查看 AI 调用记录"
          accessibilityHint="打开审计历史，查看每次问答的模型、工具与字段"
          // expo-router's typed-routes union is regenerated by
          // `expo start`; the new screen file is recognised at runtime
          // but tsc hasn't seen it yet. Cast for now.
          onPress={() => router.push('/p-audit_history' as never)}
        >
          <View style={styles.settingContent}>
            <Text style={styles.settingTitle}>查看 AI 调用记录</Text>
            <Text style={styles.settingDescription}>
              每次问答的元数据（模型、工具、字段、状态），不含提示词原文
            </Text>
          </View>
          <Icon name="chevron-right" size={12} color={COLOR.inkMuted} />
        </Pressable>
      </View>
    );
  };

  /** Render the four data-sharing toggles. Pulled out as its own
   *  function to mirror `renderAiConsentSection` — loading and
   *  error states share the same shape. */
  const renderSharingSection = () => {
    if (sharingLoading) {
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>数据授权</Text>
          <Text
            style={{
              paddingHorizontal: 24,
              paddingVertical: 12,
              color: COLOR.inkMuted,
              fontSize: 13,
            }}
          >
            正在加载共享设置...
          </Text>
        </View>
      );
    }

    if (sharingError) {
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>数据授权</Text>
          <Text
            style={{
              paddingHorizontal: 24,
              paddingVertical: 12,
              color: COLOR.inkMuted,
              fontSize: 13,
            }}
          >
            {sharingError}
          </Text>
        </View>
      );
    }

    if (!sharingPrefs) return null;
    const { flags } = sharingPrefs;

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>数据授权</Text>

        {/* 临床试验数据授权 */}
        <View style={styles.settingItem}>
          <View style={styles.settingContent}>
            <Text style={styles.settingTitle}>临床试验数据授权</Text>
            <Text style={styles.settingDescription}>
              允许临床试验机构访问您的档案数据以评估入组资格
            </Text>
          </View>
          <ToggleSwitch
            accessibilityLabel="临床试验数据授权"
            isEnabled={flags.clinicalTrial}
            disabled={sharingSaving || isConfirming}
            onToggle={(newState) => void requestToggle('trial-permission', newState)}
          />
        </View>

        {/* 匿名化数据捐赠 */}
        <View style={styles.settingItem}>
          <View style={styles.settingContent}>
            <Text style={styles.settingTitle}>匿名化数据捐赠</Text>
            <Text style={styles.settingDescription}>将您的匿名化数据捐赠给FSHD科研项目</Text>
          </View>
          <ToggleSwitch
            accessibilityLabel="匿名化数据捐赠"
            isEnabled={flags.dataDonation}
            disabled={sharingSaving || isConfirming}
            onToggle={(newState) => void requestToggle('donation-permission', newState)}
          />
        </View>

        {/* 医院数据同步 */}
        <View style={styles.settingItem}>
          <View style={styles.settingContent}>
            <Text style={styles.settingTitle}>医院数据同步</Text>
            <Text style={styles.settingDescription}>
              允许医院HIS系统同步您的日常记录数据到个人档案
            </Text>
          </View>
          <ToggleSwitch
            accessibilityLabel="医院数据同步"
            isEnabled={flags.hospitalSync}
            disabled={sharingSaving || isConfirming}
            onToggle={(newState) => void requestToggle('hospital-sync', newState)}
          />
        </View>

        {/* 社区内容分享 */}
        <View style={styles.settingItem}>
          <View style={styles.settingContent}>
            <Text style={styles.settingTitle}>社区内容分享</Text>
            <Text style={styles.settingDescription}>允许在社区中分享您的康复经验和训练视频</Text>
          </View>
          <ToggleSwitch
            accessibilityLabel="社区内容分享"
            isEnabled={flags.communityShare}
            disabled={sharingSaving || isConfirming}
            onToggle={(newState) => void requestToggle('community-share', newState)}
          />
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* 顶部导航栏 — ScreenHeader adds the 首页 control the hand-rolled
          row never had. Privacy is typically reached from 我的 → 隐私设置
          → 数据捐赠, so leaving it took two targeted presses. */}
      <ScreenHeader title="隐私设置" style={styles.header} />

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* AI 数据授权 */}
        {renderAiConsentSection()}

        {/* 数据授权设置 */}
        {renderSharingSection()}

        {/* 数据捐赠详情 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>数据捐赠详情</Text>

          <View style={styles.donationInfoCard}>
            <View style={styles.donationInfoHeader}>
              <Text style={styles.donationInfoTitle}>了解数据捐赠</Text>
              {/* Beside a heading, so `plain` is legal here — position
                  establishes that it is interactive. It had no
                  accessibilityRole at all before. */}
              <Button
                label="查看详情"
                trailingIcon="chevron-right"
                variant="plain"
                compact
                accessibilityLabel="查看数据捐赠详情"
                onPress={handleDonationDetailsPress}
              />
            </View>

            <View style={styles.donationStatus}>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>捐赠状态</Text>
                <Text style={[styles.statusValue, { color: donationStatus.statusColor }]}>
                  {donationStatus.status}
                </Text>
              </View>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>授权时间</Text>
                <Text style={styles.statusValue}>{donationStatus.grantedAt}</Text>
              </View>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>可共享记录</Text>
                <Text style={styles.statusValue}>{donationStatus.shareableRecords}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* 谁现在能读我的记录 —— the standing permissions.
            Placed above 授权记录 on purpose: a consent ledger is a
            history, and a live share link is a door that is open right
            now. The urgent one goes first. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>谁现在能看我的记录</Text>
          <Text style={styles.settingDescription}>
            你可以生成一个只读链接，在微信里发给医生。对方不需要注册、不需要装 App，
            打开就能看到你的临床护照。链接会自动失效，你也可以随时撤销。
          </Text>
          {/* 当面交 vs 微信发 —— two different rooms.
              A URL is right when the doctor is not in front of you.
              When they are, there is no chat window between you, and
              「把手机举起来给对方看」 is exactly the ask this disease
              makes hardest. See db/migrations/024. */}
          {/* PICKUP_TTL_MINUTES, not a typed-out 15. This sentence is on
              screen before anything has been minted, so there is no
              server response to read — the constant mirrors the API's
              and is the closest thing to a source we have here. */}
          <Text style={styles.settingDescription}>
            如果医生就在你面前，用取件码更省事：你念 8 位码，他在自己的电脑或手机上输入，
            再输一次你的出生日期就能打开。取件码 {PICKUP_TTL_MINUTES} 分钟有效、只能用一次；
            重新生成一个，上一个就立刻作废。
          </Text>

          {freshPickup ? (
            /* `key` on the code, so a second mint REMOUNTS the card.
               Without it React updates props on the same instance and
               the countdown's mount timestamp stays pinned to the FIRST
               mint — a code minted fourteen minutes later rendered
               「约 1 分钟内有效」 and then 「已过期，请重新生成」 while the
               server had given it a full fifteen.

               That is the exact path the supersede-on-mint change exists
               to serve: the patient reads the code out, the doctor
               mishears a character, they tap again. The card would then
               tell them to regenerate, and regenerating supersedes the
               code that was still good. Two correct fixes composed into
               a loop. */
            <PickupCodeCard
              key={freshPickup.code}
              code={freshPickup.code}
              qrUrl={freshPickup.qrUrl}
              expiresAt={freshPickup.expiresAt}
              ttlMinutes={freshPickup.ttlMinutes}
              maxAttempts={freshPickup.maxAttempts}
            />
          ) : null}

          {freshLink ? (
            <View style={styles.shareFresh}>
              <Text style={styles.shareFreshTitle}>链接已生成</Text>
              {/* selectable, because copying it out is the entire point,
                  and 「复制」 needs a clipboard permission this web
                  export does not reliably have inside WeChat. */}
              <Text style={styles.shareFreshValue} selectable>
                {freshLink.url ?? freshLink.token}
              </Text>
              <Text style={styles.shareHint}>
                {freshLink.url
                  ? '长按上面这行复制，然后发给医生。这串地址只显示这一次，关掉就看不到了 —— 丢了就再生成一个。'
                  : '这台设备上拼不出完整网址，上面是链接的口令部分。请在浏览器里打开本页面再生成一次。'}
              </Text>
            </View>
          ) : null}

          {/* The in-person action first: it is the one that happens
              while the patient is standing in front of someone, and
              the one whose credential dies in fifteen minutes. */}
          <Button
            label="当面给医生：生成取件码"
            icon="qrcode"
            variant="tinted"
            fullWidth
            busy={creatingPickup}
            accessibilityHint={`生成一个 8 位取件码和二维码，医生在自己的设备上输入取件码和你的出生日期就能打开你的临床护照。${PICKUP_TTL_MINUTES} 分钟有效，只能用一次；你上一个还没用掉的取件码会立刻作废`}
            onPress={onCreatePickup}
          />

          <Button
            label="生成一个给医生看的链接"
            icon="arrow-up-right-from-square"
            variant="tinted"
            fullWidth
            busy={creatingShare}
            accessibilityHint="生成一个有效期有限的只读链接，医生打开后可以看到你的临床护照"
            onPress={onCreateShare}
          />

          {sharesError ? <Text style={styles.shareHint}>{sharesError}</Text> : null}

          {shares && shares.length > 0
            ? shares.map((share) => {
                // A pickup row and a link row are both doors and belong
                // in the same list — but they are not interchangeable:
                // one was forwarded in WeChat and one was read out
                // loud, and「已被取走一次」 has no meaning for a link.
                //
                // isShareRowLive, not isShareLive: a code that has been
                // redeemed or burned is dead while its parent link is
                // still unrevoked and unexpired, and isShareLive was
                // offering 撤销 on it — a button that does nothing, on
                // the one screen whose job is telling the patient which
                // doors are open.
                // `now` from the ticking state above, never the implicit
                // default: the default samples render time, and this
                // screen does not re-render on its own.
                const live = isShareRowLive(share, now);
                const pickupState = describePickupState(share, now);
                return (
                  <View key={share.id} style={styles.shareRow}>
                    <View style={styles.shareRowCopy}>
                      <Text style={styles.shareRowTitle}>
                        {share.label ??
                          `${share.createdAt.slice(0, 10)} ${share.pickup ? '生成的取件码' : '生成'}`}
                      </Text>
                      <Text style={styles.shareRowMeta}>
                        {pickupState ?? describeShareLife(share, now)}
                        {/* 「还没有人打开过」 is worth saying explicitly:
                            a patient checking whether their doctor
                            looked at it should not have to infer it
                            from a missing number. */}
                        {share.openedCount > 0
                          ? ` · 被打开过 ${share.openedCount} 次`
                          : ' · 还没有人打开过'}
                      </Text>
                    </View>
                    {live ? (
                      // `plain` but NOT `compact`. Compact draws 34pt
                      // tall, and the hitSlop that would buy the rest
                      // back is not read by Pressable on
                      // react-native-web — so on the only channel that
                      // ships, this was a 34pt-tall target on the
                      // control that takes back access to a medical
                      // record, aimed at by people whose grip and reach
                      // this disease has already taken.
                      //
                      // The other dimension is not this call site's to
                      // fix: `plain` drops the horizontal padding, so
                      // the width comes from `styles.base`'s minWidth in
                      // Button.tsx. Do not paper over it with a `style`
                      // here — a caller style is applied last and would
                      // override the floor for this one button while the
                      // sibling list rows in p-falls kept it.
                      <Button
                        label={share.pickup ? '作废' : '撤销'}
                        variant="plain"
                        busy={revokingShareId === share.id}
                        accessibilityHint={
                          share.pickup
                            ? '作废这个取件码，作废后医生再输入它也打不开你的记录'
                            : '撤销这个链接，撤销后任何人都无法再打开'
                        }
                        onPress={() => onRevokeShare(share)}
                      />
                    ) : null}
                  </View>
                );
              })
            : null}

          {shares && shares.length === 0 ? (
            <Text style={styles.shareHint}>你还没有生成过任何链接。</Text>
          ) : null}
        </View>

        {/* 授权记录 — the ledger the consent documents point at.
            Rendered only when the read succeeded; a failed fetch leaves
            the rest of the screen usable rather than showing an empty
            shell that looks like「你没同意过任何东西」. */}
        {acceptances && acceptances.acceptances.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>授权记录</Text>
            {acceptances.acceptances.map((item) => (
              <View key={item.document} style={styles.statusRow}>
                <Text style={styles.statusLabel}>
                  {LEGAL_DOCUMENT_TITLES[item.document] ?? item.document}
                </Text>
                <Text style={styles.statusValue}>
                  {item.version} · {item.acceptedAt.slice(0, 10)}
                </Text>
              </View>
            ))}
            {acceptances.acceptances.some(
              (item) => item.document === LEGAL_DOCUMENTS.sensitiveData,
            ) ? (
              <Button
                label="撤回敏感信息处理同意"
                variant="plain"
                fullWidth
                busy={withdrawing}
                onPress={onWithdrawSensitive}
                accessibilityHint="撤回后将无法继续上传报告或记录健康数据，已上传的内容不会被删除"
              />
            ) : null}
          </View>
        ) : null}

        {/* 隐私保护说明 */}
        <View style={styles.section}>
          <View style={styles.privacyNoticeCard}>
            <View style={styles.privacyNoticeHeader}>
              <View style={styles.privacyIconContainer}>
                <Icon name="shield-halved" size={14} color={COLOR.accent} />
              </View>
              <View style={styles.privacyNoticeContent}>
                <Text style={styles.privacyNoticeTitle}>隐私保护承诺</Text>
                <View style={styles.privacyNoticeList}>
                  {/* Every line here must be something the code
                      actually does. This block used to claim
                      「区块链存证数据操作日志」— there is no blockchain
                      anywhere in this product — and 「严格遵守 HIPAA、
                      GDPR 等国际隐私标准」, which is a US healthcare
                      statute that does not apply and a compliance
                      claim nobody has assessed. Telling patients that
                      about their own medical records is worse than
                      saying nothing; what replaced it is the shorter,
                      true list. */}
                  <View style={styles.privacyNoticeItem}>
                    <Text style={styles.bulletPoint}>•</Text>
                    <Text style={styles.privacyNoticeText}>
                      传输使用 HTTPS，密码加盐哈希存储，我们无法还原你的原始密码
                    </Text>
                  </View>
                  <View style={styles.privacyNoticeItem}>
                    <Text style={styles.bulletPoint}>•</Text>
                    <Text style={styles.privacyNoticeText}>
                      报告存放在权限受限的对象存储，只能通过你本人登录后的接口取回
                    </Text>
                  </View>
                  <View style={styles.privacyNoticeItem}>
                    <Text style={styles.bulletPoint}>•</Text>
                    <Text style={styles.privacyNoticeText}>
                      每一次同意的开启与关闭都有带时间戳的记录，可在「授权记录」查看
                    </Text>
                  </View>
                  <View style={styles.privacyNoticeItem}>
                    <Text style={styles.bulletPoint}>•</Text>
                    <Text style={styles.privacyNoticeText}>
                      按《个人信息保护法》处理；我们团队规模有限，不承诺绝对安全
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* 确认弹窗 now comes from useAppDialog() — see requestToggle. */}

      {/* 成功提示 */}
      <SuccessToast isVisible={isSuccessToastVisible} message="设置已更新" />
    </SafeAreaView>
  );
};

export default PrivacySettingsScreen;
