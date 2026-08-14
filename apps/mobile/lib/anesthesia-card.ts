import { readPassportValueOrigins, type ClinicalPassportSummary } from './api';

/**
 * The content of the anesthesia card, as data.
 *
 * Kept separate from the drawing code so the clinical text can be
 * tested without a canvas. Everything below traces to one of:
 *
 *  [AANA] Mani A, Jha S, Kumar V, Kumar S. Balancing Risks in
 *         Obstetrics: Anesthesia Management in Facioscapulohumeral
 *         Muscular Dystrophy With Scoliosis. AANA J. 2025 Oct.
 *  [AAN]  Tawil R, Kissel JT, Heatwole C, Pandya S, Gronseth G,
 *         Benatar M. Neurology. 2015;85(4):357-364.
 *
 * Both are in the corpus. Two things that are NOT sources, and were
 * the obvious places to reach for:
 *
 *  - The FSHD Society's 「手术麻醉」 page in the corpus is a webinar
 *    landing page. The saved file is 4.7 MB of WordPress and one
 *    abstract paragraph; the content is inside a video.
 *  - The MDA 「应对麻醉」 article is from 2000 and is about
 *    neuromuscular disease generally, mostly DMD.
 *
 * A card handed to an anesthetist before surgery cannot be written
 * from either of those. If someone extends this file, the bar is a
 * citation, not a recollection about muscular dystrophy — the doses
 * and drug choices here differ from the ones DMD would suggest.
 */

export type AnesthesiaCardSection = {
  title: string;
  lines: string[];
};

export type AnesthesiaCardModel = {
  title: string;
  patientName: string;
  /** The patient's own facts. Short lines — this block is what makes
   *  the card theirs rather than a leaflet. */
  patientLines: string[];
  sections: AnesthesiaCardSection[];
  sources: string[];
  disclaimer: string;
};

const hasValue = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.trim() !== '—';

