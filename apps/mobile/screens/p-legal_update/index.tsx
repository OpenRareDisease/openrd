import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Button from '../common/Button';
import { COLOR } from '../../lib/design';
import { ApiError, recordLegalAcceptance } from '../../lib/api';
import {
  GUARDIAN_CONSENT_TITLE,
  LEGAL_CONTACT_EMAIL,
  LEGAL_CONTACT_PHONE,
  PRIVACY_POLICY_TITLE,
  SENSITIVE_DATA_CONSENT_TITLE,
  USER_AGREEMENT_TITLE,
} from '../../lib/legal-content';
import { useLegalConsentContext } from '../../contexts/LegalConsentContext';
import styles from './styles';

/**
 * 隐私政策更新 — the re-consent §9 promises.
 *
 * WHAT THIS SCREEN IS FOR
 *
 * 《隐私政策》第 9 条: 「涉及处理目的、处理方式、信息种类或接收方实质
 * 变更的，我们会在 App 内重新征得你的同意」. The administrator back
 * office is such a change. Both documents that describe it were
 * revised, their versions bumped, and `GET /legal/acceptances` now
 * reports them as outstanding for every existing account. This screen
 * is what reads that and asks.
 *
 * IT IS A SCREEN, NOT A MODAL, ON PURPOSE. A modal is something a
 * person dismisses on the way to what they opened the app for. What
 * changed here is that another human being can read their medical
 * record, and that deserves a page with room for the sentence rather
 * than a scroll-to-the-bottom-and-tick.
 *
 * THE SAME MECHANISM AS THE FIRST ACCEPTANCE. The ledger is written
 * through `recordLegalAcceptance` — the one writer the register screen
 * and SensitiveDataConsentGate both use — with the version this build
 * actually displayed. There is no second table, no local flag standing
 * in for consent, and nothing here decides what the API will serve.
 *
 * DECLINING IS A REAL OPTION AND COSTS NOTHING. 暂不同意 defers for the
 * session and returns the patient to their own records. The rights the
 * privacy policy already promises — 导出我的数据 and 注销账号, both in
 * 我的 (screens/p-settings) — are named on this screen with a control
 * that goes there, because 「你可以行使你的权利」 with no way to reach
 * them is the kind of sentence this repository exists to not write.
 * What this screen must NOT claim is that declining stops the back
 * office from reading the record: nothing in the API keys admin access
 * off this ledger, and saying so would be a promise the code does not
 * keep. It says what is true instead — the account is not locked, the
 * data can be taken out or deleted, and there is a person to write to.
 */

