import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import Button from '../common/Button';
import ListGroup, { Row } from '../common/ListGroup';
import {
  ADMIN_PATIENT_PAGE_SIZE,
  listAdminPatients,
  type AdminPatientListItem,
} from '../../lib/admin-api';
import { COLOR } from '../../lib/design';
import { AdminScreen, AdminState, describeAdminError, formatDate } from './common';
import styles from './styles';

/**
 * 后台 · 患者列表 — contract §B4 读.
 *
 * WHAT THIS SCREEN MUST NOT BECOME.
 *
 * The service sends `maskedName` (张三 → 张〇) and `maskedPhone`
 * (139****0001) and searches the unmasked columns without returning
 * them. The point of that is not tidiness: it makes a shoulder-surfed
 * screen not be a dialable roster of Chinese FSHD patients, and it
 * makes turning any one row into a person cost one `admin.record_read`
 * audit row. So this screen renders exactly what arrives, adds no
 * column that would need unmasking to fill, and says out loud that
 * opening a row is the audited act.
 *
 * The search box is the only place an operator types a patient's name,
 * and it goes out as `?q=`. `requireAdmin` strips the query string
 * before writing its audit row for precisely that reason — see
 * `_auditPathOf` — so the name is not persisted into `audit_logs` by
 * the act of looking someone up.
 */

