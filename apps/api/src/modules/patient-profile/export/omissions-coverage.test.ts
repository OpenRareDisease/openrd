import { describe, expect, it } from 'vitest';

import {
  EXPORT_FIXTURE_PROFILE,
  EXPORT_FIXTURE_PROFILE_MAXIMAL,
  EXPORT_FIXTURE_PROFILE_SPARSE,
  FIXTURE_GENERATED_AT,
} from './__fixtures__/profile.fixture.js';
import { buildPortableExport, type PortableExportFormat } from './index.js';

/**
 * THE AUDIT, AS A TEST.
 *
 * envelope.ts states the contract this file enforces: `omissions` holds
 * everything we HOLD and did not emit, and 「An empty `omissions` array
 * would be the claim that nothing was left out」. The corollary nobody
 * had written down is that a NON-empty omissions list makes the same
 * claim about everything it does not mention — a receiver reading eight
 * declared gaps concludes those are the gaps.
 *
 * Two consecutive review rounds found a clinical fact that reached no
 * portable export and was declared in none:
 *
 *   - the EcoRI fragment and 甲基化, which travelled to one export
 *     between them and were named in the other two's omissions nowhere;
 *   - `familyHistoryStatement`, which `normaliseSource` computes and
 *     only treat-nmd.ts read. 家族史 / FamilyMemberHistory appeared zero
 *     times in the FHIR builder, zero times in the Phenopacket builder,
 *     and zero times in either rendered envelope. FHIR R4 has the slot.
 *     Family history is a first-line question in an FSHD workup, so a
 *     neurologist reading a bundle with no FamilyMemberHistory and no
 *     omission naming one reads 「asked, and negative」.
 *
 * Both were found by a human enumerating the DTO by hand. This table is
 * that enumeration, kept where it fails: every clinical fact the
 * profile DTO holds, and for each of the three portable exports whether
 * it is EMITTED (a probe that must appear in the serialised document)
 * or DECLARED (a probe that must appear in some omission's `reasonZh`).
 * There is no third column value, because 「silently absent」 is the
 * defect and a row cannot be written for it.
 *
 * ADDING A FACT TO THE DTO. Add its row here too. That is the whole
 * mechanism — nothing can derive this table, because the question 「is
 * this fact in the document」 is answered by prose in two of the three
 * formats.
 */

type Placement =
  | { readonly where: 'document'; readonly probe: string }
  | { readonly where: 'omissions'; readonly probe: string }
  /**
   * On the envelope but NOT in `omissions` — `fieldOrigins` and the
   * `notes` block. Its own placement rather than folded into
   * 'omissions', because an omission is a thing left OUT and §B3's
   * provenance is a thing said ABOUT a value that is in.
   */
  | { readonly where: 'envelope'; readonly probe: string };

interface FactRow {
  /** The fact, named the way this repository names it. */
  readonly factZh: string;
  readonly treatNmd: Placement;
  readonly phenopacket: Placement;
  readonly fhir: Placement;
}

const emitted = (probe: string): Placement => ({ where: 'document', probe });
const declared = (probe: string): Placement => ({ where: 'omissions', probe });
const envelopeNote = (probe: string): Placement => ({ where: 'envelope', probe });