const LegalUpdateScreen = () => {
  const router = useRouter();
  const { status, asks, refresh, defer } = useLegalConsentContext();

  /** Documents accepted in this visit. The context's list only changes
   *  after a refresh, so stepping through two asks (privacy policy and
   *  the guardian rules were bumped together) needs its own record of
   *  what has already been answered. */
  const [answered, setAnswered] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullTextOpen, setFullTextOpen] = useState(false);

  /** True until this mount's own read of the ledger comes back. */
  const [rereading, setRereading] = useState(true);

  /**
   * Re-read the ledger before asking anything.
   *
   * THIS SCREEN HAS TWO ENTRIES, and only one of them arrives fresh.
   * The gate in app/_layout replaces the route on entry, off
   * LegalConsentContext's list; 「看看改了什么」 in 隐私设置 pushes it at
   * an arbitrary later time, off that screen's own fetch. On the second
   * entry the context's list can be stale in either direction: holding
   * a document already accepted (accept one of two, press 暂不同意, and
   * it still holds both), or missing one the ledger has since put back
   * into `outstanding`. 隐私设置 read the ledger a moment ago; this
   * screen must not answer that patient out of an older list. So: read,
   * then render the read.
   */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await refresh();
      } catch {
        // The provider already turns a failed probe into status
        // 'error', which this screen renders as 「读不到」 rather than
        // 「没有」. Nothing to do here but stop waiting.
      } finally {
        if (alive) setRereading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [refresh]);

  const remaining = asks.filter((item) => !answered.includes(item.document));
  const ask = remaining[0] ?? null;

  const leaveTo = (href: '/p-home' | '/p-settings') => {
    // Defer BEFORE navigating: the gate in app/_layout re-evaluates on
    // the next render, and without this it would replace the
    // destination with this screen again — which is what turns a
    // refusal into a lockout.
    defer();
    router.replace(href);
  };

  const onAccept = async () => {
    if (!ask || busy) return;
    setBusy(true);
    setError(null);
    try {
      // The version this screen actually displayed, not the server's
      // idea of current — see legal.schema.ts on why the ledger
      // records what the user saw.
      await recordLegalAcceptance(ask.document, ask.currentVersion);
      const nextAnswered = [...answered, ask.document];
      setAnswered(nextAnswered);
      setFullTextOpen(false);
      setBusy(false);
      if (asks.every((item) => nextAnswered.includes(item.document))) {
        // Re-read the ledger before leaving, so the gate sees 'ready'
        // and does not bounce the user straight back here.
        await refresh();
        router.replace('/p-home');
      }
    } catch (err) {
      // Fail closed on the WRITE, exactly as the Art. 29 gate does: an
      // acceptance that was not recorded is not an acceptance, and
      // walking the patient onward as if it had been is how a consent
      // ledger becomes decoration.
      setBusy(false);
      setError(err instanceof ApiError ? err.message : '同意没有保存成功，请检查网络后再试一次');
    }
  };

  // Nothing is asked from a snapshot: while this mount's own read is in
  // flight the screen says it is reading, rather than answering a
  // question it has not asked the server yet.
  const reading = rereading || status === 'loading';

  if (!ask || reading) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {answered.length > 0 ? (
            <View style={styles.emptyBlock}>
              <Text style={styles.emptyTitle}>已经记下来了</Text>
              <Text style={styles.emptyText}>
                谢谢你读完。你同意的版本号和时间都存下来了，可以在「隐私设置 →
                授权记录」里看到。正在带你回首页。
              </Text>
            </View>
          ) : reading ? (
            <View style={styles.emptyBlock}>
              <ActivityIndicator color={COLOR.accent} />
              <Text style={styles.emptyText}>正在读取你的授权记录…</Text>
              {/* The read is a network round trip, and on the gate
                  entry this route is where the patient is put back if
                  they navigate away without deferring. So the exit is
                  on this branch too, and it defers exactly as 暂不同意
                  does — otherwise the wait is a screen with no way off
                  it. */}
              <Button
                label="先回首页"
                variant="plain"
                fullWidth
                onPress={() => leaveTo('/p-home')}
                accessibilityHint="先不确认，回到你的记录；下次打开时我们会再问一次"
              />
            </View>
          ) : status === 'error' ? (
            // NOT 「没有需要重新确认的条款」. The read failed, so we do
            // not know whether anything is owed, and this screen is
            // reachable from 隐私设置 — where a successful read may
            // have just told the patient that something is.
            <View style={styles.emptyBlock}>
              <Text style={styles.emptyTitle}>现在读不到你的授权记录</Text>
              <Text style={styles.emptyText}>
                所以这一页说不出你是否还有待确认的条款——不是「没有」，是取不到。请检查网络后重试。
              </Text>
              <Button
                label="重试"
                variant="tinted"
                fullWidth
                onPress={() => void refresh()}
                accessibilityHint="重新读取你的授权记录"
              />
              <Button
                label="回到首页"
                variant="plain"
                fullWidth
                onPress={() => router.replace('/p-home')}
              />
            </View>
          ) : (
            <View style={styles.emptyBlock}>
              <Text style={styles.emptyTitle}>没有需要重新确认的条款</Text>
              {/* WHERE EACH DOCUMENT ACTUALLY IS. This screen asks about
                  every id in ASK_ORDER (lib/legal-updates.ts). 关于我们
                  opens USER_AGREEMENT_SECTIONS and
                  PRIVACY_POLICY_SECTIONS — the ones it imports, and no
                  others. So 「条款全文可以在关于我们里随时翻看」 sent a
                  patient looking for the Art. 29 单独同意 or the 监护人同意
                  to a screen that does not carry them. Those have no
                  standing entry anywhere: SensitiveDataConsentGate shows
                  them at the first report upload and at 建档, and this
                  screen shows them under 展开全文 when one of them is the
                  outstanding ask — which is exactly not this branch.
                  Saying so is better than pointing somewhere they are
                  not. */}
              <Text style={styles.emptyText}>
                你当前同意的就是最新版本。《
                {USER_AGREEMENT_TITLE}》和《{PRIVACY_POLICY_TITLE}
                》的全文在「我的 → 关于我们」里随时可以翻看；《
                {SENSITIVE_DATA_CONSENT_TITLE}》和《{GUARDIAN_CONSENT_TITLE}
                》没有常驻入口，只在向你征求同意时完整展示。
              </Text>
              <Button
                label="回到首页"
                variant="tinted"
                fullWidth
                onPress={() => router.replace('/p-home')}
              />
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* No back control, and no home control. On the GATE entry (a
          `replace` from app/_layout) a back arrow would land on a
          route the gate immediately replaces with this screen: a
          button that looks like an exit and behaves like a bounce.
          暂不同意 below is the exit instead — it defers first, so it
          works on both entries. */}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* 「更新了」 only when there is something to have updated from.
            An account whose ledger holds no LIVE acceptance of this
            document is not looking at a revision, and telling that
            person 「文件更新了」 would be the screen's very first
            sentence being false. The payload does not say why the row
            is missing (see ConsentAsk.acceptedVersion), so the copy
            below names no cause. */}
        {ask.acceptedVersion ? (
          <>
            <Text style={styles.pageTitle} accessibilityRole="header">
              《{ask.title}》更新了，想先跟你说一声
            </Text>
            <Text style={styles.pageLead}>
              {ask.lead}按我们在《隐私政策》第 9 条里对你的承诺，这种改动要在 App
              里重新问你一次——所以有了这一页。
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.pageTitle} accessibilityRole="header">
              《{ask.title}》还差你一次确认
            </Text>
            <Text style={styles.pageLead}>
              我们这边现在没有你对这份文件的有效同意记录，所以要请你确认一次。记下来以后，你什么时候同意的、同意的是哪一版，都能自己查到。
            </Text>
          </>
        )}

        {asks.length > 1 ? (
          <Text style={styles.stepHint}>
            这次有 {asks.length} 份文件要确认，这是第 {answered.length + 1} 份：《{ask.title}》。
          </Text>
        ) : null}

        <View style={styles.versionRow}>
          {ask.acceptedVersion ? (
            <Text style={styles.versionText}>
              你上次同意的是 {ask.acceptedVersion} 版，现在是 {ask.currentVersion} 版。
            </Text>
          ) : (
            <Text style={styles.versionText}>
              我们这里没有你同意这份文件的有效记录。这一版是 {ask.currentVersion}，请读一遍再决定。
            </Text>
          )}
        </View>

        {ask.notes.length > 0 ? (
          <View style={styles.changeCard}>
            <Text style={styles.changeCardTitle}>这一版改了什么</Text>
            {ask.notes.map((note) => (
              <View key={note.version} style={styles.note}>
                <Text style={styles.noteHeadline}>{note.headline}</Text>
                {note.changes.map((line) => (
                  <View key={line} style={styles.bulletRow}>
                    <Text style={styles.bullet}>·</Text>
                    <Text style={styles.bulletText}>{line}</Text>
                  </View>
                ))}
              </View>
            ))}
            <Text style={styles.changeCardFoot}>
              上面是摘要，不是全文；有出入以下面的全文为准。
            </Text>
          </View>
        ) : ask.acceptedVersion ? (
          // A revision this build has no note for. Two ways in:
          // LEGAL_VERSION_NOTES carries none for this document at all
          // (用户协议 and 敏感个人信息处理单独同意 today), or none newer
          // than the version this account accepted. What does NOT empty
          // the list is a version this build cannot order — the
          // ledger's oldest rows carry 'v1' — because buildConsentAsks
          // shows every note for those rather than none. Saying so is
          // better than an empty space where 「改了什么」 should be: the
          // patient then knows the summary is missing rather than
          // assuming the change was too small to describe.
          <Text style={styles.changeCardFoot}>
            这一次改动我们没有写下摘要，所以这一页说不出改了哪几句。请展开下面的全文自己读一遍再决定。
          </Text>
        ) : null}

        <Button
          label={fullTextOpen ? `收起《${ask.title}》全文` : `展开《${ask.title}》全文`}
          variant="tinted"
          fullWidth
          onPress={() => setFullTextOpen((open) => !open)}
          accessibilityHint={fullTextOpen ? '收起条款全文' : '展开这份文件的全部条款'}
        />

        {fullTextOpen ? (
          <View style={styles.fullText}>
            {ask.sections.map((section) => (
              <View key={section.title} style={styles.fullTextSection}>
                <Text style={styles.fullTextTitle}>{section.title}</Text>
                <Text style={styles.fullTextBody}>{section.body}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Button
          label={ask.acceptLabel}
          variant="prominent"
          fullWidth
          busy={busy}
          onPress={() => void onAccept()}
          accessibilityHint={ask.acceptHint}
        />
        <Text style={styles.acceptFoot}>
          同意会连同版本号和时间一起存进你的授权记录，可以在「隐私设置 → 授权记录」里查到。
        </Text>

        {/* 拒绝 is a full-width control of the same size as 同意, for the
            same reason SensitiveDataConsentGate gives: a consent whose
            refusal is a small grey link is a dark pattern, and this one
            is about who may read a medical record. */}
        <Button
          label="暂不同意"
          variant="plain"
          fullWidth
          disabled={busy}
          onPress={() => leaveTo('/p-home')}
          accessibilityHint="先不同意这一版，回到你的记录；下次打开时我们会再问一次"
        />

        <View style={styles.declineCard}>
          <Text style={styles.declineTitle}>如果你不想同意</Text>
          <Text style={styles.declineText}>
            不同意不会锁住你的账号，也不会删掉任何东西——这个账号里的记录你现在就可以照常打开。你还有这些办法：
          </Text>
          <View style={styles.bulletRow}>
            <Text style={styles.bullet}>·</Text>
            <Text style={styles.bulletText}>
              「我的 → 导出我的数据」把全部档案、记录、报告清单与授权历史下载成一个文件，带走它。
            </Text>
          </View>
          <View style={styles.bulletRow}>
            <Text style={styles.bullet}>·</Text>
            <Text style={styles.bulletText}>
              「我的 → 注销账号」申请删除全部数据。有 7 天冷静期，期间随时可以反悔。
            </Text>
          </View>
          <View style={styles.bulletRow}>
            <Text style={styles.bullet}>·</Text>
            <Text style={styles.bulletText}>
              想跟人说话：{LEGAL_CONTACT_EMAIL} 或 {LEGAL_CONTACT_PHONE}
              （《隐私政策》第 1 条里的同一个联系方式）。
            </Text>
          </View>
          <Button
            label="去「我的」，导出或注销"
            variant="tinted"
            fullWidth
            disabled={busy}
            onPress={() => leaveTo('/p-settings')}
            accessibilityHint="打开「我的」页，那里有「导出我的数据」和「注销账号」"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default LegalUpdateScreen;
