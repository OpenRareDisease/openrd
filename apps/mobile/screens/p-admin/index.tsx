import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, Text } from 'react-native';
import { useRouter } from 'expo-router';
import ListGroup, { Row } from '../common/ListGroup';
import {
  getAdminAiUsage,
  getAdminCorpusStatus,
  getAdminHealth,
  getAdminParseFailureQueue,
} from '../../lib/admin-api';
import {
  AdminBlock,
  AdminScreen,
  AdminStat,
  describeWaiting,
  formatCount,
  formatDateTime,
} from './common';
import { useAdminResource } from './use-admin-resource';
import styles from './styles';

/**
 * 后台 · 运维概览 — contract §B4 运维.
 *
 * The four things it answers, in the order an operator asks them:
 * 健康检查 (is anything down), 解析失败队列 (is anyone's report stuck),
 * 语料状态 (does the knowledge base still answer), AI 调用量与失败率.
 *
 * It is not a chart page. Every number here is one an operator would
 * otherwise get by SSHing to the host and running psql, which is the
 * only reason it is worth a screen — and it means every number has to
 * be exactly as true as the psql would have been. That is why a value
 * the server did not send renders as 「服务端没有返回这一项」 rather than
 * as 0, and why the four blocks load independently: this page is
 * opened when something is already wrong.
 */

/** The AI window. 7 days rather than 30 because the question this
 *  block answers is 「现在是不是坏的」; the retention line beside it says
 *  how far back the table can be asked at all. */
const AI_WINDOW_DAYS = 7;