const FACTS: readonly FactRow[] = [
  // ---------------------------------------------------------- 诊断
  {
    factZh: 'FSHD 分型',
    treatNmd: emitted('diagnosis.type'),
    phenopacket: emitted('OMIM:'),
    fhir: emitted('面肩肱型肌营养不良'),
  },
  {
    factZh: '确诊年份',
    treatNmd: emitted('diagnosis.year'),
    phenopacket: declared('确诊年份'),
    fhir: emitted('recordedDate'),
  },
  {
    factZh: '是否基因确诊',
    treatNmd: emitted('diagnosis.geneticallyConfirmed'),
    // 「是否基因确诊」 rather than 「不表示基因确诊」: the second phrase
    // lives in the 诊断依据 entry, which exists only when there is a
    // Disease term to qualify. The probe has to hold for the profile
    // with no classifiable 分型 too, and there the answer is carried by
    // the 临床护照 entry instead.
    phenopacket: declared('是否基因确诊'),
    fhir: emitted('verificationStatus'),
  },
  {
    factZh: '诊断进度（患者自己勾选的）',
    treatNmd: declared('诊断进度'),
    phenopacket: declared('诊断进度'),
    fhir: declared('诊断进度'),
  },
  {
    factZh: '报告上写的检测方法',
    treatNmd: declared('检测方法'),
    phenopacket: declared('检测方法'),
    fhir: declared('检测方法'),
  },
  {
    factZh: '基因证据分级（本平台的判定）',
    treatNmd: declared('基因证据的分级'),
    phenopacket: declared('基因证据的分级'),
    fhir: declared('基因证据的分级'),
  },
  {
    factZh: 'D4Z4 重复单元数',
    treatNmd: emitted('diagnosis.d4z4'),
    phenopacket: declared('D4Z4 重复单元数'),
    fhir: emitted('D4Z4 重复单元数'),
  },
  {
    factZh: '4q 单倍型',
    treatNmd: emitted('diagnosis.haplotype'),
    phenopacket: declared('4q 单倍型'),
    fhir: emitted('4q 单倍型'),
  },
  {
    factZh: 'EcoRI 片段',
    treatNmd: emitted('diagnosis.ecoRIFragment'),
    phenopacket: declared('EcoRI 片段'),
    fhir: emitted('EcoRI 片段'),
  },
  {
    factZh: '甲基化',
    treatNmd: emitted('diagnosis.methylation'),
    phenopacket: declared('甲基化'),
    fhir: emitted('甲基化'),
  },
  {
    factZh: '起病部位',
    treatNmd: emitted('起病部位'),
    phenopacket: declared('起病部位'),
    fhir: declared('起病部位'),
  },
  // ------------------------------------------------------- 家族史
  {
    // The defect this file was written for. TREAT-NMD carries it only
    // in the local-retention variant; the shareable variant declares
    // it, which is what the 'omissions' placement below asserts, and
    // the local-retention variant is asserted separately at the bottom.
    factZh: '家族史陈述',
    treatNmd: declared('家族史'),
    phenopacket: declared('家族史'),
    fhir: declared('家族史'),
  },
  // -------------------------------------------- 症状与自评、身体状况
  {
    factZh: '症状自评（随访）',
    treatNmd: emitted('symptom.'),
    phenopacket: declared('症状自评'),
    fhir: emitted('疲劳'),
  },
  {
    factZh: '基线问卷的困难程度自评',
    treatNmd: emitted('challenge.'),
    phenopacket: declared('基线困难程度自评'),
    fhir: declared('困难程度自评'),
  },
  {
    factZh: '日常活动困难程度（随访）',
    treatNmd: emitted('dailyImpact.'),
    phenopacket: declared('日常活动困难程度'),
    fhir: emitted('洗头困难程度'),
  },
  {
    factZh: '基线问卷记录的身体状况（抬臂 / 面部 / 足下垂 / 呼吸）',
    treatNmd: emitted('motor.facialWeakness'),
    phenopacket: declared('面部肌无力'),
    fhir: declared('面部肌无力'),
  },
  {
    factZh: '正在使用的辅助器具',
    treatNmd: emitted('motor.assistiveDevices'),
    phenopacket: declared('辅助器具'),
    fhir: declared('辅助器具'),
  },
  // ------------------------------------------------------- 运动功能
  {
    factZh: '徒手肌力（MRC）',
    treatNmd: emitted('motor.muscleStrength'),
    phenopacket: declared('肌力记录'),
    fhir: emitted('三角肌肌力'),
  },
  {
    factZh: '功能测试',
    treatNmd: emitted('motor.functionTests'),
    phenopacket: declared('功能测试记录'),
    fhir: emitted('10 米步行计时'),
  },
  {
    factZh: '基线记录的行走状态',
    treatNmd: emitted('motor.ambulation'),
    phenopacket: declared('行走状态'),
    fhir: declared('行走状态'),
  },
  {
    factZh: 'Brooke / Vignos 分级',
    treatNmd: declared('Brooke'),
    phenopacket: declared('Brooke'),
    fhir: declared('Brooke'),
  },
  // --------------------------------------------- 里程碑与随访事件
  {
    factZh: '里程碑事件（轮椅 / NIV / AFO）',
    treatNmd: emitted('milestone.'),
    phenopacket: declared('里程碑事件'),
    fhir: emitted('开始使用轮椅'),
  },
  {
    factZh: '其他随访事件（跌倒等）',
    treatNmd: emitted('followupEvents'),
    phenopacket: declared('随访事件'),
    fhir: emitted('跌倒'),
  },
  // ------------------------------------------------- 文件与用药
  {
    factZh: '上传的报告文件',
    treatNmd: declared('本导出不含上传文件清单'),
    phenopacket: emitted('fileAttributes'),
    fhir: emitted('DocumentReference'),
  },
  {
    factZh: '用药记录',
    treatNmd: declared('用药记录'),
    phenopacket: declared('用药记录'),
    fhir: declared('用药记录'),
  },
  {
    factZh: '患者写的日常记录',
    treatNmd: declared('日常记录'),
    phenopacket: declared('日常记录'),
    fhir: declared('日常记录'),
  },
  {
    factZh: '档案备注',
    treatNmd: declared('档案备注'),
    phenopacket: declared('档案备注'),
    fhir: declared('档案备注'),
  },
  // -------------------------------------- 人口学、体格与身份信息
  {
    factZh: '出生年份',
    treatNmd: declared('出生年份'),
    phenopacket: declared('出生年份'),
    fhir: emitted('birthDate'),
  },
  {
    factZh: '性别',
    treatNmd: declared('性别'),
    phenopacket: emitted('FEMALE'),
    fhir: emitted('gender'),
  },
  {
    factZh: '身高 / 体重 / 血型',
    treatNmd: declared('身高'),
    phenopacket: declared('身高'),
    fhir: declared('身高'),
  },
  {
    factZh: '姓名与称呼',
    treatNmd: declared('姓名'),
    phenopacket: declared('姓名'),
    fhir: declared('姓名'),
  },
  {
    factZh: '确诊医生 / 主诊医生姓名',
    treatNmd: declared('确诊医生'),
    phenopacket: declared('确诊医生'),
    fhir: declared('确诊医生'),
  },
  {
    factZh: '联系电话与邮箱',
    treatNmd: declared('联系电话'),
    phenopacket: declared('联系电话'),
    fhir: declared('联系电话'),
  },
  {
    factZh: '常住地区',
    treatNmd: declared('常住地区'),
    phenopacket: declared('常住地区'),
    fhir: declared('常住地区'),
  },
  {
    factZh: '本平台内部的患者编号',
    treatNmd: declared('患者编号'),
    phenopacket: declared('患者编号'),
    fhir: declared('患者编号'),
  },
  // -------------------------------------------------------- §B3
  {
    // §B3 does NOT ride `omissions`: it rides `fieldOrigins` and the
    // per-format `notes` key, because it is a statement about who typed
    // a value that IS in the document rather than about something left
    // out. The probe is the phrase both states of that note share —
    // 「N 个基线字段不是患者本人填写的」 and 「本次导出的基线字段没有…代填的
    // 记录」 — so the empty case is checked as hard as the marked one.
    factZh: '管理员代填的基线字段标记（§B3）',
    treatNmd: envelopeNote('基线字段'),
    phenopacket: envelopeNote('基线字段'),
    fhir: envelopeNote('基线字段'),
  },
];

