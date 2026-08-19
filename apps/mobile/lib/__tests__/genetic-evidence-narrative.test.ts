import { isLaboratoryGeneticReport, type GeneticEvidenceDocumentLike } from '../genetic-evidence';

/**
 * 「这一页上的行文，写的是一个人的故事，还是一次检查对结果的判断」。
 *
 * 这条判定是 `isLaboratoryGeneticReport` 的第二步，服务端
 * apps/api/src/modules/patient-profile/genetic-evidence.ts 上还有同一份，
 * 助手侧的资格门也用它。它以前是整页做子串匹配 —— 命中十七个词里任意
 * 一个就算病历 —— 于是两类真报告被判成病历：顶上印着申请单、把
 * 主诉 / 现病史 当表单列印出来的影像与肌电图报告；以及结论收尾写
 * 「请结合临床及查体」「与主诉相符」「结合既往史」的那些，那是放射科医师
 * 在参考病史，恰好是这份文件不是病历的证据。
 *
 * 现在按位置读。判不出来的一律仍然算病历 —— 判错成病历只损失一次判读，
 * 判错成报告是拿实验室的口吻说一句没有实验室背书的话。
 */
describe('叙述判定读的是版式，不是词表（与服务端同一份规则）', () => {
  const document = (extractedText: string): GeneticEvidenceDocumentLike => ({
    id: 'doc',
    documentType: 'genetic_report',
    status: 'parsed',
    uploadedAt: '2026-02-01T00:00:00.000Z',
    ocrPayload: {
      fields: {
        classifiedType: 'genetic_report',
        documentType: 'genetic_report',
        geneticTestMethod: 'Southern blot',
        d4z4RepeatPathogenic: '4',
      },
      extractedText,
    },
  });

  const LABORATORY_BODY =
    '检测项目：FSHD1 D4Z4 重复数检测\n检测方法：Southern blot\n检测结果：D4Z4 重复单元 4 个。';

  it('申请单把 主诉/现病史 排成表单列的真报告，判读留住', () => {
    expect(
      isLaboratoryGeneticReport(
        document(
          '示例医学检验实验室 遗传病检测报告\n' +
            '送检单位：神经内科        送检医师：李某某\n' +
            '主诉：双上肢无力8年        现病史：进行性加重\n' +
            LABORATORY_BODY,
        ),
      ),
    ).toBe(true);
  });

  it('结论收尾写「请结合临床及查体」的真报告，判读留住', () => {
    expect(
      isLaboratoryGeneticReport(
        document(
          `示例医学检验实验室 遗传病检测报告\n${LABORATORY_BODY}\n` +
            '检测结论：检出致病性 D4Z4 重复数收缩，请结合临床及查体。',
        ),
      ),
    ).toBe(true);
  });

  it('页面自称病历摘要时，抄得再全也拦住', () => {
    expect(
      isLaboratoryGeneticReport(
        document(`示例医院 门诊病历摘要\n主诉：双肩无力7年。\n附：${LABORATORY_BODY}`),
      ),
    ).toBe(false);
  });

  it('一行一段的病历章节仍然算，OCR 压成一行、句号分隔的也算', () => {
    expect(
      isLaboratoryGeneticReport(
        document(`主诉：双下肢无力4年。\n现病史：缓慢进展。\n${LABORATORY_BODY}`),
      ),
    ).toBe(false);
    expect(
      isLaboratoryGeneticReport(
        document(`主诉：双下肢无力4年。现病史：缓慢进展。\n${LABORATORY_BODY}`),
      ),
    ).toBe(false);
  });

  it('只有一列的 主诉 判不出来是谁写的，仍然算病历', () => {
    expect(isLaboratoryGeneticReport(document(`主诉：双下肢无力5年\n${LABORATORY_BODY}`))).toBe(
      false,
    );
  });
});