const AdminOverviewScreen = () => {
  const router = useRouter();

  const loadAi = useCallback(() => getAdminAiUsage(AI_WINDOW_DAYS), []);
  const health = useAdminResource(getAdminHealth);
  const queue = useAdminResource(getAdminParseFailureQueue);
  const corpus = useAdminResource(getAdminCorpusStatus);
  const ai = useAdminResource(loadAi);

  // Tracked rather than derived from the four block states: those are
  // all 'loading' on first mount too, and a pull-to-refresh spinner
  // that appears on its own before anyone pulled reads as a page that
  // is stuck.
  const [pulled, setPulled] = useState(false);
  const reloadAll = useCallback(() => {
    setPulled(true);
    health.reload();
    queue.reload();
    corpus.reload();
    ai.reload();
  }, [health, queue, corpus, ai]);

  const allSettled =
    health.state !== 'loading' &&
    queue.state !== 'loading' &&
    corpus.state !== 'loading' &&
    ai.state !== 'loading';
  useEffect(() => {
    if (pulled && allSettled) setPulled(false);
  }, [pulled, allSettled]);

  const queueData = queue.data;
  const corpusData = corpus.data;
  const aiData = ai.data;
  const healthData = health.data;

  return (
    <AdminScreen
      title="运维概览"
      subtitle="下面四块各自独立取数、各自重试。取不到的那一项会说自己取不到，不会显示 0。"
      fallbackHref="/p-home"
      refreshControl={<RefreshControl refreshing={pulled} onRefresh={reloadAll} />}
    >
      <ListGroup title="档案">
        <Row
          icon="users"
          label="患者列表"
          detail="按手机号、患者编号或姓名搜索；列表上的姓名和手机号是打码的"
          onPress={() => router.push('/p-admin_patients')}
        />
        {/* The full export gets its own route rather than a button
            here: this page is opened every morning, and the action
            behind that row writes every patient's name and phone
            number into one file. The row says so, so nobody arrives
            there by accident. */}
        <Row
          icon="file-shield"
          label="全量导出"
          detail="把全部患者导成一个 CSV。要把一句带人数和日期的话完整敲一遍才会开始"
          onPress={() => router.push('/p-admin_export')}
        />
      </ListGroup>

      <AdminBlock
        title="健康检查"
        note="和 /api/healthz 同一份结果，但没有对匿名调用者做的那层删减——组件的 detail 只在后台这条路上看得到。"
        state={health.state}
        error={health.error}
        onRetry={health.reload}
      >
        {healthData ? (
          <>
            <AdminStat
              first
              label="总体状态"
              value={healthData.status}
              alert={healthData.status !== 'ok'}
              detail={
                healthData.draining
                  ? '这个实例正在退出（draining）：组件都还好，但它已经不该再接新流量。'
                  : healthData.ready === null
                    ? null
                    : healthData.ready
                      ? '就绪，可以接流量'
                      : '未就绪：负载均衡应该把它摘掉'
              }
            />
            {healthData.components.length === 0 ? (
              <AdminStat label="组件" value={null} />
            ) : (
              healthData.components.map((component) => (
                <AdminStat
                  key={component.name}
                  label={component.name}
                  value={component.status}
                  alert={component.status !== 'ok' && component.status !== 'configured'}
                  detail={component.detail}
                />
              ))
            )}
          </>
        ) : null}
      </AdminBlock>

      <AdminBlock
        title="解析失败队列"
        note="包含状态是 parse_failed / failed 的报告，以及卡在 processing 超过下面那个分钟数的——后者没有任何东西标记过它，患者那一侧只是一直转圈。"
        state={queue.state}
        error={queue.error}
        onRetry={queue.reload}
      >
        {queueData ? (
          <>
            <AdminStat
              first
              label="待处理"
              value={formatCount(queueData.items.length)}
              alert={queueData.items.length > 0}
              detail={
                queueData.atCap
                  ? `列表被截断在 ${queueData.limit ?? '上限'} 条，真实积压只多不少。`
                  : queueData.stuckAfterMinutes === null
                    ? null
                    : `「卡住」的判定：uploaded_at 超过 ${queueData.stuckAfterMinutes} 分钟。`
              }
            />
            {queueData.items.length === 0 ? (
              <Text style={styles.blockNote}>队列是空的。</Text>
            ) : (
              queueData.items.map((item) => (
                <Pressable
                  key={item.documentId}
                  style={({ pressed }) => [
                    styles.historyRow,
                    styles.statDivider,
                    styles.queueRow,
                    pressed && item.userId ? styles.queueRowPressed : null,
                  ]}
                  // A stuck report belongs to a person, and the next
                  // thing an operator does with one is find out whose
                  // it is. Disabled rather than silently inert when the
                  // server did not send the owner.
                  disabled={!item.userId}
                  onPress={() => {
                    if (item.userId) router.push(`/p-admin_patient?userId=${item.userId}`);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`打开这份报告所属患者的档案：${item.documentType ?? '未标类型'}`}
                  accessibilityState={{ disabled: !item.userId }}
                  aria-disabled={!item.userId}
                >
                  <Text style={styles.historyTitle}>{item.documentType ?? '未标类型'}</Text>
                  <Text style={styles.historyMeta}>
                    {[
                      item.status,
                      formatDateTime(item.uploadedAt),
                      describeWaiting(item.uploadedAt),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  {/* The document id, not the title or the file name:
                      the service does not send those on purpose (both
                      are patient-typed and routinely hold a name or a
                      hospital), and an id is what acting on the row
                      needs anyway. */}
                  <Text style={styles.historyMeta}>{item.documentId}</Text>
                  {item.userId ? null : (
                    <Text style={styles.historyMeta}>
                      服务端没有返回这份报告属于谁，这一行打不开档案。
                    </Text>
                  )}
                </Pressable>
              ))
            )}
          </>
        ) : null}
      </AdminBlock>

      <AdminBlock
        title="语料状态"
        note="AI 问答的检索底座。没有 embedding 的分块在库里但检索永远取不到它，KB 服务自己的 /health/ready 也不会报。"
        state={corpus.state}
        error={corpus.error}
        onRetry={corpus.reload}
      >
        {corpusData ? (
          <>
            <AdminStat first label="分块" value={formatCount(corpusData.chunkCount, '段')} />
            <AdminStat label="来源文件" value={formatCount(corpusData.sourceFileCount, '个')} />
            <AdminStat
              label="没有 embedding 的分块"
              value={formatCount(corpusData.unembeddedChunkCount, '段')}
              alert={(corpusData.unembeddedChunkCount ?? 0) > 0}
            />
            <AdminStat
              label="embedding 模型"
              value={
                corpusData.embedModels.length === 0
                  ? null
                  : corpusData.embedModels
                      .map((entry) => `${entry.embedModel}（${entry.chunkCount} 段）`)
                      .join('\n')
              }
              alert={corpusData.embedModels.length > 1}
              detail={
                corpusData.embedModels.length > 1
                  ? '同时存在多个模型，说明有一次重新入库没跑完。跨模型的向量距离不可比，这段时间的检索质量是未定义的，不只是变差。'
                  : null
              }
            />
            <AdminStat
              label="最近更新"
              value={formatDateTime(corpusData.newestUpdatedAt)}
              detail={
                corpusData.oldestUpdatedAt
                  ? `最早一条：${formatDateTime(corpusData.oldestUpdatedAt)}`
                  : null
              }
            />
          </>
        ) : null}
      </AdminBlock>

      <AdminBlock
        title="AI 调用量与失败率"
        note={`统计窗口 ${AI_WINDOW_DAYS} 天。`}
        state={ai.state}
        error={ai.error}
        onRetry={ai.reload}
      >
        {aiData ? (
          <>
            <AdminStat
              first
              label={
                aiData.windowDays === null ? '调用总数' : `调用总数（${aiData.windowDays} 天内）`
              }
              value={formatCount(aiData.totalCalls, '次')}
              detail={
                aiData.retentionDays === null
                  ? null
                  : `ai_prompt_audit 保留 ${aiData.retentionDays} 天，再往前的调用已经被清掉了——窗口拉长也看不到。`
              }
            />
            <AdminStat
              label="失败率"
              value={
                aiData.failureRate === null ? null : `${(aiData.failureRate * 100).toFixed(1)}%`
              }
              alert={(aiData.failureRate ?? 0) > 0.05}
              detail={
                aiData.failureRate === null
                  ? '窗口内没有成功也没有失败的调用，0/0 不是 0%。'
                  : '分母只算成功和失败两种。consent_denied 不在里面：那是同意闸门在正常工作，算进失败率会让一个隐私控制看起来像故障。'
              }
            />
            {aiData.byStatus.map((entry) => (
              <AdminStat
                key={entry.status}
                label={entry.status}
                value={formatCount(entry.calls, '次')}
                detail={entry.avgLatencyMs === null ? null : `平均 ${entry.avgLatencyMs} ms`}
              />
            ))}
          </>
        ) : null}
      </AdminBlock>
    </AdminScreen>
  );
};

export default AdminOverviewScreen;
