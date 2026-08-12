import { describe, expect, it } from 'vitest';

import { locatorsIn } from './__fixtures__/reason-claims.js';

/**
 * The fixture `locatorsIn` is calibrated against.
 *
 * The helper exists so a reason cannot point a receiving hospital at a
 * section the document does not have. It was written once, tried only
 * on the three reasons that shipped that day, and made both the
 * brackets and the 一 of 「运动功能」一节 optional — which turned every
 * word ending in 节 into a document locator. 关节 is core FSHD
 * vocabulary (关节活动度 is a measurement this platform collects) and
 * this whole export module writes prose about orthoses, so the false
 * positive is not hypothetical: appending 「这些测量的细节见各条
 * Observation。」 to the live FHIR reason returned `['这些测量的细节']`
 * and reddened `expect(locatorsIn(reason)).toEqual([])`.
 *
 * A test author cannot fix that by editing the helper's callers — two
 * of the three assert an empty array and the third feeds every locator
 * back into the serialised document — so the only move left is bending
 * a patient-facing Chinese sentence around a regex. Hence both
 * directions pinned here, on sentences rather than on whichever three
 * reasons happen to ship:
 *
 *   - POINTERS is every shape the exports use to point INTO the
 *     document, with the exact locator each must yield.
 *   - NOT_POINTERS is prose these reasons legitimately contain that
 *     points at nothing: ordinary 节 words, and path-looking tokens
 *     with no dot.
 *
 * A widening that catches a new pointer shape has to leave NOT_POINTERS
 * empty, and a narrowing that silences a false positive has to leave
 * POINTERS resolving. Neither list is derivable from the other.
 */
describe('locatorsIn — a place in the document, not any word ending in 节', () => {
  /** [reason fragment, the locators it points at]. */
  const POINTERS: Array<[string, string[]]> = [
    // Verbatim from the shipped TREAT-NMD reason (treat-nmd.ts): the
    // dotted shape, two of them in one sentence.
    [
      '若患者在填写 Vignos 时选择了同步到基线，由分级推出的行走状态会出现在 sections.motorFunction 的 motor.ambulation 与 sections.wheelchairUse 的 wheelchair.currentState，分级本身仍然不在。',
      [
        'sections.motorFunction',
        'motor.ambulation',
        'sections.wheelchairUse',
        'wheelchair.currentState',
      ],
    ],
    // The bracketed named section, which is what the helper's own doc
    // comment cites.
    ['基线行走状态见「运动功能」一节。', ['运动功能']],
    ['轮椅相关信息在「轮椅使用」一节。', ['轮椅使用']],
    // The unbracketed named section: the round-one wording that this
    // module actually shipped. The name is bounded on the left by the
    // pointing particle, so the locator is 运动功能 and not the run of
    // prose in front of it.
    ['由分级推出的行走状态会出现在运动功能一节。', ['运动功能']],
    // A section name that is itself a 节 word must still resolve — the
    // narrowing is about the shape of the pointer, not about banning a
    // vocabulary.
    ['详见关节活动度一节。', ['关节活动度']],
  ];

  /** Prose that points nowhere. Every one of these is a sentence an
   *  FSHD export reason can reasonably contain. */
  const NOT_POINTERS = [
    // The one that reproduced as a red test on the live FHIR reason.
    '这些测量的细节见各条 Observation。',
    '本导出不含关节活动度数据。',
    '本导出不含评估关节活动度所需的数据。',
    '该数据集共有六个章节，本导出不编造章节数。',
    '手术麻醉只是围手术期管理中的一个环节。',
    '随访频率按季节和患者情况调整。',
    '这一节说明留在采集方本地的字段。',
    // Verbatim from the shipped Phenopacket and FHIR reasons.
    '本文件不含任何行走能力或运动功能数据。',
    '基线行走状态不在本 Bundle 中；需要它请向患者索取，或改用 TREAT-NMD 对齐导出。',
    // A path-looking token with no dot is not a place in this document.
    '分级本身请调用 /me/instruments 获取。',
  ];

  it.each(POINTERS)('points at something: %s', (reason, expected) => {
    expect(locatorsIn(reason)).toEqual(expected);
  });

  it.each(NOT_POINTERS)('points at nothing: %s', (reason) => {
    expect(locatorsIn(reason)).toEqual([]);
  });
});
