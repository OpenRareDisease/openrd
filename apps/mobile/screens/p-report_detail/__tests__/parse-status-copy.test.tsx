/**
 * 报告详情 is now the only screen that tells a patient how to correct a
 * value read off a report. The passport family states the value and
 * where it came from and stops there, because it cannot see the
 * document's status and so cannot know whether any instruction it gave
 * would work. This screen renders from the document row and does know.
 *
 * That makes the status branching load-bearing rather than cosmetic:
 * every sentence here is read by someone deciding what to do next, and
 * a sentence that is true for `parsed` and false for `uploaded` is a
 * sentence this screen has no excuse for. So each status is rendered
 * and read back — the control that is drawn, and the words around it.
 *
 * The rules being pinned:
 *
 *   1. The control drawn is one the server accepts. 修正 is drawn
 *      exactly where the OCR PATCH is allowed (parsed / needs_review);
 *      重新识别 is never drawn where the reparse endpoint would refuse
 *      it — a failed parse, a row the pipeline never settled, a job we
 *      stopped watching, a parse that yielded nothing.
 *
 *   2. It is drawn for FEWER rows than the server would accept, and
 *      the tests below say which and why: the request blanks
 *      ocr_payload before re-running, so a row whose payload is still
 *      holding values is offered nothing rather than an action that
 *      destroys them. The values in question are frequently ones this
 *      screen has no row for and the passport prints, which is why the
 *      question is asked of the payload and not of the table.
 *
 *   3. A status that offers no control says when to come back, and
 *      never states a conclusion about the report's contents that the
 *      pipeline has not actually reached.
 */

import TestRenderer, { act } from 'react-test-renderer';

const mockGetOcr = jest.fn();
const mockPatchOcr = jest.fn();
const mockReparse = jest.fn();

jest.mock('../../../lib/api', () => {
  class ApiError extends Error {
    status?: number;
    data?: unknown;
  }
  return {
    __esModule: true,
    ApiError,
    deletePatientDocument: jest.fn(),
    getPatientDocumentOcr: (...args: unknown[]) => mockGetOcr(...args),
    getMyConsent: jest.fn(async () => ({ level: 'none' })),
    generatePatientDocumentSummary: jest.fn(),
    patchPatientDocumentOcr: (...args: unknown[]) => mockPatchOcr(...args),
    reparsePatientDocument: (...args: unknown[]) => mockReparse(...args),
    updateMyConsent: jest.fn(),
  };
});

// lib/consent-epoch reaches AsyncStorage at module load, and jest-expo
// has no native module for it. Nothing here changes consent.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async () => null,
  setItem: async () => undefined,
  removeItem: async () => undefined,
}));

jest.mock('@expo/vector-icons', () => ({ FontAwesome6: 'FontAwesome6' }));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      React.createElement('SafeAreaView', null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ documentId: 'doc-1' }),
}));

jest.mock('../../common/feedback/AppDialog', () => ({
  __esModule: true,
  useAppDialog: () => ({ notify: jest.fn(), confirm: jest.fn(async () => true) }),
}));

import { ApiError } from '../../../lib/api';
import ReportDetailScreen from '../index';

type Doc = {
  status: string;
  ocrPayload: { fields: Record<string, string>; provider?: string; extractedText?: string } | null;
};

// A `processing` document leaves a live poller behind, so every tree
// is torn down after its test — otherwise the 2s re-poll outlives the
// suite and jest never exits.
const mounted: TestRenderer.ReactTestRenderer[] = [];

const render = async (doc: Doc) => {
  mockGetOcr.mockResolvedValue({ documentId: 'doc-1', ...doc });
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<ReportDetailScreen />);
  });
  mounted.push(tree);
  return tree;
};

/** Every string the patient can read, flattened. */
const readable = (tree: TestRenderer.ReactTestRenderer): string => {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    walk((node as { children?: unknown }).children ?? []);
  };
  walk(tree.toJSON());
  return out.join(' | ');
};

/** A control the patient can actually press, found by the name it
 *  announces — Button takes `label`, InlineNotice's retry announces
 *  through `accessibilityLabel`. */
