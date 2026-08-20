import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import Button from '../common/Button';
import { requestAdminFullPatientCsv, type AdminFullExportResult } from '../../lib/admin-api';
import { COLOR } from '../../lib/design';
import {
  ADMIN_AUDIT_NOTICE_FULL_EXPORT,
  AdminBlock,
  AdminScreen,
  AdminState,
  describeAdminError,
} from './common';
import {
  DOWNLOAD_UNSUPPORTED_MESSAGE,
  describeDownloadName,
  downloadStamp,
  isDownloadSupported,
  saveBlobInBrowser,
} from './download';
import styles from './styles';

/**
 * 后台 · 全量导出 — contract §B4「全量导出是最危险的一个动作」.
 *
 * ITS OWN ROUTE, NOT A BUTTON ON THE OVERVIEW. The overview is the page
 * an operator opens every morning to see whether anything is down. An
 * action that writes every patient's name, phone number and clinical
 * baseline into a file on somebody's laptop does not belong one mis-tap
 * away from 「解析失败队列」.
 *
 * THE CONFIRMATION IS A GATE, AND THESE FOUR THINGS ARE WHAT MAKE IT
 * ONE RATHER THAN A FORMALITY:
 *
 *  1. The phrase comes from the SERVER, from a request that has read
 *     nothing yet. It carries the row count, so it cannot be typed
 *     without having been shown how many patients are in the file.
 *  2. It is typed, not tapped. There is deliberately no copy button and
 *     the phrase carries `selectable={false}`: a phrase you can paste
 *     in one gesture is a second OK button with more steps. The prop is
 *     load-bearing on the only platform this ships to — react-native-web
 *     emits `user-select: none` ONLY for `selectable={false}`
 *     (node_modules/react-native-web/dist/exports/Text/index.js:115,
 *     183-188) and sets no global reset, so with the prop absent the
 *     browser default applies and the phrase long-presses and pastes.
 *  3. The box starts empty on every visit, and every phrase this screen
 *     shows arrives through `apply`'s `confirmation_required` branch,
 *     which clears it. So a screen left open cannot be re-submitted by
 *     somebody who did not read the phrase in front of them. The
 *     download branch does not clear it and does not need to: the box
 *     is not rendered in the 已下载 state, and 再导一次 goes back to the
 *     server for a new phrase, through the branch that does.
 *  4. The comparison is exact. The phrase carries today's date in
 *     Asia/Shanghai and the row count, both of which go stale — and a
 *     stale phrase comes back as another 428 with the new one, which
 *     this screen shows as「要重新确认」rather than as a failure.
 *
 * WHAT THIS SCREEN DOES NOT CLAIM. It does not say the file is
 * redacted, because it is not: `admin.csv.ts` writes full names, phone
 * numbers and regions. The server's own notes are rendered verbatim
 * rather than paraphrased here — two copies of「这份文件里有什么」that
 * drift apart is how a summary ends up milder than the file.
 */

type ExportState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'confirm';
      requiredConfirmation: string;
      patientCount: number | null;
      notes: string[];
      /** True when this confirmation REPLACED one the operator had
       *  already answered — the phrase went stale between the two
       *  requests. Rendered, because silently swapping the phrase under
       *  someone reads as 「我明明输对了」. */
      superseded: boolean;
    }
  | { kind: 'done'; fileName: string; notice: string | null }
  | { kind: 'error'; error: unknown };