const build = (
  format: PortableExportFormat,
  profile = EXPORT_FIXTURE_PROFILE_MAXIMAL,
  includeLocalOnly = false,
) => buildPortableExport(format, profile, { includeLocalOnly, generatedAt: FIXTURE_GENERATED_AT });

const FORMATS = [
  ['treat-nmd', 'treatNmd'],
  ['phenopacket', 'phenopacket'],
  ['fhir-r4', 'fhir'],
] as const;

describe('每一项临床事实，三份可携带导出要么承载它，要么声明没有承载', () => {
  FORMATS.forEach(([format, column]) => {
    FACTS.forEach((row) => {
      const placement = row[column];
      const whereZh =
        placement.where === 'document'
          ? '写入文件'
          : placement.where === 'omissions'
            ? '在 omissions 里声明'
            : '在信封的 notes / fieldOrigins 上';
      it(`${format}：${row.factZh} —— ${whereZh}`, () => {
        const envelope = build(format);
        if (placement.where === 'envelope') {
          expect(
            JSON.stringify({ notes: envelope.notes, fieldOrigins: envelope.fieldOrigins }),
          ).toContain(placement.probe);
          return;
        }
        if (placement.where === 'document') {
          // Serialised rather than walked: the three documents share no
          // shape below the envelope, and what this asserts is that the
          // value reached the document at all.
          expect(JSON.stringify(envelope.document)).toContain(placement.probe);
          return;
        }
        const reasons = envelope.omissions.map((entry) => entry.reasonZh).join('\n');
        expect(reasons).toContain(placement.probe);
        // A declaration must not also be a false denial: the fact must
        // not be sitting in the document while an omission says it is
        // not. Scoped to the `field` names, because a reason legitimately
        // quotes values (「记录的分型「FSHD1」」).
        expect(envelope.omissions.some((entry) => entry.reasonZh.includes(placement.probe))).toBe(
          true,
        );
      });
    });
  });

  /**
   * The declarations must survive an empty profile.
   *
   * A declaration pushed only when the value is present says nothing to
   * the receiver who most needs it — the one holding a document with no
   * medication list, no family history and no follow-up events, who has
   * to tell 「this patient has none」 from 「this format does not carry
   * them」. Every DECLARED row above is asserted again over a profile
   * with nothing on it.
   */
  FORMATS.forEach(([format, column]) => {
    it(`${format}：档案空的时候，该声明的还是照样声明`, () => {
      const envelope = build(format, EXPORT_FIXTURE_PROFILE_SPARSE);
      const reasons = envelope.omissions.map((entry) => entry.reasonZh).join('\n');
      const missing = FACTS.filter((row) => row[column].where === 'omissions')
        .map((row) => row[column].probe)
        .filter((probe) => !reasons.includes(probe));
      expect(missing).toEqual([]);
    });
  });

  /**
   * And the local-retention TREAT-NMD variant is where the family
   * history actually travels. Asserted separately because the table
   * above builds the shareable variant, which declares it instead — and
   * a rule that only ever checks the declaration would stay green if
   * the value stopped being emitted anywhere at all.
   */
  it('treat-nmd：本地留存版本里家族史是写出来的，不是声明掉的', () => {
    const envelope = build('treat-nmd', EXPORT_FIXTURE_PROFILE, true);
    expect(JSON.stringify(envelope.document)).toContain('患者对自身家族史的陈述');
    expect(JSON.stringify(envelope.document)).toContain(
      '父亲和姑姑都有类似的抬手困难，但都没有做过基因检测。',
    );
    expect(envelope.omissions.map((entry) => entry.field)).not.toContain('sections.familyHistory');
  });

  /**
   * And it travels in NEITHER of the other two, in EITHER mode. The
   * FHIR bundle and the Phenopacket refuse to branch on
   * `includeLocalOnly` at all — a resource that can never carry a
   * relative's account cannot leak one because a caller passed the flag
   * wrong — so the declaration is unconditional and the statement is
   * never in the document.
   */
  (['phenopacket', 'fhir-r4'] as const).forEach((format) => {
    [false, true].forEach((includeLocalOnly) => {
      it(`${format}：includeLocalOnly=${includeLocalOnly} 时都不写家族史，也都照样声明`, () => {
        const envelope = build(format, EXPORT_FIXTURE_PROFILE, includeLocalOnly);
        expect(JSON.stringify(envelope.document)).not.toContain('父亲和姑姑');
        const family = envelope.omissions.find((entry) => entry.reasonZh.includes('家族史'));
        expect(family).toBeDefined();
        expect(family?.reasonZh).toContain('不表示患者没有家族史');
      });
    });
  });
});