const formatDate = (value: string | null | undefined): string | null => {
  if (!hasValue(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

/** One line per monitoring slot: the finding, or「上传了但读不出」, or
 *  「未做过或未上传」. All three are information an anesthetist can act
 *  on; a missing line is not, and the wrong one of the two negatives is
 *  worse than either. */
const monitoringLine = (
  summary: ClinicalPassportSummary,
  key: 'respiratory' | 'cardiac',
  label: string,
): string => {
  const item = summary.monitoring.items.find((entry) => entry.key === key);
  if (!item || !item.available || !hasValue(item.summary)) {
    // Three states, not two. 「未做过或未上传」 about a patient who DID
    // upload a pulmonary function report is a false statement about
    // their own care, made to the one reader who is not them — and made
    // on the line that exists to stop an unassessed patient reaching
    // general anesthesia. An anesthetist who is told the test was never
    // done orders one; an anesthetist who is told a report exists but
    // could not be read automatically asks the patient to show it.
    const date = formatDate(item?.latestDate);
    if (item?.state === 'unreadable') {
      return date
        ? `${label}：已上传报告（${date}），但系统未能自动读出数值 —— 请向患者本人索取原件`
        : `${label}：已上传报告，但系统未能自动读出数值 —— 请向患者本人索取原件`;
    }
    return `${label}：未做过或未上传`;
  }
  const date = formatDate(item.latestDate);
  return date ? `${label}：${item.summary}（${date}）` : `${label}：${item.summary}`;
};

export const buildAnesthesiaCard = (
  summary: ClinicalPassportSummary,
  today: Date,
): AnesthesiaCardModel => {
  const { confirmation, d4z4Repeats, geneticType } = summary.diagnosis;
  const origins = readPassportValueOrigins(summary.diagnosis.valueOrigins);

  /**
   * The line an anesthetist plans an airway from. It says what this
   * platform CHECKED, and it names no author it has not been told.
   *
   * A non-genetic `confirmation` says nothing about who filed anything
   * and nothing about whether a genetic report exists: a report parsed
   * to nothing but a 分型 lands in one of those states with that 分型
   * read off the report by OCR. What `confirmation` does withhold is
   * narrower, and is the thing that matters here: no D4Z4 repeat count,
   * 4q haplotype or EcoRI fragment was read. `unconfirmedLine` says
   * that and nothing more, which is true in every non-genetic state.
   *
   * D4Z4 is not bracketed in the confirmed branch: the API resolves that
   * value off the genetic report or not at all, so a repeat count on
   * this card is always a report's.
   */
  const unconfirmedLine =
    '诊断：FSHD —— 未经基因确诊：本平台没有读到可作确诊依据的基因结果（D4Z4 重复数、4q 单倍型或 EcoRI 片段）';
  // Whose 分型 it is, when the platform has been told. Without it the
  // reader is left to assume, and 「the patient says FSHD1」 and 「we read
  // FSHD1 off their report」 are different things to plan from.
  const geneticTypeOrigin = origins?.geneticType ?? null;
  const geneticTypeNote =
    hasValue(geneticType) && geneticTypeOrigin && geneticTypeOrigin.kind !== 'absent'
      ? `；档案里的分型为 ${geneticType}（${geneticTypeOrigin.labelZh}）`
      : '';
  const diagnosisLine =
    confirmation === 'genetic'
      ? hasValue(d4z4Repeats)
        ? `诊断：FSHD，基因确诊（D4Z4 重复数 ${d4z4Repeats}）`
        : '诊断：FSHD，基因确诊'
      : `${unconfirmedLine}${geneticTypeNote}`;

  const patientLines = [
    diagnosisLine,
    monitoringLine(summary, 'respiratory', '最近肺功能'),
    monitoringLine(summary, 'cardiac', '最近心脏检查'),
    `生成日期：${formatDate(today.toISOString()) ?? ''}`,
  ];

  const sections: AnesthesiaCardSection[] = [
    {
      title: '术前评估',
      lines: [
        '肺功能：约 40% 的 FSHD 患者有限制性通气功能障碍，且常无自觉症状。全身麻醉前建议先查肺功能。',
        '心电图 + 心脏超声：不完全性右束支传导阻滞见于约 30%，二尖瓣脱垂约 25%。FSHD 日常不需要常规心脏筛查，但术前评估应包含这两项。',
        '面肌无力可能影响肺功能测试的配合，结果偏低时请考虑这一点。',
      ],
    },
    {
      title: '全身麻醉',
      lines: [
        '恶性高热在 FSHD 人群中并不比一般人群多见，但文献仍建议按 MH 预案准备手术间（撤除挥发罐、高流量冲洗回路、更换钠石灰）。',
        '避免吸入性麻醉药；避免琥珀胆碱 —— 可致危及生命的高钾血症。快速诱导可用罗库溴铵。',
        '维持首选静脉全麻：丙泊酚 / 瑞芬太尼靶控输注，或瑞马唑仑。',
        '肌松首选甾体类并以舒更葡糖拮抗；无舒更葡糖时可选短效药（如顺阿曲库铵）。',
        '全程 TOF 神经肌肉监测指导给药与拮抗；拔管前建议上肢与下肢同时监测。',
        '如条件允许，尽量安排为当日第一台手术。',
      ],
    },
    {
      title: '椎管内麻醉',
      lines: [
        '可行，文献中多作为首选。FSHD 的神经本身是正常的，受累的是肌肉。',
        '但脊柱前凸是 FSHD 的特征性改变，侧弯也常见：穿刺可能困难，阻滞平面与持续时间不可预测。文献中有运动阻滞 57 小时后才完全恢复的报告。',
        '侧弯时硬膜外腔向凸侧偏移，药液易流向凹侧造成单侧阻滞；可考虑凸侧旁正中入路、超声引导、大容量低浓度给药。',
        '在术式允许时，外周神经阻滞是另一个选择。',
      ],
    },
  ];

  return {
    title: '面肩肱型肌营养不良（FSHD）麻醉注意事项',
    patientName: hasValue(summary.patientName) ? summary.patientName : '未填写姓名',
    patientLines,
    sections,
    sources: [
      'Mani A 等. AANA Journal. 2025年10月.',
      'Tawil R 等. AAN/AANEM 指南. Neurology. 2015;85(4):357-364.',
      '神经肌肉病麻醉的完整共识见 ENMC, Eur J Neurol. 2022;29:3479-3753.',
    ],
    // Load-bearing. The lines above are a literature summary compiled
    // by an app, handed over in a setting where the reader is the one
    // with the training and the liability.
    disclaimer: '本卡为文献要点汇总，供麻醉医师参考，不替代麻醉医师对具体患者和术式的判断。',
  };
};