const control = (tree: TestRenderer.ReactTestRenderer, name: string) =>
  tree.root.findAll(
    (node) =>
      typeof node.props?.onPress === 'function' &&
      (node.props?.label === name || node.props?.accessibilityLabel === name),
  )[0];

/** One input box in the correction sheet, by the label it announces. */
const box = (tree: TestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) => node.props?.accessibilityLabel === label && node.props?.onChangeText,
  )[0];

const CORRECT = '识别有误？手动修正';
const REPARSE = '重新识别';
const START = '开始识别';
const RELOAD = '重新加载';

const fieldsFor = (extra: Record<string, string> = {}) => ({
  fieldCount: String(Object.keys(extra).length),
  ...extra,
});

afterEach(async () => {
  for (const tree of mounted.splice(0)) {
    await act(async () => {
      tree.unmount();
    });
  }
  mockGetOcr.mockReset();
  mockPatchOcr.mockReset();
  mockReparse.mockReset();
});

describe('每种状态画出的控件，就是服务端会接受的那个', () => {
  it('parsed：可以修正，没有一个多余的「重新识别」', async () => {
    const tree = await render({
      status: 'parsed',
      ocrPayload: { fields: fieldsFor({ diagnosisType: 'FSHD1' }) },
    });
    expect(control(tree, CORRECT)).toBeDefined();
    expect(control(tree, REPARSE)).toBeUndefined();
    expect(control(tree, START)).toBeUndefined();
  });

  it('needs_review：待核对同样是服务端接受修正的状态', async () => {
    const tree = await render({
      status: 'needs_review',
      ocrPayload: { fields: fieldsFor({ d4z4Repeats: '4' }) },
    });
    expect(control(tree, CORRECT)).toBeDefined();
    expect(readable(tree)).toContain('待核对');
  });

  it('parse_failed：只画重新识别，绝不画一个会被 409 拒掉的修正入口', async () => {
    const tree = await render({ status: 'parse_failed', ocrPayload: null });
    expect(control(tree, REPARSE)).toBeDefined();
    // The OCR PATCH refuses anything that is not parsed / needs_review.
    // Drawing 修正 here was drawing a button whose only outcome is an
    // error message.
    expect(control(tree, CORRECT)).toBeUndefined();
  });

  it('processing：什么都不画，但说清楚什么时候回来', async () => {
    const tree = await render({ status: 'processing', ocrPayload: null });
    expect(control(tree, CORRECT)).toBeUndefined();
    expect(control(tree, REPARSE)).toBeUndefined();
    const text = readable(tree);
    // A status that offers nothing has to say so, or the patient is
    // left hunting for a button that is deliberately absent.
    expect(text).toContain('通常需要 1-2 分钟');
    expect(text).toContain('识别完成后这里会自动更新');
  });

  it('uploaded：不再宣布报告里没东西，并且给出服务端确实接受的那个动作', async () => {
    const tree = await render({ status: 'uploaded', ocrPayload: null });
    const text = readable(tree);

    // The whole defect: nothing had ever been parsed, and the screen
    // reported the conclusion of a parse that never ran. Reachable on
    // any deployment with OCR switched off.
    expect(text).not.toContain('暂无识别出的关键指标');
    expect(text).toContain('还没有识别过');

    // The reparse endpoint accepts 'uploaded'. The screen used to draw
    // no control at all for it.
    expect(control(tree, START)).toBeDefined();
    expect(control(tree, CORRECT)).toBeUndefined();
  });

  it('uploaded：按下「开始识别」真的会去调那个接口', async () => {
    mockReparse.mockResolvedValue({ documentId: 'doc-1', status: 'processing' });
    const tree = await render({ status: 'uploaded', ocrPayload: null });
    await act(async () => {
      control(tree, START).props.onPress();
    });
    expect(mockReparse).toHaveBeenCalledWith('doc-1');
  });

  it('识别完成却什么也没取到：两条路都在，因为服务端两条都收', async () => {
    const tree = await render({ status: 'parsed', ocrPayload: { fields: { fieldCount: '0' } } });
    expect(control(tree, REPARSE)).toBeDefined();
    expect(control(tree, CORRECT)).toBeDefined();
    expect(readable(tree)).toContain('这次识别没有取到报告里的具体数据');
  });

  it('只认出了报告类型：还是给重新识别，说的也只是没取到数据', async () => {
    // What a parse that classified the file and extracted nothing
    // actually leaves behind. The re-run exists for these rows, so the
    // type label must not read as evidence and withhold it — and the
    // sentence has to stay true with the 识别类型 row visible right
    // under it, which is why it is about the report's data and not
    // about 「任何结果」.
    const tree = await render({
      status: 'parsed',
      ocrPayload: {
        fields: { fieldCount: '0', classifiedType: 'genetic_report', reportTypeLabel: '基因报告' },
      },
    });
    const text = readable(tree);
    expect(text).toContain('识别类型');
    expect(text).toContain('基因报告');
    expect(text).toContain('这次识别没有取到报告里的具体数据');
    expect(control(tree, REPARSE)).toBeDefined();
  });

  it('取到了值、只是没记数：不对着满屏数值说没取到数据', async () => {
    // The server's eligibility test reads the pipeline's own count, so
    // a payload without one satisfies it. The sentence that goes with
    // the button does not survive the reader looking at their own
    // haplotype directly above it, so the offer is withheld.
    const tree = await render({
      status: 'parsed',
      ocrPayload: { fields: { d4z4Repeats: '4', haplotype: '4qA' } },
    });
    const text = readable(tree);
    expect(text).toContain('4qA');
    expect(text).not.toContain('没有取到报告里的具体数据');
    expect(control(tree, REPARSE)).toBeUndefined();
  });

  it('护照正在印、这张表却没有对应行的值：仍然不算「没取到」', async () => {
    // 诊断日期 and 检测方法 have no row in the table on this screen and
    // are both read straight off this payload by the passport. A guard
    // derived from the rows drawn here calls this report empty, offers
    // 重新识别, and that request blanks ocr_payload before re-running —
    // so the passport stops printing a diagnosis date because a screen
    // that never displayed it decided nothing was there.
    const tree = await render({
      status: 'parsed',
      ocrPayload: {
        fields: {
          fieldCount: '0',
          diagnosisDate: '2019-05-01',
          geneticTestMethod: 'southern_blot',
        },
      },
    });
    const text = readable(tree);
    expect(text).not.toContain('2019-05-01');
    expect(text).not.toContain('没有取到报告里的具体数据');
    expect(control(tree, REPARSE)).toBeUndefined();
  });

  it('uploaded 但解析已经跑过：不说它没开始，也不叫它「开始识别」', async () => {
    // Every provider that files no analysisStatus lands its result
    // here: the row keeps 'uploaded' and carries a payload. 「还没有开
    // 始识别」 under a 开始识别 button sent the patient to start a parse
    // that had already run, and the re-run put the row back in exactly
    // this state — with nothing on the page admitting the round trip.
    const tree = await render({
      status: 'uploaded',
      ocrPayload: {
        provider: 'baidu',
        extractedText: '报告正文',
        fields: { documentType: 'genetic_report' },
      },
    });
    const text = readable(tree);
    expect(text).not.toContain('还没有开始识别');
    expect(text).not.toContain('还没有识别过');
    expect(text).toContain('这份报告识别过一次，没有取到报告里的具体数据');
    // And it does not promise the re-run will end differently.
    expect(text).toContain('再识别一次可能仍是这个结果');
    expect(control(tree, START)).toBeUndefined();
    expect(control(tree, REPARSE)).toBeDefined();
  });

  it('这份报告根本没读到：不冒充任何一种解析状态', async () => {
    // No row, therefore no status, therefore nothing to offer. The
    // failure is about the fetch, and every sentence on the page has
    // to stay off the subject of what the report contains.
    mockGetOcr.mockRejectedValue(new ApiError('网络异常'));
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ReportDetailScreen />);
    });
    mounted.push(tree);

    const text = readable(tree);
    expect(text).toContain('暂时读不到这份报告');
    expect(text).not.toContain('还没有识别过');
    expect(text).not.toContain('没有取到报告里的具体数据');
    // Including the one it used to impersonate by accident: with no
    // row read, the status expression fell through to the literal
    // 'unknown' and the chip printed it.
    expect(text).not.toContain('unknown');
    expect(control(tree, REPARSE)).toBeUndefined();
    expect(control(tree, START)).toBeUndefined();
    expect(control(tree, CORRECT)).toBeUndefined();
    // And the failure is recoverable without leaving the screen.
    expect(control(tree, RELOAD)).toBeDefined();
  });

  it.each([
    ['parsed', '识别完成'],
    ['needs_review', '待核对'],
    ['processing', '识别中'],
    ['parse_failed', '识别失败'],
    ['uploaded', '待识别'],
  ])('%s：读到了行，所以照旧画出它的状态', async (status, label) => {
    // The chip is drawn only where a status was actually read. This
    // is the other side of that rule: every status the pipeline can
    // put on a row still gets its own Chinese label.
    const tree = await render({ status, ocrPayload: null });
    expect(readable(tree)).toContain(label);
  });

  it('uploaded 但解析取到了值：不动它', async () => {
    // A legacy row the pipeline never labelled, holding real values.
    // 重新识别 blanks the payload first, so the only safe offer is none
    // — and 「还没有识别过」 would be denying a parse that plainly ran.
    const tree = await render({
      status: 'uploaded',
      ocrPayload: { fields: { haplotype: '4qA' } },
    });
    const text = readable(tree);
    expect(text).toContain('4qA');
    expect(text).not.toContain('还没有识别过');
    expect(text).not.toContain('没有取到报告里的具体数据');
    expect(control(tree, REPARSE)).toBeUndefined();
    expect(control(tree, START)).toBeUndefined();
  });
});