const AdminFullExportScreen = () => {
  const [state, setState] = useState<ExportState>({ kind: 'idle' });
  const [typed, setTyped] = useState('');
  const downloadable = isDownloadSupported();

  const apply = (result: AdminFullExportResult, superseded: boolean) => {
    if (result.state === 'confirmation_required') {
      setTyped('');
      setState({
        kind: 'confirm',
        requiredConfirmation: result.requiredConfirmation,
        patientCount: result.patientCount,
        notes: result.notes,
        superseded,
      });
      return;
    }
    const { fileName, notice } = describeDownloadName(
      result.download,
      `openrd-patients-${downloadStamp()}-服务端文件名未收到.csv`,
      'full_export',
    );
    saveBlobInBrowser(result.download.blob, fileName);
    setState({ kind: 'done', fileName, notice });
  };

  const run = async (confirmation?: string) => {
    // The buttons are disabled too, but `disabled` is an affordance and
    // this is the behaviour: the server writes an `admin.export` audit
    // row and reads every profile in the database on the way to sending
    // those bytes, so finding out afterwards that this client cannot
    // save a file leaves a trail saying the cohort was exported when
    // nobody received it. The reason is already on screen — the 这里导
    // 不了 block above renders whenever this is false.
    if (!isDownloadSupported()) return;
    setState({ kind: 'loading' });
    try {
      apply(await requestAdminFullPatientCsv(confirmation), confirmation !== undefined);
    } catch (caught) {
      setState({ kind: 'error', error: caught });
    }
  };

  const described = state.kind === 'error' ? describeAdminError(state.error) : null;
  const phraseMatches = state.kind === 'confirm' && typed.trim() === state.requiredConfirmation;

  return (
    <AdminScreen
      title="全量导出"
      subtitle="把全部患者的档案导成一个 CSV 文件。这是这个产品里最危险的一个动作，所以它要你把一句话完整敲一遍。"
      audit={ADMIN_AUDIT_NOTICE_FULL_EXPORT}
      fallbackHref="/p-admin"
    >
      <AdminBlock
        title="这个导出是什么"
        note="每一次导出都会写两条审计记录：一条是这次访问，一条记下导了多少人和文件名。文件名里带时间戳和你的账号 ID。"
        state="ready"
      >
        <View style={styles.field}>
          {/* 「从已上传的基因报告推出来的」 named a document this screen
              cannot see. The autofill reads the one document
              `pickGeneticEvidenceDocument` picks as a profile's genetic
              evidence, and that picker takes a 病历摘要 quoting the
              results when the genetics report read out nothing — so the
              sentence asserted a genetics report behind values belonging
              to patients who have never uploaded one. What the file does
              and does not carry is the same either way, so the clause
              names 已上传的文件 and stops. */}
          <Text style={styles.stateText}>
            导出的是数据库里存着的值。界面上看得到、但其实是从已上传的文件里读出来的那些字段（基因结果和确诊年份），在这个文件里可能是空的。
          </Text>
          <Text style={styles.blockNote}>
            每位患者的明细（每一次肌力测量、每一份报告的内容）不在这个文件里，只有条数。要一位患者的完整文档，用他档案页上的「导出」。
          </Text>
        </View>
      </AdminBlock>

      {!downloadable ? (
        <AdminBlock title="这里导不了" state="ready">
          <Text style={styles.stateText}>{DOWNLOAD_UNSUPPORTED_MESSAGE}</Text>
        </AdminBlock>
      ) : null}

      <AdminBlock title="导出" state="ready">
        {state.kind === 'loading' ? (
          <AdminState kind="loading" message="正在和服务端确认…" />
        ) : null}

        {state.kind === 'idle' ? (
          <View style={styles.field}>
            <Text style={styles.stateText}>
              先问一次服务端这次会导出多少人。这一步不读任何患者数据，只拿到人数和要你敲的那句话。
            </Text>
            <Button
              label="查看规模并取确认口令"
              variant="prominent"
              fullWidth
              disabled={!downloadable}
              onPress={() => void run()}
            />
          </View>
        ) : null}

        {state.kind === 'confirm' ? (
          <>
            {state.superseded ? (
              <Text style={[styles.stateText, styles.statValueAlert]}>
                你上一次确认已经失效了：口令里带着人数和当天日期，人数变了或者过了当地零点就要重新确认。下面是新的。
              </Text>
            ) : null}
            <View style={styles.field}>
              <Text style={styles.statLabel}>这次会导出</Text>
              {state.patientCount === null ? (
                <Text style={styles.statMissing}>服务端没有返回人数。</Text>
              ) : (
                <Text style={styles.statValue}>{`${state.patientCount} 位患者`}</Text>
              )}
            </View>
            {state.notes.map((note) => (
              // The server's own words, not a paraphrase. If it starts
              // saying something new about the file, this screen says it
              // too without anyone remembering to edit it.
              <Text key={note} style={styles.blockNote}>
                {note}
              </Text>
            ))}
            <View style={styles.field}>
              <Text style={styles.statLabel}>把下面这句话完整敲进输入框</Text>
              {/* `selectable={false}` on purpose — see 2 in the header.
                  Absent, this is selectable on the web export. */}
              <Text style={styles.statValue} selectable={false}>
                {state.requiredConfirmation}
              </Text>
              <TextInput
                style={[styles.input, styles.multilineInput]}
                value={typed}
                onChangeText={setTyped}
                multiline
                placeholder="在这里一个字一个字地敲上面那句话"
                placeholderTextColor={COLOR.inkFaint}
                accessibilityLabel="全量导出确认口令"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {typed.trim() && !phraseMatches ? (
                <Text style={styles.blockNote}>还对不上。必须一字不差，包括日期和人数。</Text>
              ) : null}
              <Button
                label="确认导出全部患者"
                variant="prominent"
                fullWidth
                disabled={!phraseMatches || !downloadable}
                onPress={() => void run(state.requiredConfirmation)}
              />
              <Button
                label="取消"
                variant="tinted"
                fullWidth
                onPress={() => {
                  setTyped('');
                  setState({ kind: 'idle' });
                }}
              />
            </View>
          </>
        ) : null}

        {state.kind === 'done' ? (
          <View style={styles.field}>
            <Text style={styles.stateText}>{`已下载 ${state.fileName}`}</Text>
            {state.notice ? <Text style={styles.blockNote}>{state.notice}</Text> : null}
            <Text style={styles.blockNote}>
              这个文件里有全部患者的姓名和手机号，请当成病历本身来保管。再导一次要重新走一遍确认。
            </Text>
            <Button
              label="再导一次"
              variant="tinted"
              fullWidth
              onPress={() => setState({ kind: 'idle' })}
            />
          </View>
        ) : null}

        {state.kind === 'error' && described ? (
          <AdminState
            kind="error"
            title={described.title}
            message={described.message}
            // Retries the SAFE half — the request that reads no patient
            // data and comes back with the phrase. Never the confirmed
            // one: an automatic re-send of a confirmed export is the
            // second copy of the file the confirmation exists to
            // prevent.
            onRetry={() => void run()}
          />
        ) : null}
      </AdminBlock>
    </AdminScreen>
  );
};

export default AdminFullExportScreen;
