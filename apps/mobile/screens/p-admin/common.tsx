import type { ReactNode } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../common/Button';
import Icon from '../common/Icon';
import ScreenHeader from '../common/ScreenHeader';
import { ApiError } from '../../lib/api';
import {
  ADMIN_FIELD_ORIGIN_LABEL,
  AdminResponseError,
  type AdminFieldOrigin,
} from '../../lib/admin-api';
import { COLOR } from '../../lib/design';
import styles from './styles';

/**
 * The parts every back-office screen shares.
 *
 * The banner and the error wording live here rather than in each
 * screen because they must not drift: an operator has to read the same
 * sentence about audit on every screen, and a 403 has to mean the same
 * thing on every screen — otherwise the one that words it loosely is
 * the one somebody believes.
 */

/**
 * The mechanism, which is the same wherever the banner is drawn.
 *
 * It is not a disclaimer. `requireAdmin` writes one `audit_logs` row
 * for every request it lets through, INCLUDING reads, before the
 * handler runs, and refuses the request with a 503 if that write fails.
 * So this sentence is a description of what happens, and an operator
 * who reads it and keeps browsing has been told the truth.
 *
 * It says 放行之前 rather than 每次请求, because a request refused AT the
 * gate writes nothing: `requireAdmin` answers a non-admin, a deactivated
 * account and an unparseable patient id without touching `audit_logs`,
 * and says why in its own comments. Those refusals are states these
 * screens display — the banner sits above the 403 — so a sentence
 * promising a row for every request would be false on the screen an
 * operator is looking at when they read it.
 */
const AUDIT_MECHANISM =
  '服务端放行一次后台请求之前，会先记一条审计：哪个管理员账号、什么时间、请求了哪个接口。' +
  '记录写不进去时，服务端会直接拒绝这次访问，而不是先给你看。';

/**
 * WHAT THE BANNER MAY CLAIM IS DECIDED PER SCREEN, and that is why
 * there is no longer one constant for all of them.
 *
 * Two facts differ from screen to screen, and one sentence covering
 * every screen has to be false on some of them:
 *
 *  - WHETHER OPENING THE SCREEN RECORDS ANYTHING. 全量导出 issues no
 *    request when it opens — the first one is the one the operator asks
 *    for by pressing a button. The old wording opened with 「你在这里打开
 *    的每一页都会记进审计」, so the one screen that touches nothing on
 *    open was also the one screen telling an operator, in the strongest
 *    words on the page, that something had been written down.
 *  - WHETHER THE ROWS NAME A PATIENT. `targetUserId` is filled from
 *    `AdminAuditSpec.targetParam` — a patient id in the route's OWN
 *    PATH — so the routes behind `getPatientRecord`,
 *    `updatePatientBaseline` and `exportPatient` name a patient, and
 *    the others cannot: `listPatients` answers with a page of many, the
 *    ops panels are about nobody, and `exportAllPatientsCsv` is about
 *    everybody (the extra row `recordFullExportAudit` writes says how
 *    many, not who).
 *
 * `AdminScreen` takes the notice as a required prop rather than owning
 * one, so a screen added later has to answer both questions instead of
 * inheriting an answer written for a different screen. Each screen's
 * test asserts that ITS string is the text drawn there.
 */
export const ADMIN_AUDIT_NOTICE_OVERVIEW =
  '这一页一打开就会向服务端取数；这些请求不针对某一位患者，记录里就没有患者这一项。' +
  AUDIT_MECHANISM;

export const ADMIN_AUDIT_NOTICE_PATIENT_LIST =
  '这一页一打开就会向服务端要一页患者，搜索和翻页也各是一次请求；这些请求不针对某一位患者，' +
  '记录里就没有患者这一项。点开一位患者的那一次才会记下是哪一位。' +
  AUDIT_MECHANISM;

export const ADMIN_AUDIT_NOTICE_PATIENT_RECORD =
  '这一页的请求都针对某一位患者——打开、保存、导出都算——记录里会写着是哪一位。' + AUDIT_MECHANISM;

export const ADMIN_AUDIT_NOTICE_FULL_EXPORT =
  '这一页打开时不向服务端要任何东西，所以到这里为止没有记下什么。' +
  '从「查看规模并取确认口令」那一步起，每一次请求才会记进审计；全量导出不针对某一位患者，记录里就没有患者这一项。' +
  AUDIT_MECHANISM;