describe('等到我们自己放弃轮询为止', () => {
  // The tenth state, and the only one the screen decides for itself:
  // the row still says processing and we have stopped watching. It is
  // rendered here rather than reasoned about, because it is the one
  // input to the offer that the server does not agree with by
  // construction.
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('轮询超时：换一句话，并且给出重新识别', async () => {
    const tree = await render({ status: 'processing', ocrPayload: null });
    expect(readable(tree)).toContain('通常需要 1-2 分钟');

    // First tick lands inside the window and re-arms; the second finds
    // the ten minutes gone.
    await act(async () => {
      jest.advanceTimersByTime(1200);
    });
    await act(async () => {
      jest.advanceTimersByTime(11 * 60 * 1000);
    });

    const text = readable(tree);
    expect(text).toContain('识别时间超出预期');
    // The 「稍等一下」 line belongs to a screen that is still watching.
    expect(text).not.toContain('正在识别，稍等一下');
    expect(control(tree, REPARSE)).toBeDefined();
  });
});

/**
 * WHEN THE RE-READ IS THE THING THAT FAILS.
 *
 * 重新识别 hands the screen back to the load effect, and both of its
 * exits do: on success because the row is now processing and something
 * has to watch it, on failure because a refusal is usually the server
 * saying the job is still running and the screen had stopped looking.
 * Both therefore depend on a read that can itself fail, and the
 * failure path used to keep the last status it had read.
 *
 * That is what stranded the screen: the effect clears the poll-timeout
 * on the way in, so the row's stale 「processing」 came back without the
 * timeout that had been offering 重新识别 — a spinner, a chip reading
 * 识别中 and a line promising the page would update itself, with no
 * poll armed, no control drawn and no way to ask again. Every sentence
 * in that state was drawn from a status the screen no longer had any
 * evidence for.
 *
 * Both exits are driven here, because they leave different stale
 * statuses behind and only one of them is reachable by tapping.
 */
