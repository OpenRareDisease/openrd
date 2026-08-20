import { describe, expect, it } from 'vitest';

import {
  EXPORT_FIXTURE_PROFILE,
  EXPORT_FIXTURE_PROFILE_ARCHIVE_ONLY_GENETICS,
  EXPORT_FIXTURE_PROFILE_MAXIMAL,
  EXPORT_FIXTURE_PROFILE_SPARSE,
  FIXTURE_GENERATED_AT,
} from './__fixtures__/profile.fixture.js';
import {
  normaliseSource,
  GENETIC_ARCHIVE_CELL_LABELS_ZH,
  REPORT_FIELD_INVENTORY,
} from './export-source.js';
import { buildPortableExport, type PortableExportFormat } from './index.js';
import { MEASUREMENT_METRIC_LABELS, measurementSubjectZh } from './labels.js';
import { MUSCLE_GROUPS } from '../profile.constants.js';
import { PASSPORT_MONITORING_PAYLOAD_KEYS } from '../profile.passport.js';
import type { PatientProfileDTO } from '../profile.service.js';

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
    // THIS ROW IS ABOUT `patient_measurements` — the grades the patient
    // records through this app and a clinician records for them. It is
    // NOT about the MRC grades parsed off an uploaded report; those are
    // a different store, reached through `REPORT_FIELD_SPECS`, and they
    // are covered by the derived block at the bottom of this file.
    //
    // THE FHIR PROBE CARRIES THE SIDE ON PURPOSE. A bare 「三角肌肌力」 is
    // a prefix of the report-derived label too, so this row would have
    // gone green for a bundle carrying only the report's grade and none
    // of the patient's own — the two-facts-one-name hole again, now that
    // both facts are in the bundle. `（左侧）` is written only by the
    // measurement path.
    factZh: '徒手肌力（MRC）',
    treatNmd: emitted('motor.muscleStrength'),
    phenopacket: declared('肌力记录'),
    fhir: emitted('三角肌肌力（左侧）'),
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
    // THE EVENT. `patient_followup_events` with `event_type = 'fall'` —
    // a date, an optional severity band, a free-text description. This
    // row was already here and was already passing, and that is exactly
    // how the row below went missing for so long: 「跌倒」 appears in two
    // of the three documents, so every probe anybody thought to write
    // was green while the diary underneath reached nothing.
    factZh: '其他随访事件（跌倒等）——事件本身',
    treatNmd: emitted('followupEvents'),
    phenopacket: declared('随访事件'),
    fhir: emitted('跌倒'),
  },
  {
    /**
     * THE DIARY. A DIFFERENT STORE AND A DIFFERENT ROW.
     *
     * `patient_falls` (migration 023) holds five structured answers per
     * fall — 当时在做什么 / 室内还是室外 / 手里是否拿着东西 / 能否自行起身
     * / 是否受伤 — none of which is on `PatientProfileDTO`, which is the
     * only thing `normaliseSource` reads.
     *
     * WHY IT NEEDS ITS OWN ROW rather than being folded into the one
     * above. Every diary entry writes a `patient_followup_events` twin
     * in the same transaction (`origin_event_id`), so the row above is
     * satisfied by the twin: TREAT-NMD emits the fall, FHIR emits a
     * 跌倒 Observation, and neither carries one of the five answers.
     * The table said 「跌倒 is carried」 and was telling the truth about
     * a different fact — which is the failure mode this whole file
     * exists to catch, arriving through the one gap a fact-per-row
     * table has: two facts sharing a name.
     *
     * A neurologist reading a bundle with a dated 跌倒 Observation and
     * no omission naming the diary reads 「that is everything they
     * recorded」. Falls are the dangerous event in FSHD and 能否自行起身
     * is not derivable from anything else in these documents.
     */
    factZh: '跌倒日记的五项结构化明细（活动 / 室内外 / 手是否占用 / 能否自行起身 / 是否受伤）',
    treatNmd: declared('跌倒日记'),
    phenopacket: declared('跌倒日记'),
    fhir: declared('跌倒日记'),
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
    factZh: '档案备注（patient_profiles.notes）',
    treatNmd: declared('档案备注'),
    phenopacket: declared('档案备注'),
    fhir: declared('档案备注'),
  },
  {
    /**
     * A SECOND FREE-TEXT NOTES STORE, AND THE THREE DECLARATIONS USED
     * TO NAME ONLY THE FIRST.
     *
     * `baseline_payload.notes` is not `patient_profiles.notes`. The
     * product itself treats them as two things: the full-cohort CSV
     * emits `baseline_notes` and `profile_notes` as separate columns,
     * and admin.controller.ts labels them 「基线备注」 and 「档案备注」
     * separately. The back office's baseline editor writes the first
     * one; nothing there writes the second.
     *
     * All three exports declared 「档案备注」 and stopped, so the
     * receiver of a document containing neither was told about one
     * withheld free-text field and had a second withheld free-text
     * field they had no way to ask for. Same shape as the row above
     * this block's neighbour: the declaration was true about a
     * different store that shares a name.
     */
    factZh: '基线备注（baseline_payload.notes）',
    treatNmd: declared('基线备注'),
    phenopacket: declared('基线备注'),
    fhir: declared('基线备注'),
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

/**
 * Keys whose string content is the export talking ABOUT itself, not a
 * value read off this patient.
 *
 * Needed because the false-denial half of the DECLARED branch below
 * asks 「is this fact nevertheless sitting in the document?」, and a
 * whole-document substring search answers 「yes」 for three facts that
 * are honestly declared:
 *
 *   - `datasetSourceZh` — the TREAT-NMD blurb naming what the core
 *     dataset's mandatory questions cover (「…诊断、家族史、症状…」). That
 *     is a statement about the STANDARD, and it reads the same whether
 *     or not we filled the slot.
 *   - `titleZh` — a section heading. `sections[1]` is titled 家族史 with
 *     `collected: false` and zero items; the heading is identical in the
 *     variant that does carry it, so it distinguishes nothing.
 *   - `noteZh` — the section's own in-document statement of what it
 *     leaves out (「本节不含 Brooke 上肢分级与 Vignos 下肢分级…」). Matching a
 *     declaration against the declaration would make the assertion
 *     always fail for the facts it most needs to be green on.
 *
 * Everything else stays in scope, and that is where the check earns its
 * keep: an item's `key`, `labelZh`, `value` and `provenanceZh` are all
 * searched, so a serialiser that starts EMITTING a declared fact trips
 * this on the same run — the local-retention family-history variant is
 * asserted against below to prove exactly that.
 *
 * FAIL DIRECTION. A serialiser that invents a fourth prose key is not
 * silently excused: its prose is searched like any value, so the first
 * declared fact it names fails here and somebody has to decide whether
 * the key belongs on this list. Loud is the correct direction for a
 * list that would otherwise rot.
 */
const DECLARATORY_PROSE_KEYS: ReadonlySet<string> = new Set([
  'datasetSourceZh',
  'titleZh',
  'noteZh',
]);

/** Every string in `document` except the export's own declaratory prose. */
const carriedStrings = (node: unknown, key: string | null, into: string[]): string[] => {
  if (key !== null && DECLARATORY_PROSE_KEYS.has(key)) return into;
  if (typeof node === 'string') {
    into.push(node);
    return into;
  }
  if (Array.isArray(node)) {
    node.forEach((entry) => carriedStrings(entry, key, into));
    return into;
  }
  if (node && typeof node === 'object') {
    Object.entries(node as Record<string, unknown>).forEach(([childKey, value]) => {
      into.push(childKey);
      carriedStrings(value, childKey, into);
    });
  }
  return into;
};

const carriedText = (document: unknown): string => carriedStrings(document, null, []).join('\n');

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
        // A declaration must not also be a FALSE DENIAL: the fact must
        // not be sitting in the document while an omission says it is
        // not. A receiver who reads both believes the omission, because
        // the omission is the half written for them.
        //
        // Searched over the document minus its own declaratory prose —
        // see `DECLARATORY_PROSE_KEYS` for which three keys that is and
        // why each one distinguishes nothing.
        expect(
          carriedText(envelope.document),
          `${format} 在 omissions 里声明了「${placement.probe}」，` +
            '但文件本身又承载了它。声明与承载只能二选一——' +
            '收件人读到的是声明，于是把文件里那个值当作不存在。',
        ).not.toContain(placement.probe);
      });
    });
  });

  /**
   * AND THE FALSE-DENIAL HALF IS NOT VACUOUS.
   *
   * `carriedText` strips three prose keys. A stripper that stripped one
   * key too many would leave every `not.toContain` above green over a
   * document that does carry the value — the precise failure this whole
   * file exists to name, one level down.
   *
   * So it is pinned against the one profile/flag combination where a
   * DECLARED fact really is emitted: 家族史 is declared by shareable
   * treat-nmd and written by the local-retention variant. If the same
   * probe that must be absent from the shareable document is not found
   * in the local-only one, the stripper has stopped seeing values.
   */
  it('false-denial 那半边不是空转的：同一个探针在真的承载它的那份文件里必须找得到', () => {
    const shareable = build('treat-nmd', EXPORT_FIXTURE_PROFILE, false);
    const localOnly = build('treat-nmd', EXPORT_FIXTURE_PROFILE, true);
    expect(
      carriedText(shareable.document),
      '可分享版本声明了家族史，文件里不该有它。',
    ).not.toContain('家族史');
    expect(
      carriedText(localOnly.document),
      'carriedText 把承载着的值也一并剥掉了——' +
        '这样一来上面每一条 not.toContain 都是在空字符串上通过的。',
    ).toContain('家族史');
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

/**
 * ============================================================
 * THE HALF OF THE CHECK THAT IS NOT HAND-WRITTEN.
 * ============================================================
 *
 * WHY THIS BLOCK EXISTS. The table above is a good check and it has now
 * failed to prevent the same defect FOUR TIMES. Every one of those
 * rounds went the same way: a clinical fact this platform holds reached
 * no portable export and was declared in none, a human found it by
 * reading the DTO by hand, and a row was added. The table never fails
 * for a fact it has no row for — that is not a bug in the table, it is
 * the definition of a hand-written enumeration.
 *
 * The four facts, and what each of them WAS at the moment it was missed:
 *
 *   1. The lab / pulmonary / cardiac / imaging readings. A member of
 *      `REPORT_FIELD_SPECS`, a runtime array in export-source.ts. Ten of
 *      its fourteen entries were exercised by no test in this directory.
 *   2. The MRC grades read off a clinical report. A key
 *      `embedded-report-ocr.ts` writes into `ocrPayload.fields` and the
 *      app's own report table prints, with NO `REPORT_FIELD_SPECS` entry
 *      in either spelling.
 *   3. The measurement row with no muscle group. A shape
 *      `measurementSchema` explicitly admits and the shipped 用力闭眼
 *      self-test writes on every submission.
 *   4. A genetic reading held in the archive and absent from the
 *      evidence document. One of the four cells in
 *      `GENETIC_BASELINE_VALUE_ORIGINS`, in one of its two states.
 *
 * ALL FOUR WERE ALREADY ENUMERATED SOMEWHERE IN RUNNING CODE. Not one
 * of them needed a human to discover that it existed; what was missing
 * was anything that walked those enumerations and asked the exports the
 * question. That is what this block does.
 *
 * IS FULL DERIVATION POSSIBLE? No, and the boundary is worth stating
 * precisely, because pretending otherwise is how a check becomes
 * decorative:
 *
 *   - The MEMBERSHIP question — 「what does the platform hold?」 — is
 *     derivable wherever the answer is a runtime table, and every one of
 *     the four was. That is what is enforced below, and it is the half
 *     that failed four times.
 *   - The PLACEMENT question — 「does this document carry it, or declare
 *     it, and is the sentence true?」 — is not derivable. Two of the
 *     three formats answer it in Chinese prose, and no assertion can
 *     tell a reason that is true from one that is fluent. That half
 *     stays in the table above, one row at a time, written by whoever
 *     changes the serialiser.
 *
 * WHAT IT COSTS. Three things, all of them real:
 *
 *   - `EXPORT_FIXTURE_PROFILE_MAXIMAL` has to actually populate every
 *     enumerated member. It did not: it carried two of fourteen report
 *     cells, and no measurement without a muscle group. A derived check
 *     over a thin fixture passes vacuously, which is worse than no check.
 *     Keeping it maximal is now a standing obligation.
 *   - `REPORT_FIELD_SPECS` had to be exported from export-source.ts as
 *     `REPORT_FIELD_INVENTORY`. A private table cannot be the subject of
 *     a coverage assertion.
 *   - The `Record<keyof PatientProfileDTO, …>` below turns adding a
 *     column to the DTO into a COMPILE error in this file. That is the
 *     cheapest of the three and the one with the longest reach, and it
 *     is also the one that will annoy somebody adding a field that has
 *     nothing to do with exports — they still have to write the row.
 *     That cost is the point.
 *
 * WHAT IT STILL DOES NOT CATCH, stated so nobody reads the block as
 * covering more than it does: defect 2 above. Nothing here derives the
 * set of keys `embedded-report-ocr.ts` can write into `ocrPayload.fields`
 * — that inventory lives in another module, behind a Python parser, and
 * importing it into an export test would couple this directory to the
 * OCR pipeline's internals. `PARSED_CELL_INVENTORY` below is the manual
 * bridge, and it is manual on purpose: it is closed in the direction
 * that matters (every payload key it lists must have a home) but a key
 * nobody adds to it is still invisible. That is the residual, and it is
 * the one place a fifth round can still come from.
 */

const MAXIMAL_ENVELOPES = FORMATS.map(([format]) => [format, build(format)] as const);

describe('清单是从运行时的表里推导出来的，不是手写的', () => {
  /**
   * DEFECT 1's CLASS. Every entry in `REPORT_FIELD_SPECS`, asked of all
   * three envelopes: is this reading in the document, or named in an
   * omission? A spec added with no home fails here on the day it is
   * added, without anybody remembering to add a row above.
   *
   * The probe is the spec's own `labelZh`, which is what both a
   * document value and a declaration are written with — that is why the
   * shared declaration in `reportReadingsOmission` builds its sentence
   * out of `REPORT_READING_LABELS_ZH` rather than a hand-typed list.
   */
  REPORT_FIELD_INVENTORY.forEach((spec) => {
    MAXIMAL_ENVELOPES.forEach(([format, envelope]) => {
      it(`${format}：报告解析项「${spec.labelZh}」要么写进文件，要么在 omissions 里点名`, () => {
        const inDocument = JSON.stringify(envelope.document).includes(spec.labelZh);
        const inOmissions = envelope.omissions.some((entry) =>
          entry.reasonZh.includes(spec.labelZh),
        );
        expect(
          inDocument || inOmissions,
          `${format} 既没有承载「${spec.labelZh}」，也没有在 omissions 里声明它。` +
            'REPORT_FIELD_SPECS 里新增一项时，三份导出各自要么写它、要么声明它——' +
            '「悄悄没有」不是一个可选项，见 envelope.ts。',
        ).toBe(true);
      });
    });
  });

  /**
   * And the maximal fixture must actually CARRY every one of them,
   * or every assertion above is green over a value that is not there.
   *
   * This is the cost paragraph in the header, made enforceable.
   */
  it('最大化夹具真的填满了 REPORT_FIELD_SPECS 的每一项', () => {
    const source = normaliseSource(EXPORT_FIXTURE_PROFILE_MAXIMAL, {
      includeLocalOnly: false,
      generatedAt: FIXTURE_GENERATED_AT,
    });
    const present = new Set(source.reportFields.map((field) => field.key));
    const missing = REPORT_FIELD_INVENTORY.map((spec) => spec.key).filter(
      (key) => !present.has(key),
    );
    expect(
      missing,
      '这些解析项在 EXPORT_FIXTURE_PROFILE_MAXIMAL 上没有值，' +
        '因此上面那组断言对它们是空转的。请在夹具的 ocrPayload.fields 里补上。',
    ).toEqual([]);
  });

  /**
   * DEFECT 2's CLASS, as far as it can be closed from inside this
   * directory. `embedded-report-ocr.ts` writes these keys into
   * `ocrPayload.fields`; each must be read by a `REPORT_FIELD_SPECS`
   * entry, or carry a written reason for not being one.
   *
   * MANUAL, AND CLOSED IN ONE DIRECTION ONLY — see the header. What it
   * buys is that the five MRC keys can never again be present in the
   * payload, printed in the app, and absent from every export with
   * nobody having written a sentence about it.
   */
  const PARSED_CELL_INVENTORY: ReadonlyArray<{
    readonly payloadKey: string;
    readonly notAReadingBecauseZh?: string;
  }> = [
    {
      payloadKey: 'reportTime',
      notAReadingBecauseZh: '是报告自己的日期，不是读数；用于 observedAt',
    },
    { payloadKey: 'creatineKinase' },
    { payloadKey: 'myoglobin' },
    { payloadKey: 'LDH' },
    { payloadKey: 'CKMB' },
    { payloadKey: 'fvcPredPct' },
    { payloadKey: 'tlcPredPct' },
    { payloadKey: 'dlcoPredPct' },
    { payloadKey: 'LVEF' },
    { payloadKey: 'qtcMs' },
    { payloadKey: 'serratusFatigueGrade' },
    { payloadKey: 'deltoidStrength' },
    { payloadKey: 'deltoid_strength' },
    { payloadKey: 'bicepsStrength' },
    { payloadKey: 'biceps_strength' },
    { payloadKey: 'tricepsStrength' },
    { payloadKey: 'triceps_strength' },
    { payloadKey: 'quadricepsStrength' },
    { payloadKey: 'quadriceps_strength' },
    { payloadKey: 'tibialisStrength' },
    { payloadKey: 'tibialis_strength' },
    // The sixteen monitoring cells the spec table used to be a subset
    // of — see `PASSPORT_MONITORING_PAYLOAD_KEYS`.
    { payloadKey: 'creatinine' },
    { payloadKey: 'uric_acid' },
    { payloadKey: 'wbc' },
    { payloadKey: 'hgb' },
    { payloadKey: 'plt' },
    { payloadKey: 'ft3' },
    { payloadKey: 'ft4' },
    { payloadKey: 'tsh' },
    { payloadKey: 'pt' },
    { payloadKey: 'aptt' },
    { payloadKey: 'fibrinogen' },
    { payloadKey: 'd_dimer' },
    { payloadKey: 'ventilatory_pattern' },
    { payloadKey: 'diaphragmMotionSummary' },
    { payloadKey: 'ecgSummary' },
    { payloadKey: 'echoSummary' },
    { payloadKey: 'd4z4Repeats' },
    { payloadKey: 'haplotype' },
    { payloadKey: 'ecoRIFragment' },
    { payloadKey: 'methylationValue' },
    {
      payloadKey: 'diagnosisType',
      notAReadingBecauseZh:
        '分型不是走 reportFields 的：它经 normaliseSource 归一后成为 Condition.code / Disease.term / diagnosis.type',
    },
    {
      payloadKey: 'geneticTestMethod',
      notAReadingBecauseZh:
        '检测方法，三份导出都在 omissions 里声明不承载（FACTS 表里有「报告上写的检测方法」一行）',
    },
    {
      payloadKey: 'interpretationSummary',
      notAReadingBecauseZh: '是报告的结论段落，不是某一项的读数；属于自由文本，三份都不承载',
    },
    {
      payloadKey: 'reportImpression',
      notAReadingBecauseZh: '同上：影像报告的印象段落，自由文本',
    },
    {
      payloadKey: 'impressionText',
      notAReadingBecauseZh: '同上，reportImpression 的别名',
    },
    { payloadKey: 'aiSummary', notAReadingBecauseZh: '本平台生成的摘要，不是报告上的读数' },
  ];

  it('OCR 写进 ocrPayload.fields 的每一个键，要么被某条 REPORT_FIELD_SPECS 读走，要么写明为什么不是读数', () => {
    const consumed = new Set(REPORT_FIELD_INVENTORY.flatMap((spec) => spec.payloadKeys));
    const orphans = PARSED_CELL_INVENTORY.filter(
      (cell) => !consumed.has(cell.payloadKey) && cell.notAReadingBecauseZh === undefined,
    ).map((cell) => cell.payloadKey);
    expect(
      orphans,
      '这些键会被写进 ocrPayload.fields，但没有任何 REPORT_FIELD_SPECS 条目读它们，' +
        '也没有写明它们为什么不是一项读数。患者在 App 的报告页上看得到的值，' +
        '不能对三份可携带导出全部隐形。',
    ).toEqual([]);
  });

  /**
   * And closed the other way, at the granularity of a READING rather
   * than of a spelling.
   *
   * Not 「every alias appears in the inventory」: `REPORT_FIELD_SPECS`
   * lists historical spellings (`d4z4_repeats`, `EcoRI_kb`, `ecoriFragmentKb`)
   * that no writer produces any more and that exist so an archived
   * payload still resolves. Demanding a row for each would make the
   * inventory a second copy of the alias lists, which is a table that
   * goes stale rather than a bridge between two modules.
   *
   * What must hold is that each spec is REPRESENTED — a reading nobody
   * has traced back to a key the OCR writer produces is a reading whose
   * presence in the payload nothing here can vouch for.
   */
  it('反过来也要闭合：每一条 REPORT_FIELD_SPECS 至少有一个拼写出现在上面的清单里', () => {
    const listed = new Set(PARSED_CELL_INVENTORY.map((cell) => cell.payloadKey));
    const untraced = REPORT_FIELD_INVENTORY.filter(
      (spec) => !spec.payloadKeys.some((key) => listed.has(key)),
    ).map((spec) => spec.key);
    expect(
      untraced,
      '这些解析项的所有拼写都不在 PARSED_CELL_INVENTORY 里，' +
        '也就是说没人核对过 OCR 到底会不会写出这个键。',
    ).toEqual([]);
  });

  /**
   * ════════════════════════════════════════════════════════════════
   * AND THE INVENTORY ITSELF IS NO LONGER HAND-WRITTEN.
   * ════════════════════════════════════════════════════════════════
   *
   * `PARSED_CELL_INVENTORY` above is manual, and the header says so:
   * closed in the direction that matters, blind to a key nobody adds.
   * That blindness had already cost a round — `REPORT_FIELD_SPECS` was
   * a NINETEEN-ENTRY SUBSET of what this platform parses and prints,
   * and the sixteen missing cells were invisible to every check in this
   * file, including the derived ones, because the derived ones walked
   * the incomplete table.
   *
   * A check whose subject is itself a hand-written subset has exactly
   * the defect it was written to catch, one level up. So the subject is
   * now a RUNTIME table again: `PASSPORT_MONITORING_PAYLOAD_KEYS` is
   * every cell the clinical passport's 血检 / 肺功能 / 心脏 rows can
   * print, exported from profile.passport.ts for this assertion.
   *
   * WHY THE PASSPORT IS THE RIGHT SUBJECT and not the Python parser's
   * `STRUCTURED_KEY_ALIASES` (which is wider still — urinalysis,
   * 感染筛查, stool, 腹部超声). The passport is the line this platform has
   * already drawn: a cell on it is a number we are willing to put in
   * front of a CLINICIAN, on the share page, in the referral pack, on
   * the PDF handed across a desk. The portable exports reach the same
   * reader through a registry. Anything we will show a clinician here
   * and not there is a discrepancy between two of our own surfaces, and
   * that is the class of defect this directory keeps producing.
   *
   * The parser's wider set stays the residual named in the header —
   * this narrows it, it does not close it.
   */
  it('临床护照上能印出来的每一个监测项，导出这边都有一条 REPORT_FIELD_SPECS 读它', () => {
    const consumed = new Set(REPORT_FIELD_INVENTORY.flatMap((spec) => spec.payloadKeys));
    const unexported = PASSPORT_MONITORING_PAYLOAD_KEYS.filter((key) => !consumed.has(key));
    expect(
      unexported,
      '这些单元格临床护照会印给医生看（分享页、转诊资料、患者递过去的 PDF），' +
        '但三份可携带导出一条都读不到它们——既不承载，也不会出现在 ' +
        'REPORT_READINGS_RULE_ZH 那句「本平台可解析的项目是这些」里，' +
        '于是收件人读到的清单就是全部。同一个平台的两个面给医生看的东西不能不一样。',
    ).toEqual([]);
  });

  /**
   * DEFECT 3's CLASS. Every muscle group the database will accept, plus
   * the group-less row the schema accepts and the self-test writes, must
   * produce a NAMED subject — never a raw enum key, never the storage
   * sentinel, never 「null」 or 「undefined」 rendered by a template
   * literal.
   *
   * Derived from `MUSCLE_GROUPS`, which is the api-side half of the
   * two-place edit migration 022 documents. A tenth muscle group added
   * to that array with no `MUSCLE_GROUP_LABELS` row fails here.
   */
  const FORBIDDEN_IN_A_SUBJECT_LABEL = ['custom', 'null', 'undefined'];

  MUSCLE_GROUPS.forEach((group) => {
    it(`肌群「${group}」在导出里有中文名，不是把枚举值直接印出来`, () => {
      const subject = measurementSubjectZh(group, null);
      expect(subject).not.toBeNull();
      expect(subject).not.toContain(group);
    });
  });

  Object.keys(MEASUREMENT_METRIC_LABELS).forEach((metricKey) => {
    it(`自测动作「${metricKey}」在没有肌群时仍然有中文名`, () => {
      // 'custom' is what `addMeasurement` stores for a row whose payload
      // carried no `muscleGroup`; null and undefined are what a reader
      // that bypasses that COALESCE would hand us. All three must land
      // on the movement's own label rather than on a template literal's
      // rendering of the sentinel.
      ['custom', null, undefined].forEach((stored) => {
        const subject = measurementSubjectZh(stored, metricKey);
        expect(subject).not.toBeNull();
        FORBIDDEN_IN_A_SUBJECT_LABEL.forEach((token) => {
          expect(subject).not.toContain(token);
        });
      });
    });
  });

  it('用力闭眼这一条在三份导出里都有名字，没有一份印出 custom / null / undefined', () => {
    MAXIMAL_ENVELOPES.forEach(([format, envelope]) => {
      const serialised = JSON.stringify(envelope.document);
      FORBIDDEN_IN_A_SUBJECT_LABEL.forEach((token) => {
        expect(serialised, `${format} 的文件里出现了「${token}肌力」`).not.toContain(
          `${token}肌力`,
        );
      });
    });
    // And it is not merely absent — the grade actually travelled, under
    // the movement's own name, in the two formats that carry strength.
    const [, treatNmd] = MAXIMAL_ENVELOPES.find(([format]) => format === 'treat-nmd')!;
    const [, fhir] = MAXIMAL_ENVELOPES.find(([format]) => format === 'fhir-r4')!;
    expect(JSON.stringify(treatNmd.document)).toContain('用力闭眼肌力');
    expect(JSON.stringify(fhir.document)).toContain('用力闭眼肌力');
  });

  /**
   * DEFECT 4's CLASS. Each of the three genetic cells the baseline
   * questionnaire has a box for, in BOTH of its states — read off the
   * evidence document, and held only in the archive — asked of all three
   * envelopes.
   *
   * The archive-only state is the one that produced three different
   * answers about one number, and it is a state no fixture had.
   */
  GENETIC_ARCHIVE_CELL_LABELS_ZH.forEach((labelZh) => {
    FORMATS.forEach(([format]) => {
      it(`${format}：只存在于档案里、报告上没有的「${labelZh}」，要么写进文件，要么在 omissions 里点名`, () => {
        const envelope = build(format, EXPORT_FIXTURE_PROFILE_ARCHIVE_ONLY_GENETICS);
        const inDocument = JSON.stringify(envelope.document).includes(labelZh);
        const inOmissions = envelope.omissions.some((entry) => entry.reasonZh.includes(labelZh));
        expect(
          inDocument || inOmissions,
          `${format} 对「${labelZh}」既不承载也不声明。` +
            '基线问卷为这一项留了输入框，患者填了值而基因证据文件上没有这一项时，' +
            '三份导出必须各自给出一个答案——TREAT-NMD 印出来，另外两份声明它。',
        ).toBe(true);
      });
    });
  });

  it('档案里有、报告上没有的那一项，FHIR 不承载但点名，Phenopacket 不再把接收方指向 FHIR', () => {
    const fhir = build('fhir-r4', EXPORT_FIXTURE_PROFILE_ARCHIVE_ONLY_GENETICS);
    expect(JSON.stringify(fhir.document)).not.toContain('甲基化水平 32%');
    const declaration = fhir.omissions.find((entry) => entry.reasonZh.includes('甲基化'));
    expect(declaration).toBeDefined();
    expect(declaration?.reasonZh).toContain('derivedFrom');

    const treatNmd = build('treat-nmd', EXPORT_FIXTURE_PROFILE_ARCHIVE_ONLY_GENETICS);
    expect(JSON.stringify(treatNmd.document)).toContain('甲基化水平 32%');

    // The Phenopacket's pointer used to read 「凡是本平台…档案里记着的，都…
    // 出现在…FHIR 导出的 Observation 里」, which sent a receiver to a bundle
    // that does not hold the value — and a receiver who follows a pointer
    // and finds nothing concludes the patient has nothing.
    const pheno = build('phenopacket', EXPORT_FIXTURE_PROFILE_ARCHIVE_ONLY_GENETICS);
    const readings = pheno.omissions.find((entry) =>
      entry.field.includes('基因报告上的读数'),
    )?.reasonZh;
    expect(readings).toBeDefined();
    expect(readings).toContain('只记在本平台档案里');
    expect(readings).toContain('FHIR 导出不承载它们');
  });

  /**
   * THE COMPILE-TIME HALF, and the one with the longest reach.
   *
   * Every column on `PatientProfileDTO` names the FACTS rows that
   * account for it. `Record<keyof PatientProfileDTO, …>` means adding a
   * column to the DTO does not typecheck until somebody has written down
   * which fact rows cover it — and writing 「nothing here is clinical」 is
   * a fine answer, made explicitly, in a file whose whole subject is
   * what the exports do and do not carry.
   *
   * This is the mechanism that would have caught the family-history
   * defect and the two notes stores. It would NOT have caught any of the
   * four listed at the top of this block: all four hang off `documents`
   * or `measurements`, which have had rows since the table was written.
   * It is here because it closes a different door on the same corridor,
   * and it costs one line per column.
   */
  const DTO_COVERAGE: Record<keyof PatientProfileDTO, readonly string[]> = {
    id: [],
    userId: [],
    createdAt: [],
    updatedAt: [],
    fullName: ['姓名与称呼'],
    preferredName: ['姓名与称呼'],
    dateOfBirth: ['出生年份'],
    gender: ['性别'],
    patientCode: ['本平台内部的患者编号'],
    diagnosisStage: ['诊断进度（患者自己勾选的）'],
    diagnosisDate: ['确诊年份'],
    geneticMutation: ['FSHD 分型'],
    heightCm: ['身高 / 体重 / 血型'],
    weightKg: ['身高 / 体重 / 血型'],
    bloodType: ['身高 / 体重 / 血型'],
    contactPhone: ['联系电话与邮箱'],
    contactEmail: ['联系电话与邮箱'],
    primaryPhysician: ['确诊医生 / 主诊医生姓名'],
    regionProvince: ['常住地区'],
    regionCity: ['常住地区'],
    regionDistrict: ['常住地区'],
    // The baseline JSONB is many facts, not one. Listed exhaustively
    // rather than waved at, because it is the column every one of the
    // four defects' neighbours came out of.
    baseline: [
      'FSHD 分型',
      '确诊年份',
      'D4Z4 重复单元数',
      '4q 单倍型',
      '甲基化',
      '起病部位',
      '家族史陈述',
      '基线问卷的困难程度自评',
      '基线问卷记录的身体状况（抬臂 / 面部 / 足下垂 / 呼吸）',
      '正在使用的辅助器具',
      '基线记录的行走状态',
      '出生年份',
      '姓名与称呼',
      '基线备注（baseline_payload.notes）',
      // §B3's markers live in the baseline payload's own provenance
      // block — `listBaselineFieldOrigins` reads it out of this column.
      '管理员代填的基线字段标记（§B3）',
    ],
    notes: ['档案备注（patient_profiles.notes）'],
    measurements: ['徒手肌力（MRC）'],
    functionTests: ['功能测试'],
    symptomScores: ['症状自评（随访）'],
    dailyImpacts: ['日常活动困难程度（随访）'],
    followupEvents: ['里程碑事件（轮椅 / NIV / AFO）', '其他随访事件（跌倒等）——事件本身'],
    activityLogs: ['患者写的日常记录'],
    documents: [
      '上传的报告文件',
      '报告上写的检测方法',
      'EcoRI 片段',
      // The lab / pulmonary / cardiac / imaging / MRC readings parsed
      // off these documents deliberately have NO row in FACTS. They are
      // enumerated by `REPORT_FIELD_INVENTORY` and asserted by the
      // derived block above — a hand-written row per reading would be a
      // second copy of a table that already exists, and the copy is what
      // goes stale.
      // Both are READ OFF the evidence document by
      // `buildClinicalPassportSummary` and carried on `NormalisedSource`
      // rather than stored anywhere — the archive contributes the boxes,
      // the document contributes the reading, and the verdict is neither.
      '是否基因确诊',
      '基因证据分级（本平台的判定）',
    ],
    medications: ['用药记录'],
  };

  /**
   * FACTS THAT ARE NOT ON `PatientProfileDTO` AT ALL.
   *
   * `normaliseSource` reads exactly one shape, and two of the facts in
   * the table above come out of tables that shape does not include. They
   * are declared here with the store named, rather than filed under a
   * DTO column they do not live in — a coverage table whose entries are
   * approximately true is the failure mode this whole file is about, and
   * 「the falls diary is covered by `followupEvents`」 is precisely the
   * mistake the FACTS row for it was written to undo.
   *
   * A fact landing HERE is also a signal: it is a fact no export can
   * carry today no matter what the serialisers do, because the
   * normaliser cannot see it. Both of these are declared by all three.
   */
  const OFF_DTO_FACTS: Readonly<Record<string, readonly string[]>> = {
    'patient_instruments（migration 022）': ['Brooke / Vignos 分级'],
    'patient_falls（migration 023）': [
      '跌倒日记的五项结构化明细（活动 / 室内外 / 手是否占用 / 能否自行起身 / 是否受伤）',
    ],
  };

  it('DTO 上的每一列都指向真实存在的 FACTS 行', () => {
    const known = new Set(FACTS.map((row) => row.factZh));
    const dangling = [...Object.entries(DTO_COVERAGE), ...Object.entries(OFF_DTO_FACTS)].flatMap(
      ([column, facts]) =>
        facts.filter((fact) => !known.has(fact)).map((fact) => `${column} -> ${fact}`),
    );
    expect(
      dangling,
      'DTO_COVERAGE / OFF_DTO_FACTS 指向了 FACTS 里没有的行。重命名 factZh 时两处要一起改，' +
        '否则这层编译期保护会退化成一张对不上的表。',
    ).toEqual([]);
  });

  it('FACTS 里的每一行都被某一列或某个已点名的存储认领', () => {
    const claimed = new Set([
      ...Object.values(DTO_COVERAGE).flat(),
      ...Object.values(OFF_DTO_FACTS).flat(),
    ]);
    const orphans = FACTS.map((row) => row.factZh).filter((fact) => !claimed.has(fact));
    expect(
      orphans,
      '这些事实没有任何 DTO 列认领，也没有写明它来自哪个 normaliseSource 看不见的表。' +
        '要么补一列，要么把它连同存储名写进 OFF_DTO_FACTS——' +
        '「大概挂在某一列下面」正是这张表存在要防的那种说法。',
    ).toEqual([]);
  });
});