const AdminAuditBanner = ({ notice }: { notice: string }) => (
  <View style={styles.auditBanner}>
    <Icon name="file-shield" size={18} color={COLOR.warn} />
    <Text style={styles.auditBannerText}>{notice}</Text>
  </View>
);

/**
 * The per-field part of a zod 400, if the body carried one.
 *
 * `ZodError.flatten()` keys `fieldErrors` by the FIRST path segment
 * only, so a `diseaseBackground.familyHistory` that is too long arrives
 * as `{ diseaseBackground: ['String must contain at most 255
 * character(s)'] }` — the section, not the box, and in zod's English.
 * It is reproduced verbatim rather than translated or mapped onto this
 * screen's labels: a mapping would be a second copy of the schema, and
 * the failure it would produce is naming the wrong box confidently.
 *
 * Returns null when there is nothing there, so the caller can say so
 * instead of printing an empty bracket.
 */
export const describeValidationDetails = (data: unknown): string | null => {
  if (!data || typeof data !== 'object') return null;
  const details = (data as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return null;
  const { formErrors, fieldErrors } = details as {
    formErrors?: unknown;
    fieldErrors?: unknown;
  };
  const parts: string[] = [];
  if (fieldErrors && typeof fieldErrors === 'object') {
    for (const [field, messages] of Object.entries(fieldErrors as Record<string, unknown>)) {
      const text = Array.isArray(messages) ? messages.filter(Boolean).join('；') : null;
      parts.push(text ? `${field}（${text}）` : field);
    }
  }
  if (Array.isArray(formErrors)) {
    for (const message of formErrors) {
      if (typeof message === 'string' && message.trim()) parts.push(message);
    }
  }
  return parts.length > 0 ? parts.join('，') : null;
};

/**
 * A failure, in words that say what to do next.
 *
 * What each status means on the admin routes, and therefore what this
 * client is allowed to say about it:
 *
 *  - 403 for 「不是管理员 / 账号停用 / 查无此账号」 — these deliberately
 *    share one message, so this client cannot tell them apart either.
 *  - 503 for 「角色读不到」 and for 「审计写不进去」.
 *  - 400 for a `targetParam` that is present and is not a UUID (a
 *    pasted or mistyped id), and for any zod refusal.
 *  - 500 only for a `targetParam` that is ABSENT — a route mounted
 *    wrong, which is our fault and not the operator's.
 *  - 409 for a refusal this router makes on purpose. They do NOT share
 *    a remedy — some want the page reloaded, some a different tool,
 *    some the maintainer told, some something only the patient can do —
 *    so each writes its own Chinese sentence saying which. See the
 *    branch below for why this function adds nothing to them.
 *  - 429 from the 10/min budget on the full export.
 *
 * 428 is not here: it is the full export's FIRST step rather than a
 * failure, and `requestAdminFullPatientCsv` returns it as a value.
 */
export const describeAdminError = (error: unknown): { title: string; message: string } => {
  if (error instanceof AdminResponseError) {
    return { title: '这一版读不懂服务端的返回', message: error.message };
  }
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return {
        title: '这个账号没有后台权限',
        message:
          '服务端每次请求都重新去数据库读一次角色，所以刚被 npm run admin:revoke 收回权限的账号会立刻落到这里。' +
          '需要权限请找能登录服务器的人执行 npm run admin:grant，App 里没有自助入口。',
      };
    }
    if (error.status === 503) {
      return {
        title: '后台暂时不可用',
        message:
          '服务端在两种情况下这样回答：读不到你的角色，或者这次访问的审计记录写不进去。' +
          '后一种情况下它宁可不放行——没有留痕的读取是这套后台唯一不允许发生的事。稍后重试。',
      };
    }
    if (error.status === 404) {
      return { title: '找不到这条记录', message: '这个账号可能已经注销，或者链接里的 ID 不对。' };
    }
    if (error.status === 400) {
      // Very different 400s reach here. `requireAdmin` answers one
      // with a sentence an operator can act on (「链接里的患者 ID 不是一个
      // 合法的用户 ID」); a zod refusal answers the bare English
      // 'Validation failed' from error-handler.ts, and puts the useful
      // part in `details` — which for a ZodError is `flatten()` sent
      // through UNFILTERED (the CLIENT_SAFE_DETAIL_KEYS projection only
      // applies to AppError.details). So the breakdown is on the wire,
      // and reading it is the difference between naming a section to
      // look in and telling the operator 「请求失败 / Validation failed」
      // with every box a candidate.
      const detail = describeValidationDetails(error.data);
      if (detail) {
        return {
          title: '服务端不接受这次请求的内容',
          message: `${error.message}。服务端指出的位置：${detail}`,
        };
      }
      // Only the bare English one needs explaining. Appending this to
      // 「链接里的患者 ID 不是一个合法的用户 ID，请从患者列表里再点一次。」
      // would bury an instruction under a paragraph about length limits
      // that has nothing to do with what happened.
      if (/^validation failed$/i.test(error.message.trim())) {
        return {
          title: '服务端不接受这次请求的内容',
          message:
            'Validation failed —— 服务端没有说是哪个字段。本页在发送前已按记录在案的长度上限检查过一遍，' +
            '所以走到这里通常意味着前后端的上限对不上了，请看 API 日志。',
        };
      }
      return { title: '服务端不接受这次请求的内容', message: error.message };
    }
    if (error.status === 409) {
      // NOTHING IS ADDED TO THE SERVER'S SENTENCE HERE, and that is the
      // whole content of this branch.
      //
      // A generic 「重新来一遍即可」 is wrong for every 409 a retry cannot
      // fix: the same request reproduces the refusal until something
      // else happens first — the page is reloaded, a different tool is
      // used, the patient saves a baseline.
      // Each of these already carries a complete Chinese sentence naming
      // what to do, so the only thing this client can say across all of
      // them, including ones added after this comment, is that the
      // server refused.
      return { title: '服务端拒绝了这次操作', message: error.message };
    }
    if (error.status === 429) {
      return {
        title: '太频繁了',
        message: error.retryAfterSeconds
          ? `${error.message}（约 ${error.retryAfterSeconds} 秒后再试。）`
          : error.message,
      };
    }
    if (error.status === 500) {
      return {
        title: '后台接口出错',
        message: `${error.message}（这是服务端的问题，重试通常不会变好，请看 API 日志。）`,
      };
    }
    return { title: '请求失败', message: error.message };
  }
  return {
    title: '请求失败',
    message: error instanceof Error ? error.message : '请稍后重试。',
  };
};