describe('重新识别之后连读行都读不到了', () => {
  const renderThenFail = async (first: Doc, reparse: () => Promise<unknown>) => {
    mockGetOcr.mockResolvedValue({ documentId: 'doc-1', ...first });
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ReportDetailScreen />);
    });
    mounted.push(tree);
    mockReparse.mockImplementation(reparse);
    mockGetOcr.mockRejectedValue(new ApiError('网络异常'));
    await act(async () => {
      control(tree, REPARSE).props.onPress();
    });
    return tree;
  };

  it('重新识别成功、紧接着连接断了：不再演一个没人在看的识别中', async () => {
    const tree = await renderThenFail({ status: 'parse_failed', ocrPayload: null }, async () => ({
      documentId: 'doc-1',
      status: 'processing',
    }));
    const text = readable(tree);
    // The status the tap wrote locally, which nothing has since
    // confirmed. Every one of these is drawn from it.
    expect(text).not.toContain('识别中');
    expect(text).not.toContain('识别进行中');
    expect(text).not.toContain('正在识别这份报告');
    expect(text).not.toContain('识别完成后这里会自动更新');
    // What did happen.
    expect(text).toContain('网络异常');
    expect(text).toContain('暂时读不到这份报告');
    expect(control(tree, RELOAD)).toBeDefined();
  });

  it('重新识别被拒、再读也读不到：旧状态一起走，不留一个空转的页面', async () => {
    const tree = await renderThenFail({ status: 'parse_failed', ocrPayload: null }, async () => {
      throw new ApiError('该报告正在识别中，请稍候');
    });
    const text = readable(tree);
    // The refusal is still reported — it is the server's answer and
    // the patient asked for it.
    expect(text).toContain('该报告正在识别中，请稍候');
    // But the row's own status is no longer asserted, in either
    // direction: not the 识别失败 that was on the page before the tap,
    // and not a 识别中 inferred from the refusal.
    expect(text).not.toContain('识别失败');
    expect(text).not.toContain('识别中，通常需要');
    expect(text).toContain('暂时读不到这份报告');
    expect(control(tree, RELOAD)).toBeDefined();
  });

  it('重新加载：真的再读一次，读到了就照读到的画', async () => {
    const tree = await renderThenFail({ status: 'parse_failed', ocrPayload: null }, async () => ({
      documentId: 'doc-1',
      status: 'processing',
    }));
    mockGetOcr.mockResolvedValue({
      documentId: 'doc-1',
      status: 'parsed',
      ocrPayload: { fields: fieldsFor({ haplotype: '4qA' }) },
    });
    await act(async () => {
      control(tree, RELOAD).props.onPress();
    });
    const text = readable(tree);
    expect(text).toContain('识别完成');
    expect(text).toContain('4qA');
    expect(text).not.toContain('暂时读不到这份报告');
    expect(control(tree, CORRECT)).toBeDefined();
  });
});