const PatientRow = ({ item, onPress }: { item: AdminPatientListItem; onPress: () => void }) => {
  const detail = [
    item.maskedPhone,
    item.patientCode,
    // Only when it is not the default. Every row saying 「patient」 is
    // noise; a 医生 or 家属 account sitting in a patient list is the
    // thing worth seeing.
    item.role && item.role !== 'patient' ? item.role : null,
    item.hasProfile === false ? '未建档' : null,
    item.isActive === false ? '账号已停用' : null,
    item.registeredAt ? `注册 ${formatDate(item.registeredAt)}` : null,
    item.profileUpdatedAt ? `档案更新 ${formatDate(item.profileUpdatedAt)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Row
      icon="user"
      // 未填姓名 rather than a blank: a row with no label reads as a
      // rendering fault, and 「有账号，没填过」 is a real and common
      // state this list exists to show.
      label={item.maskedName ?? '未填姓名'}
      detail={detail || '没有更多信息'}
      onPress={onPress}
      accessibilityLabel={`打开 ${item.maskedName ?? '未填姓名'} 的档案`}
      accessibilityHint="打开会写一条读取审计记录"
    />
  );
};

const AdminPatientListScreen = () => {
  const router = useRouter();
  const [draft, setDraft] = useState('');
  /** The term the CURRENT page was fetched with. Separate from `draft`
   *  so typing does not fire a request per keystroke against an
   *  endpoint that writes an audit row per request. */
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  /** The page number the SERVER says it served, for display only.
   *  Deliberately not fed back into `page`: that would make the
   *  response drive the effect that made the request, and a server
   *  that clamps or echoes differently would fetch in a loop. */
  const [servedPage, setServedPage] = useState(1);
  /** Same story as `servedPage`: the size the server actually used. The
   *  page count has to come from that and not from what we asked for —
   *  a server that caps `pageSize` would otherwise be reported as
   *  having more pages than it has, and 下一页 would walk the operator
   *  into empty ones. */
  const [servedPageSize, setServedPageSize] = useState(ADMIN_PATIENT_PAGE_SIZE);
  const [items, setItems] = useState<AdminPatientListItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null);
  /** Guards against a slow page 1 landing after a fast page 2 and
   *  putting the wrong rows under the right page number. */
  const seq = useRef(0);

  const load = useCallback((nextPage: number, nextTerm: string) => {
    const mine = ++seq.current;
    setState('loading');
    listAdminPatients({ page: nextPage, q: nextTerm, pageSize: ADMIN_PATIENT_PAGE_SIZE })
      .then((result) => {
        if (mine !== seq.current) return;
        setItems(result.items);
        setTotal(result.total);
        setServedPage(result.page);
        setServedPageSize(result.pageSize);
        setError(null);
        setState('ready');
      })
      .catch((caught: unknown) => {
        if (mine !== seq.current) return;
        setError(caught);
        setState('error');
      });
  }, []);

  // `draft` is deliberately absent: it changes on every keystroke and
  // this endpoint writes an audit row per request. The submitted term
  // is `term`, and `load` is stable.
  useEffect(() => {
    load(page, term);
  }, [load, page, term]);

  const submitSearch = () => {
    const next = draft.trim();
    // Always reset to page 1: staying on page 4 of the previous result
    // set shows an empty page and reads as 「没有这个人」.
    setPage(1);
    setTerm(next);
    // Re-submitting the same term must still re-fetch (the operator
    // pressed the button because they want fresh data), and setting
    // state to the same value would not re-run the effect.
    //
    // `page === 1` is the other half, and it is not a micro-optimisation:
    // off page 1 the `setPage(1)` above ALREADY re-runs the effect with
    // the same arguments, so without this guard one press of 搜索 fires
    // two identical requests and `requireAdmin` writes two `admin.list`
    // audit rows for it — the exact cost this file's header cites as the
    // reason `draft` is kept out of the effect deps.
    if (next === term && page === 1) load(1, next);
  };

  const described = state === 'error' ? describeAdminError(error) : null;
  const knownPages = total === null ? null : Math.max(1, Math.ceil(total / servedPageSize));
  // Without a total there is no last page to know about, so 下一页 is
  // offered whenever this page came back full — pressing it on the
  // real last page returns an empty page rather than a wrong claim.
  const canGoNext = knownPages === null ? items.length >= servedPageSize : page < knownPages;

  return (
    <AdminScreen
      title="患者列表"
      subtitle="搜索会匹配手机号、患者编号和姓名；返回的姓名和手机号是打码的。点开一位患者才会看到完整信息，那一次会记进审计。"
      fallbackHref="/p-admin"
    >
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submitSearch}
          returnKeyType="search"
          placeholder="手机号 / 患者编号 / 姓名"
          placeholderTextColor={COLOR.inkFaint}
          accessibilityLabel="搜索患者"
          autoCapitalize="none"
        />
        <Button label="搜索" icon="chevron-right" onPress={submitSearch} />
      </View>

      {state === 'loading' ? <AdminState kind="loading" message="加载中…" /> : null}

      {state === 'error' && described ? (
        <AdminState
          kind="error"
          title={described.title}
          message={described.message}
          onRetry={() => load(page, term)}
        />
      ) : null}

      {state === 'ready' && items.length === 0 ? (
        <AdminState
          kind="empty"
          message={
            term
              ? `没有匹配「${term}」的账号。搜索只匹配手机号、患者编号和姓名，不匹配病历内容。`
              : '一个账号也没有。'
          }
        />
      ) : null}

      {state === 'ready' && items.length > 0 ? (
        <>
          <ListGroup
            title={
              total === null
                ? `第 ${servedPage} 页 · 本页 ${items.length} 人`
                : `第 ${servedPage} 页 · 共 ${total} 人`
            }
            footnote={total === null ? '服务端没有返回总数，所以这里不写「共几人」。' : undefined}
          >
            {items.map((item) => (
              <PatientRow
                key={item.userId}
                item={item}
                onPress={() => router.push(`/p-admin_patient?userId=${item.userId}`)}
              />
            ))}
          </ListGroup>

          <View style={styles.pager}>
            <Button
              label="上一页"
              icon="chevron-left"
              variant="tinted"
              disabled={page <= 1}
              onPress={() => setPage((current) => Math.max(1, current - 1))}
            />
            <Text style={styles.pagerText}>
              {knownPages === null ? `第 ${servedPage} 页` : `第 ${servedPage} / ${knownPages} 页`}
            </Text>
            <Button
              label="下一页"
              trailingIcon="chevron-right"
              variant="tinted"
              disabled={!canGoNext}
              onPress={() => setPage((current) => current + 1)}
            />
          </View>
        </>
      ) : null}
    </AdminScreen>
  );
};

export default AdminPatientListScreen;