/** Loading / error / empty, drawn the same way everywhere. */
export const AdminState = ({
  kind,
  title,
  message,
  onRetry,
}: {
  kind: 'loading' | 'error' | 'empty';
  title?: string;
  message: string;
  onRetry?: () => void;
}) => (
  <View style={styles.state}>
    {kind === 'loading' ? <ActivityIndicator color={COLOR.accent} /> : null}
    {kind === 'error' ? <Icon name="triangle-exclamation" size={20} color={COLOR.alert} /> : null}
    {kind === 'empty' ? <Icon name="circle-info" size={20} color={COLOR.inkMuted} /> : null}
    {title ? <Text style={styles.stateTitle}>{title}</Text> : null}
    <Text style={styles.stateText}>{message}</Text>
    {/* Not `compact`: a compact button is a 34pt target on the web
        export (Button.tsx documents why hitSlop cannot buy it back
        there), and retry is on the path out of a failure. */}
    {onRetry ? (
      <Button label="重试" icon="rotate-right" variant="tinted" onPress={onRetry} />
    ) : null}
  </View>
);

/**
 * One titled section that loads, fails and retries ON ITS OWN.
 *
 * This is why the ops dashboard makes a request per block rather than
 * one aggregate call:
 * the page an operator opens is the page they open BECAUSE something
 * is already wrong, and a single aggregate call means a slow
 * `ai_prompt_audit` scan takes the corpus status and the parse queue
 * down with it.
 */
export const AdminBlock = ({
  title,
  note,
  state,
  error,
  onRetry,
  children,
}: {
  title: string;
  note?: string;
  state: 'loading' | 'ready' | 'error';
  error?: unknown;
  onRetry?: () => void;
  children?: ReactNode;
}) => {
  const described = state === 'error' ? describeAdminError(error) : null;
  return (
    <View style={styles.block}>
      <View style={styles.blockHead}>
        <Text style={styles.blockTitle}>{title}</Text>
      </View>
      {note ? <Text style={styles.blockNote}>{note}</Text> : null}
      <View style={styles.blockBody}>
        {state === 'loading' ? <AdminState kind="loading" message="加载中…" /> : null}
        {state === 'error' && described ? (
          <AdminState
            kind="error"
            title={described.title}
            message={described.message}
            onRetry={onRetry}
          />
        ) : null}
        {state === 'ready' ? children : null}
      </View>
    </View>
  );
};