describe('没有一种状态还在用那句和稀泥的话', () => {
  it.each([
    ['parsed', { status: 'parsed', ocrPayload: { fields: fieldsFor({ haplotype: '4qA' }) } }],
    ['parse_failed', { status: 'parse_failed', ocrPayload: null }],
    ['processing', { status: 'processing', ocrPayload: null }],
    ['uploaded', { status: 'uploaded', ocrPayload: null }],
  ] as Array<[string, Doc]>)('%s 不出现「或仍在识别中」', async (_name, doc) => {
    const tree = await render(doc);
    // The hedge covered states this screen can tell apart, and was
    // wrong wherever the parse was not in fact still running.
    expect(readable(tree)).not.toContain('或仍在识别中');
  });
});

/**
 * AN AI SUMMARY IS NOT SOMETHING READ OFF THE REPORT.
 *
 * `generateDocumentSummary` writes its result back into the very same
 * `fields` record the parse writes into, and it writes more than the
 * sentence: also which producer wrote it — the model, or the
 * rule-based fallback used when the model call fails — and the hash of
 * the prompt the sentence is cached against. This screen asks that
 * record 「is there anything here a re-run would destroy」, and the
 * bookkeeping list knew the sentence and not its two companions.
 *
 * So a report the extractor came away from empty stopped looking empty
 * the moment a summary was written for it, and the re-run was
 * withdrawn from exactly the rows it exists for — together with the
 * sentence that explains why they are empty. It is the ordinary end
 * state, not an exotic one: with AI consent granted the summary
 * generates itself the moment the parse settles, and the fallback
 * guarantees one lands even when the model call fails, so an empty
 * parse acquires its own alibi without the patient doing anything.
 *
 * Every status is rendered against a payload holding nothing but that
 * block, because the question 「does this count as evidence」 is asked
 * on two of the branches and has to be answered the same way on both.
 */
describe('AI 总结不是从报告里读出来的东西', () => {
  /** What an empty parse plus one generated summary actually leaves in
   *  `fields`. The three keys are written together by one request. */
  const summaryOnly = () => ({
    fieldCount: '0',
    aiSummary: '这是一份基因检测报告，未能提取到结构化指标。',
    aiSummarySource: 'fallback',
    aiSummaryInputHash: 'a1b2c3d4e5f60718',
  });

  it('识别完成却只留下一条总结：重新识别没有被它顶掉', async () => {
    const tree = await render({ status: 'parsed', ocrPayload: { fields: summaryOnly() } });
    const text = readable(tree);
    expect(text).toContain('这次识别没有取到报告里的具体数据');
    expect(control(tree, REPARSE)).toBeDefined();
  });

  it('uploaded 且只留下一条总结：同样算没取到数据', async () => {
    const tree = await render({ status: 'uploaded', ocrPayload: { fields: summaryOnly() } });
    const text = readable(tree);
    expect(text).toContain('这份报告识别过一次，没有取到报告里的具体数据');
    expect(control(tree, REPARSE)).toBeDefined();
    expect(control(tree, START)).toBeUndefined();
  });

  it('parse_failed 上还挂着一条总结：照旧只画重新识别', async () => {
    const tree = await render({ status: 'parse_failed', ocrPayload: { fields: summaryOnly() } });
    expect(control(tree, REPARSE)).toBeDefined();
    expect(control(tree, CORRECT)).toBeUndefined();
  });

  it('processing：仍然什么都不画，因为这一份还在跑', async () => {
    const tree = await render({ status: 'processing', ocrPayload: { fields: summaryOnly() } });
    expect(control(tree, REPARSE)).toBeUndefined();
    expect(readable(tree)).toContain('识别完成后这里会自动更新');
  });

  it('needs_review：服务端不收这个状态的重识别，所以这里也不画', async () => {
    // Not a consequence of the summary — the reparse endpoint refuses
    // `needs_review` outright. Rendered so the summary cannot be
    // blamed for an absence it did not cause.
    const tree = await render({ status: 'needs_review', ocrPayload: { fields: summaryOnly() } });
    expect(control(tree, REPARSE)).toBeUndefined();
    expect(control(tree, CORRECT)).toBeDefined();
  });

  it('总结还是照常显示：被排除的只是「它算不算报告里的数据」', async () => {
    const tree = await render({ status: 'parsed', ocrPayload: { fields: summaryOnly() } });
    expect(readable(tree)).toContain('未能提取到结构化指标');
  });

  it('真取到了值、旁边也挂着一条总结：这一份才是要保住的', async () => {
    // The other direction of the same guard. The re-run blanks the
    // payload, so a row holding a real reading is offered nothing —
    // and the summary beside it must not change that answer either.
    const tree = await render({
      status: 'parsed',
      ocrPayload: { fields: { ...summaryOnly(), d4z4Repeats: '4/22' } },
    });
    const text = readable(tree);
    expect(text).toContain('4/22');
    expect(text).not.toContain('没有取到报告里的具体数据');
    expect(control(tree, REPARSE)).toBeUndefined();
  });
});