/**
 * One number.
 *
 * `value === null` is 「服务端没有返回这一项」 and is drawn in body
 * weight, not metric weight — a missing number must not look like a
 * number. There is no path here that renders a null as 0.
 */
export const AdminStat = ({
  label,
  value,
  detail,
  alert,
  first,
}: {
  label: string;
  value: string | null;
  detail?: string | null;
  /** Draws the value in the alert colour. For a queue with items in
   *  it — the number an operator is scanning for. */
  alert?: boolean;
  first?: boolean;
}) => (
  <View style={[styles.stat, first ? null : styles.statDivider]}>
    <Text style={styles.statLabel}>{label}</Text>
    {value === null ? (
      <Text style={styles.statMissing}>服务端没有返回这一项</Text>
    ) : (
      <Text style={[styles.statValue, alert ? styles.statValueAlert : null]}>{value}</Text>
    )}
    {detail ? <Text style={styles.statDetail}>{detail}</Text> : null}
  </View>
);

/** The provenance marker, §B3. One word per state, and
 *  `unreadable` never borrows the patient's. */
export const AdminOriginChip = ({ origin }: { origin: AdminFieldOrigin }) => {
  const tone =
    origin.state === 'admin_entered'
      ? { color: COLOR.warn, wash: COLOR.warnWash }
      : origin.state === 'unreadable'
        ? { color: COLOR.alert, wash: COLOR.alertWash }
        : { color: COLOR.inkMuted, wash: 'transparent' };
  // The words come from lib/admin-api.ts, not from here. Two copies of
  //「无代填记录」/「管理员代填」/「来源不明」is how a chip ends up disagreeing
  // with an accessibility label about the same field.
  const label = ADMIN_FIELD_ORIGIN_LABEL[origin.state];
  return (
    <View style={[styles.originChip, { borderColor: tone.color, backgroundColor: tone.wash }]}>
      <Text style={[styles.originChipText, { color: tone.color }]}>{label}</Text>
    </View>
  );
};

/** The page shell: header, title, the audit banner, a scroll view. */
export const AdminScreen = ({
  title,
  subtitle,
  audit,
  fallbackHref,
  children,
  refreshControl,
}: {
  title: string;
  subtitle: string;
  /** The banner's sentence — one of the `ADMIN_AUDIT_NOTICE_*` above.
   *  Required, and deliberately not defaulted: a default is how the
   *  next screen ends up promising what some other screen's requests
   *  record. */
  audit: string;
  /** Where 返回 goes when this route was opened cold — the back office
   *  is reached by typing a URL as often as by tapping. */
  fallbackHref?: '/p-admin' | '/p-admin_patients' | '/p-home';
  children: ReactNode;
  refreshControl?: React.ComponentProps<typeof ScrollView>['refreshControl'];
}) => (
  <SafeAreaView style={styles.container}>
    <ScreenHeader title="后台" fallbackHref={fallbackHref ?? '/p-home'} />
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
    >
      <View>
        <Text style={styles.pageTitle}>{title}</Text>
        <Text style={styles.pageSubtitle}>{subtitle}</Text>
      </View>
      <AdminAuditBanner notice={audit} />
      {children}
    </ScrollView>
  </SafeAreaView>
);

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** An ISO timestamp as 「2026-08-13 19:26」, or the raw string when it
 *  is not a date. Never 「Invalid Date」 and never silently blank: the
 *  raw value is at least evidence of what the server sent. */
export const formatDateTime = (iso: string | null): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
};

export const formatDate = (iso: string | null): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** 「已等 3 天」 for a queue's oldest item. Returns null rather than
 *  「0 分钟」 for an unparseable timestamp. */
export const describeWaiting = (iso: string | null, now: Date = new Date()): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 0) return null;
  if (minutes < 60) return `已等 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `已等 ${hours} 小时`;
  return `已等 ${Math.floor(hours / 24)} 天`;
};

/** A count for display. `null` stays `null` all the way to AdminStat,
 *  which is what stops a missing number becoming 0. */
export const formatCount = (value: number | null, unit = '条'): string | null =>
  value === null ? null : `${value} ${unit}`;