describe('修正面板收得下四项基因结果，也认得出解析实际写下的拼写', () => {
  const openSheet = async (tree: TestRenderer.ReactTestRenderer) => {
    await act(async () => {
      control(tree, CORRECT).props.onPress();
    });
    return tree.root
      .findAll((node) => node.props?.placeholder !== undefined && node.props?.accessibilityLabel)
      .map((node) => [node.props.accessibilityLabel as string, node.props.value as string]);
  };

  it('解析一个值都没给，四项基因结果照样各有一个能填的框', async () => {
    const tree = await render({ status: 'parsed', ocrPayload: { fields: { fieldCount: '0' } } });
    const rows = await openSheet(tree);
    const labels = rows.map(([label]) => label);
    // 甲基化 is the one that keeps going missing: a report that never
    // reported it still needs somewhere to type it, not merely
    // somewhere to correct it.
    for (const label of ['FSHD 分型', 'D4Z4 重复数', '单倍型', '甲基化']) {
      expect(labels).toContain(label);
    }
    expect(rows.every(([, value]) => value === '')).toBe(true);
  });

  it('面板里的值，就是上面那张表显示的值', async () => {
    // The parser writes the snake_case spelling, which is why every
    // other reader in the codebase carries both. The sheet read only
    // the camelCase one and opened with an empty 甲基化 box directly
    // under a row reading 甲基化值 12%.
    const tree = await render({
      status: 'parsed',
      ocrPayload: {
        fields: { fieldCount: '3', methylation_value: '12%', diagnosis_type: 'FSHD1' },
      },
    });
    expect(readable(tree)).toContain('12%');
    const rows = Object.fromEntries(await openSheet(tree));
    expect(rows['甲基化']).toBe('12%');
    expect(rows['FSHD 分型']).toBe('FSHD1');
  });

  it('单倍型的拼写：表和面板认的是同一串别名', async () => {
    // The spelling the passport and the profile autofill both read.
    // The sheet had it and the table did not, so the sheet showed a
    // 单倍型 the screen behind it had no row for — one payload, two
    // readers, two answers about whether the value exists.
    const tree = await render({
      status: 'parsed',
      ocrPayload: { fields: { fieldCount: '1', haplotype_4q: '4qA' } },
    });
    expect(readable(tree)).toContain('4qA');
    const rows = Object.fromEntries(await openSheet(tree));
    expect(rows['单倍型']).toBe('4qA');
  });

  it('只提这份报告，不替档案许诺它并不会做的事', async () => {
    const tree = await render({
      status: 'parsed',
      ocrPayload: { fields: fieldsFor({ haplotype: '4qA' }) },
    });
    await act(async () => {
      control(tree, CORRECT).props.onPress();
    });
    const text = readable(tree);
    // The autofill reads the one document the API picks as this
    // profile's genetic evidence and fills only the fields still
    // blank; the manual-edit stamp this save writes has no reader.
    // Whether a correction reaches the profile therefore turns on
    // which document that is, which this sheet cannot see — so it
    // promises nothing about the profile in either direction.
    expect(text).not.toContain('优先使用你修正的值');
    expect(text).toContain('写回这份报告的识别结果');
  });

  it('清空一个已识别的值：说清楚为什么没保存，而不是说你什么都没改', async () => {
    const tree = await render({
      status: 'parsed',
      ocrPayload: { fields: fieldsFor({ methylationValue: '12%' }) },
    });
    await act(async () => {
      control(tree, CORRECT).props.onPress();
    });
    await act(async () => {
      box(tree, '甲基化').props.onChangeText('');
    });
    await act(async () => {
      await control(tree, '保存修正').props.onPress();
    });
    const text = readable(tree);
    expect(text).not.toContain('没有需要保存的修改');
    expect(text).toContain('甲基化不能清空');
    expect(mockPatchOcr).not.toHaveBeenCalled();
  });

  it('清空一个值、同时改另一个：一样拦下来，不是悄悄把清空丢掉', async () => {
    // The other half of the same defect, and it failed the opposite
    // way: with a second edit in the patch the blank simply vanished —
    // the sheet closed, the save reported success, and the value the
    // patient had deleted was still on the screen behind it. Both
    // paths now refuse, and the refusal keeps what was typed.
    const tree = await render({
      status: 'parsed',
      ocrPayload: { fields: fieldsFor({ methylationValue: '12%', haplotype: '4qA' }) },
    });
    await act(async () => {
      control(tree, CORRECT).props.onPress();
    });
    await act(async () => {
      box(tree, '甲基化').props.onChangeText('');
    });
    await act(async () => {
      box(tree, '单倍型').props.onChangeText('4qB');
    });
    await act(async () => {
      await control(tree, '保存修正').props.onPress();
    });

    expect(mockPatchOcr).not.toHaveBeenCalled();
    const text = readable(tree);
    expect(text).toContain('甲基化不能清空');
    // Still open, still holding the edit that was fine — closing here
    // would throw away the correction the patient did want.
    expect(box(tree, '单倍型').props.value).toBe('4qB');
    expect(box(tree, '甲基化').props.value).toBe('');
  });

  it('清空两个值：两个都点名', async () => {
    const tree = await render({
      status: 'parsed',
      ocrPayload: { fields: fieldsFor({ methylationValue: '12%', haplotype: '4qA' }) },
    });
    await act(async () => {
      control(tree, CORRECT).props.onPress();
    });
    await act(async () => {
      box(tree, '甲基化').props.onChangeText('');
    });
    await act(async () => {
      box(tree, '单倍型').props.onChangeText('   ');
    });
    await act(async () => {
      await control(tree, '保存修正').props.onPress();
    });
    expect(mockPatchOcr).not.toHaveBeenCalled();
    expect(readable(tree)).toContain('单倍型、甲基化不能清空');
  });

  it('把自己刚打的字删掉：那不是清空，档案里本来就没有这个值', async () => {
    // The blank is measured against what the parse produced, not
    // against the box. A field the report never carried is empty
    // before and after, so backing out of typing into one is simply
    // no edit — the refusal is for deleting a value that exists.
    const tree = await render({
      status: 'parsed',
      ocrPayload: { fields: fieldsFor({ haplotype: '4qA' }) },
    });
    await act(async () => {
      control(tree, CORRECT).props.onPress();
    });
    await act(async () => {
      box(tree, '甲基化').props.onChangeText('12%');
    });
    await act(async () => {
      box(tree, '甲基化').props.onChangeText('');
    });
    await act(async () => {
      await control(tree, '保存修正').props.onPress();
    });
    const text = readable(tree);
    expect(text).not.toContain('不能清空');
    expect(text).toContain('没有需要保存的修改');
    expect(mockPatchOcr).not.toHaveBeenCalled();
  });

  it('什么都没动：这句话仍然只留给真的什么都没动', async () => {
    const tree = await render({
      status: 'parsed',
      ocrPayload: { fields: fieldsFor({ haplotype: '4qA' }) },
    });
    await act(async () => {
      control(tree, CORRECT).props.onPress();
    });
    await act(async () => {
      await control(tree, '保存修正').props.onPress();
    });
    expect(readable(tree)).toContain('没有需要保存的修改');
    expect(mockPatchOcr).not.toHaveBeenCalled();
  });

  it('保存时状态被抢走：说它在重新识别，不叫患者去「完成识别」', async () => {
    const conflict = new ApiError('当前状态不支持修正识别结果');
    (conflict as ApiError & { status?: number }).status = 409;
    mockPatchOcr.mockRejectedValue(conflict);

    const tree = await render({
      status: 'parsed',
      ocrPayload: { fields: fieldsFor({ haplotype: '4qA' }) },
    });
    await act(async () => {
      control(tree, CORRECT).props.onPress();
    });
    await act(async () => {
      box(tree, '单倍型').props.onChangeText('4qB');
    });
    const loadsBefore = mockGetOcr.mock.calls.length;
    await act(async () => {
      await control(tree, '保存修正').props.onPress();
    });

    const text = readable(tree);
    // 「请先完成识别」 asked the patient to finish something they have
    // no control over, and was simply false if the reparse that took
    // the row had already failed.
    expect(text).not.toContain('请先完成识别');
    expect(text).toContain('重新开始识别');
    // And the screen goes back to reading the row, so whatever it says
    // now is what gets drawn.
    expect(mockGetOcr.mock.calls.length).toBeGreaterThan(loadsBefore);
  });
});
