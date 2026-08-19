import re
import unittest

import app.services.fshd_report_service as fshd_report_service
from app.services.fshd_report_service import (
    MEDICAL_SUMMARY_STRUCTURE_MARKERS,
    analyze_fshd_report,
    extract_lab_table_rows,
)


class FshdReportServiceCoverageTest(unittest.TestCase):
    def test_blood_routine(self):
        text = """
        示例市第一人民医院检验报告单
        检验目的: 血常规
        白细胞计数(WBC) 6.69 3.5-9.5
        血红蛋白量(HGB) 155 130-175
        血小板计数(PLT) 249 125-350
        """
        result = analyze_fshd_report(text, "other", "Blood Routine Examination.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "blood_routine")
        panel = result["fshd"]["normalized_summary"]["lab_panel"]
        self.assertEqual(panel["wbc"], 6.69)
        self.assertEqual(panel["hgb"], 155.0)
        self.assertEqual(panel["plt"], 249.0)

    def test_abdominal_ultrasound(self):
        text = """
        示例市第一人民医院 彩色超声诊断报告单
        检查部位: 男性全腹彩超
        检查所见:
        肝大小形态正常，胆囊欠光滑，胰腺形态大小正常，脾大小形态正常。
        检查提示:
        胆囊壁毛糙
        """
        result = analyze_fshd_report(text, "other", "Color Ultrasound for Abdomen.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "abdominal_ultrasound")
        fields = {item["field_name"]: item["field_value"] for item in result["fshd"]["structured_fields"]}
        self.assertIn("胆囊壁毛糙", fields["abdominal_ultrasound_impression"])

    def test_diaphragm_ultrasound(self):
        text = """
        示例市第一人民医院 彩色超声诊断报告单
        检查部位: 膈肌彩超
        活动度(cm) QB DB VS 膈肌厚度(mm) E-E E-I D-I
        右侧膈肌 1.47 5.32 1.67 1.9 2.8 7.1
        左侧膈肌 1.28 4.81 2.12 1.9 2.3 4.8
        检查提示:
        双侧膈肌运动及增厚率未见明显异常声像
        """
        result = analyze_fshd_report(text, "other", "Color Ultrasound for Diaphragm.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "diaphragm_ultrasound")
        panel = result["fshd"]["normalized_summary"]["cardio_respiratory_panel"]
        self.assertEqual(panel["right_qb"], 1.47)
        self.assertEqual(panel["left_di"], 4.8)
        self.assertIn("未见明显异常", panel["diaphragm_motion_summary"])

    def test_echocardiography(self):
        text = """
        示例市第一人民医院 彩色超声诊断报告单
        检查部位: 心脏彩色多普勒超声
        HR: 58bpm AoD: 2.81cm LAD: 2.93cm LVDd: 4.58cm
        FS: 37.42% EF: 67.42%
        检查所见:
        左房未见明显增大，左室内径正常，整体收缩功能正常。
        检查提示:
        房室大小及LVEF值正常范围（检查时心动过缓）
        """
        result = analyze_fshd_report(text, "other", "Color Ultrasound for Heart.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "echocardiography")
        panel = result["fshd"]["normalized_summary"]["cardio_respiratory_panel"]
        self.assertEqual(panel["lvef"], 67.42)
        self.assertIn("LVEF值正常范围", panel["echo_summary"])

    def test_ecg(self):
        text = """
        示例市第一人民医院 心电图报告
        心率: 70 bpm P-R间期: 180 ms QRS时限: 88 ms QT/QTc: 358/386 ms
        心电图诊断:
        窦性心律不齐
        不完全性右束支传导阻滞
        """
        result = analyze_fshd_report(text, "other", "ECG.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "ecg")
        panel = result["fshd"]["normalized_summary"]["cardio_respiratory_panel"]
        self.assertEqual(panel["heart_rate"], 70.0)
        self.assertEqual(panel["pr_interval_ms"], 180.0)
        self.assertIn("右束支传导阻滞", panel["ecg_summary"])

    def test_thyroid_function(self):
        text = """
        示例市第一人民医院核医学报告单
        检验目的: FT3、FT4、STSH
        游离T3(FT3) 6.000 3.5-6.59
        游离T4(FT4) 13.580 11.5-22.7
        超敏促甲状腺素(TSH3) 1.995 0.55-4.78
        """
        result = analyze_fshd_report(text, "other", "FT3、FT4.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "thyroid_function")
        panel = result["fshd"]["normalized_summary"]["lab_panel"]
        self.assertEqual(panel["ft3"], 6.0)
        self.assertEqual(panel["ft4"], 13.58)
        self.assertEqual(panel["tsh"], 1.995)

    def test_infection_screening_hbv(self):
        text = """
        示例市第一人民医院检验报告单
        检验目的: 乙肝两对半定量+HIV.
        乙型肝炎病毒表面抗原(HBsAg) 0.00(-) <0.05
        抗乙型肝炎病毒表面抗体(Anti-HBs) 0.35(-) <10
        乙型肝炎病毒e抗原(HBeAg) 0.56(-) <1.0
        抗乙型肝炎病毒e抗体(Anti-HBe) 1.92(-) >1.0
        抗乙型肝炎病毒核心抗体(Anti-HBc) 0.10(-) <1.0
        人类免疫缺陷病毒抗原抗体联合检测(HIV) 0.06(-) <1.0
        丙型肝炎病毒抗体(Anti-HCV) 0.07(-) <1.0
        """
        result = analyze_fshd_report(text, "other", "HBV Test.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "infection_screening")
        panel = result["fshd"]["normalized_summary"]["lab_panel"]
        self.assertEqual(panel["hbsag"], "阴性(-)")
        self.assertEqual(panel["hiv_ab"], "阴性(-)")

    def test_stool_hp_breath(self):
        text = """
        示例市第一人民医院13C呼气试验检验报告
        Basal 0.0
        30-Minutes 15.8
        检测结果:DOB=15.8 阳性+
        样本次检测结果为阳性+
        """
        result = analyze_fshd_report(text, "other", "HP.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "stool_test")
        panel = result["fshd"]["normalized_summary"]["lab_panel"]
        self.assertEqual(panel["hp_dob"], 15.8)
        self.assertEqual(panel["hp_result"], "阳性+")

    def test_muscle_enzyme(self):
        text = """
        示例市第一人民医院核医学报告单
        检验目的: 血清肌红蛋白(Mb)
        肌红蛋白(MYO) 158.810 ↑ 0-110 ug/L
        """
        result = analyze_fshd_report(text, "other", "Mb.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "muscle_enzyme")
        panel = result["fshd"]["normalized_summary"]["lab_panel"]
        self.assertEqual(panel["mb"], 158.81)

    def test_muscle_mri(self):
        text = """
        示例市第一人民医院 磁共振检查报告单
        检查项目: 双侧小腿肌肉MRI平扫
        影像所见:
        右侧小腿腓肠肌内侧头、右侧胫前肌肌腹片状短T1长T2信号影，左侧腓肠肌内侧头、胫骨前肌与趾长伸肌肌腹片絮状长T1长T2信号影。
        印象:
        右侧腓肠肌内侧头、双侧胫骨前肌与趾长伸肌脂肪浸润。
        """
        result = analyze_fshd_report(text, "other", "Muscle MRI Scan.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "muscle_mri")
        self.assertIn("脂肪浸润", result["fshd"]["normalized_summary"]["mri_summary"]["report_impression"])

    def test_pulmonary_function(self):
        text = """
        示例市第一人民医院 通气弥散残气检查报告
        FVC [L] 5.55 3.45 62.1
        FEV1 [L] 4.65 3.03 65.0
        FEV1/FVC [%] 83.20 87.72 105.4
        TLC-SB [L] 7.54 5.54 73.4
        DLCO-SB [mmol/min/kPa] 12.65 10.27 81.2
        结论:
        中度限制性通气功能障碍，正常肺弥散功能（一口气弥散法）。
        """
        result = analyze_fshd_report(text, "other", "Pulmonay Ventilation Test.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "pulmonary_function")
        panel = result["fshd"]["normalized_summary"]["cardio_respiratory_panel"]
        self.assertEqual(panel["fvc"], 3.45)
        self.assertEqual(panel["fvc_pred_pct"], 62.1)
        self.assertEqual(panel["ventilatory_pattern"], "restrictive")

    def test_biochemistry(self):
        text = """
        示例市第一人民医院检验报告单
        检验目的: 生化全套检查
        谷丙转氨酶(ALT) 21 9-50
        谷草转氨酶(AST) 23 15-40
        肌酸激酶(CK) 693 ↑ 50-310
        尿素(UREA) 4.11 3.10-8.0
        肌酐(CREA) 40.0 57-97
        葡萄糖(GLU) 4.52 3.90-6.10
        总胆固醇(TCHO) 3.68 3.0-5.18
        """
        result = analyze_fshd_report(text, "other", "routine biochemistry test.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "biochemistry")
        panel = result["fshd"]["normalized_summary"]["lab_panel"]
        self.assertEqual(panel["alt"], 21.0)
        self.assertEqual(panel["ast"], 23.0)
        self.assertEqual(panel["creatinine"], 40.0)

    def test_urinalysis(self):
        text = """
        示例市第一人民医院检验报告单
        检验目的: 尿沉渣定量+尿常规
        颜色 黄色
        透明度 澄清
        葡萄糖(GLU) 阴性
        蛋白质(PRO) 阴性
        潜血(OB) 阴性
        白细胞 2.10
        红细胞(RBC) 2.10
        """
        result = analyze_fshd_report(text, "other", "urinalysis.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "urinalysis")
        panel = result["fshd"]["normalized_summary"]["lab_panel"]
        self.assertEqual(panel["urine_color"], "黄色")
        self.assertEqual(panel["urine_protein"], "阴性")
        self.assertEqual(panel["urine_occult_blood"], "阴性")

    def test_coagulation_panel(self):
        text = """
        示例市第一人民医院检验报告单
        检验目的: 凝血全套
        凝血酶原时间(PT) 13.7 11.0-14.5
        国际标准化比值(PT-INR) 1.12
        活化部分凝血活酶时间(APTT) 34.0 26.0-45.0
        纤维蛋白原(Fg) 2.68 2.0-4.0
        凝血酶时间(TT) 17.4 14.1-20.1
        """
        result = analyze_fshd_report(text, "other", "Whole Set Test for Coagulation.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "coagulation")
        panel = result["fshd"]["normalized_summary"]["lab_panel"]
        self.assertEqual(panel["pt"], 13.7)
        self.assertEqual(panel["aptt"], 34.0)
        self.assertEqual(panel["fibrinogen"], 2.68)

    def test_d_dimer(self):
        text = """
        示例市第一人民医院检验报告单
        检验目的: D-二聚体定量
        D-二聚体定量(D-Dimer) 0.06 0-0.55
        """
        result = analyze_fshd_report(text, "other", "D-Dimer.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "coagulation")
        panel = result["fshd"]["normalized_summary"]["lab_panel"]
        self.assertEqual(panel["d_dimer"], 0.06)

    def test_syphilis_screening(self):
        text = """
        示例市第一人民医院检验报告单
        检验目的: TPPA+TRUST滴度
        抗梅毒螺旋体抗体(TPPA) 阴性(-) 阴性
        抗梅毒螺旋体非特异性抗体(TRUST) 阴性(-) 阴性
        TRUST滴度 阴性(-) 阴性
        """
        result = analyze_fshd_report(text, "other", "Syphilis Test.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "infection_screening")
        panel = result["fshd"]["normalized_summary"]["lab_panel"]
        self.assertTrue(panel["tppa"].startswith("阴性"))
        self.assertTrue(panel["trust_ab"].startswith("阴性"))

    def test_syphilis_screening_table_cells_on_separate_lines(self):
        """The layout PaddleOCR actually produces for a lab table.

        Every cell is its own detected text box, so a row arrives as
        four consecutive lines instead of one. The fixture above keeps
        a row on one line and passed throughout, while this exact
        report — 813 characters of text, classified `infection_screening`
        at 0.99 — produced `field_count: 0` in production and a summary
        that told the patient「具体结果：未提供」.
        """
        text = "\n".join([
            "示例市第一人民医院检验报告单",
            "检验目的：TPPA+TRUST滴度",
            "项目",
            "结果",
            "参考区间",
            "抗梅毒螺旋体抗体(TPPA)",
            "阴性（-)",
            "阴性",
            "凝集法",
            "抗梅毒螺旋体非特异性抗体(TRUST)",
            "阴性（-）",
            "阴性",
            "凝集法",
        ])
        result = analyze_fshd_report(text, "other", "Syphilis Test.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "infection_screening")
        panel = result["fshd"]["normalized_summary"]["lab_panel"]
        self.assertTrue(panel["tppa"].startswith("阴性"))
        self.assertTrue(panel["trust_ab"].startswith("阴性"))
        self.assertGreater(result["fshd"]["field_count"], 0)

    # Every case below is a real value pulled from the user's database.
    # They are all one of two shared failures: a block capture that ran
    # past its section, or a summary line that returned a header.
    def test_ecg_conclusion_stops_before_identifiers(self):
        """The ECG summary swallowed the whole report, MRN included.

        `ecgSummary` is on the API's precise prompt allowlist, so the
        captured 「住院号:R000000」 was reaching the LLM.
        """
        text = "\n".join([
            "心电图报告单",
            "姓名: 张三丰",
            "年龄:23",
            "科别:神经内科",
            "心电图诊断",
            "实性心律不齐",
            "不完全性右束支传导阻滞",
            "门诊号:",
            "住院号:R000000",
            "2023/12/2217:30:35",
            "本报告仅供临床医师结合临床参考,不作诊断证明之用)",
        ])
        result = analyze_fshd_report(text, "other", "ECG.jpeg")
        summary = result["fshd"]["normalized_summary"]["cardio_respiratory_panel"]["ecg_summary"]
        # Both halves matter. Truncating at the first identifier was the
        # first fix and it threw away findings: this ECG's OCR merged two
        # columns onto one line, so 「不完全性右束支传导阻滞」 sat after
        # 「年龄:23」 and went with it. Identifiers are excised as pairs;
        # the diagnosis around them survives.
        self.assertIn("不完全性右束支传导阻滞", summary)
        self.assertIn("实性心律不齐", summary)
        self.assertNotIn("R000000", summary)
        self.assertNotIn("住院号", summary)
        self.assertNotIn("年龄", summary)
        self.assertNotIn("本报告仅供", summary)
        self.assertNotIn("神经内科", summary)

    def test_mri_impression_drops_the_radiologist_signature(self):
        """「钱医」 is the reporting radiologist, not part of the finding."""
        text = "\n".join([
            "磁共振检查报告单",
            "印象:",
            "1. 右侧腓肠肌内侧头、双侧胫骨前肌与趾长伸肌脂肪浸润.",
            "2. 左侧腓肠肌内侧头、胫骨前肌与趾长伸肌炎性改变,请结合临床.",
            "钱医",
        ])
        result = analyze_fshd_report(text, "mri", "Muscle MRI.jpeg")
        impression = next(
            (f["field_value"] for f in result["fshd"]["structured_fields"]
             if f["field_name"] == "report_impression"),
            None,
        )
        self.assertIsNotNone(impression)
        self.assertIn("脂肪浸润", impression)
        self.assertNotIn("钱医", impression)
        # The header itself is not the impression.
        self.assertNotEqual(impression.strip(), "印象:")

    def test_diaphragm_summaries_are_values_not_headers(self):
        """「膈肌厚度(mm)」 is a column header; 「孙医」 is the sonographer."""
        text = "\n".join([
            "超声检查报告单",
            "膈肌厚度(mm)",
            "右侧膈肌 1.8 2.4 33.3",
            "检查提示",
            "双侧膈肌运动及增厚率未见明显异常声像 请结合临床",
            "孙医",
        ])
        result = analyze_fshd_report(text, "other", "Diaphragm.jpeg")
        panel = result["fshd"]["normalized_summary"]["cardio_respiratory_panel"]
        motion = panel.get("diaphragm_motion_summary")
        self.assertIsNotNone(motion)
        self.assertIn("未见明显异常", motion)
        self.assertNotIn("孙医", motion)
        # A thickening summary is a measurement; a header is not one, and
        # neither is the motion conclusion that happens to say 增厚率.
        thickening = panel.get("diaphragm_thickening_summary")
        self.assertNotEqual(thickening, "膈肌厚度(mm)")
        self.assertNotEqual(thickening, motion)

    def test_free_text_is_capped(self):
        """A stop-marker list is always incomplete; length is the backstop."""
        text = "\n".join(["磁共振检查报告单", "印象:"] + [f"第{i}段所见描述文字。" for i in range(60)])
        result = analyze_fshd_report(text, "mri", "Long.jpeg")
        impression = next(
            (f["field_value"] for f in result["fshd"]["structured_fields"]
             if f["field_name"] == "report_impression"),
            "",
        )
        self.assertLessEqual(len(impression), 201)

    def test_genetic_conclusion_is_the_finding_not_the_disclaimer(self):
        """A positive report was showing a caveat about negative results.

        The 附录信息-检测局限 section of a genetic report is a dozen
        numbered items thick with clinical vocabulary, so a keyword
        search over the whole page lands there: this report's
        `interpretation_summary` came out as a mid-sentence fragment of
        caveat #5 —「即使基因检测结果为阴性,仍建议以医生诊断…」— on a
        report whose own result is FSHD1-positive with D4Z4 = 3.
        """
        text = "\n".join([
            "基因检测报告",
            "检测结果",
            "本项目对受检者样本进行光学图谱分析,检出受检者在染色体4q35的D4Z4重复单元"
            "存在致病性杂合缺失变异,可导致1型面肩肱型肌营养不良症(FSHD1)",
            "D4Z4重复单元数: 3",
            "单倍型: 4qA",
            "遗传咨询和建议",
            "1. 建议根据该检测结果,对受检者进行进一步临床检查。",
            "附录信息 -检测局限",
            "4. 不能排除生殖细胞嵌合所致的解读偏差。",
            "5. 遗传因素并非受检者发病的主导原因。即使基因检测结果为阴性,"
            "仍建议以医生诊断、其他临床检测和家族史为准。",
        ])
        result = analyze_fshd_report(text, "genetic_report", "Genetic.pdf")
        summary = next(
            (f["field_value"] for f in result["fshd"]["structured_fields"]
             if f["field_name"] == "interpretation_summary"),
            None,
        )
        self.assertIsNotNone(summary)
        self.assertIn("FSHD1", summary)
        # None of the caveat text may appear in a conclusion.
        self.assertNotIn("为阴性", summary)
        self.assertNotIn("以医生诊断", summary)
        self.assertNotIn("解读偏差", summary)

    def test_generic_table_reads_analytes_nobody_wrote_a_pattern_for(self):
        """The per-analyte regexes only cover reports we have seen.

        Chinese lab reports share a shape —「No 项目 结果 参考区间 单位
        方法」— and PaddleOCR emits one cell per line, so a row is N
        consecutive lines. Reading the structure extracts every analyte
        on the page. Motivating case: an FT3/FT4/TSH panel classified at
        0.99 confidence produced 3 fields, because only three analytes
        had hand-written patterns.
        """
        rows = extract_lab_table_rows([
            "检验报告单",
            "No", "项目", "结果", "参考区间", "单位", "方法",
            "1", "游离T3(FT3)", "6.000", "3.5-6.59", "pmol/L", "化学发光法",
            "2", "游离T4(FT4)", "13.580", "11.5-22.7", "pmol/L", "化学发光法",
            "3", "某个没人写过规则的指标", "1.23", "1.0-2.0", "mg/L", "酶法",
        ])
        by_name = {r["name"]: r for r in rows}
        self.assertIn("游离T3(FT3)", by_name)
        self.assertEqual(by_name["游离T3(FT3)"]["value"], "6.000")
        self.assertEqual(by_name["游离T3(FT3)"]["unit"], "pmol/L")
        self.assertEqual(by_name["游离T3(FT3)"]["reference"], "3.5-6.59")
        # The whole point: an analyte with no hand-written pattern.
        self.assertIn("某个没人写过规则的指标", by_name)
        # A method is not a test, and a unit is not a test — both sit in
        # their own column and are followed by the next row's number.
        self.assertNotIn("化学发光法", by_name)
        self.assertNotIn("pmol/L", by_name)

    def test_generic_table_strips_row_numbers_and_metadata(self):
        rows = extract_lab_table_rows([
            "申请时间:2023-12-2014:01",
            "*1白细胞计数(WBC)", "6.69", "3.5-9.5", "10^9/L",
            "22血小板比积(PCT)", "0.23", "0.11-0.28", "%",
        ])
        names = [r["name"] for r in rows]
        # The leading index is the table's own numbering, not the name.
        self.assertIn("白细胞计数(WBC)", names)
        self.assertIn("血小板比积(PCT)", names)
        # `label:value` is report metadata, not a results row.
        self.assertFalse(any("申请时间" in n for n in names))

    def test_il6(self):
        text = """
        示例市第一人民医院检验报告单
        检验目的: IL-6
        白介素6(IL-6) 2.04 <10 pg/ml
        """
        result = analyze_fshd_report(text, "other", "IL-6.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "biochemistry")
        panel = result["fshd"]["normalized_summary"]["lab_panel"]
        self.assertEqual(panel["il6"], 2.04)

    def test_stool_routine(self):
        text = """
        示例市第一人民医院检验报告单
        检验目的: 粪便常规+粪便隐血
        颜色 黄色
        硬度 软
        血液 阴性(-)
        粘液 阴性(-)
        红细胞 阴性(-)
        白细胞 阴性(-)
        脂肪球 阴性(-)
        隐血试验(OBT) 阴性(-)
        """
        result = analyze_fshd_report(text, "other", "stool test.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "stool_test")
        panel = result["fshd"]["normalized_summary"]["lab_panel"]
        self.assertEqual(panel["stool_color"], "黄色")
        self.assertEqual(panel["stool_occult_blood"], "阴性(-)")


class GeneticMethodAndRangeTest(unittest.TestCase):
    """Which test was run, and what it actually said.

    The single most valuable thing this product can tell a Chinese FSHD
    patient is that a negative whole-exome report is not a negative
    answer — it is the wrong test. That claim only exists downstream if
    something up here records which test it was, and records it without
    ever guessing: telling somebody their real Southern blot was
    inapplicable would send them to pay for a second one.
    """

    @staticmethod
    def _field(result, name):
        return next(
            (f for f in result["fshd"]["structured_fields"] if f["field_name"] == name),
            None,
        )

    def test_southern_blot_is_recognised(self):
        text = "\n".join([
            "基因检测报告",
            "检测方法: EcoR I + Bln I 双酶切,脉冲场凝胶电泳,p13E-11探针Southern blotting",
            "检测结果",
            "D4Z4重复单元数: 4",
            "单倍型: 4qA",
        ])
        result = analyze_fshd_report(text, "genetic_report", "SB.pdf")
        self.assertEqual(result["fshd"]["report_type"], "genetic_report")
        self.assertEqual(
            result["fshd"]["normalized_summary"]["genetic_summary"]["genetic_test_method"],
            "southern_blot",
        )

    def test_optical_genome_mapping_is_recognised(self):
        text = "\n".join([
            "基因检测报告",
            "本项目对受检者样本进行光学基因组图谱(Optical Genome Mapping)分析",
            "检测结果",
            "D4Z4重复单元数: 3",
        ])
        result = analyze_fshd_report(text, "genetic_report", "OGM.pdf")
        self.assertEqual(
            result["fshd"]["normalized_summary"]["genetic_summary"]["genetic_test_method"],
            "optical_genome_mapping",
        )

    def test_whole_exome_is_recognised_as_short_read(self):
        """The report that this whole feature exists for."""
        text = "\n".join([
            "基因检测报告",
            "检测项目: 全外显子组测序(WES)",
            "检测结果",
            "未检出与受检者临床表型相关的明确致病变异",
        ])
        result = analyze_fshd_report(text, "genetic_report", "WES.pdf")
        self.assertEqual(
            result["fshd"]["normalized_summary"]["genetic_summary"]["genetic_test_method"],
            "short_read_sequencing",
        )

    def test_limitations_section_does_not_relabel_a_wes_report(self):
        """A WES report's caveats tell you to go do a Southern blot.

        Search the whole page and every negative exome report looks like
        a Southern blot — which is precisely backwards, and would hide
        the one sentence this patient needs. The detector reads the body
        with the boilerplate tail already removed.
        """
        text = "\n".join([
            "基因检测报告",
            "检测项目: 全外显子组测序",
            "检测结果",
            "未检出与受检者临床表型相关的明确致病变异",
            "附录信息 -检测局限",
            "1. 本方法无法检测D4Z4重复序列长度。如临床怀疑FSHD,",
            "建议行脉冲场凝胶电泳联合p13E-11探针的Southern blotting检测。",
        ])
        result = analyze_fshd_report(text, "genetic_report", "WES.pdf")
        self.assertEqual(
            result["fshd"]["normalized_summary"]["genetic_summary"]["genetic_test_method"],
            "short_read_sequencing",
        )

    def test_two_platforms_in_the_body_are_ambiguous_not_a_guess(self):
        text = "\n".join([
            "基因检测报告",
            "检测方法: 全外显子组测序,以及Southern blotting分析",
            "检测结果",
            "详见下文",
        ])
        result = analyze_fshd_report(text, "genetic_report", "Both.pdf")
        self.assertEqual(
            result["fshd"]["normalized_summary"]["genetic_summary"]["genetic_test_method"],
            "ambiguous",
        )

    def test_no_method_named_stays_unset(self):
        text = "\n".join([
            "基因检测报告",
            "检测结果",
            "D4Z4重复单元数: 3",
            "单倍型: 4qA",
        ])
        result = analyze_fshd_report(text, "genetic_report", "Plain.pdf")
        self.assertIsNone(
            result["fshd"]["normalized_summary"]["genetic_summary"]["genetic_test_method"]
        )
        self.assertIsNone(self._field(result, "genetic_test_method"))

    def test_d4z4_range_is_kept_as_a_range(self):
        """「1-10」 used to be reported as 「1」.

        `D4Z4[^\\d]{0,16}(\\d+)` takes the first number it sees, so a
        lab's stated interval became a confident single figure — and one
        inside the 1–4 window that gates the passport's ophthalmology
        recommendation.
        """
        text = "\n".join([
            "基因检测报告",
            "检测结果",
            "D4Z4重复单元数: 1-10",
        ])
        result = analyze_fshd_report(text, "genetic_report", "Range.pdf")
        field = self._field(result, "d4z4_repeat_pathogenic")
        self.assertIsNotNone(field)
        self.assertEqual(field["field_value"], "1-10")
        # The typed count must be empty: only the raw text is honest.
        summary = result["fshd"]["normalized_summary"]["genetic_summary"]
        self.assertIsNone(summary["d4z4_repeat_pathogenic"])
        self.assertIsNone(result["d4z4_repeats"])

    def test_a_plain_count_still_normalizes_to_an_int(self):
        text = "\n".join([
            "基因检测报告",
            "检测结果",
            "D4Z4重复单元数: 3",
        ])
        result = analyze_fshd_report(text, "genetic_report", "Single.pdf")
        field = self._field(result, "d4z4_repeat_pathogenic")
        self.assertEqual(field["field_value"], "3")
        self.assertEqual(field["normalized_value"], 3)
        self.assertEqual(
            result["fshd"]["normalized_summary"]["genetic_summary"]["d4z4_repeat_pathogenic"], 3
        )
        self.assertEqual(result["d4z4_repeats"], 3)

    def test_a_slash_pair_is_still_a_pair_not_a_range(self):
        text = "\n".join([
            "基因检测报告",
            "检测结果",
            "D4Z4重复单元数: 3/11",
        ])
        result = analyze_fshd_report(text, "genetic_report", "Pair.pdf")
        summary = result["fshd"]["normalized_summary"]["genetic_summary"]
        self.assertEqual(summary["d4z4_repeat_pathogenic"], 3)
        self.assertEqual(summary["d4z4_repeat_other"], 11)


class VerdictsAreNotReadingsTest(unittest.TestCase):
    """A field may say what the report says, and nothing else.

    Every case here is a cell this platform cannot read, and every one
    of them used to come out of `_extract_genetic` as a confident
    positive finding — carried on to the patient's document row, the
    passport and the registry export under a laboratory's name.
    """

    @staticmethod
    def _fields(result):
        return {f["field_name"]: f for f in result["fshd"]["structured_fields"]}

    @staticmethod
    def _summary(result):
        return result["fshd"]["normalized_summary"]["genetic_summary"]

    def _analyze(self, *body, hint="genetic_report", name="G.pdf"):
        return analyze_fshd_report("\n".join(("基因检测报告", "检测结果") + body), hint, name)

    # --- the computed verdict, deleted -------------------------------

    def test_no_field_claims_the_result_is_positive(self):
        """`genetic_positive` could only ever answer 「yes」.

        It was derived from the PRESENCE of a cell, so a count of 0, a
        length in kb and a sentence saying nothing was found all
        produced 「yes」. There is no honest version of a flag with no
        「no」 in it, so the derivation is gone.
        """
        for body in (
            "D4Z4重复单元数: 3",
            "D4Z4重复单元数: 0",
            "D4Z4 EcoRI 片段长度: 38 kb",
            "D4Z4 未检出3个重复单元",
            "本次未见异常。",
        ):
            with self.subTest(body=body):
                result = self._analyze(body)
                self.assertNotIn("genetic_positive", self._fields(result))
                self.assertNotIn("genetic_positive", self._summary(result))
                names = {o["analyte_name"] for o in result["observations"]}
                self.assertNotIn("genetic_positive", names)
                self.assertNotIn("genetic_positive", result["latest_summary"]["by_analyte"])

    # --- a count cell that is not a count ----------------------------

    def test_zero_is_kept_visible_but_never_typed_as_a_count(self):
        """0 is what the cell prints and is not a reading.

        Kept, so a reviewer sees it was read and refused rather than
        finding the row missing — but never a number anything can use,
        and always below the review threshold.
        """
        result = self._analyze("D4Z4重复单元数: 0")
        field = self._fields(result)["d4z4_repeat_pathogenic"]
        self.assertEqual(field["field_value"], "0")
        self.assertLess(field["confidence"], 0.75)
        self.assertIn(
            "d4z4_repeat_pathogenic",
            [q["field_name"] for q in result["fshd"]["review_queue"]],
        )
        self.assertIsNone(self._summary(result)["d4z4_repeat_pathogenic"])
        self.assertIsNone(result["d4z4_repeats"])

    def test_a_length_in_kb_is_not_a_repeat_count(self):
        """One number must not be reported under two names.

        「D4Z4 EcoRI 片段长度: 38 kb」 set `d4z4_repeat_pathogenic` to 38
        — well above the FSHD1 range — while `ecori_fragment_kb`
        recorded the same 38 correctly. The length keeps its own name.
        """
        result = self._analyze("D4Z4 EcoRI 片段长度: 38 kb")
        self.assertNotIn("d4z4_repeat_pathogenic", self._fields(result))
        self.assertIsNone(self._summary(result)["d4z4_repeat_pathogenic"])
        self.assertEqual(self._summary(result)["ecori_fragment_kb"], 38.0)

    def test_a_negated_cell_reports_nothing(self):
        """「未检出3个重复单元」 carries a 3 that is not a count."""
        result = self._analyze("D4Z4 未检出3个重复单元")
        self.assertNotIn("d4z4_repeat_pathogenic", self._fields(result))
        self.assertIsNone(self._summary(result)["d4z4_repeat_pathogenic"])

    def test_a_stated_interval_never_becomes_a_number(self):
        """The interval fix left two channels uncovered.

        `observations[].result.value_num` and `latest_summary` both read
        「1-10」 as 1.0 — inside the 1–4 window that gates a
        recommendation.
        """
        result = self._analyze("D4Z4重复单元数: 1-10")
        obs = next(
            o for o in result["observations"] if o["analyte_name"] == "d4z4_repeat_pathogenic"
        )
        self.assertIsNone(obs["result"]["value_num"])
        self.assertEqual(obs["result"]["value_text"], "1-10")
        self.assertIsNone(
            result["latest_summary"]["by_analyte"]["d4z4_repeat_pathogenic"]["value_num"]
        )

    # --- naming a type is not diagnosing it --------------------------

    def test_an_excluded_or_suspected_type_is_not_a_diagnosis(self):
        for body in (
            "本次检测不支持 FSHD1，建议评估 FSHD2。",
            "本次检测不支持 FSHD1。",
            "临床怀疑 FSHD1，请进一步检查。",
        ):
            with self.subTest(body=body):
                result = self._analyze(body)
                self.assertNotIn("diagnosis_type", self._fields(result))
                self.assertIsNone(self._summary(result)["diagnosis_type"])

    def test_the_excluding_sentence_is_still_displayed(self):
        """Abstaining from the GRADE does not withhold the words.

        Only the two sentences whose conclusion block survives
        `_extract_block_after_header` are asserted here — a conclusion
        containing 「建议」 is truncated away by that helper before this
        code sees it, which is a separate pre-existing gap.
        """
        for body in ("本次检测不支持 FSHD1。", "临床怀疑 FSHD1，请进一步检查。"):
            with self.subTest(body=body):
                summary = self._summary(self._analyze(body))
                self.assertIn("FSHD1", summary["interpretation_summary"])

    def test_a_stated_type_still_lands(self):
        result = self._analyze("检测结论: 符合 FSHD1。", "D4Z4重复单元数: 3")
        self.assertEqual(self._summary(result)["diagnosis_type"], "FSHD1")

    # --- the allele the whole reading rests on -----------------------

    def test_a_negated_haplotype_is_not_a_haplotype(self):
        result = self._analyze("未检出 4qA permissive 等位基因")
        self.assertNotIn("haplotype", self._fields(result))
        self.assertIsNone(self._summary(result)["haplotype"])

    def test_both_alleles_named_is_withheld_not_queued_for_review(self):
        """A LOW CONFIDENCE IS NOT A WARNING — NOTHING DOWNSTREAM READS IT.

        This used to emit whichever allele was printed first at 0.60, on
        the theory that dropping below the 0.75 review threshold put a
        human on it. The queue is a human process and the value did not
        wait for it: the bridge writes `fields.haplotype`
        unconditionally, `parsePermissiveHaplotype` sees one token and
        returns true, and the assistant prompt and the patient-facing
        passport both assert a permissive allele in the meantime.

        So the VALUE is withheld. The platform renders a missing one as
        `unspecified_haplotype`, which every downstream reader already
        handles, and the report's own sentence still travels on
        `interpretation_summary`.
        """
        result = self._analyze("单倍型: 4qB/4qA 双等位基因均已分型，致病侧为 4qB")
        self.assertNotIn("haplotype", self._fields(result))
        self.assertIsNone(self._summary(result)["haplotype"])
        self.assertNotIn("haplotype", [q["field_name"] for q in result["fshd"]["review_queue"]])

    def test_a_single_stated_haplotype_keeps_its_confidence(self):
        result = self._analyze("单倍型: 4qA", "D4Z4重复单元数: 3")
        self.assertEqual(self._summary(result)["haplotype"], "4qA")
        self.assertGreaterEqual(self._fields(result)["haplotype"]["confidence"], 0.75)

    def test_the_probe_pair_on_the_method_line_is_not_this_patients_allele(self):
        """THE DEFECT THIS SECTION EXISTS FOR, ON A REAL REPORT.

        The haplotype was `re.search(r"\\b(4qA|4qB)\\b")` over the whole
        document — the FIRST token on the page. On a Southern blot report
        that is the 检测方法 line naming the standard probe pair, and the
        wording below is the exact wording this platform's own patient
        copy tells people to ask their laboratory for. So a report whose
        RESULT is 4qB was read as 4qA.

        FSHD1 cannot be the mechanism on a 4qB allele, so this turned a
        non-diagnosis into 基因确诊 and 可用于入组.
        """
        result = self._analyze(
            "检测方法: 脉冲场凝胶电泳,联合 p13E-11 探针,再结合 4qA / 4qB 探针判断单倍型",
            "检测结果",
            "4q35 单倍型: 4qB",
            "D4Z4重复单元数: 6",
        )
        self.assertEqual(self._summary(result)["haplotype"], "4qB")

    def test_the_probe_pair_does_not_lower_a_genuine_4qa_reading(self):
        """The same method line above a 4qA result is still a clean read.

        Flagging on 「both tokens appear anywhere」 put every ordinary
        Southern blot into the review queue at 0.60, because the probe
        line names both on every one of them.
        """
        result = self._analyze(
            "检测方法: 联合 p13E-11 探针,再结合 4qA / 4qB 探针判断单倍型",
            "检测结果",
            "4q35 单倍型: 4qA",
        )
        self.assertEqual(self._summary(result)["haplotype"], "4qA")
        self.assertGreaterEqual(self._fields(result)["haplotype"]["confidence"], 0.75)

    def test_a_footnote_defining_the_term_does_not_suppress_the_result(self):
        """「附注: 4qA 为允许型单倍型」 is a definition, not a second result.

        It contains 单倍型, so a line-contains test read it as a stated
        result and withheld the 4qB printed above it — costing the
        patient the one sentence that says a 4qB contraction does not
        support FSHD1. The label sits AFTER the token in a footnote and
        BEFORE it on every real result row, which is the same rule
        `_find_adjacent_regex` applies to the numeric cells.
        """
        result = self._analyze(
            "检测结果", "单倍型: 4qB", "附注: 4qA 为允许型单倍型"
        )
        self.assertEqual(self._summary(result)["haplotype"], "4qB")

    def test_a_bare_token_with_no_heading_is_still_read(self):
        """An OCR that recovered the results and lost the headings.

        Requiring a 单倍型 label outright would drop a real allele for
        every report whose layout the OCR flattened, so an unlabelled
        line is still read — but only when the whole document, method
        lines aside, is unanimous about which allele it names.
        """
        self.assertEqual(
            self._summary(self._analyze("FSHD1", "4qA", "D4Z4重复单元数: 4"))["haplotype"],
            "4qA",
        )

    # --- a unit nobody printed ---------------------------------------

    def test_methylation_carries_only_the_unit_the_report_printed(self):
        """A bisulfite ratio is commonly printed as a fraction.

        Defaulting the unit to 「%」 turned 甲基化 0.35 into 0.35% on the
        patient's screen. This repo states no methylation boundary, so
        the unit was the last way this field could say something false.
        """
        self.assertIsNone(
            self._fields(self._analyze("甲基化 0.35"))["methylation_value"]["unit"]
        )
        self.assertEqual(
            self._fields(self._analyze("甲基化 35%"))["methylation_value"]["unit"], "%"
        )


class TheNumberBelongsToTheLabelNextToItTest(unittest.TestCase):
    """A cell label reached down into the line below it.

    Every numeric pattern in `_extract_genetic` was written
    `标签[^\\d]{0,N}(\\d+)`, and `[^\\d]` matches a newline — so a label
    sitting on the 检测项目 line captured whatever number the NEXT line
    happened to start with. On an FSHD report the next line is very
    often the haplotype, and 「4qA」 starts with a digit.
    """

    @staticmethod
    def _summary(result):
        return result["fshd"]["normalized_summary"]["genetic_summary"]

    def _analyze(self, *body):
        return analyze_fshd_report("\n".join(body), "genetic_report", "G.pdf")

    def test_the_methylation_cell_is_not_read_out_of_the_haplotype(self):
        """甲基化分析 is the name of the FSHD2 assay, not a reading of it.

        With the 检测项目 line naming the method and the next line stating
        the haplotype, `甲基化[^\\d]{0,12}` captured the 4 of 4qA — and
        because the first match wins, the laboratory's own 甲基化 35%
        further down was never reached. Precise mode handed the
        assistant that 4; strict mode counted it in
        `numericValuesWithheld`.
        """
        summary = self._summary(
            self._analyze(
                "示例医学检验实验室 基因检测报告",
                "送检单位: 示例市第一人民医院神经内科",
                "检测项目: FSHD 甲基化分析",
                "单倍型: 4qA",
                "D4Z4重复单元数: 4",
                "甲基化: 35%",
                "报告医师: 王某某",
            )
        )
        self.assertEqual(summary["methylation_value"], 35.0)
        self.assertNotEqual(summary["methylation_value"], 4.0)
        self.assertEqual(summary["haplotype"], "4qA")

    def test_the_repeat_count_is_not_read_out_of_the_haplotype(self):
        """The same shape on the cell the whole FSHD1 reading rests on.

        「检测项目: D4Z4 重复单元数检测」 above 「单倍型: 4qA」 reported a
        repeat count of 4 at confidence 0.97 — a confirmed FSHD1-range
        count taken from an allele name — while the report's own count,
        9 and in the grey zone, sat unread below it.
        """
        summary = self._summary(
            self._analyze(
                "示例医学检验实验室 基因检测报告",
                "检测项目: D4Z4 重复单元数检测",
                "单倍型: 4qA",
                "检测结果",
                "D4Z4重复单元数: 9",
                "报告医师: 王某某",
            )
        )
        self.assertEqual(summary["d4z4_repeat_pathogenic"], 9)

    def test_the_assay_name_may_still_label_its_own_result_row(self):
        """「甲基化分析: 35%」 IS the result row, and must still read.

        The gap is the same method word; what separates the two cases is
        the colon. Forbidding the method word outright would have made
        this laboratory's number disappear.
        """
        self.assertEqual(self._summary(self._analyze("基因检测报告", "甲基化分析: 35%"))["methylation_value"], 35.0)

    def test_a_method_word_with_no_separator_reports_nothing(self):
        summary = self._summary(
            self._analyze("基因检测报告", "检测结果", "检测项目 甲基化分析 4qA")
        )
        self.assertIsNone(summary["methylation_value"])
        # NOR IS THE 4qA A HAPLOTYPE. It sits on a 检测项目 line, which
        # names the assay — the reason the methylation cell above it
        # reports nothing is the same reason this one does. This
        # assertion read `== "4qA"` while the haplotype was taken from
        # the first token anywhere on the page.
        self.assertIsNone(summary["haplotype"])

    def test_a_methylation_row_is_never_a_repeat_count(self):
        """ONE CELL, TWO ANSWERS ABOUT TWO DIFFERENT MEASUREMENTS.

        「D4Z4」 labels the repeat count and also opens 「D4Z4甲基化」, so
        the count's last-resort pattern reached into the methylation row.
        The gap 「甲基化: 」 carries a colon, which is what
        `_gap_names_a_method` treats as settling the question, so the
        match was accepted at 0.97 — the confidence of a cell we really
        read. The same cell was ALSO read correctly as
        `methylation_value`, so one methylation reading became a
        methylation value AND a fabricated repeat count, and the count
        drove the FSHD1/FSHD2 branch.

        This repo states no methylation boundary, and neither report
        below contains a repeat count at all.
        """
        percent = self._summary(
            self._analyze("基因检测报告", "检测结果", "D4Z4甲基化: 35%")
        )
        self.assertEqual(percent["methylation_value"], 35.0)
        self.assertIsNone(percent["d4z4_repeat_pathogenic"])

    def test_the_fraction_spelling_does_not_mint_a_count_of_zero(self):
        """「D4Z4 甲基化水平：0.35」 gave `d4z4_repeat_pathogenic` = 0.

        The pattern stopped at the 0 before the decimal point, and the
        platform then told the patient the laboratory had printed a count
        of zero with 报告读取 beside it. A bisulfite ratio is commonly
        printed as a fraction, so this is the ordinary spelling.
        """
        summary = self._summary(
            self._analyze("基因检测报告", "检测结果", "D4Z4 甲基化水平：0.35")
        )
        self.assertEqual(summary["methylation_value"], 0.35)
        self.assertIsNone(summary["d4z4_repeat_pathogenic"])

    def test_no_d4z4_cell_is_emitted_off_a_methylation_row(self):
        """Not merely ungraded — the row must not exist.

        `normalized_value` alone is not enough: the passport prints the
        raw `field_value` with 报告读取 in its bracket, so a `d4z4` field
        carrying 「35」 or 「0」 attributes a count to a report that states
        none however the number is typed.
        """
        for row in ("D4Z4甲基化: 35%", "D4Z4 甲基化水平：0.35"):
            with self.subTest(row=row):
                names = {
                    f["field_name"]
                    for f in self._analyze("基因检测报告", "检测结果", row)["fshd"][
                        "structured_fields"
                    ]
                }
                self.assertNotIn("d4z4_repeat_pathogenic", names)

    def test_a_methylation_row_does_not_hide_a_real_count_below_it(self):
        """The match is refused, not the cell — so the scan goes on.

        A report carrying both must still read the count the laboratory
        printed.
        """
        summary = self._summary(
            self._analyze(
                "基因检测报告",
                "检测结果",
                "D4Z4甲基化: 28%",
                "D4Z4 重复单元数: 7",
            )
        )
        self.assertEqual(summary["d4z4_repeat_pathogenic"], 7)
        self.assertEqual(summary["methylation_value"], 28.0)

    def test_a_length_row_is_still_refused_by_its_unit(self):
        """The `length_in_kb` refusal stays live for the bare spelling.

        「D4Z4: 38 kb」 has a gap of just 「: 」 — no analyte word in it —
        so the gap test cannot see it and the unit AFTER the number is
        what catches it.
        """
        summary = self._summary(self._analyze("基因检测报告", "检测结果", "D4Z4: 38 kb"))
        self.assertIsNone(summary["d4z4_repeat_pathogenic"])


class AGeneticReportIsIdentifiedByItsStructureTest(unittest.TestCase):
    """A 病历摘要 quoting a genetic result classified as the report.

    `REPORT_TYPE_RULES` scores VOCABULARY, and a clinic letter that
    transcribes the patient's own result contains every genetics word
    the rules look for: measured on a real one, genetic_report 18
    (基因检测 4 + fshd1 5 + d4z4 5 + 4qa 4) against medical_summary 16,
    with the uploader's declared 「other」 losing to the classifier. The
    label is what the API's `isLaboratoryGeneticReport` asks before
    anything may GRADE a genetics cell, so the transcribed count was
    graded on the FSHD1 boundary and the transcribed haplotype called
    permissive.

    The failure was self-reinforcing: the more of the result the letter
    quoted, the more certainly it flipped.
    """

    SUMMARY = (
        "示例市第一人民医院 门诊病历摘要",
        "主诉: 双上肢抬举无力10年,加重2年。",
        "现病史: 2019年于外院行基因检测,结果示 D4Z4 重复单元数 4 个,"
        "单倍型 4qA,考虑 FSHD1。",
        "既往史: 否认高血压、糖尿病史。",
        "查体: 双侧翼状肩胛,面肌无力。",
    )
    REPORT = (
        "示例医学检验实验室 基因检测报告",
        "送检单位: 示例市第一人民医院神经内科",
        "检测项目: FSHD 相关 D4Z4 重复单元数检测",
        "检测方法: 脉冲场凝胶电泳,p13E-11探针Southern blotting",
        "检测结果",
        "单倍型: 4qA",
        "D4Z4重复单元数: 4",
        "报告医师: 王某某",
    )

    @staticmethod
    def _analyze(body, hint):
        return analyze_fshd_report("\n".join(body), hint, "Upload.pdf")

    def test_a_transcription_is_not_promoted_to_a_genetic_report(self):
        result = self._analyze(self.SUMMARY, "other")
        self.assertEqual(result["fshd"]["report_type"], "medical_summary")

    def test_the_quoted_values_are_still_read_off_the_transcription(self):
        """Refusing the LABEL must not lose the patient's numbers.

        For some patients the 病历摘要 is the only page in the account
        carrying the D4Z4 count, and the platform's answer has always
        been 「display it with its origin, never grade it」. The API can
        only stamp `not_read_off_a_laboratory_report` onto a cell that
        exists.
        """
        summary = self._analyze(self.SUMMARY, "other")["fshd"]["normalized_summary"][
            "genetic_summary"
        ]
        self.assertEqual(summary["d4z4_repeat_pathogenic"], 4)
        self.assertEqual(summary["haplotype"], "4qA")
        self.assertEqual(summary["diagnosis_type"], "FSHD1")

    def test_the_narrative_cells_are_still_read_as_well(self):
        names = {
            f["field_name"] for f in self._analyze(self.SUMMARY, "other")["fshd"]["structured_fields"]
        }
        self.assertIn("progression_node", names)

    def test_the_uploader_calling_it_a_genetic_report_does_not_promote_it(self):
        """Patients pick 基因检测报告 for the letter that quotes one."""
        result = self._analyze(self.SUMMARY, "genetic_report")
        self.assertEqual(result["fshd"]["report_type"], "medical_summary")

    def test_a_real_report_is_still_a_genetic_report(self):
        for hint in ("genetic_report", "other"):
            with self.subTest(hint=hint):
                result = self._analyze(self.REPORT, hint)
                self.assertEqual(result["fshd"]["report_type"], "genetic_report")

    def test_a_signature_line_does_not_relabel_a_laboratory_report(self):
        """医师签名 IS A SIGNATURE BLOCK, NOT A CLINICAL NARRATIVE.

        It was added to MEDICAL_SUMMARY_STRUCTURE_MARKERS, where a single
        hit is disqualifying on its own and outranks every laboratory
        marker — so one extra line on an otherwise unchanged Southern
        blot flipped it from 基因确诊 to self_reported and relabelled it
        病历摘要 on the citation chip the patient taps.

        Every genetics report is signed. This file already classifies the
        string correctly in `_BLOCK_STOP_MARKERS`, under the note that
        signature blocks are never part of a clinical conclusion.
        """
        signed = self.REPORT + ("医师签名：王医师",)
        for hint in ("genetic_report", "other"):
            with self.subTest(hint=hint):
                self.assertEqual(self._analyze(signed, hint)["fshd"]["report_type"], "genetic_report")

    def test_no_narrative_marker_appears_on_a_laboratory_report(self):
        """The rule the list is audited against, kept executable.

        A marker that a genetics laboratory prints is not a narrative
        marker, and because a hit is disqualifying on its own, one such
        entry demotes every report carrying it. The signatures, the
        timestamps and the identifiers a report DOES print belong in
        `_BLOCK_STOP_MARKERS`, which is where 医师签名 already was.
        """
        report = "\n".join(self.REPORT + (
            "样本号: SB2024-0417",
            "实验者: 周某某   复核者: 吴某某",
            "审核医师: 赵某某",
            "医师签名：王某某",
            "报告日期: 2024-04-20   打印日期: 2024-04-21",
            "本报告仅供临床参考,不作诊断依据。",
        ))
        for marker in MEDICAL_SUMMARY_STRUCTURE_MARKERS:
            with self.subTest(marker=marker):
                self.assertNotIn(marker, report)

    def test_a_report_with_no_recognisable_structure_is_still_promoted(self):
        """Demoting here would lose the numbers, not just the grade.

        Where neither structure appears — an OCR that recovered the
        result lines and none of the headings — this rule abstains. The
        API-side gate is what refuses to grade an unconfirmed document.
        """
        result = self._analyze(("FSHD1", "4qA", "D4Z4重复单元数: 4"), "other")
        self.assertEqual(result["fshd"]["report_type"], "genetic_report")


class ANarrativeIsDemotedWhateverVocabularyItQuotesTest(unittest.TestCase):
    """THE GUARD COVERED `genetic_report` AND NOTHING ELSE.

    `REPORT_TYPE_RULES` scores vocabulary, and it is the QUOTED RESULT
    that scores — so a 出院小结 describing the patient's muscle MRI wins
    `muscle_mri` on exactly the mechanism a 病历摘要 quoting a D4Z4 count
    wins `genetic_report`. The demotion only asked the question of the
    one label.

    That is not cosmetic. The assistant's eligibility gate
    (`RESULT_DOCUMENT_TYPES` in
    apps/api/src/modules/ai-agents/security/pii-redactor.ts) reads any
    of the fifteen result labels as permission to send that document's
    own impression to a model VERBATIM. A discharge summary labelled
    `muscle_mri` is such a licence, and what identifies a person inside
    one is not a pattern — 「其兄 2019 年因同病去世」 identifies a family
    and cannot be scrubbed without deleting the sentence.

    Measured through this function, eight result labels escaped.
    """

    CASES = {
        "muscle_mri": (
            "示例医院神经内科 出院小结",
            "主诉: 进行性四肢无力10年。",
            "现病史: 外院查双大腿磁共振示臀大肌、腓肠肌脂肪浸润,胫骨前肌相对保留。",
            "诊疗经过: 入院后完善检查。",
        ),
        "pulmonary_function": (
            "示例医院 门诊病历",
            "主诉: 活动后气促2年。",
            "现病史: 外院查肺功能 FVC 62%,FEV1 下降。",
        ),
        "echocardiography": (
            "示例医院 入院记录",
            "主诉: 心悸1月。",
            "现病史: 外院心电图示窦性心律,心脏超声 LVEF 58%。",
        ),
        "muscle_enzyme": (
            "示例医院 出院小结",
            "主诉: 乏力3年。",
            "现病史: 查生化示 ALT 43 U/L,肌酸激酶 CK 860 U/L,肌红蛋白升高。",
        ),
        "diaphragm_ultrasound": (
            "病程记录",
            "主诉: 夜间平卧憋气。",
            "现病史: 膈肌超声示膈肌活动度下降。",
        ),
        "blood_routine": (
            "示例医院 住院病历",
            "主诉: 发热3天。",
            "现病史: 血常规示白细胞 WBC 11.2,血红蛋白 HGB 132,血小板 PLT 210。",
        ),
        "abdominal_ultrasound": (
            "示例医院 出院小结",
            "主诉: 腹胀。",
            "现病史: 腹部超声示肝脏回声均匀,胆囊未见结石,脾脏不大。",
        ),
        "coagulation": (
            "示例医院 入院记录",
            "主诉: 怕冷。",
            "现病史: 甲功示 TSH 正常;凝血示 PT/INR 正常,纤维蛋白原正常。",
        ),
    }

    @staticmethod
    def _analyze(body):
        return analyze_fshd_report("\n".join(body))["fshd"]

    def test_every_quoted_vocabulary_is_demoted_to_the_narrative_it_is_written_in(self):
        for escaped_label, body in self.CASES.items():
            with self.subTest(label=escaped_label):
                self.assertEqual(self._analyze(body)["report_type"], "medical_summary")

    def test_the_demotion_keeps_the_values_the_narrative_quotes(self):
        """The label is refused; the numbers are not.

        The MRI rows an 出院小结 quotes are the patient's only copy as
        often as a D4Z4 count is, so `analyze_fshd_report` runs the
        quoted document's own extractor as well as the narrative one.
        Trading one silent erasure for another is not a fix.
        """
        names = {
            f["field_name"] for f in self._analyze(self.CASES["muscle_enzyme"])["structured_fields"]
        }
        self.assertIn("ck", names)
        names = {
            f["field_name"] for f in self._analyze(self.CASES["blood_routine"])["structured_fields"]
        }
        self.assertIn("wbc", names)

    def test_a_physical_exam_is_not_demoted_by_the_sections_that_define_it(self):
        """肌力 / 体格检查 / 查体 IS what a physical-exam document is.

        Three of those strings are entries on
        CLINICAL_STORY_SECTION_MARKERS, so a blanket demotion would
        relabel every physical exam and lose `_extract_physical_exam`.
        It needs none: the API's eligibility gate already counts
        `physical_exam` as a non-result document.
        """
        result = self._analyze(
            (
                "神经科专科查体记录",
                "体格检查: MRC 分级 上肢近端 3 级,翼状肩胛阳性,面肌无力,Beevor 征阳性。",
            )
        )
        self.assertEqual(result["report_type"], "physical_exam")
        self.assertIn("mrc_score", {f["field_name"] for f in result["structured_fields"]})


class AResultReportKeepsItsLabelTest(unittest.TestCase):
    """THE OTHER DIRECTION, AND IT IS THE SAME ROOT CAUSE.

    A structure test that is a bare substring search reads a word a
    result report prints as ordinary professional language as a witness
    that the document is a narrative about a person. Two shapes, both
    routine:

      - the referring clinician's REQUISITION, printed across the top of
        a radiology or EMG report, which carries 主诉 and 现病史 as form
        COLUMNS beside 申请科室 and 申请医师;
      - 请结合临床及查体 / 与主诉相符 / 结合既往史, the standard closing
        of a Chinese radiology, EMG or muscle-MRI conclusion — the
        radiologist REFERRING to the clinical history, which is the
        opposite of the document being one.

    Being wrong this way is not free either: the label decides whether
    the report's own impression may be sent at all, and whether its
    values are read by its own extractor.
    """

    @staticmethod
    def _analyze(body):
        return analyze_fshd_report("\n".join(body))["fshd"]

    def test_a_requisition_header_does_not_relabel_the_report_under_it(self):
        result = self._analyze(
            (
                "示例医院 医学影像科 检查报告单",
                "申请科室: 神经内科 申请医师: 李某某",
                "主诉: 双下肢无力5年 现病史: 进行性加重",
                "检查项目: 双大腿MRI平扫",
                "影像所见: 双侧臀大肌、股二头肌长头脂肪浸润,磁共振信号增高。",
                "影像诊断: 双大腿肌群脂肪浸润,考虑肌营养不良。",
            )
        )
        self.assertEqual(result["report_type"], "muscle_mri")

    def test_a_conclusion_referring_to_the_clinical_history_is_not_one(self):
        for closing in (
            "影像诊断: 双大腿肌群脂肪浸润,请结合临床及查体。",
            "影像诊断: 双大腿肌群脂肪浸润,请结合临床查体。",
            "影像诊断: 双大腿肌群脂肪浸润,请结合既往史综合判断。",
        ):
            with self.subTest(closing=closing):
                result = self._analyze(
                    (
                        "示例医院 医学影像科 检查报告单",
                        "检查项目: 双大腿MRI平扫",
                        "影像所见: 双侧臀大肌脂肪浸润,胫骨前肌相对保留,磁共振信号增高。",
                        closing,
                    )
                )
                self.assertEqual(result["report_type"], "muscle_mri")

    def test_a_genetics_report_with_a_requisition_and_a_sign_off_keeps_its_label(self):
        result = self._analyze(
            (
                "示例医学检验实验室 遗传病检测报告",
                "送检单位: 神经内科 送检医师: 李某某",
                "主诉: 双上肢无力8年 现病史: 进行性加重",
                "检测项目: FSHD1 D4Z4 重复数检测",
                "检测方法: Southern blot p13E-11 探针",
                "检测结果: 4q35 D4Z4 重复单元 4 个,单倍型 4qA。",
                "检测结论: 检出致病性 D4Z4 重复数收缩,请结合临床及查体。",
            )
        )
        self.assertEqual(result["report_type"], "genetic_report")

    def test_medical_summary_is_scored_on_structure_not_on_the_word(self):
        """An EMG report was labelled 病历摘要 by one word in its conclusion.

        This file has no EMG template, so 「与主诉相符」 scoring
        `medical_summary` 2 was the only score on the page and won.
        `other` is the honest answer for a document this parser cannot
        name, and the assistant's gate refuses it as 「cannot tell」
        rather than as somebody's medical record.
        """
        result = self._analyze(
            (
                "神经电生理室 肌电图检查报告",
                "检查项目: 四肢肌电图",
                "检查结论: 肌源性损害电生理表现,与主诉相符,请结合临床。",
            )
        )
        self.assertNotEqual(result["report_type"], "medical_summary")

    def test_a_narrative_section_alone_on_its_line_is_still_a_narrative(self):
        """The direction of doubt.

        A requisition that prints 主诉 alone on its line is
        indistinguishable from a narrative that does, and where the
        page's own layout cannot tell, the document stays a narrative.
        """
        result = self._analyze(
            (
                "示例医院 医学影像科 检查报告单",
                "主诉: 双下肢无力5年",
                "影像诊断: 双大腿肌群脂肪浸润,磁共振信号增高,胫骨前肌相对保留。",
            )
        )
        self.assertEqual(result["report_type"], "medical_summary")


class TheRowTheNumberSitsOnTest(unittest.TestCase):
    """A NUMBER BELONGS TO THE ROW THAT PRINTED IT.

    Every case here is a number this file used to read off a row that
    was not stating a result — the assay's detection limit, a population
    reference interval, a definition quoted back in the conclusion — and
    publish as this patient's laboratory reading.
    """

    @staticmethod
    def _fields(result):
        return {f["field_name"]: f for f in result["fshd"]["structured_fields"]}

    @staticmethod
    def _summary(result):
        return result["fshd"]["normalized_summary"]["genetic_summary"]

    def _analyze(self, *body):
        return analyze_fshd_report("\n".join(body), "genetic_report", "G.pdf")

    def test_a_detection_limit_on_the_method_line_is_not_a_count(self):
        """The measured report: EXCLUDES FSHD1, published as confirming it.

        `_gap_names_a_method` refuses only a gap that is NOTHING BUT
        method words and `_gap_names_another_analyte` refuses only a gap
        naming a DIFFERENT analyte, so 「检测方法: D4Z4 重复单元数, 检测
        下限 1 个重复单元」 passed both — it names the method AND the
        right analyte. `re.finditer` returns the first accepted match,
        so the report's own result row was never reached: a count of 18
        with 结论 未见缩短 was published as a 1-repeat contraction at
        0.97, graded `within_fshd1_repeat_range` in both prompt modes,
        and it fired the AAN Level B ophthalmology recommendation.
        """
        result = self._analyze(
            "FSHD 基因检测报告",
            "检测方法: D4Z4 重复单元数, 检测下限 1 个重复单元",
            "检测结果: D4Z4 重复单元数 18",
            "结论: 未见 D4Z4 片段缩短",
        )
        self.assertEqual(self._summary(result)["d4z4_repeat_pathogenic"], 18)
        self.assertEqual(self._fields(result)["d4z4_repeat_pathogenic"]["field_value"], "18")

    def test_a_method_row_alone_states_no_count(self):
        """No result row to fall back to is not a licence to read one."""
        result = self._analyze(
            "FSHD 基因检测报告",
            "检测方法: D4Z4 重复单元数, 检测下限 1 个重复单元",
        )
        self.assertNotIn("d4z4_repeat_pathogenic", self._fields(result))
        self.assertIsNone(self._summary(result)["d4z4_repeat_pathogenic"])

    def test_the_result_label_governs_when_both_labels_are_on_one_line(self):
        """An OCR that flattened a table row carries both labels."""
        result = self._analyze(
            "FSHD 基因检测报告",
            "检测项目: D4Z4 重复单元数检测 检测结果: 3",
        )
        self.assertEqual(self._summary(result)["d4z4_repeat_pathogenic"], 3)

    def test_a_population_interval_does_not_replace_the_stated_count(self):
        """The interval outranked the count and emptied the typed value.

        The range branch was searched over the WHOLE document before the
        single-count branch was tried at all, so any interval printed
        anywhere near the token D4Z4 won — and `normalized_value` went
        empty, so the passport reported the item as having no
        determinate result on a report that states one plainly.
        """
        result = self._analyze(
            "FSHD 基因检测报告",
            "检测结果: D4Z4 重复单元数 5",
            "参考: 正常人群 D4Z4 重复单元数为 11-100 个",
        )
        self.assertEqual(self._summary(result)["d4z4_repeat_pathogenic"], 5)

    def test_the_grey_zone_quoted_in_the_conclusion_is_not_the_count(self):
        """Same defect where the interval sits on a RESULT row."""
        result = self._analyze(
            "FSHD 基因检测报告",
            "D4Z4 重复单元数 5",
            "结论: D4Z4 重复单元数 1-10 为缩短范围, 符合 FSHD1",
        )
        self.assertEqual(self._summary(result)["d4z4_repeat_pathogenic"], 5)

    def test_an_interval_is_still_the_reading_when_it_is_all_there_is(self):
        """The single-count branch must not report 1 off 「1-10」."""
        result = self._analyze("FSHD 基因检测报告", "D4Z4重复单元数: 1-10")
        field = self._fields(result)["d4z4_repeat_pathogenic"]
        self.assertEqual(field["field_value"], "1-10")
        self.assertIsNone(field["normalized_value"])
        self.assertIsNone(self._summary(result)["d4z4_repeat_pathogenic"])


class TheCellPerLineTableTest(unittest.TestCase):
    """The OCR layout this module documents as the norm.

    One text box per table cell, so a label and its number are on
    separate lines — and every gap in the genetics extractor is
    `[^\\d\\n]`, deliberately. The rows were read only by
    `_append_generic_table_fields`, whose slug DELETED EVERY CJK
    CHARACTER: two Chinese genetics analytes whose only Latin content is
    D4Z4 collapsed onto one key and the second was dropped.
    """

    ROWS = (
        "FSHD 基因检测报告",
        "检测方法",
        "Southern blot",
        "项目",
        "结果",
        "单位",
        "D4Z4甲基化水平",
        "35",
        "%",
        "D4Z4重复单元数",
        "5",
        "个",
    )

    def _result(self):
        return analyze_fshd_report("\n".join(self.ROWS), "genetic_report", "T.pdf")

    def _fields(self):
        return {f["field_name"]: f for f in self._result()["fshd"]["structured_fields"]}

    def test_the_repeat_count_row_is_not_discarded(self):
        """It was: the methylation row above it took the shared key."""
        summary = self._result()["fshd"]["normalized_summary"]["genetic_summary"]
        self.assertEqual(summary["d4z4_repeat_pathogenic"], 5)

    def test_the_methylation_row_lands_on_the_methylation_cell(self):
        """And carries the unit the row printed, not the count's key."""
        field = self._fields()["methylation_value"]
        self.assertEqual(field["field_value"], "35")
        self.assertEqual(field["unit"], "%")

    def test_no_table_key_carries_a_genetics_dispatch_substring(self):
        """A `table_*` name is arbitrary printed text.

        The API's OCR projection dispatches its genetics readers on the
        substrings d4z4 / ecori / methylation / haplotype, so a slug
        containing one bought a reading on the FSHD1 repeat-count
        boundary — measured, off a METHYLATION percentage, in BOTH
        prompt modes. These cells have canonical keys; a table row must
        not mint a second name for them.
        """
        for name in self._fields():
            if not name.startswith("table_"):
                continue
            with self.subTest(name=name):
                for token in ("d4z4", "ecori", "methylation", "haplotype"):
                    self.assertNotIn(token, name.lower())

    def test_a_header_row_on_one_line_is_not_an_analyte(self):
        """It was, and its result was the first data row's index.

        `_TABLE_HEADER_CELLS` is matched cell by cell, so the header
        rendered as ONE line passed every test and published
        `table_no: 1` on the patient's own report screen.
        """
        rows = extract_lab_table_rows([
            "检验报告单",
            "No 项目 结果 参考区间 单位 方法",
            "1",
            "游离T3(FT3)",
            "6.000",
            "3.5-6.59",
            "pmol/L",
        ])
        names = [r["name"] for r in rows]
        self.assertIn("游离T3(FT3)", names)
        # Neither the header row nor the title above it claims the index.
        self.assertFalse(any("项目" in n for n in names))
        self.assertNotIn("检验报告单", names)

    def test_two_cjk_analytes_are_two_keys(self):
        """The slug deleted every CJK character, so they were one."""
        rows = (
            "检验报告单",
            "血清铁蛋白",
            "120",
            "ng/mL",
            "血清转铁蛋白",
            "2.5",
            "g/L",
        )
        fields = analyze_fshd_report("\n".join(rows), "other", "T.pdf")["fshd"][
            "structured_fields"
        ]
        table_keys = [f["field_name"] for f in fields if f["field_name"].startswith("table_")]
        self.assertEqual(len(table_keys), len(set(table_keys)))
        self.assertEqual(len(table_keys), 2)


class TheHaplotypeRowOutranksTheSentenceTest(unittest.TestCase):
    """A dedicated result row beats a sentence that mentions both."""

    @staticmethod
    def _summary(result):
        return result["fshd"]["normalized_summary"]["genetic_summary"]

    def _analyze(self, *body):
        return analyze_fshd_report("\n".join(body), "genetic_report", "G.pdf")

    def test_a_biallelic_conclusion_does_not_wipe_out_the_stated_row(self):
        """The routine bi-allelic Southern blot conclusion.

        `_read_haplotype` unioned the labelled tokens across ALL lines
        and then required unanimity of the union — and 结果 and 结论 were
        both on the one label list, so a conclusion naming the contracted
        4qA allele and the normal 4qB one in ONE SENTENCE wiped out the
        haplotype the same report states on its own 单倍型 row. That is
        how such a conclusion is written, so the reports that state the
        allele most plainly were the ones this platform refused to read.
        """
        result = self._analyze(
            "FSHD 基因检测报告",
            "单倍型: 4qA",
            "结论: 检测到一条缩短的 4qA 等位基因及一条正常的 4qB 等位基因",
        )
        self.assertEqual(self._summary(result)["haplotype"], "4qA")

    def test_a_dedicated_row_naming_both_is_still_withheld(self):
        """Unanimity is required INSIDE the tier that answers."""
        result = self._analyze(
            "FSHD 基因检测报告",
            "单倍型: 4qB/4qA 双等位基因均已分型",
            "结论: 致病侧为 4qB",
        )
        self.assertIsNone(self._summary(result)["haplotype"])

    def test_a_conclusion_sentence_still_answers_when_it_is_all_there_is(self):
        result = self._analyze(
            "FSHD 基因检测报告",
            "结论: 检测到缩短的 4qA 等位基因",
        )
        self.assertEqual(self._summary(result)["haplotype"], "4qA")


class TheInlineLimitationsParagraphTest(unittest.TestCase):
    """The one sentence this product exists to deliver.

    `_before_disclaimer_section` only cut the tail when the marker word
    sat on a line of at most 16 characters, so a limitations paragraph
    written INLINE was not cut — and it is on every whole-exome report,
    naming the two methods the exome did NOT use.
    """

    BODY = (
        "基因检测报告",
        "检测方法: 全外显子组测序(WES)",
        "检测结果: 未检出与临床表型相关的致病变异",
        "本次检测存在局限性: 本方法无法检测 D4Z4 重复序列长度, "
        "该区域需通过 Southern blot 或分子梳(molecular combing) 等方法检测。",
    )

    def _result(self):
        return analyze_fshd_report("\n".join(self.BODY), "genetic_report", "W.pdf")

    def test_the_wes_report_is_named_as_a_wes_report(self):
        """It came out 「ambiguous」 and the passport fell to unknown."""
        summary = self._result()["fshd"]["normalized_summary"]["genetic_summary"]
        self.assertEqual(summary["genetic_test_method"], "short_read_sequencing")

    def test_the_caveat_fragment_is_not_shown_as_the_conclusion(self):
        """Cutting at the marker left 「本次检测存在」 as the summary.

        That string is what the patient reads under 报告详情 → 来源追溯.
        """
        summary = self._result()["fshd"]["normalized_summary"]["genetic_summary"]
        self.assertEqual(summary["interpretation_summary"], "未检出与临床表型相关的致病变异")

    def test_a_caveat_appended_to_a_real_sentence_keeps_the_sentence(self):
        result = analyze_fshd_report(
            "\n".join((
                "基因检测报告",
                "检测结果: 检出 D4Z4 重复单元数缩短。本报告存在局限性: 不能排除嵌合。",
            )),
            "genetic_report",
            "W.pdf",
        )
        summary = result["fshd"]["normalized_summary"]["genetic_summary"]
        self.assertIn("缩短", summary["interpretation_summary"])
        self.assertNotIn("嵌合", summary["interpretation_summary"])


class TheNumbersInTheConclusionSurviveTest(unittest.TestCase):
    """`_pick_finding_sentence` split on the ASCII dot.

    `_normalize_text` folds 「。」 to 「.」 before any of this runs, so the
    full stop and the decimal point are the same character by then — and
    the report's own conclusion, shown to the patient verbatim under
    报告详情 → 来源追溯, was cut mid-number.
    """

    @staticmethod
    def _summary(result):
        return result["fshd"]["normalized_summary"]["genetic_summary"]

    def _analyze(self, *body):
        return analyze_fshd_report("\n".join(body), "genetic_report", "G.pdf")

    def test_an_ecori_fragment_is_not_cut_to_its_decimals(self):
        """18.5 kb came out 「5 kb」 — roughly one repeat unit."""
        result = self._analyze(
            "FSHD 基因检测报告",
            "检测结果: EcoRI 片段长度 18.5 kb, 提示 D4Z4 重复单元数轻度缩短。",
        )
        self.assertIn("18.5", self._summary(result)["interpretation_summary"])

    def test_a_sentence_ending_in_a_number_still_splits(self):
        """A dot is a decimal point only with a digit on BOTH sides."""
        result = self._analyze(
            "FSHD 基因检测报告",
            "检测结果: 检出 D4Z4 重复单元数为 3.本报告仅供临床参考,不作诊断依据。",
        )
        summary = self._summary(result)["interpretation_summary"]
        self.assertIn("3", summary)
        self.assertNotIn("仅供临床参考", summary)


class ARefusedCellIsNotTypedTest(unittest.TestCase):
    """Two comments asserted a guarantee the code did not provide.

    The refused-cell comment said a 0 「is never typed as a count」 and
    passed `normalized_value=None` — but `None` is how a qualitative
    cell asks `_build_field` to fall back to the printed text, so the
    field shipped `normalized_value: 「0」` and `_build_observations`
    read it into `result.value_num: 0.0`.
    """

    def _analyze(self, *body):
        return analyze_fshd_report("\n".join(body), "genetic_report", "G.pdf")

    def test_a_refused_zero_is_not_a_number_on_any_channel(self):
        result = self._analyze("FSHD 基因检测报告", "检测结果: D4Z4 重复单元数 0")
        field = next(
            f for f in result["fshd"]["structured_fields"]
            if f["field_name"] == "d4z4_repeat_pathogenic"
        )
        self.assertEqual(field["field_value"], "0")
        self.assertIsNone(field["normalized_value"])
        obs = next(
            o for o in result["observations"]
            if o["analyte_name"] == "d4z4_repeat_pathogenic"
        )
        self.assertIsNone(obs["result"]["value_num"])
        self.assertEqual(obs["result"]["value_text"], "0")
        self.assertIsNone(
            result["latest_summary"]["by_analyte"]["d4z4_repeat_pathogenic"]["value_num"]
        )
        self.assertIsNone(result["d4z4_repeats"])

    def test_the_refused_cell_is_still_visible_to_a_reviewer(self):
        result = self._analyze("FSHD 基因检测报告", "检测结果: D4Z4 重复单元数 0")
        self.assertIn(
            "d4z4_repeat_pathogenic",
            [q["field_name"] for q in result["fshd"]["review_queue"]],
        )

    def test_a_qualitative_cell_still_falls_back_to_its_printed_text(self):
        """The fallback `None` selects, which the sentinel must not break."""
        result = analyze_fshd_report(
            "\n".join(("感染筛查", "乙肝表面抗原(HBsAg): 阴性(-)")), "infection_screening", "I.pdf"
        )
        field = next(
            f for f in result["fshd"]["structured_fields"] if f["field_name"] == "hbsag"
        )
        self.assertEqual(field["normalized_value"], field["field_value"])


class TheStatedArraySizeIsReadTest(unittest.TestCase):
    """「D4Z4 大小: 20 kb」 produced nothing at all.

    The fragment patterns required the literal labels EcoRI or 片段长度,
    and the repeat count's last-resort pattern refuses that number
    correctly because 大小 is a `fragment_length` word — so a stated
    array size fell between the two.
    """

    def _summary(self, *body):
        result = analyze_fshd_report("\n".join(body), "genetic_report", "G.pdf")
        return result["fshd"]["normalized_summary"]["genetic_summary"]

    def test_a_size_in_kb_is_read_as_a_length(self):
        summary = self._summary("FSHD 基因检测报告", "D4Z4 大小: 20 kb")
        self.assertEqual(summary["ecori_fragment_kb"], 20.0)
        self.assertIsNone(summary["d4z4_repeat_pathogenic"])

    def test_the_english_spelling_reads_too(self):
        summary = self._summary("FSHD genetic report", "D4Z4 array size: 20 kb")
        self.assertEqual(summary["ecori_fragment_kb"], 20.0)

    def test_a_size_without_the_unit_is_not_a_length(self):
        summary = self._summary("FSHD 基因检测报告", "样本大小: 20")
        self.assertIsNone(summary["ecori_fragment_kb"])


class TheTypeTheReportStatesTest(unittest.TestCase):
    """A report is TITLED after the type it was ordered to look for.

    `diagnosis_type` was the first FSHD1/FSHD2 token anywhere on the
    page, with the absence and hedge tests asked only of the line that
    token happened to sit on — so a report that excludes the type in its
    own conclusion published it as this patient's 分型, and it fired on
    the negative reports as a class.
    """

    @staticmethod
    def _summary(result):
        return result["fshd"]["normalized_summary"]["genetic_summary"]

    def _analyze(self, *body):
        return analyze_fshd_report("\n".join(body), "genetic_report", "G.pdf")

    def test_a_title_naming_the_type_is_not_a_diagnosis_of_it(self):
        result = self._analyze(
            "FSHD1 基因检测报告",
            "检测方法: Southern blot",
            "检测结果: D4Z4 重复单元数 18",
            "结论: 本次检测不支持 FSHD1, 建议评估 FSHD2。",
        )
        self.assertIsNone(self._summary(result)["diagnosis_type"])

    def test_the_item_line_is_not_a_diagnosis_either(self):
        result = self._analyze(
            "基因检测报告",
            "检测项目: FSHD1/FSHD2 基因检测",
            "结论: 未见 D4Z4 片段缩短, 不支持 FSHD1。",
        )
        self.assertIsNone(self._summary(result)["diagnosis_type"])

    def test_excluding_one_type_does_not_refuse_the_other(self):
        """Two tokens are two claims."""
        result = self._analyze(
            "基因检测报告",
            "检测结论: 符合 FSHD1。",
            "本次检测不支持 FSHD2。",
        )
        self.assertEqual(self._summary(result)["diagnosis_type"], "FSHD1")

    def test_a_stated_type_still_lands_from_the_conclusion(self):
        result = self._analyze(
            "FSHD1 基因检测报告",
            "检测结论: 符合 FSHD1, D4Z4 重复单元数 3。",
        )
        self.assertEqual(self._summary(result)["diagnosis_type"], "FSHD1")


class ChineseLaboratoriesPrintWithoutSpacesTest(unittest.TestCase):
    r"""`\b` NEVER FIRES BETWEEN A CJK CHARACTER AND A LATIN ONE.

    Python's `\w` is Unicode-aware, so 型 and 诊 are word characters and
    `\b(4qA|4qB)\b` has no boundary to find in 「4q35单倍型4qB」. Every
    Latin token in this file was anchored that way, so on the real
    spelling the report's own result row, its own exclusion clause, its
    method name and the kb refusal were all invisible — silently, and in
    the direction that publishes a reading.
    """

    @staticmethod
    def _summary(result):
        return result["fshd"]["normalized_summary"]["genetic_summary"]

    @staticmethod
    def _fields(result):
        return {f["field_name"]: f for f in result["fshd"]["structured_fields"]}

    def _analyze(self, *body):
        return analyze_fshd_report("\n".join(body), "genetic_report", "G.pdf")

    def test_the_result_row_is_read_and_not_the_footnote_defining_the_term(self):
        """THE MEASURED CASE. 4qA was published off a definition.

        The report states 4qB on its own 单倍型 row, no space around the
        token — which the anchored pattern could not see — so the only
        allele the reader could find was the one the FOOTNOTE names. The
        passport called it `permissive_haplotype` and read the count
        against the FSHD1 range; FSHD1 cannot be the mechanism on 4qB.
        """
        result = self._analyze(
            "XX大学附属医院医学检验报告",
            "4q35单倍型4qB",
            "D4Z4重复单元数6",
            "附注: 4qA 为允许型单倍型",
        )
        self.assertEqual(self._summary(result)["haplotype"], "4qB")

    def test_the_exclusion_clause_is_visible_to_the_type_reader(self):
        result = self._analyze(
            "XX大学附属医院医学检验报告",
            "检测项目:FSHD1基因检测",
            "D4Z4重复单元数8",
            "检测结论:本次检测不支持FSHD1诊断",
        )
        self.assertIsNone(self._summary(result)["diagnosis_type"])

    def test_a_length_in_kb_with_no_space_is_still_not_a_count(self):
        r"""`(kb|bp|mb)\b` could not see 「38kb的片段」."""
        result = self._analyze(
            "XX医院 FSHD1 基因检测报告",
            "检测结果:D4Z4 EcoRI片段长度38kb的片段",
        )
        self.assertIsNone(self._summary(result)["d4z4_repeat_pathogenic"])
        self.assertEqual(self._summary(result)["ecori_fragment_kb"], 38.0)

    def test_no_pattern_in_the_module_keeps_a_raw_word_boundary(self):
        """The class fix has to hold for patterns added later, too.

        Every precompiled pattern goes through `_cjk_safe_compile`, so a
        surviving `\\b` means somebody reached for `re.compile` directly
        — which is how the four in this module were written in the first
        place.
        """
        offenders = [
            name
            for name, value in vars(fshd_report_service).items()
            if isinstance(value, re.Pattern) and "\\b" in value.pattern
        ]
        self.assertEqual(offenders, [])

    def test_the_method_name_with_no_space_is_still_recognised(self):
        r"""`\becor\s*[i1]\b` could not see 「EcoRI酶切」."""
        result = self._analyze(
            "XX医院 基因检测报告",
            "检测方法:采用EcoRI酶切后行Southern印迹",
        )
        self.assertEqual(self._summary(result)["genetic_test_method"], "southern_blot")


class ATitleIsNotAResultTest(unittest.TestCase):
    """A REPORT IS TITLED AFTER THE TYPE IT WAS ORDERED TO LOOK FOR.

    The per-token refusal only reaches a title when the conclusion
    repeats the token and negates it, and the ordinary Chinese negative
    conclusion does not repeat it. So on the commonest negative wording
    there was nothing to refuse and the title won.
    """

    @staticmethod
    def _summary(result):
        return result["fshd"]["normalized_summary"]["genetic_summary"]

    def test_the_ordinary_negative_wording_leaves_no_diagnosis(self):
        result = analyze_fshd_report(
            "\n".join((
                "FSHD1 基因检测报告",
                "送检单位: 神经内科",
                "检测方法: Southern blot, EcoRI 酶切",
                "检测结果: 未见 4q35 D4Z4 阵列缩短, 结果在正常范围",
            )),
            "genetic_report",
            "G.pdf",
        )
        self.assertIsNone(self._summary(result)["diagnosis_type"])
        # And the sentence that says so is still what the patient reads.
        self.assertIn("未见", self._summary(result)["interpretation_summary"])


class TheDedicatedResultRowOutranksAProseSentenceTest(unittest.TestCase):
    """On the cell-per-line layout the patient's own row scored LOWEST.

    「检测结果:」 is its own line and the analyte rows below it carry no
    label, so they ranked unlabelled — while any 结论 sentence quoting a
    threshold carries 结论 and ranked as a result row.
    """

    ROWS = (
        "XX医学检验所 FSHD1 基因检测报告",
        "项目 结果 单位",
        "检测结果:",
        "D4Z4重复单元数",
        "5",
        "个",
        "结论: D4Z4 重复单元数低于 10 个即为缩短, 本例符合 FSHD1",
    )

    def test_the_count_is_the_rows_and_not_the_conclusions_threshold(self):
        result = analyze_fshd_report("\n".join(self.ROWS), "genetic_report", "T.pdf")
        summary = result["fshd"]["normalized_summary"]["genetic_summary"]
        self.assertEqual(summary["d4z4_repeat_pathogenic"], 5)


class TheReferenceColumnIsNotTheResultTest(unittest.TestCase):
    """项目 / 参考区间 / 结果 is an ordinary Chinese column order.

    A comparator-prefixed cell counted as a value and the row reader
    took the first one, so the FSHD1 reference limit became the reading
    and the reading became the row's UNIT.
    """

    ROWS = (
        "XX医院 FSHD1 D4Z4 基因检测报告",
        "项目 参考区间 结果 单位",
        "D4Z4重复单元数",
        ">10",
        "3",
        "个",
    )

    def test_the_bound_is_the_reference_and_the_bare_number_the_result(self):
        rows = extract_lab_table_rows(list(self.ROWS))
        by_name = {r["name"]: r for r in rows}
        self.assertEqual(by_name["D4Z4重复单元数"]["value"], "3")
        self.assertEqual(by_name["D4Z4重复单元数"]["reference"], ">10")
        # A bare number is never a unit.
        self.assertNotEqual(by_name["D4Z4重复单元数"]["unit"], "3")

    def test_the_published_count_is_the_patients_and_not_the_limit(self):
        result = analyze_fshd_report("\n".join(self.ROWS), "genetic_report", "T.pdf")
        summary = result["fshd"]["normalized_summary"]["genetic_summary"]
        self.assertEqual(summary["d4z4_repeat_pathogenic"], 3)

    def test_a_one_sided_limit_alone_is_still_the_reading(self):
        """Refusing a bound outright would lose a genuine 「<0.01」."""
        rows = extract_lab_table_rows([
            "检验报告单",
            "超敏肌钙蛋白I", "<0.01", "ng/mL",
        ])
        self.assertEqual(rows[0]["value"], "<0.01")


class TheConclusionIsNotTruncatedByItsOwnRecommendationTest(unittest.TestCase):
    """建议 is a block stop keyword and the standard negative carries it.

    「结论: 本次检测不支持 FSHD1, 建议评估 FSHD2。」 — the block stopped
    one line short of the exclusion, answered with the result row above
    it, and the fallback that would have found the exclusion never ran.
    """

    def test_the_exclusion_is_the_sentence_the_patient_reads(self):
        result = analyze_fshd_report(
            "\n".join((
                "FSHD1 基因检测报告",
                "检测结果: D4Z4 重复单元数 18",
                "结论: 本次检测不支持 FSHD1, 建议评估 FSHD2。",
            )),
            "genetic_report",
            "G.pdf",
        )
        summary = result["fshd"]["normalized_summary"]["genetic_summary"]
        self.assertIn("不支持", summary["interpretation_summary"])
        # The count on the result row is still read.
        self.assertEqual(summary["d4z4_repeat_pathogenic"], 18)

    def test_a_conclusion_stating_nothing_does_not_displace_the_block(self):
        result = analyze_fshd_report(
            "\n".join((
                "基因检测报告",
                "检测结果",
                "检出 D4Z4 重复单元数缩短",
                "结论: 详见上述",
            )),
            "genetic_report",
            "G.pdf",
        )
        summary = result["fshd"]["normalized_summary"]["genetic_summary"]
        self.assertIn("缩短", summary["interpretation_summary"])


class ANegationIsNotASignatureTest(unittest.TestCase):
    """A two-to-four-character Chinese word alone was 「a doctor's name」.

    So a conclusion ending in the clause that MAKES IT NEGATIVE had that
    clause deleted — as a block line and as a trailing token.
    """

    def _interpretation(self, *body):
        result = analyze_fshd_report("\n".join(body), "genetic_report", "G.pdf")
        return result["fshd"]["normalized_summary"]["genetic_summary"]["interpretation_summary"]

    def test_the_negation_survives_to_the_end_of_the_conclusion(self):
        summary = self._interpretation(
            "XX医院 FSHD 基因检测报告",
            "检测方法: Southern blot",
            "检测结论:",
            "4q35区域D4Z4阵列",
            "未见缩短",
        )
        self.assertIn("未见缩短", summary)

    def test_a_positive_finding_ending_in_the_finding_survives_too(self):
        summary = self._interpretation(
            "XX医院 FSHD 基因检测报告",
            "检测结论:",
            "4q35区域D4Z4",
            "阵列缩短",
        )
        self.assertIn("阵列缩短", summary)

    def test_the_radiologists_name_is_still_dropped(self):
        """The scenario the docstring describes: a finished clause."""
        text = "\n".join([
            "磁共振检查报告单",
            "印象:",
            "1. 双侧胫骨前肌脂肪浸润,请结合临床. 钱医",
        ])
        result = analyze_fshd_report(text, "mri", "M.jpeg")
        impression = next(
            (f["field_value"] for f in result["fshd"]["structured_fields"]
             if f["field_name"] == "report_impression"),
            "",
        )
        self.assertIn("脂肪浸润", impression)
        self.assertNotIn("钱医", impression)


class NoGeneticsCellIsPublishedTwiceTest(unittest.TestCase):
    """The `table_*` refusal was four LATIN substrings on a Chinese row.

    「甲基化水平」 carries none of them, so it was minted as
    `table_甲基化水平` beside the canonical `methylation_value` read off
    the identical cell: one reading, two analytes, both on
    `observations` and `latest_summary.by_analyte`.
    """

    ROWS = (
        "XX医学检验所 FSHD2 甲基化检测报告",
        "项目 结果 单位",
        "甲基化水平",
        "35",
        "%",
        "D4Z4重复单元数",
        "28",
        "个",
    )

    def _result(self):
        return analyze_fshd_report("\n".join(self.ROWS), "genetic_report", "T.pdf")

    def test_a_chinese_named_genetics_row_mints_no_table_key(self):
        names = {f["field_name"] for f in self._result()["fshd"]["structured_fields"]}
        self.assertIn("methylation_value", names)
        self.assertFalse([n for n in names if n.startswith("table_")], names)

    def test_the_reading_appears_once_on_every_numeric_channel(self):
        result = self._result()
        by_analyte = result["latest_summary"]["by_analyte"]
        thirty_five = [k for k, v in by_analyte.items() if v["value_num"] == 35.0]
        self.assertEqual(thirty_five, ["methylation_value"])


class ZeroIsRefusedOnBothSidesOfAPairTest(unittest.TestCase):
    """The refusal was asked only of `d4z4_repeat_pathogenic`.

    `d4z4_repeat_other` comes off the SAME match and was typed
    unconditionally, so 「D4Z4 重复数 3/0」 published a laboratory repeat
    count of zero on `result.value_num` and `latest_summary.by_analyte`
    — the two channels the `NO_NORMALIZED_VALUE` note names as the whole
    reason the refusal exists.
    """

    def _result(self):
        return analyze_fshd_report(
            "\n".join((
                "XX医院 FSHD1 基因检测报告",
                "检测方法: 分子梳",
                "检测结果: D4Z4 重复数 3/0",
            )),
            "genetic_report",
            "G.pdf",
        )

    def test_the_other_allele_is_kept_visible_and_never_typed(self):
        result = self._result()
        field = next(
            f for f in result["fshd"]["structured_fields"]
            if f["field_name"] == "d4z4_repeat_other"
        )
        self.assertEqual(field["field_value"], "0")
        self.assertIsNone(field["normalized_value"])
        self.assertLess(field["confidence"], 0.75)
        self.assertIn(
            "d4z4_repeat_other",
            [q["field_name"] for q in result["fshd"]["review_queue"]],
        )

    def test_zero_is_not_a_number_on_any_channel(self):
        result = self._result()
        summary = result["fshd"]["normalized_summary"]["genetic_summary"]
        self.assertIsNone(summary["d4z4_repeat_other"])
        self.assertIsNone(
            result["latest_summary"]["by_analyte"]["d4z4_repeat_other"]["value_num"]
        )
        # The pathogenic side is a real reading and is untouched.
        self.assertEqual(summary["d4z4_repeat_pathogenic"], 3)


class AnAbbreviationIsNotReadInsideAWordTest(unittest.TestCase):
    r"""The same `\b` defect, in a substring test.

    The analyte keywords include single Latin letters — `k` for 钾, `p`
    for 无机磷 — matched with `keyword in line`. On 「肌酸激酶(CK): 890
    U/L」 the `k` of `(CK)` matched and the patient's creatine kinase was
    republished as a potassium of 890.
    """

    @staticmethod
    def _panel(result):
        return result["fshd"]["normalized_summary"]["lab_panel"]

    def test_ck_is_not_also_a_potassium(self):
        result = analyze_fshd_report(
            "\n".join(("XX医院 生化检验报告", "肌酸激酶(CK): 890 U/L")),
            "other",
            "B.jpeg",
        )
        self.assertEqual(self._panel(result)["ck"], 890.0)
        self.assertNotIn("potassium", self._panel(result))

    def test_plt_is_not_also_an_inorganic_phosphorus(self):
        result = analyze_fshd_report(
            "\n".join(("XX医院 生化全套报告", "血小板计数(PLT): 210 10^9/L")),
            "other",
            "B.jpeg",
        )
        self.assertNotIn("phosphorus", self._panel(result))

    def test_a_ck_mb_row_is_not_also_a_ck_and_a_myoglobin(self):
        """THE WORST ONE ON AN FSHD REPORT.

        肌酸激酶 is a prefix of 肌酸激酶同工酶, the CK-MB row's own
        printed name, and the first line carrying a keyword wins — so a
        patient whose creatine kinase is 890, an order of magnitude
        above the reference range, had it published as the CK-MB's 25.
        A NORMAL CK, on the marker this platform exists to track.
        """
        result = analyze_fshd_report(
            "\n".join((
                "XX医院 生化检验报告",
                "肌酸激酶同工酶(CK-MB): 25 U/L",
                "肌酸激酶(CK): 890 U/L",
                "肌红蛋白(MYO): 45 ng/mL",
            )),
            "other",
            "B.jpeg",
        )
        panel = self._panel(result)
        self.assertEqual(panel["ck"], 890.0)
        self.assertEqual(panel["ckmb"], 25.0)
        self.assertEqual(panel["mb"], 45.0)

    def test_the_other_prefix_collisions_in_the_map_are_closed_too(self):
        """One rule, computed from the map, not four written-out cases."""
        for body, expected in (
            (
                ("极低密度脂蛋白胆固醇(VLDL-C): 0.45 mmol/L",
                 "低密度脂蛋白胆固醇(LDL-C): 3.10 mmol/L"),
                {"ldl_c": 3.1, "vldl_c": 0.45},
            ),
            (
                ("碱性磷酸酶(ALP): 80 U/L", "无机磷(P): 1.2 mmol/L"),
                {"alp": 80.0, "phosphorus": 1.2},
            ),
            (
                ("载脂蛋白A1(ApoA1): 1.35 g/L", "脂蛋白a(Lp(a)): 210 mg/L"),
                {"apo_a1": 1.35, "lp_a": 210.0},
            ),
        ):
            with self.subTest(body=body):
                result = analyze_fshd_report(
                    "\n".join(("XX医院 生化检验报告",) + body), "other", "B.jpeg"
                )
                panel = self._panel(result)
                for key, value in expected.items():
                    self.assertEqual(panel.get(key), value)

    def test_a_real_potassium_row_still_reads(self):
        result = analyze_fshd_report(
            "\n".join(("XX医院 生化检验报告", "钾(K): 4.1 mmol/L")),
            "other",
            "B.jpeg",
        )
        self.assertEqual(self._panel(result)["potassium"], 4.1)


class AGapMayNotOpenABracketTest(unittest.TestCase):
    r"""`游离T3(?:\(FT3\))?[^\d\n]{0,16}(\d+)` captured the 3 of the NAME.

    The optional parenthetical backtracks, the gap runs into it, and the
    digit inside the analyte's own abbreviation is taken as the result —
    so a thyroid panel whose value sat on the next line published
    `ft3: 3` and `ft4: 4`.
    """

    ROWS = (
        "XX医院 甲状腺功能报告",
        "项目 结果 单位",
        "游离T3(FT3)",
        "5.2",
        "pmol/L",
        "游离T4(FT4)",
        "16.8",
        "pmol/L",
    )

    def test_the_value_comes_from_the_value_cell_not_the_name(self):
        result = analyze_fshd_report("\n".join(self.ROWS), "other", "T.jpeg")
        panel = result["fshd"]["normalized_summary"]["lab_panel"]
        self.assertEqual(panel["ft3"], 5.2)
        self.assertEqual(panel["ft4"], 16.8)


class ADecimalSurvivesTheNarrativePathTest(unittest.TestCase):
    """`_extract_sentences` kept its own splitter, and it split on 「.」.

    「病程 18.5 年」 became 「病程 18」 and 「5 年」, so the duration regex
    — which needs 病程 and 年 in one sentence — found nothing,
    `progression_node` was published truncated, and the timeline gained
    a phantom event.
    """

    BODY = (
        "病历摘要",
        "主诉: 双上肢抬举无力",
        "现病史: 患者15岁起病, 病程 18.5 年, 逐渐加重",
    )

    def _summary(self):
        result = analyze_fshd_report("\n".join(self.BODY), "other", "S.pdf")
        return result["fshd"]["normalized_summary"]

    def test_the_duration_is_the_one_the_record_states(self):
        medical = self._summary()["medical_summary"]
        self.assertEqual(medical["disease_duration"], 18.5)
        self.assertEqual(medical["onset_age"], 15)

    def test_the_sentence_is_not_cut_mid_number(self):
        medical = self._summary()["medical_summary"]
        self.assertIn("18.5", medical["progression_node"])

    def test_no_phantom_event_is_minted_from_the_fraction(self):
        timeline = self._summary()["timeline"]
        self.assertEqual(len(timeline), 1)


class NoLineCanClaimTwoLabelsTest(unittest.TestCase):
    """THE INVARIANT THE ROW-LABELLING PASS KEPT BREAKING.

    Every list `_row_label` consults overlaps some other list — 检测项目
    is a column heading AND a method-ish name, 送检项目 is a section
    header AND a metadata label, 附注 is a section header AND a footnote
    prefix. That is a property of the strings a Chinese laboratory
    prints, not a mistake in the lists, and it is not going to stop
    happening as strings are added.

    What broke three times is leaving the overlap for STATEMENT ORDER to
    settle: whichever `if` was written first won, two functions
    disagreed about the order, and the symptom was a whole report going
    unread with an empty `review_queue` reporting nothing amiss. So the
    overlaps are enumerated here. A new string that lands in two lists
    fails this test until somebody decides, in `_row_label`, which of
    the two it is.
    """

    #: Every overlap that exists, with the label `_row_label` decides
    #: for it. Adding a string to two lists without adding it here is
    #: what this test is for.
    DECIDED = {
        # Column heading AND the name of a method-ish thing. Decided as
        # the ordered item it names; its one value cell goes with it.
        "检测项目": (fshd_report_service._KIND_METHOD, fshd_report_service._SCOPE_NEXT),
        "检验项目": (fshd_report_service._KIND_METHOD, fshd_report_service._SCOPE_NEXT),
        # Column heading AND a method section header. Decided as the
        # heading, which closes the run rather than opening one.
        "参考区间": (fshd_report_service._KIND_PLAIN, fshd_report_service._SCOPE_SELF),
        "参考值": (fshd_report_service._KIND_PLAIN, fshd_report_service._SCOPE_SELF),
        "参考范围": (fshd_report_service._KIND_PLAIN, fshd_report_service._SCOPE_SELF),
        # Method section header AND an exam-metadata label. Decided as
        # the label: it names what was ordered and reaches its value.
        "送检项目": (fshd_report_service._KIND_METHOD, fshd_report_service._SCOPE_NEXT),
        # Note section header AND a footnote prefix. Both say NOTE, but
        # the scopes differ, so it is decided too.
        "附注": (fshd_report_service._KIND_NOTE, fshd_report_service._SCOPE_RUN),
        "备注": (fshd_report_service._KIND_NOTE, fshd_report_service._SCOPE_RUN),
        "注释": (fshd_report_service._KIND_NOTE, fshd_report_service._SCOPE_RUN),
        "说明": (fshd_report_service._KIND_NOTE, fshd_report_service._SCOPE_RUN),
        # A HEADER STANDING AT THE TOP OF THE PAGE, which every one of
        # these can be. `_is_title_row` grew a first-line branch — the
        # document's name is the first thing printed on it — and every
        # header carrying 检测 / 检验 / 检查 / 报告 satisfies it there.
        # The title branch is deliberately the WEAKEST claim in
        # `_row_label`: a page that opens on 检测结果 opens a section, it
        # does not name itself. Decided as the header in every case.
        "检测结果": (fshd_report_service._KIND_RESULT, fshd_report_service._SCOPE_RUN),
        "检验结果": (fshd_report_service._KIND_RESULT, fshd_report_service._SCOPE_RUN),
        "报告结果": (fshd_report_service._KIND_RESULT, fshd_report_service._SCOPE_RUN),
        "检测结论": (fshd_report_service._KIND_CONCLUSION, fshd_report_service._SCOPE_RUN),
        "检验结论": (fshd_report_service._KIND_CONCLUSION, fshd_report_service._SCOPE_RUN),
        "检测方法": (fshd_report_service._KIND_METHOD, fshd_report_service._SCOPE_RUN),
        "检验方法": (fshd_report_service._KIND_METHOD, fshd_report_service._SCOPE_RUN),
        "检查项目": (fshd_report_service._KIND_METHOD, fshd_report_service._SCOPE_NEXT),
        "检查方法": (fshd_report_service._KIND_METHOD, fshd_report_service._SCOPE_NEXT),
        "检查部位": (fshd_report_service._KIND_METHOD, fshd_report_service._SCOPE_NEXT),
        "检查设备": (fshd_report_service._KIND_METHOD, fshd_report_service._SCOPE_NEXT),
        "检查途径": (fshd_report_service._KIND_METHOD, fshd_report_service._SCOPE_NEXT),
        "检验目的": (fshd_report_service._KIND_METHOD, fshd_report_service._SCOPE_NEXT),
    }

    def _claimants(self, value):
        """Which label lists claim `value`."""
        claims = []
        if value in fshd_report_service._TABLE_HEADER_CELLS:
            claims.append("table_header_cell")
        if value in fshd_report_service._ORDERED_ITEM_LABELS:
            claims.append("ordered_item_label")
        if any(value.startswith(p) for p in fshd_report_service._EXAM_METADATA_PREFIXES):
            claims.append("exam_metadata_prefix")
        if value in fshd_report_service._RESULT_SECTION_HEADERS:
            claims.append("result_section_header")
        if value in fshd_report_service._CONCLUSION_SECTION_HEADERS:
            claims.append("conclusion_section_header")
        if value in fshd_report_service._METHOD_SECTION_HEADERS:
            claims.append("method_section_header")
        if value in fshd_report_service._NOTE_SECTION_HEADERS:
            claims.append("note_section_header")
        if any(value.startswith(p) for p in fshd_report_service._NOTE_ROW_PREFIXES):
            claims.append("note_row_prefix")
        if fshd_report_service._is_title_row(value, first_content_line=True):
            claims.append("title")
        return claims

    def _every_label_string(self):
        for group in (
            fshd_report_service._TABLE_HEADER_CELLS,
            fshd_report_service._ORDERED_ITEM_LABELS,
            fshd_report_service._EXAM_METADATA_PREFIXES,
            fshd_report_service._RESULT_SECTION_HEADERS,
            fshd_report_service._CONCLUSION_SECTION_HEADERS,
            fshd_report_service._METHOD_SECTION_HEADERS,
            fshd_report_service._NOTE_SECTION_HEADERS,
            fshd_report_service._NOTE_ROW_PREFIXES,
        ):
            for value in group:
                yield value

    def test_every_ambiguous_string_has_a_decision_written_down(self):
        undecided = sorted(
            value
            for value in set(self._every_label_string())
            if len(self._claimants(value)) > 1 and value not in self.DECIDED
        )
        self.assertEqual(
            undecided,
            [],
            "these strings are claimed by two label lists and nothing decides "
            "between them; add the decision to _row_label and to DECIDED",
        )

    def test_each_decided_string_gets_the_label_that_was_decided(self):
        for value, expected in self.DECIDED.items():
            self.assertEqual(
                fshd_report_service._row_label(value, first_content_line=True),
                expected,
                f"{value} is not labelled the way DECIDED says it is",
            )

    def test_a_decision_is_only_recorded_for_a_string_that_needs_one(self):
        # Keeps DECIDED from silently outliving the ambiguity it
        # documents: a string listed here that is no longer claimed
        # twice is a note about a problem that no longer exists.
        stale = sorted(
            value for value in self.DECIDED if len(self._claimants(value)) < 2
        )
        self.assertEqual(stale, [])

    def test_no_section_header_is_also_a_document_title(self):
        # `_is_title_row` grew a first-line branch, and a page whose
        # first line is a bare section header must still open the
        # section rather than be eaten as the document's name.
        for header in (
            fshd_report_service._RESULT_SECTION_HEADERS
            + fshd_report_service._CONCLUSION_SECTION_HEADERS
            + fshd_report_service._METHOD_SECTION_HEADERS
        ):
            kind, _ = fshd_report_service._row_label(header, first_content_line=True)
            self.assertNotEqual(kind, fshd_report_service._KIND_TITLE, header)


class ACountIsNotTheDigitOfATypeTokenTest(unittest.TestCase):
    """「符合FSHD1」 IS A DIAGNOSIS, NOT A REPEAT COUNT OF ONE.

    The last-resort repeat pattern is 「any digit within 16 characters of
    D4Z4」 and the ordinary Chinese positive conclusion puts the 1 of
    FSHD1 exactly 14 characters away. A report printing no count at all
    published `d4z4_repeat_pathogenic: 1` at 0.97 — the confidence of a
    cell actually read, and the most severe contraction there is.
    """

    POSITIVE_NO_COUNT = """面肩肱型肌营养不良基因检测报告单
检测方法:Southern blot(p13E-11探针,EcoRI/BlnI双酶切)
检测结论:
受检者4q35区D4Z4重复序列缩短,符合FSHD1分子诊断标准.
"""

    def _payload(self):
        return analyze_fshd_report(self.POSITIVE_NO_COUNT, "other", "G.pdf")

    def test_no_count_is_invented_from_the_type_token(self):
        summary = self._payload()["fshd"]["normalized_summary"]["genetic_summary"]
        self.assertIsNone(summary["d4z4_repeat_pathogenic"])

    def test_the_count_reaches_no_channel_a_model_reads_numbers_off(self):
        result = self._payload()
        names = {item["field_name"] for item in result["fshd"]["structured_fields"]}
        self.assertNotIn("d4z4_repeat_pathogenic", names)
        self.assertNotIn("d4z4_repeat_pathogenic", result["latest_summary"]["by_analyte"])

    def test_the_diagnosis_the_report_states_still_survives(self):
        summary = self._payload()["fshd"]["normalized_summary"]["genetic_summary"]
        self.assertEqual(summary["diagnosis_type"], "FSHD1")
        self.assertIn("符合FSHD1", summary["interpretation_summary"])

    def test_a_count_after_a_chinese_character_is_still_read(self):
        text = """FSHD基因检测报告单
检测结果:D4Z4重复单元数为3个
"""
        summary = analyze_fshd_report(text, "other", "G.pdf")["fshd"][
            "normalized_summary"
        ]["genetic_summary"]
        self.assertEqual(summary["d4z4_repeat_pathogenic"], 3)


class TheRebuiltTableRowOutranksTheConclusionSentenceTest(unittest.TestCase):
    """A TIE WAS BEING SETTLED BY APPEND ORDER.

    On the cell-per-line layout the conclusion prose sits on its own line
    under a bare 检测结论 header, so it was promoted to the same rank as
    the rebuilt table rows — which `_page_rows` appends LAST, and
    `_read_cell` keeps a candidate only when the rank is strictly
    better. The report's own printed 5 lost to the threshold quoted in
    its conclusion, and 10 is the boundary that sends a reader off to
    evaluate FSHD2.
    """

    BODY = """面肩肱型肌营养不良基因检测报告单
检测结果
项目
结果
参考区间
单位
D4Z4重复单元数
5
>10
个
检测结论
D4Z4重复单元数低于10个即为缩短,本例符合FSHD1.
"""

    def _payload(self):
        return analyze_fshd_report(self.BODY, "other", "G.pdf")

    def test_the_report_own_printed_count_wins(self):
        summary = self._payload()["fshd"]["normalized_summary"]["genetic_summary"]
        self.assertEqual(summary["d4z4_repeat_pathogenic"], 5)

    def test_the_threshold_quoted_in_the_conclusion_is_not_published(self):
        result = self._payload()
        cell = result["latest_summary"]["by_analyte"]["d4z4_repeat_pathogenic"]
        self.assertEqual(cell["value_num"], 5)

    def test_a_conclusion_sentence_is_not_promoted_to_the_data_rank(self):
        rows = fshd_report_service._page_rows(self.BODY.strip().split("\n"))
        kinds = {row.text: row.kind for row in rows}
        self.assertEqual(
            kinds["D4Z4重复单元数低于10个即为缩短,本例符合FSHD1."],
            fshd_report_service._KIND_CONCLUSION,
        )


class TheConclusionUnderABareHeaderIsStillTheConclusionTest(unittest.TestCase):
    """THE PATIENT LOSES THE REPORT'S OWN WORDS.

    On the cell-per-line layout 「检测结论」 is its own line and the
    sentence is the next one, carrying none of the keywords. Matching
    the bare header also ENDED the search, because it cleans to nothing.
    `interpretation_summary` came out None, `findings` came out empty,
    and the sentence appeared nowhere in the payload — not under
    报告详情 → 来源追溯, and not in what the assistant is handed.
    """

    BODY = """面肩肱型肌营养不良基因检测报告单
检测结果
项目
结果
参考区间
单位
D4Z4重复单元数
5
>10
个
检测结论
D4Z4重复单元数低于10个即为缩短,本例符合FSHD1.
"""

    def _payload(self):
        return analyze_fshd_report(self.BODY, "other", "G.pdf")

    def test_the_sentence_reaches_the_genetic_summary(self):
        summary = self._payload()["fshd"]["normalized_summary"]["genetic_summary"]
        self.assertIn("符合FSHD1", summary["interpretation_summary"])

    def test_the_sentence_reaches_the_structured_field(self):
        fields = {
            item["field_name"]: item["field_value"]
            for item in self._payload()["fshd"]["structured_fields"]
        }
        self.assertIn("符合FSHD1", fields["interpretation_summary"])

    def test_the_sentence_reaches_findings(self):
        findings = self._payload()["findings"]
        self.assertTrue(findings)
        self.assertIn("符合FSHD1", findings[0]["finding_text"])

    def test_a_header_with_nothing_under_it_does_not_reach_down_the_page(self):
        value = fshd_report_service._extract_summary_line(
            ["检测结论", "医师签名: 王某"], ["检测结论", "结论"]
        )
        self.assertIsNone(value)


class ATitleTheSuffixListDoesNotRecogniseIsStillATitleTest(unittest.TestCase):
    """A REPORT IS NAMED AFTER THE TYPE IT WAS ORDERED TO LOOK FOR.

    Two entirely ordinary Chinese titles failed `_is_title_row`: one is
    32 characters against a cap of 30, the other does not end in 报告.
    Both fell through to PLAIN, and on the ordinary negative wording
    that names no type the title's FSHD1 was the only candidate left —
    published as this patient's 分型 at 0.98, onto the passport, the
    exports and `patient_profiles`.
    """

    NEGATIVE = "检测结果:未见4q35D4Z4阵列缩短,结果在正常范围."

    def _diagnosis(self, title):
        text = f"{title}\n{self.NEGATIVE}\n"
        return analyze_fshd_report(text, "other", "G.pdf")["fshd"][
            "normalized_summary"
        ]["genetic_summary"]["diagnosis_type"]

    def test_a_thirty_two_character_title_is_a_title(self):
        title = "面肩肱型肌营养不良1型(FSHD1)D4Z4重复单元数检测报告单"
        self.assertGreater(len(title), 30)
        self.assertIsNone(self._diagnosis(title))

    def test_a_title_that_does_not_end_in_the_word_report_is_a_title(self):
        self.assertIsNone(self._diagnosis("FSHD1基因检测"))

    def test_a_first_data_row_is_not_eaten_as_a_title(self):
        # A page whose heading the OCR dropped must still be read.
        text = """D4Z4重复单元数
3
个
"""
        summary = analyze_fshd_report(text, "other", "G.pdf")["fshd"][
            "normalized_summary"
        ]["genetic_summary"]
        self.assertEqual(summary["d4z4_repeat_pathogenic"], 3)


class TheStatedLengthIsRecordedWhereTheRefusalSaysItIsTest(unittest.TestCase):
    """THE REFUSAL AND THE RECORDING MUST COVER THE SAME SPELLINGS.

    `d4z4_refusal == "length_in_kb"` fires on ANY 「D4Z4 … N kb」 while
    the length patterns each required their own literal label, so for
    the spellings the refusal covered and the patterns did not, the
    measurement was refused as a count and recorded NOWHERE — under a
    comment saying it was already recorded under its own name.
    """

    def _summary(self, body):
        return analyze_fshd_report(body, "other", "G.pdf")["fshd"][
            "normalized_summary"
        ]["genetic_summary"]

    def test_a_length_with_no_recognised_label_is_still_recorded(self):
        summary = self._summary(
            "面肩肱型肌营养不良基因检测报告单\n检测结果:D4Z4阵列38kb\n"
        )
        self.assertEqual(summary["ecori_fragment_kb"], 38.0)

    def test_the_length_is_never_typed_as_a_count(self):
        summary = self._summary(
            "面肩肱型肌营养不良基因检测报告单\n检测结果:D4Z4阵列38kb\n"
        )
        self.assertIsNone(summary["d4z4_repeat_pathogenic"])

    def test_a_labelled_length_still_reports_through_its_own_label(self):
        result = analyze_fshd_report(
            "FSHD基因检测报告单\n检测结果:EcoRI片段长度38kb,D4Z4重复单元数11\n",
            "other",
            "G.pdf",
        )
        summary = result["fshd"]["normalized_summary"]["genetic_summary"]
        self.assertEqual(summary["ecori_fragment_kb"], 38.0)
        self.assertEqual(summary["d4z4_repeat_pathogenic"], 11)

    def test_every_kb_spelling_the_refusal_covers_lands_in_the_length_cell(self):
        for spelling in ("D4Z4阵列38kb", "D4Z4片段38kb", "D4Z4长度38kb", "D4Z438kb"):
            summary = self._summary(
                f"FSHD基因检测报告单\n检测结果:{spelling}\n"
            )
            self.assertEqual(summary["ecori_fragment_kb"], 38.0, spelling)
            self.assertIsNone(summary["d4z4_repeat_pathogenic"], spelling)


class AnOrderedItemLabelDoesNotRefuseThePageBelowItTest(unittest.TestCase):
    """ONE OCR LINE ERASED A CONFIRMED GENETIC FINDING.

    送检项目 is a `_METHOD_SECTION_HEADERS` entry, so a bare one opened a
    METHOD run that never closed; `_KIND_METHOD` is refused, so every
    reader skipped the rest of the page. And giving it self-scope alone
    would trade that for the opposite error, because the cell BELOW it
    is the name of the test that was ORDERED.
    """

    CONFIRMED = """面肩肱型肌营养不良基因检测报告单
送检项目
FSHD1基因检测(Southern blot法)
D4Z4重复单元数:3个
单倍型:4qA
结论:符合FSHD1分子诊断标准.
"""

    def test_the_finding_below_the_label_is_still_read(self):
        summary = analyze_fshd_report(self.CONFIRMED, "other", "G.pdf")["fshd"][
            "normalized_summary"
        ]["genetic_summary"]
        self.assertEqual(summary["d4z4_repeat_pathogenic"], 3)
        self.assertEqual(summary["haplotype"], "4qA")
        self.assertEqual(summary["diagnosis_type"], "FSHD1")

    def test_the_ordered_test_name_is_not_a_diagnosis(self):
        for label in ("送检项目", "检查项目", "检测项目", "检验项目", "标本类型"):
            text = f"{label}\nFSHD1基因检测\n检测结论:未见4q35D4Z4阵列缩短,结果在正常范围.\n"
            summary = analyze_fshd_report(text, "other", "G.pdf")["fshd"][
                "normalized_summary"
            ]["genetic_summary"]
            self.assertIsNone(summary["diagnosis_type"], label)

    def test_an_ordered_item_label_carrying_its_value_inline_is_refused_too(self):
        text = "送检项目:FSHD1基因检测\n检测结论:未见4q35D4Z4阵列缩短,结果在正常范围.\n"
        summary = analyze_fshd_report(text, "other", "G.pdf")["fshd"][
            "normalized_summary"
        ]["genetic_summary"]
        self.assertIsNone(summary["diagnosis_type"])

    def test_the_label_reaches_exactly_one_row(self):
        text = "送检项目\nFSHD1基因检测\nD4Z4重复单元数:3个\n"
        rows = fshd_report_service._page_rows(text.strip().split("\n"))
        kinds = {row.text: row.kind for row in rows if row.kind != "table"}
        self.assertEqual(kinds["FSHD1基因检测"], fshd_report_service._KIND_METHOD)
        self.assertEqual(kinds["D4Z4重复单元数:3个"], fshd_report_service._KIND_PLAIN)


#: The 常规生化全套 of patient_documents 62dd3f96-ac74-42ae-9759-d7b24e230343,
#: as PaddleOCR emits it: one cell per line, 「No 项目 结果 参考区间 单位
#: 方法」, a row index glued to some names and standing alone on others,
#: an arrow column that is only printed when the row is abnormal, and a
#: method column full of assay names built on the analytes they measure.
#: Trimmed to the rows the three defects of this round were measured on.
ARCHIVED_BIOCHEMISTRY_CELLS = """福建医科大学附属第一医院检验报告单
检验目的：常规生化全套检查
临床诊断：面肩肱型肌营养不良症
No
项目
结果
参考区间
单位
方法
*8
丙氨酸氨基转移酶（ALT）
21
9-50
U/L
乳酸脱氢酶法
*9
天冬氨酸氨基转移酶（AST）
23
15-40
U/L
苹果酸脱氢酶
*12乳酸脱氢酶（LDH)
319
↑
120-250
U/L
速率法
*13碱性磷酸酶（ALP)
47
45-125
U/L
氧化酶法
*14肌酸激酶（CK)
693
↑
50-310
U/L
速率法
15肌酸激酶同工酶（活性）（CKMB)
49
↑
<25
U/L
免疫抑制法
17肌酐(CREA)
40.0
↓
57-97
umol/L
酶法
"""


class AMethodNameIsNotAResultLabelTest(unittest.TestCase):
    """A CHINESE ASSAY IS NAMED AFTER THE ENZYME THAT DRIVES IT.

    Measured on the archived 常规生化全套: the ALT row's method column
    reads 「乳酸脱氢酶法」 and, on the cell-per-line layout, is a line of
    its own eleven rows above the report's own
    「*12乳酸脱氢酶（LDH)  319  ↑  120-250」. The first line carrying a
    keyword wins, so 乳酸脱氢酶 matched the METHOD, found no number on
    it, read forward into the next row and took 「*9」 — the AST row's
    INDEX. An LDH of 319 against an upper limit of 250 reached a
    clinician as 9.

    `_gap_names_a_method` built this defence for the genetics cells. This
    is the same rule on the laboratory path, and it is applied to the
    whole map rather than to LDH: ten of the map's analytes have a
    Chinese name that heads a common assay name, and only the order the
    laboratory happened to print its methods in was protecting the other
    nine.
    """

    @staticmethod
    def _fields(result):
        return {item["field_name"]: item for item in result["fshd"]["structured_fields"]}

    def _read(self, text):
        return self._fields(analyze_fshd_report(text, "other", "B.jpeg"))

    def test_the_archived_report_reads_its_own_ldh_row(self):
        fields = self._read(ARCHIVED_BIOCHEMISTRY_CELLS)
        self.assertEqual(fields["ldh"]["field_value"], "319")
        self.assertEqual(fields["ldh"]["unit"], "U/L")
        self.assertIn("*12乳酸脱氢酶(LDH)", fields["ldh"]["source_text"])
        self.assertNotIn("乳酸脱氢酶法", fields["ldh"]["source_text"])

    def test_the_row_index_of_the_next_row_is_never_a_measurement(self):
        fields = self._read(ARCHIVED_BIOCHEMISTRY_CELLS)
        for name in ("ldh", "ck", "ckmb", "alt", "ast", "alp", "creatinine"):
            self.assertNotEqual(fields[name]["field_value"], "9", name)
            self.assertNotIn("*9", fields[name]["source_text"], name)

    def test_every_method_named_analyte_in_the_map_is_covered(self):
        """The shape, not the instance — one case per colliding analyte."""
        for key, method, name, value, reference, unit in (
            ("ldh", "乳酸脱氢酶法", "*12乳酸脱氢酶(LDH)", "319", "120-250", "U/L"),
            ("ck", "肌酸激酶法", "*14肌酸激酶(CK)", "693", "50-310", "U/L"),
            ("urea", "尿素酶法", "*16尿素(UREA)", "6.11", "3.10-8.0", "mmol/L"),
            ("uric_acid", "尿酸酶法", "*19尿酸(UA)", "583", "208-428", "umol/L"),
            ("creatinine", "肌酐酶法", "17肌酐(CREA)", "40.0", "57-97", "umol/L"),
            ("glucose", "葡萄糖氧化酶法", "*20葡萄糖(GLU)", "4.52", "3.90-6.10", "mmol/L"),
            ("phosphorus", "磷钼酸法", "*31无机磷(P)", "1.33", "0.85-1.51", "mmol/L"),
            ("calcium", "钙羧基偶氮法", "*30钙(CA)", "2.26", "2.11-2.52", "mmol/L"),
            ("magnesium", "镁二甲苯胺蓝法", "32镁(MG)", "0.93", "0.53-1.11", "mmol/L"),
            ("cholesterol", "胆固醇氧化酶法", "*21总胆固醇(TCHO)", "3.68", "<5.18", "mmol/L"),
        ):
            with self.subTest(analyte=key):
                fields = self._read("\n".join((
                    "XX医院 生化检验报告",
                    "*1丙氨酸氨基转移酶(ALT)", "21", "9-50", "U/L", method,
                    name, value, reference, unit, "速率法",
                )))
                self.assertEqual(fields[key]["field_value"], value)
                self.assertEqual(fields[key]["unit"], unit)
                self.assertEqual(fields["alt"]["field_value"], "21")

    def test_a_row_that_prints_its_own_method_column_still_reads(self):
        """A TOKEN, NOT A LINE. A row printed on one line carries its
        method beside its reading, and refusing the line would refuse the
        reading with it."""
        fields = self._read("\n".join((
            "XX医院 生化检验报告",
            "*8丙氨酸氨基转移酶(ALT) 21 9-50 U/L 乳酸脱氢酶法",
            "*12乳酸脱氢酶(LDH) 319 ↑ 120-250 U/L 速率法",
        )))
        self.assertEqual(fields["alt"]["field_value"], "21")
        self.assertEqual(fields["ldh"]["field_value"], "319")

    def test_an_analyte_named_only_in_a_method_column_is_not_published(self):
        """Nothing is better than the next row's index."""
        fields = self._read("\n".join((
            "XX医院 生化检验报告",
            "*8丙氨酸氨基转移酶(ALT)", "21", "9-50", "U/L", "乳酸脱氢酶法",
            "*9天冬氨酸氨基转移酶(AST)", "23", "15-40", "U/L", "苹果酸脱氢酶",
        )))
        self.assertNotIn("ldh", fields)
        self.assertEqual(fields["alt"]["field_value"], "21")
        self.assertEqual(fields["ast"]["field_value"], "23")


class TheRowSaysWhetherItIsAbnormalTest(unittest.TestCase):
    """THE FLAG AND THE INTERVAL WERE INSIDE THE CAPTURED SNIPPET.

    The CK row of the archived report was captured whole —
    「*14肌酸激酶(CK) 693 ↑ 50-310 U/L」 — and published as an ordinary
    693 with `is_abnormal: false` and an empty reference. A CK of 693
    against an upper limit of 310, flagged ↑ by the laboratory, on the
    marker this disease is monitored by, on the passport a patient hands
    to a clinician.
    """

    @staticmethod
    def _by_analyte(result):
        return {obs["analyte_name"]: obs for obs in result["observations"]}

    def test_the_archived_ck_row_carries_its_flag_and_its_interval(self):
        observations = self._by_analyte(
            analyze_fshd_report(ARCHIVED_BIOCHEMISTRY_CELLS, "other", "B.jpeg")
        )
        ck = observations["ck"]
        self.assertEqual(ck["result"]["value_num"], 693.0)
        self.assertTrue(ck["interpretation"]["is_abnormal"])
        self.assertEqual(ck["interpretation"]["direction"], "high")
        self.assertEqual(ck["reference"]["range_raw"], "50-310")
        self.assertEqual(ck["reference"]["low"], 50.0)
        self.assertEqual(ck["reference"]["high"], 310.0)

    def test_a_one_sided_interval_is_recorded_as_one_sided(self):
        """「<25」 is an upper limit and no lower one, which is the whole
        of what the CKMB row states."""
        observations = self._by_analyte(
            analyze_fshd_report(ARCHIVED_BIOCHEMISTRY_CELLS, "other", "B.jpeg")
        )
        ckmb = observations["ckmb"]
        self.assertEqual(ckmb["result"]["value_num"], 49.0)
        self.assertTrue(ckmb["interpretation"]["is_abnormal"])
        self.assertEqual(ckmb["reference"]["range_raw"], "<25")
        self.assertIsNone(ckmb["reference"]["low"])
        self.assertEqual(ckmb["reference"]["high"], 25.0)

    def test_a_downward_flag_reads_too(self):
        creatinine = self._by_analyte(
            analyze_fshd_report(ARCHIVED_BIOCHEMISTRY_CELLS, "other", "B.jpeg")
        )["creatinine"]
        self.assertEqual(creatinine["interpretation"]["direction"], "low")
        self.assertEqual(creatinine["reference"]["low"], 57.0)
        self.assertEqual(creatinine["reference"]["high"], 97.0)

    def test_the_abnormal_rows_reach_the_summary(self):
        summary = analyze_fshd_report(ARCHIVED_BIOCHEMISTRY_CELLS, "other", "B.jpeg")[
            "latest_summary"
        ]
        flagged = {row["analyte_name"] for row in summary["abnormal_list"]}
        self.assertEqual(flagged, {"ck", "ckmb", "ldh", "creatinine"})
        self.assertEqual(summary["by_analyte"]["ldh"]["reference_high"], 250.0)

    def test_an_unflagged_row_is_not_made_abnormal_by_its_interval(self):
        """The laboratory's verdict, not this file's. Grading a reading
        against its interval is a decision with a specimen, an age and a
        unit in it; recording what the row printed is not."""
        observations = self._by_analyte(
            analyze_fshd_report(ARCHIVED_BIOCHEMISTRY_CELLS, "other", "B.jpeg")
        )
        alt = observations["alt"]
        self.assertFalse(alt["interpretation"]["is_abnormal"])
        self.assertIsNone(alt["interpretation"]["direction"])
        self.assertEqual(alt["reference"]["range_raw"], "9-50")

    def test_a_flag_spelled_out_does_not_end_the_row(self):
        """「偏高」 has CJK in it and no digits, so a row boundary drawn on
        「looks like an analyte name」 cut the row between its reading and
        its interval."""
        observations = self._by_analyte(analyze_fshd_report(
            "\n".join((
                "XX医院 生化检验报告",
                "肌酸激酶(CK)", "693", "偏高", "50-310", "U/L",
                "肌酐(CREA)", "40.0", "偏低", "57-97", "umol/L",
            )),
            "other",
            "B.jpeg",
        ))
        self.assertEqual(observations["ck"]["interpretation"]["direction"], "high")
        self.assertEqual(observations["ck"]["reference"]["high"], 310.0)
        self.assertEqual(observations["ck"]["result"]["unit"], "U/L")
        self.assertEqual(observations["creatinine"]["interpretation"]["direction"], "low")

    def test_a_one_sided_reading_is_not_also_its_own_reference(self):
        observations = self._by_analyte(analyze_fshd_report(
            "\n".join(("XX医院 生化检验报告", "肌酸激酶同工酶(CKMB)", "<0.01", "U/L")),
            "other",
            "B.jpeg",
        ))
        ckmb = observations["ckmb"]
        self.assertEqual(ckmb["result"]["value_raw"], "<0.01")
        self.assertIsNone(ckmb["reference"]["range_raw"])

    def test_a_row_with_no_reference_column_keeps_the_shape_it_had(self):
        observations = self._by_analyte(analyze_fshd_report(
            "\n".join(("XX医院 生化检验报告", "肌酸激酶(CK): 890 U/L")),
            "other",
            "B.jpeg",
        ))
        self.assertEqual(observations["ck"]["reference"],
                         {"range_raw": None, "low": None, "high": None, "unit": "U/L"})

    def test_the_interval_comes_off_this_row_and_not_the_next(self):
        observations = self._by_analyte(analyze_fshd_report(
            "\n".join((
                "XX医院 生化检验报告",
                "肌酸激酶(CK)", "693",
                "碱性磷酸酶(ALP)", "47", "45-125", "U/L",
            )),
            "other",
            "B.jpeg",
        ))
        self.assertEqual(observations["ck"]["result"]["value_num"], 693.0)
        self.assertIsNone(observations["ck"]["reference"]["range_raw"])
        self.assertEqual(observations["alp"]["reference"]["range_raw"], "45-125")


class AMilligramIsNotAMagnesiumTest(unittest.TestCase):
    """`mg` IS BOTH MAGNESIUM AND A MILLIGRAM.

    `_analyte_keyword_pattern` answers 「is this hit inside a longer
    word」, and 「mg/dL」 puts a token boundary right after the `mg`. So
    the unit column of any row reporting in milligrams named itself
    magnesium and then read forward for a number. The same class as
    「mb」 inside 「CK-MB」, one column further right.
    """

    @staticmethod
    def _panel(result):
        return result["fshd"]["normalized_summary"]["lab_panel"]

    def test_a_milligram_unit_does_not_publish_a_magnesium(self):
        panel = self._panel(analyze_fshd_report(
            "\n".join(("XX医院 生化检验报告", "血清铁", "12.0", "mg/dL", "200", "ng/mL")),
            "other",
            "B.jpeg",
        ))
        self.assertNotIn("magnesium", panel)

    def test_a_real_magnesium_row_still_reads(self):
        panel = self._panel(analyze_fshd_report(
            "\n".join(("XX医院 生化检验报告", "镁(MG)", "0.93", "0.53-1.11", "mmol/L")),
            "other",
            "B.jpeg",
        ))
        self.assertEqual(panel["magnesium"], 0.93)

    def test_a_latin_analyte_column_still_reads(self):
        """A lone 「CK」 cell is unit-shaped too, and it spans its whole
        token, so it still names creatine kinase."""
        panel = self._panel(analyze_fshd_report(
            "\n".join(("XX医院 生化检验报告", "CK", "890", "U/L")), "other", "B.jpeg"
        ))
        self.assertEqual(panel["ck"], 890.0)


class NoMyoglobinIsMintedFromACkMbTest(unittest.TestCase):
    """THE ARCHIVED PAYLOAD FOR 62dd3f96 CARRIES `mb: 49`, WHICH IS THE
    CKMB'S 49, AND THE PARSER NO LONGER MINTS IT.

    Confirmed by execution against the archived text rather than by
    reading: the boundary in `_analyte_keyword_pattern` puts `-` inside
    the word, so `mb` is refused inside both 「CKMB」 and 「CK-MB」. The
    row is locked here because the archived row is still on a patient's
    screen and nothing about that row tells this file it was fixed.
    """

    def test_the_archived_report_mints_no_myoglobin(self):
        result = analyze_fshd_report(ARCHIVED_BIOCHEMISTRY_CELLS, "other", "B.jpeg")
        panel = result["fshd"]["normalized_summary"]["lab_panel"]
        self.assertNotIn("mb", panel)
        self.assertEqual(panel["ckmb"], 49.0)

    def test_both_spellings_of_the_isoenzyme_refuse_the_myoglobin(self):
        for printed in ("肌酸激酶同工酶(CKMB)", "肌酸激酶同工酶(CK-MB)"):
            with self.subTest(printed=printed):
                panel = analyze_fshd_report(
                    "\n".join(("XX医院 生化检验报告", f"{printed}: 49 U/L")),
                    "other",
                    "B.jpeg",
                )["fshd"]["normalized_summary"]["lab_panel"]
                self.assertNotIn("mb", panel)
                self.assertEqual(panel["ckmb"], 49.0)

    def test_a_real_myoglobin_row_still_reads(self):
        panel = analyze_fshd_report(
            "\n".join((
                "XX医院 生化检验报告",
                "肌酸激酶同工酶(CK-MB): 25 U/L",
                "肌红蛋白(MYO): 45 ng/mL",
            )),
            "other",
            "B.jpeg",
        )["fshd"]["normalized_summary"]["lab_panel"]
        self.assertEqual(panel["mb"], 45.0)
        self.assertEqual(panel["ckmb"], 25.0)


class TheLowerBoundIsNotTheReadingTest(unittest.TestCase):
    """A SECOND ARCHIVED COPY OF THE SAME PANEL, READ BY THE FALLBACK.

    patient_documents 0dcab9e5-de8b-4e8c-b441-0bb62bdb05e7 is the same
    生化全套 as 62dd3f96, read by Tesseract rather than PaddleOCR, and
    the fallback did not recover the 结果 column at all — the rows print
    their name, their reference interval and their unit and nothing
    else. `re.search` takes the first number it finds, so every one of
    those rows published the BOTTOM OF THE NORMAL RANGE as this
    patient's reading: `ck: 50` off 「50-310」, on the patient whose CK
    is 693, and `ldh: 120`, `alp: 45`, `alt: 9`, `ast: 15`, `ggt: 10`
    the same way. Six normal-looking numbers, none of them measured.

    `_BOUND_CELL` states the rule for the cell reader — a limit is a
    reference by default. A flattened row keeps 「50-310」 in one piece,
    where no cell test can see it.
    """

    ARCHIVED_TESSERACT_ROWS = """福建医科大学附属第一医院检验报告单
检验目的  常规生化全套检查
结果            参考区间               单位        方法
*# 8 两氨酸氨基转移酶(ALT)                           9-50              U/L
# 9 天冬氨酸氨基转移酶(AST)                           15-40             U/L
*# 11 Y-谷氨酰转肽酶(GGT)                                  10-60                UL
# 12 乳酸脱氧酶(LDH)                                         +      120-250                 U/L
# 13 碱性磷酸酶(ALP)                                               45-125                  UL
# 14 肌酸激酶(CK)                                         人     50-310                U/L        速率法
"""

    @staticmethod
    def _panel(result):
        return result["fshd"]["normalized_summary"].get("lab_panel", {})

    def test_a_row_with_no_result_column_publishes_nothing(self):
        panel = self._panel(
            analyze_fshd_report(self.ARCHIVED_TESSERACT_ROWS, "other", "B.jpeg")
        )
        for analyte in ("ck", "ldh", "alp", "alt", "ast", "ggt"):
            self.assertNotIn(analyte, panel, analyte)

    def test_a_row_that_does_print_a_result_still_reads_it(self):
        panel = self._panel(analyze_fshd_report(
            "\n".join((
                "XX医院 生化检验报告",
                "# 14 肌酸激酶(CK)   693   50-310   U/L   速率法",
                "# 12 乳酸脱氢酶(LDH)   319   120-250   U/L   速率法",
            )),
            "other",
            "B.jpeg",
        ))
        self.assertEqual(panel["ck"], 693.0)
        self.assertEqual(panel["ldh"], 319.0)

    def test_the_reading_is_read_whichever_column_order_prints_it(self):
        """项目 / 参考区间 / 结果 is an ordinary Chinese column order, and
        it puts the interval to the LEFT of the reading."""
        panel = self._panel(analyze_fshd_report(
            "\n".join(("XX医院 生化检验报告", "肌酸激酶(CK)   50-310   693   U/L")),
            "other",
            "B.jpeg",
        ))
        self.assertEqual(panel["ck"], 693.0)

    def test_a_one_sided_limit_is_still_the_reading_when_it_is_all_there_is(self):
        result = analyze_fshd_report(
            "\n".join(("XX医院 生化检验报告", "肌酸激酶同工酶(CKMB)   <0.01   U/L")),
            "other",
            "B.jpeg",
        )
        fields = {item["field_name"]: item for item in result["fshd"]["structured_fields"]}
        self.assertEqual(fields["ckmb"]["field_value"], "<0.01")
        self.assertIsNone(fields["ckmb"].get("reference_range_raw"))


class TheRowIsReadPastItsUnitColumnTest(unittest.TestCase):
    """项目 / 结果 / 单位 / 参考区间 puts the interval LAST.

    The forward scan returned the moment it had a value and a unit, and
    on that column order the unit cell is the third of four — so every
    cell to the right of it was abandoned unread, taking the reference
    interval with it. A CK of 693 and an LDH of 319 came back with
    「50-310」 and 「120-250」 nowhere in the payload: the column the row
    reader exists to record, and the only thing either number can be
    abnormal against.
    """

    ROWS = (
        "示例市中心医院 检验报告单",
        "检验目的: 心肌酶谱",
        "项目", "结果", "单位", "参考区间",
        "肌酸激酶(CK)", "693", "U/L", "50-310",
        "乳酸脱氢酶(LDH)", "319", "U/L", "120-250",
    )

    @staticmethod
    def _fields(result):
        return {item["field_name"]: item for item in result["fshd"]["structured_fields"]}

    def test_the_interval_to_the_right_of_the_unit_is_read(self):
        fields = self._fields(
            analyze_fshd_report("\n".join(self.ROWS), "other", "muscle enzyme.jpeg")
        )
        self.assertEqual(fields["ck"]["field_value"], "693")
        self.assertEqual(fields["ck"]["unit"], "U/L")
        self.assertEqual(fields["ck"]["reference_range_raw"], "50-310")
        self.assertEqual(fields["ck"]["reference_high"], 310.0)

    def test_the_row_below_keeps_its_own_interval(self):
        """Reading on cannot reach the next analyte's cells: the next
        analyte's name is what ends the row."""
        fields = self._fields(
            analyze_fshd_report("\n".join(self.ROWS), "other", "muscle enzyme.jpeg")
        )
        self.assertEqual(fields["ldh"]["reference_range_raw"], "120-250")

    def test_a_unit_printed_as_its_own_cell_after_the_interval_still_reads(self):
        """The other column order, which is the one that already worked."""
        fields = self._fields(analyze_fshd_report(
            "\n".join((
                "示例市中心医院 检验报告单",
                "肌酸激酶(CK)", "693", "50-310", "U/L",
            )),
            "other",
            "muscle enzyme.jpeg",
        ))
        self.assertEqual(fields["ck"]["unit"], "U/L")
        self.assertEqual(fields["ck"]["reference_range_raw"], "50-310")


class ABareLetterIsTheFlagAndNotTheUnitTest(unittest.TestCase):
    """The Sysmex and Beckman convention prints the flag as one letter.

    `is_unit_only` accepted any Latin run and `_read_row_flag` knew only
    arrows and spelled-out Chinese, so the letter became the row's UNIT:
    a CK of 693 published as 「693H」, the laboratory's own 「U/L」 never
    reached, and the flag lost — on the marker this disease is monitored
    by.
    """

    @staticmethod
    def _observation(rows, analyte):
        result = analyze_fshd_report("\n".join(rows), "other", "muscle enzyme.jpeg")
        return {obs["analyte_name"]: obs for obs in result["observations"]}[analyte]

    def test_the_letter_is_read_as_the_flag_and_the_unit_survives(self):
        ck = self._observation((
            "示例市中心医院 检验报告单",
            "项目", "结果", "提示", "单位", "参考区间",
            "肌酸激酶(CK)", "693", "H", "U/L", "50-310",
        ), "ck")
        self.assertEqual(ck["result"]["unit"], "U/L")
        self.assertEqual(ck["interpretation"]["direction"], "high")
        self.assertEqual(ck["reference"]["range_raw"], "50-310")

    def test_the_downward_letter_reads_too(self):
        creatinine = self._observation((
            "示例市中心医院 检验报告单",
            "肌酐(CREA)", "40.0", "L", "umol/L", "57-97",
        ), "creatinine")
        self.assertEqual(creatinine["interpretation"]["direction"], "low")
        self.assertEqual(creatinine["result"]["unit"], "umol/L")

    def test_the_flag_on_a_flattened_row_is_not_taken_as_the_unit(self):
        ck = self._observation((
            "示例市中心医院 检验报告单",
            "肌酸激酶(CK) 693 H 50-310 U/L",
        ), "ck")
        self.assertEqual(ck["interpretation"]["direction"], "high")
        self.assertNotEqual(ck["result"]["unit"], "H")

    def test_the_l_of_a_unit_is_not_a_flag(self):
        """「U/L」 is one token and 「L」 is not it — which is the whole
        reason the letters are read as cells rather than substrings."""
        ck = self._observation((
            "示例市中心医院 检验报告单",
            "肌酸激酶(CK)", "693", "U/L", "50-310",
        ), "ck")
        self.assertIsNone(ck["interpretation"]["direction"])
        self.assertFalse(ck["interpretation"]["is_abnormal"])


class TheGenericTableReaderReadsTheWholeRowTest(unittest.TestCase):
    """The reader that exists for the analytes nobody wrote a pattern for.

    It had the same two defects, one column apart: a one-letter flag is
    unit-shaped, so 「H」 was published as the unit and the laboratory's
    own unit — one cell further right — was never reached; and a flag
    SPELLED OUT is CJK with no digits, so `_looks_like_analyte` called it
    the next analyte and ended the row before its unit. The reference
    the row dict has always carried was never passed on either.
    """

    ROWS = (
        "示例市中心医院 检验报告单",
        "项目", "结果", "提示", "单位", "参考区间",
        "游离甲状腺素指数", "4.5", "H", "pmol/L", "1.0-4.0",
        "抗核抗体滴度", "1.5", "偏高", "ratio", "0-1.0",
    )

    def test_a_letter_flag_is_not_the_unit(self):
        rows = {row["name"]: row for row in extract_lab_table_rows(list(self.ROWS))}
        self.assertEqual(rows["游离甲状腺素指数"]["unit"], "pmol/L")
        self.assertEqual(rows["游离甲状腺素指数"]["flag"], "high")

    def test_a_spelled_out_flag_does_not_end_the_row(self):
        rows = {row["name"]: row for row in extract_lab_table_rows(list(self.ROWS))}
        self.assertEqual(rows["抗核抗体滴度"]["unit"], "ratio")
        self.assertEqual(rows["抗核抗体滴度"]["reference"], "0-1.0")

    def test_the_field_carries_what_the_row_said(self):
        result = analyze_fshd_report("\n".join(self.ROWS), "other", "T.jpeg")
        fields = {item["field_name"]: item for item in result["fshd"]["structured_fields"]}
        cell = fields["table_游离甲状腺素指数"]
        self.assertEqual(cell["unit"], "pmol/L")
        self.assertEqual(cell["abnormal_flag"], "high")
        self.assertEqual(cell["reference_range_raw"], "1.0-4.0")
        self.assertEqual(cell["reference_high"], 4.0)

    def test_a_row_a_canonical_extractor_already_published_is_not_repeated(self):
        """One laboratory row is one analyte. The guard read a bare
        reading for membership in a set of whole row snippets, which is
        never true, so the archived 生化全套 published its CK twice —
        and once the flag was carried, the same creatine kinase appeared
        twice in `abnormal_list`."""
        result = analyze_fshd_report(ARCHIVED_BIOCHEMISTRY_CELLS, "other", "B.jpeg")
        names = [item["field_name"] for item in result["fshd"]["structured_fields"]]
        self.assertIn("ck", names)
        self.assertEqual([name for name in names if name.startswith("table_")], [])
        flagged = [row["analyte_name"] for row in result["latest_summary"]["abnormal_list"]]
        self.assertEqual(sorted(flagged), sorted(set(flagged)))

    def test_a_panel_row_is_not_published_twice_either(self):
        """`_panel_source_line` answers with the LINE carrying a keyword,
        and on the cell-per-line layout that is the analyte's name alone
        — evidence that does not contain the reading it is evidence for,
        and nothing this reader could recognise as the same row."""
        result = analyze_fshd_report("\n".join((
            "示例市第一人民医院 检验报告单",
            "检验目的: 甲功三项",
            "游离T3", "5.2", "3.1-6.8", "pmol/L",
            "游离T4", "16.8", "12-22", "pmol/L",
        )), "other", "T.jpeg")
        names = [item["field_name"] for item in result["fshd"]["structured_fields"]]
        self.assertIn("ft3", names)
        self.assertEqual([name for name in names if name.startswith("table_")], [])

    def test_an_analyte_nobody_wrote_a_pattern_for_is_still_published(self):
        result = analyze_fshd_report("\n".join(self.ROWS), "other", "T.jpeg")
        names = {item["field_name"] for item in result["fshd"]["structured_fields"]}
        self.assertIn("table_抗核抗体滴度", names)


class EveryPanelSaysWhatTheRowSaidTest(unittest.TestCase):
    """The flag and reference work had landed in ONE panel.

    `_extract_labs` read them; 血常规, 甲功, 凝血, 尿常规, 感染筛查 and
    粪便 all reach `_append_panel_number` instead, which passed no flag,
    no interval and a unit only where one was hard-coded. A haemoglobin
    the laboratory flagged reached the patient as a bare 98.
    """

    @staticmethod
    def _observations(rows, hint, name):
        result = analyze_fshd_report("\n".join(rows), hint, name)
        return {obs["analyte_name"]: obs for obs in result["observations"]}

    def test_a_flagged_haemoglobin_reaches_the_patient_flagged(self):
        hgb = self._observations((
            "示例市第一人民医院 检验报告单",
            "检验目的: 血常规",
            "项目 结果 参考区间 单位",
            "血红蛋白量(HGB) 98 ↓ 130-175 g/L",
            "白细胞计数(WBC) 6.69 3.5-9.5 10^9/L",
        ), "other", "blood routine.jpeg")["hgb"]
        self.assertEqual(hgb["result"]["value_num"], 98.0)
        self.assertEqual(hgb["result"]["unit"], "g/L")
        self.assertEqual(hgb["interpretation"]["direction"], "low")
        self.assertEqual(hgb["reference"]["range_raw"], "130-175")
        self.assertEqual(hgb["reference"]["low"], 130.0)

    def test_an_unflagged_row_on_the_same_panel_stays_unflagged(self):
        wbc = self._observations((
            "示例市第一人民医院 检验报告单",
            "检验目的: 血常规",
            "白细胞计数(WBC) 6.69 3.5-9.5 10^9/L",
        ), "other", "blood routine.jpeg")["wbc"]
        self.assertFalse(wbc["interpretation"]["is_abnormal"])
        self.assertEqual(wbc["reference"]["range_raw"], "3.5-9.5")

    def test_a_coagulation_row_carries_its_interval(self):
        aptt = self._observations((
            "示例市第一人民医院 检验报告单",
            "检验目的: 凝血四项",
            "活化部分凝血活酶时间(APTT) 45.2 ↑ 25.0-38.0 s",
        ), "other", "coagulation.jpeg")["aptt"]
        self.assertEqual(aptt["interpretation"]["direction"], "high")
        self.assertEqual(aptt["reference"]["range_raw"], "25.0-38.0")

    def test_a_hard_coded_unit_still_wins_over_the_row(self):
        """A definition's unit is a statement about the analyte; the
        row's is a reading of the page."""
        result = analyze_fshd_report("\n".join((
            "示例市第一人民医院 检验报告单",
            "检验目的: 血常规",
            "中性粒细胞比率(NEUT%) 62.5 40.0-75.0 %",
        )), "other", "blood routine.jpeg")
        fields = {item["field_name"]: item for item in result["fshd"]["structured_fields"]}
        self.assertEqual(fields["neut_pct"]["unit"], "%")

    def test_a_row_with_no_reference_column_keeps_the_shape_it_had(self):
        thyroid = self._observations((
            "示例市第一人民医院 检验报告单",
            "检验目的: 甲状腺功能",
            "游离T3 结果 5.2",
        ), "other", "thyroid.jpeg")
        self.assertEqual(thyroid["ft3"]["result"]["value_num"], 5.2)
        self.assertIsNone(thyroid["ft3"]["reference"]["range_raw"])

    def test_the_row_is_only_believed_when_the_two_readers_agree(self):
        """The panel pattern finds the number; the row reader finds the
        row. Where they name different numbers the row reader is looking
        at a different row, and nothing of it is carried — which is what
        stops one analyte's interval landing beside another's value."""
        lines = [
            "示例市第一人民医院 检验报告单",
            "血红蛋白量(HGB) 98 130-175 g/L",
        ]
        vocabulary = {"hgb": ["血红蛋白", "HGB"]}
        agreed = fshd_report_service._row_context(vocabulary, "hgb", lines, "98")
        self.assertEqual(agreed.reference_raw, "130-175")
        disagreed = fshd_report_service._row_context(vocabulary, "hgb", lines, "155")
        self.assertIsNone(disagreed.value)
        self.assertIsNone(disagreed.reference_raw)


class AGapIsALabelToValueGapOrItIsNothingTest(unittest.TestCase):
    """THE SAME GAP-WIDTH CLASS, FIXED BY SHAPE THIS TIME.

    Eight characters is short enough for 「甲基化水平: 35%」 and equally
    short enough for 「…甲基化水平常低于 25%」 — an ordinary sentence of
    disease background, printed on the genetics reports that carry one.
    The narrower width was the fix twice before; the gap is now judged
    by what it SAYS, so the next widening cannot reintroduce it.
    """

    HEAD = "示例大学附属医院 基因检测报告"

    def _fields(self, line):
        result = analyze_fshd_report(
            "\n".join((self.HEAD, line)), "genetic_report", "genetics.pdf"
        )
        return {item["field_name"]: item["field_value"]
                for item in result["fshd"]["structured_fields"]}

    def test_a_background_sentence_mints_no_methylation(self):
        report = "\n".join((
            self.HEAD,
            "检测项目: FSHD1 基因检测(D4Z4 重复单元数)",
            "面肩肱型肌营养不良2型患者的 D4Z4 甲基化水平常低于 25%。",
            "检测结果:",
            "D4Z4重复单元数 3/22",
            "结论: 本次检测支持 FSHD1 诊断。",
        ))
        summary = analyze_fshd_report(report, "genetic_report", "genetics.pdf")[
            "fshd"
        ]["normalized_summary"]["genetic_summary"]
        self.assertIsNone(summary["methylation_value"])
        # The cells the report really printed are untouched.
        self.assertEqual(summary["d4z4_repeat_pathogenic"], 3)
        self.assertEqual(summary["diagnosis_type"], "FSHD1")

    def test_a_population_sentence_mints_no_repeat_count(self):
        self.assertIsNone(
            self._fields("正常人群 D4Z4 重复单元数多于 10 个。").get(
                "d4z4_repeat_pathogenic"
            )
        )

    def test_every_spelling_of_a_real_methylation_row_still_reads(self):
        for line, expected in (
            ("甲基化: 35%", "35"),
            ("甲基化水平 35 %", "35"),
            ("D4Z4 甲基化水平: 0.35", "0.35"),
            ("甲基化分析: 35%", "35"),
            ("检测结果: 甲基化程度 35%", "35"),
            ("甲基化 BSP 35%", "35"),
            ("检测结果: 甲基化水平=35%", "35"),
        ):
            with self.subTest(line=line):
                self.assertEqual(self._fields(line).get("methylation_value"), expected)

    def test_every_spelling_of_a_real_count_row_still_reads(self):
        for line, expected in (
            ("D4Z4重复单元数 3/22", "3"),
            # 为 / 是 / 共 / = are the sentence spellings of 「:」, and a
            # ten-character gap made of nothing but the label's own tail
            # still reads — the width is not what decides.
            ("检测结果: 本项目检出 D4Z4 重复单元数为 3", "3"),
            ("检测结果: D4Z4 重复单元数是 3", "3"),
            ("检测结果: D4Z4 重复单元共 3 个", "3"),
            ("检测结果: D4Z4重复单元数检测结果为 3", "3"),
            ("检测结果: D4Z4重复单元数: 5", "5"),
            ("检测结果: D4Z4 重复单元数 1-10", "1-10"),
            ("检测结果: D4Z4 Southern 重复单元数 3", "3"),
        ):
            with self.subTest(line=line):
                self.assertEqual(
                    self._fields(line).get("d4z4_repeat_pathogenic"), expected
                )

    def test_every_spelling_of_a_real_length_row_still_reads(self):
        for line, expected in (
            ("D4Z4 EcoRI 片段长度: 38 kb", "38"),
            ("D4Z4 大小: 20 kb", "20"),
            ("检测结果: D4Z4阵列38kb", "38"),
            ("检测结果: D4Z4 片段大小为 25 kb", "25"),
        ):
            with self.subTest(line=line):
                self.assertEqual(self._fields(line).get("ecori_fragment_kb"), expected)


class AMappedNameInsideAnAnalyteTheMapDoesNotOwnTest(unittest.TestCase):
    """A cardiac panel is an ordinary thing for an FSHD patient to upload.

    `_competing_analyte_keywords` computes collisions FROM THE MAP, which
    cannot see a mapped name printed inside a name the map has never
    heard of. Measured on a synthetic 生化全套: a BNP of 1580 published
    as this patient's SODIUM, a cTnI of 0.85 as their CALCIUM, a 前白蛋白
    as their albumin, a β2微球蛋白 as their globulin, and 尿肌酐 / 尿磷 as
    serum results. A sodium of 1580 is not a survivable figure.
    """

    HEAD = (
        "示例市中心医院 检验报告单",
        "检验目的: 常规生化全套",
        "项目 结果 单位 参考区间",
    )

    def _panel(self, row):
        result = analyze_fshd_report(
            "\n".join((*self.HEAD, row)), "other", "biochemistry.jpeg"
        )
        return result["fshd"]["normalized_summary"].get("lab_panel") or {}

    def test_no_mapped_analyte_is_published_off_a_foreign_row(self):
        for row, key in (
            ("脑钠肽(BNP) 1580 pg/mL 0-100", "sodium"),
            ("N末端B型钠尿肽前体 1580 pg/mL 0-100", "sodium"),
            ("超敏肌钙蛋白I(cTnI) 0.85 ng/mL 0-0.04", "calcium"),
            ("降钙素原(PCT) 0.05 ng/mL 0-0.5", "calcium"),
            ("前白蛋白(PA) 180 mg/L 200-400", "alb"),
            ("尿微量白蛋白 25 mg/L 0-30", "alb"),
            ("β2微球蛋白 3.6 mg/L 1.0-3.0", "globulin"),
            ("免疫球蛋白G 12.5 g/L 7.0-16.0", "globulin"),
            ("甲状腺球蛋白 18.0 ng/mL 3.5-77", "globulin"),
            ("尿肌酐 8500 umol/L 6000-12000", "creatinine"),
            ("24小时尿钙 3.5 mmol/24h 2.5-7.5", "calcium"),
            ("尿磷 22 mmol/24h 13-42", "phosphorus"),
            ("酸性磷酸酶 3.1 U/L 0-9", "phosphorus"),
            ("磷酸肌酸激酶(CPK) 693 U/L 50-310", "phosphorus"),
            ("白蛋白/球蛋白比值 1.5 1.2-2.4", "alb"),
            ("白蛋白/球蛋白比值 1.5 1.2-2.4", "globulin"),
        ):
            with self.subTest(row=row, key=key):
                self.assertNotIn(key, self._panel(row))

    def test_the_cell_the_map_does_own_still_reads(self):
        for row, key, expected in (
            ("血清钠(Na) 140 mmol/L 137-147", "sodium", 140.0),
            ("血清钙(Ca) 2.35 mmol/L 2.11-2.52", "calcium", 2.35),
            ("白蛋白(ALB) 42 g/L 40-55", "alb", 42.0),
            ("球蛋白(GLO) 28 g/L 20-30", "globulin", 28.0),
            ("肌酐(Cr) 68 umol/L 57-97", "creatinine", 68.0),
            ("无机磷(P) 1.15 mmol/L 0.85-1.51", "phosphorus", 1.15),
            ("血钾(K) 4.2 mmol/L 3.5-5.3", "potassium", 4.2),
            ("肌酸激酶(CK) 693 U/L 50-310", "ck", 693.0),
        ):
            with self.subTest(row=row):
                self.assertEqual(self._panel(row).get(key), expected)

    def test_a_name_the_map_should_own_is_read_rather_than_refused(self):
        """磷酸肌酸激酶 and 白蛋白/球蛋白 are printed spellings of cells
        this map HAS — so they are keywords, which closes the collision
        and reads the row in one move."""
        self.assertEqual(self._panel("磷酸肌酸激酶(CPK) 693 U/L 50-310").get("ck"), 693.0)
        self.assertEqual(
            self._panel("白蛋白/球蛋白比值 1.5 1.2-2.4").get("a_g_ratio"), 1.5
        )


# --------------------------------------------------------------------
# ONE ROW READER FOR EVERY LABORATORY PANEL.
#
# Everything below was measured on the same defect wearing seven
# different hats: a fix landed in `_extract_labs` — the biochemistry and
# muscle-enzyme map, which reads its rows with `_extract_lab_value` —
# and the six panels that reach `_extract_numeric_panel` instead kept
# the old answer. The column orders, the flag conventions, the unit
# forms and the interval forms are identical on all seven; what differs
# is the analyte names. So the reader is shared and the names are what a
# panel declares.
#
# Every fixture is synthetic.
# --------------------------------------------------------------------


class TheLowerBoundIsNotTheReadingOnAnyPanelTest(unittest.TestCase):
    """The 项目 / 参考区间 / 结果 column order, on the panel path.

    `_BOUND_CELL` in this module calls that order 「ordinary on Chinese
    laboratory reports」, and the row reader was taught it. The panel
    patterns are written 「the analyte's name, then the first number」,
    which on that order is the reference interval's LOWER BOUND — so a
    white cell count of 6.69 was published as 3.5 and a haemoglobin of
    98 as 130, on every one of 血常规, 甲功, 凝血, 尿常规, 感染筛查 and
    粪便.
    """

    @staticmethod
    def _panel(rows, name="x.jpeg"):
        result = analyze_fshd_report("\n".join(rows), "other", name)
        return result["fshd"]["normalized_summary"]["lab_panel"]

    def test_a_flattened_blood_count_reads_its_result_column(self):
        panel = self._panel((
            "示例市第一人民医院 检验报告单",
            "检验目的: 血常规",
            "项目 参考区间 结果 单位",
            "白细胞计数(WBC) 3.5-9.5 6.69 10^9/L",
            "血红蛋白量(HGB) 130-175 98 g/L",
        ), "blood routine.jpeg")
        self.assertEqual(panel["wbc"], 6.69)
        self.assertEqual(panel["hgb"], 98.0)

    def test_the_same_order_read_one_cell_per_line(self):
        panel = self._panel((
            "示例市第一人民医院 检验报告单",
            "检验目的: 血常规",
            "项目", "参考区间", "结果", "单位",
            "白细胞计数(WBC)", "3.5-9.5", "6.69", "10^9/L",
        ), "blood routine.jpeg")
        self.assertEqual(panel["wbc"], 6.69)

    def test_a_coagulation_panel_in_the_same_order(self):
        panel = self._panel((
            "示例市第一人民医院 检验报告单",
            "检验目的: 凝血四项",
            "项目 参考区间 结果 单位",
            "凝血酶原时间(PT) 11.0-14.5 17.8 s",
        ), "coagulation.jpeg")
        self.assertEqual(panel["pt"], 17.8)

    def test_a_thyroid_panel_in_the_same_order(self):
        panel = self._panel((
            "示例市第一人民医院 核医学报告单",
            "检验目的: 甲状腺功能",
            "项目 参考区间 结果 单位",
            "游离T3(FT3) 3.5-6.5 2.10 pmol/L",
        ), "thyroid.jpeg")
        self.assertEqual(panel["ft3"], 2.10)

    def test_the_fallback_pattern_will_not_publish_a_bound_either(self):
        """The row reader is primary; where it cannot see the row the
        pattern still answers, and it is now refused a number that is one
        end of a printed interval."""
        self.assertIsNone(
            fshd_report_service._extract_named_number(
                "白细胞计数 3.5-9.5",
                [r"(?:白细胞计数)[^\d\n(]{0,16}([<>]?\d+(?:\.\d+)?)"],
                avoid_reference_intervals=True,
            )[0]
        )


class NoAbbreviationIsReadInsideAnotherTest(unittest.TestCase):
    """「PT」 and 「TT」 are both printed inside 「APTT」.

    `_analyte_keyword_pattern` has anchored the row reader's keywords
    since 「肌酸激酶(CK)」 published a potassium of 890. The panel
    patterns embedded their abbreviations bare, so one
    activated-partial-thromboplastin row was published as three
    analytes — two of them times this patient never had measured, both
    carrying APTT's own interval.
    """

    @staticmethod
    def _panel(rows, name="coagulation.jpeg"):
        result = analyze_fshd_report("\n".join(rows), "other", name)
        return result["fshd"]["normalized_summary"]["lab_panel"]

    def test_an_aptt_row_alone_publishes_only_an_aptt(self):
        panel = self._panel((
            "示例市第一人民医院 检验报告单",
            "检验目的: 凝血功能",
            "活化部分凝血活酶时间(APTT) 45.2 25.0-38.0 s",
        ))
        self.assertEqual(panel["aptt"], 45.2)
        self.assertNotIn("pt", panel)
        self.assertNotIn("tt", panel)

    def test_each_coagulation_row_still_reads_its_own_number(self):
        panel = self._panel((
            "示例市第一人民医院 检验报告单",
            "检验目的: 凝血四项",
            "凝血酶原时间(PT) 13.2 11.0-14.5 s",
            "国际标准化比值(PT-INR) 1.05 0.80-1.20",
            "活化部分凝血活酶时间(APTT) 45.2 25.0-38.0 s",
            "凝血酶时间(TT) 16.8 14.0-21.0 s",
            "纤维蛋白原(FIB) 3.10 2.00-4.00 g/L",
        ))
        self.assertEqual(panel["pt"], 13.2)
        self.assertEqual(panel["inr"], 1.05)
        self.assertEqual(panel["aptt"], 45.2)
        self.assertEqual(panel["tt"], 16.8)
        self.assertEqual(panel["fibrinogen"], 3.10)

    def test_the_hyphen_is_inside_the_word_here_too(self):
        """「RDW」 is printed inside 「RDW-SD」, which is a different row of
        the same 血常规."""
        panel = self._panel((
            "示例市第一人民医院 检验报告单",
            "检验目的: 血常规",
            "红细胞分布宽度标准差(RDW-SD) 42.5 37.0-54.0 fL",
        ), "blood routine.jpeg")
        self.assertEqual(panel["rdw_sd"], 42.5)
        self.assertNotIn("rdw_cv", panel)


class AUrineAnalysisIsNotABloodCountTest(unittest.TestCase):
    """白细胞 and 红细胞 are rows of a 血常规 AND rows of a 尿常规.

    The blood rules score both bare words plus 「WBC」, so an ordinary
    尿液分析报告单 came out `blood_routine` — and nothing downstream can
    tell, because the payload then says 血常规报告, `_extract_urinalysis`
    never runs, and the sediment counts are published under `wbc` and
    `rbc`, the keys the mobile 血常规 section reads.
    """

    ROWS = (
        "示例市第一人民医院 尿液分析报告单",
        "项目 结果 提示 参考区间 单位",
        "白细胞(WBC) 25 高 0-28 /uL",
        "红细胞(RBC) 15 0-16 /uL",
        "蛋白质(PRO) 阴性(-)",
        "亚硝酸盐(NIT) 阴性(-)",
    )

    def _result(self):
        return analyze_fshd_report("\n".join(self.ROWS), "other", "urine.jpeg")

    def test_the_report_is_labelled_a_urinalysis(self):
        self.assertEqual(self._result()["fshd"]["report_type"], "urinalysis")

    def test_the_sediment_counts_are_published_as_urine_counts(self):
        panel = self._result()["fshd"]["normalized_summary"]["lab_panel"]
        self.assertEqual(panel["urine_wbc"], 25.0)
        self.assertEqual(panel["urine_rbc"], 15.0)

    def test_no_blood_count_is_minted_from_a_urine_specimen(self):
        panel = self._result()["fshd"]["normalized_summary"]["lab_panel"]
        self.assertNotIn("wbc", panel)
        self.assertNotIn("rbc", panel)

    def test_a_real_blood_count_is_still_a_blood_count(self):
        """The specimen rule turns on what only a blood tube has. A
        report printing haemoglobin is a blood count however much urine
        vocabulary the same page carries."""
        result = analyze_fshd_report("\n".join((
            "示例市第一人民医院 检验报告单",
            "检验目的: 血常规",
            "白细胞计数(WBC) 6.69 3.5-9.5 10^9/L",
            "血红蛋白量(HGB) 155 130-175 g/L",
        )), "other", "blood routine.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "blood_routine")

    def test_a_urea_row_does_not_name_a_urine_specimen(self):
        """尿素 and 尿酸 are biochemistry rows drawn from blood, and both
        contain 尿."""
        result = analyze_fshd_report("\n".join((
            "示例市第一人民医院 检验报告单",
            "检验目的: 血常规",
            "白细胞计数(WBC) 6.69 3.5-9.5 10^9/L",
            "尿素(UREA) 5.2 2.9-8.2 mmol/L",
            "尿酸(UA) 320 208-428 umol/L",
        )), "other", "blood routine.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "blood_routine")


class ASpelledOutFlagIsNotTheNextAnalyteTest(unittest.TestCase):
    """A 提示 column spelled 「高」 / 「低」 / 「异常」.

    `_ROW_FLAG_MARKERS` reads 偏高 and 降低 as substrings, which is safe
    because neither occurs inside anything else; the bare forms cannot be
    read that way — 高 is inside 高密度脂蛋白 and 低 inside 低密度脂蛋白.
    So the cell was CJK with no digits, `_looks_like_analyte` called it
    the next analyte, and the row ENDED on it: the reading lost its unit
    and its reference interval, and with the interval gone there was
    nothing left for a read-path check to fire on.
    """

    @staticmethod
    def _fields(rows, name="blood routine.jpeg"):
        result = analyze_fshd_report("\n".join(rows), "other", name)
        return {item["field_name"]: item for item in result["fshd"]["structured_fields"]}

    def test_a_bare_high_keeps_the_row_together(self):
        cell = self._fields((
            "示例市第一人民医院 检验报告单",
            "检验目的: 血常规",
            "项目", "结果", "提示", "参考区间", "单位",
            "白细胞计数(WBC)", "12.60", "高", "3.5-9.5", "10^9/L",
        ))["wbc"]
        self.assertEqual(cell["abnormal_flag"], "high")
        self.assertEqual(cell["unit"], "10^9/L")
        self.assertEqual(cell["reference_range_raw"], "3.5-9.5")

    def test_a_bare_low_reads_the_same_way(self):
        cell = self._fields((
            "示例市第一人民医院 检验报告单",
            "检验目的: 血常规",
            "血红蛋白量(HGB)", "98", "低", "130-175", "g/L",
        ))["hgb"]
        self.assertEqual(cell["abnormal_flag"], "low")
        self.assertEqual(cell["reference_range_raw"], "130-175")

    def test_an_undirected_flag_is_recorded_without_a_direction(self):
        cell = self._fields((
            "示例市第一人民医院 检验报告单",
            "检验目的: 凝血四项",
            "凝血酶原时间(PT)", "17.8", "异常", "11.0-14.5", "s",
        ), "coagulation.jpeg")["pt"]
        self.assertEqual(cell["abnormal_flag"], "abnormal_unspecified")
        self.assertEqual(cell["unit"], "s")

    def test_a_row_the_laboratory_called_normal_is_not_ended_by_saying_so(self):
        cell = self._fields((
            "示例市第一人民医院 检验报告单",
            "检验目的: 血常规",
            "血小板计数(PLT)", "210", "正常", "125-350", "10^9/L",
        ))["plt"]
        self.assertIsNone(cell.get("abnormal_flag"))
        self.assertEqual(cell["unit"], "10^9/L")
        self.assertEqual(cell["reference_range_raw"], "125-350")


class AnIntervalAndItsUnitInOneCellTest(unittest.TestCase):
    """「50-310 U/L」 is one box printing two columns.

    It is not a value cell, not a range cell and not a unit cell, so it
    fell through every class to 「has Latin letters」 — and
    `_looks_like_analyte` therefore called it the NEXT ANALYTE and ended
    the row on it. The reading shipped with no unit and no interval.
    """

    @staticmethod
    def _fields(rows, name="B.jpeg"):
        result = analyze_fshd_report("\n".join(rows), "other", name)
        return {item["field_name"]: item for item in result["fshd"]["structured_fields"]}

    def test_the_combined_cell_is_read_as_both_columns(self):
        cell = self._fields((
            "示例市第一人民医院 检验报告单",
            "检验目的: 心肌酶谱",
            "肌酸激酶(CK)", "693", "↑", "50-310 U/L",
            "乳酸脱氢酶(LDH)", "319", "↑", "120-250 U/L",
        ))["ck"]
        self.assertEqual(cell["unit"], "U/L")
        self.assertEqual(cell["reference_range_raw"], "50-310")
        self.assertEqual(cell["reference_high"], 310.0)

    def test_the_row_below_keeps_its_own_combined_cell(self):
        cell = self._fields((
            "示例市第一人民医院 检验报告单",
            "检验目的: 心肌酶谱",
            "肌酸激酶(CK)", "693", "↑", "50-310 U/L",
            "乳酸脱氢酶(LDH)", "319", "↑", "120-250 U/L",
        ))["ldh"]
        self.assertEqual(cell["reference_range_raw"], "120-250")

    def test_a_panel_row_reads_the_combined_cell_too(self):
        cell = self._fields((
            "示例市第一人民医院 检验报告单",
            "检验目的: 血常规",
            "血红蛋白量(HGB)", "98", "↓", "130-175 g/L",
        ), "blood routine.jpeg")["hgb"]
        self.assertEqual(cell["unit"], "g/L")
        self.assertEqual(cell["reference_range_raw"], "130-175")

    def test_the_generic_reader_splits_the_box_as_well(self):
        rows = {
            row["name"]: row
            for row in extract_lab_table_rows([
                "示例市第一人民医院 检验报告单",
                "项目", "结果", "参考区间",
                "抗核抗体滴度", "1.5", "0-1.0 ratio",
            ])
        }
        self.assertEqual(rows["抗核抗体滴度"]["value"], "1.5")
        self.assertEqual(rows["抗核抗体滴度"]["reference"], "0-1.0")
        self.assertEqual(rows["抗核抗体滴度"]["unit"], "ratio")

    def test_a_unit_that_only_looks_like_a_number_is_not_split(self):
        """「10^9/L」 is a unit, not a 10 with a unit of 「^9/L」."""
        self.assertEqual(fshd_report_service._split_data_cell("10^9/L"), ["10^9/L"])
        self.assertEqual(fshd_report_service._split_data_cell("50-310"), ["50-310"])
        self.assertEqual(fshd_report_service._split_data_cell("50-310 U/L"), ["50-310", "U/L"])


class TheAbsoluteCountIsNotThePercentageTest(unittest.TestCase):
    """「NEUT%」 and 「NEUT#」 are two rows of every 血常规.

    The panel definitions carried a pattern list and a keyword list
    written by hand, and they had drifted: the pattern matched 「NEUT#」
    and the keyword list said 「NEUT」, which is the abbreviation the
    PERCENTAGE row prints. `_row_context` therefore asked the row reader
    about the ratio row, the two readers named different numbers, and
    all five absolute differential counts shipped with no flag, no unit
    and no interval — on the panel where the differential is the whole
    point.
    """

    ROWS = (
        "示例市第一人民医院 检验报告单",
        "检验目的: 血常规",
        "项目 结果 提示 参考区间 单位",
        "中性粒细胞比率(NEUT%) 82.5 高 40.0-75.0 %",
        "淋巴细胞比率(LYMPH%) 12.0 低 20.0-50.0 %",
        "单核细胞比率(MONO%) 4.5 3.0-10.0 %",
        "嗜酸细胞百分比(EOS%) 0.8 0.4-8.0 %",
        "嗜碱细胞百分比(BASO%) 0.2 0.0-1.0 %",
        "中性粒细胞数(NEUT#) 8.42 高 1.80-6.30 10^9/L",
        "淋巴细胞数(LYMPH#) 1.22 低 1.10-3.20 10^9/L",
        "单核细胞数(MONO#) 0.41 0.10-0.60 10^9/L",
        "嗜酸细胞数(EOS#) 0.05 0.02-0.52 10^9/L",
        "嗜碱细胞数(BASO#) 0.02 0.00-0.06 10^9/L",
    )

    def _fields(self):
        result = analyze_fshd_report("\n".join(self.ROWS), "other", "blood routine.jpeg")
        return {item["field_name"]: item for item in result["fshd"]["structured_fields"]}

    def test_every_absolute_count_reads_its_own_row(self):
        fields = self._fields()
        for key, value in (
            ("neut_abs", "8.42"), ("lymph_abs", "1.22"), ("mono_abs", "0.41"),
            ("eos_abs", "0.05"), ("baso_abs", "0.02"),
        ):
            with self.subTest(key=key):
                self.assertEqual(fields[key]["field_value"], value)

    def test_every_absolute_count_carries_what_its_row_said(self):
        fields = self._fields()
        for key, reference in (
            ("neut_abs", "1.80-6.30"), ("lymph_abs", "1.10-3.20"),
            ("mono_abs", "0.10-0.60"), ("eos_abs", "0.02-0.52"),
            ("baso_abs", "0.00-0.06"),
        ):
            with self.subTest(key=key):
                self.assertEqual(fields[key]["unit"], "10^9/L")
                self.assertEqual(fields[key]["reference_range_raw"], reference)

    def test_the_flagged_absolute_counts_reach_the_summary(self):
        result = analyze_fshd_report("\n".join(self.ROWS), "other", "blood routine.jpeg")
        by_analyte = result["latest_summary"]["by_analyte"]
        flagged = {row["analyte_name"] for row in result["latest_summary"]["abnormal_list"]}
        self.assertIn("neut_abs", flagged)
        self.assertIn("lymph_abs", flagged)
        self.assertEqual(by_analyte["neut_abs"]["direction"], "high")
        self.assertEqual(by_analyte["lymph_abs"]["direction"], "low")

    def test_the_percentage_rows_keep_their_own_numbers(self):
        fields = self._fields()
        self.assertEqual(fields["neut_pct"]["field_value"], "82.5")
        self.assertEqual(fields["neut_pct"]["unit"], "%")
        self.assertEqual(fields["lymph_pct"]["field_value"], "12.0")

    def test_one_list_of_names_feeds_both_readers(self):
        """The pattern and the keyword cannot drift apart if they are
        built from the same list."""
        meta = fshd_report_service._numeric_analyte("中性粒细胞数", "NEUT#")
        self.assertEqual(meta["keywords"], ["中性粒细胞数", "NEUT#"])
        self.assertEqual(len(meta["patterns"]), 1)
        for name in meta["keywords"]:
            self.assertIn(fshd_report_service._anchored_keyword_source(name), meta["patterns"][0])


class TheCommonestAnalyteShapeIsAnAnalyteTest(unittest.TestCase):
    """「中文名(缩写)」 is how most rows of a Chinese report are printed.

    `_is_header_only` calls any 「短词(拉丁内容)」 a label carrying a
    unit — it was written for 「膈肌厚度(mm)」 and 「LVEF(%)」 — and
    `_looks_like_analyte` consulted it. So the generic table reader, the
    one that exists so a report nobody anticipated still produces
    values, refused 「白细胞计数(WBC)」, 「碱性磷酸酶(ALP)」 and every other
    row of that shape: a thirty-row table yielded nothing.
    """

    ROWS = (
        "示例市第一人民医院 检验报告单",
        "项目", "结果", "提示", "参考区间", "单位",
        "抗核抗体滴度(ANA)", "1.5", "偏高", "0-1.0", "ratio",
        "肿瘤坏死因子(TNF)", "12.4", "0-8.1", "pg/mL",
    )

    def test_a_name_carrying_its_abbreviation_is_a_name(self):
        rows = {row["name"]: row for row in extract_lab_table_rows(list(self.ROWS))}
        self.assertEqual(rows["抗核抗体滴度(ANA)"]["value"], "1.5")
        self.assertEqual(rows["抗核抗体滴度(ANA)"]["unit"], "ratio")
        self.assertEqual(rows["抗核抗体滴度(ANA)"]["reference"], "0-1.0")
        self.assertEqual(rows["肿瘤坏死因子(TNF)"]["value"], "12.4")

    def test_the_row_reaches_the_patient_report(self):
        result = analyze_fshd_report("\n".join(self.ROWS), "other", "T.jpeg")
        names = {item["field_name"] for item in result["fshd"]["structured_fields"]}
        self.assertIn("table_抗核抗体滴度_ana", names)

    def test_a_label_carrying_a_real_unit_is_still_a_label(self):
        self.assertFalse(fshd_report_service._names_its_own_abbreviation("膈肌厚度(mm)"))
        self.assertFalse(fshd_report_service._names_its_own_abbreviation("LVEF(%)"))
        self.assertFalse(fshd_report_service._names_its_own_abbreviation("血红蛋白(g/L)"))
        self.assertFalse(fshd_report_service._names_its_own_abbreviation("凝血酶原时间(s)"))
        self.assertFalse(fshd_report_service._names_its_own_abbreviation("检验目的(ALT)"))

    def test_an_abbreviation_is_an_abbreviation(self):
        for cell in ("白细胞计数(WBC)", "碱性磷酸酶(ALP)", "游离T3(FT3)", "中性粒细胞比率(NEUT%)"):
            with self.subTest(cell=cell):
                self.assertTrue(fshd_report_service._names_its_own_abbreviation(cell))
                self.assertTrue(fshd_report_service._looks_like_analyte(cell))

    def test_a_panel_row_of_that_shape_is_still_not_published_twice(self):
        result = analyze_fshd_report("\n".join((
            "示例市第一人民医院 检验报告单",
            "检验目的: 血常规",
            "白细胞计数(WBC)", "6.69", "3.5-9.5", "10^9/L",
        )), "other", "blood routine.jpeg")
        names = [item["field_name"] for item in result["fshd"]["structured_fields"]]
        self.assertIn("wbc", names)
        self.assertEqual([name for name in names if name.startswith("table_")], [])


class TheSuperscriptHaematologyUnitIsAUnitTest(unittest.TestCase):
    """「×10⁹/L」 is the unit on the first three rows of every 血常规.

    The unit classes admitted no character outside ASCII plus 「μ」, so
    the printed spelling was not a unit to `is_unit_only`, not a unit to
    `_unit_from_row` and not a unit to `extract_lab_table_rows` — a white
    cell count, a red cell count and a platelet count all shipped with no
    unit at all. The ASCII spellings 「10^9/L」 and 「10*9/L」 were covered
    and the one laboratories actually print was not.
    """

    @staticmethod
    def _fields(rows):
        result = analyze_fshd_report("\n".join(rows), "other", "blood routine.jpeg")
        return {item["field_name"]: item for item in result["fshd"]["structured_fields"]}

    def test_the_printed_unit_is_read_off_its_own_cell(self):
        cell = self._fields((
            "示例市第一人民医院 检验报告单",
            "检验目的: 血常规",
            "白细胞计数(WBC)", "6.69", "3.5-9.5", "×10⁹/L",
        ))["wbc"]
        self.assertEqual(cell["unit"], "×10⁹/L")

    def test_the_printed_unit_is_read_off_a_flattened_row(self):
        cell = self._fields((
            "示例市第一人民医院 检验报告单",
            "检验目的: 血常规",
            "血小板计数(PLT) 210 125-350 ×10⁹/L",
        ))["plt"]
        self.assertEqual(cell["unit"], "×10⁹/L")

    def test_every_spelling_of_the_same_unit_is_a_unit(self):
        for unit in ("×10⁹/L", "10^9/L", "10*9/L", "10E9/L", "g/L", "μmol/L", "fL"):
            with self.subTest(unit=unit):
                self.assertTrue(fshd_report_service._UNIT_CELL.match(unit))

    def test_a_bare_number_is_still_not_a_unit(self):
        for cell in ("6.69", "125", "3.5-9.5"):
            with self.subTest(cell=cell):
                self.assertFalse(fshd_report_service._UNIT_CELL.match(cell))


class OnePanelsFixIsEveryPanelsFixTest(unittest.TestCase):
    """The shared reader, asserted as the thing that is shared.

    Seven maps of analyte names, one reader. A panel that declares names
    gets the column orders, the flag conventions, the unit forms and the
    interval forms that every other panel has — which is the whole reason
    the reader was unified rather than the eight defects patched where
    each was measured.
    """

    LAYOUT = (
        "示例市第一人民医院 检验报告单",
        "{purpose}",
        "项目", "结果", "提示", "参考区间", "单位",
        "{name}", "{value}", "低", "{reference}", "{unit}",
    )

    def _cell(self, purpose, name, value, reference, unit, key, report):
        rows = [
            row.format(purpose=purpose, name=name, value=value, reference=reference, unit=unit)
            for row in self.LAYOUT
        ]
        result = analyze_fshd_report("\n".join(rows), "other", report)
        fields = {item["field_name"]: item for item in result["fshd"]["structured_fields"]}
        return fields.get(key)

    def test_the_same_row_reads_the_same_way_on_every_panel(self):
        for purpose, name, value, reference, unit, key, report in (
            ("检验目的: 血常规", "血红蛋白量(HGB)", "98", "130-175", "g/L", "hgb", "blood.jpeg"),
            ("检验目的: 甲状腺功能", "游离T4(FT4)", "8.10", "12.0-22.0", "pmol/L", "ft4", "thyroid.jpeg"),
            ("检验目的: 凝血四项", "纤维蛋白原(FIB)", "1.20", "2.00-4.00", "g/L", "fibrinogen", "coag.jpeg"),
            ("检验目的: 尿常规", "尿比重(SG)", "1.002", "1.003-1.030", "", "urine_specific_gravity", "urine.jpeg"),
            ("检验目的: 生化全套", "肌酸激酶(CK)", "20", "50-310", "U/L", "ck", "bio.jpeg"),
        ):
            with self.subTest(key=key):
                cell = self._cell(purpose, name, value, reference, unit, key, report)
                self.assertIsNotNone(cell, key)
                self.assertEqual(cell["field_value"], value)
                self.assertEqual(cell["abnormal_flag"], "low")
                self.assertEqual(cell["reference_range_raw"], reference)
                if unit:
                    self.assertEqual(cell["unit"], unit)

    def test_every_panel_reaches_the_row_reader_through_one_entry_point(self):
        lines = ["示例市第一人民医院 检验报告单", "肌酸激酶(CK) 693 50-310 U/L"]
        vocabulary = {"ck": ["肌酸激酶", "ck"]}
        reading = fshd_report_service._read_analyte_row(vocabulary, "ck", lines)
        self.assertEqual(reading.value, "693")
        self.assertEqual(reading.reference_raw, "50-310")
        self.assertEqual(reading.unit, "U/L")


class AThousandsSeparatorIsInsideTheNumberTest(unittest.TestCase):
    """A CHINESE PRINTOUT GROUPS A LARGE READING AND EVERY READER STOPPED
    AT THE FIRST GROUP.

    「3,250」 is an ordinary way to print a creatine kinase, and the
    number classes said 「digits and a decimal point」 — so the reading
    was truncated to 3 while the row's own 偏高 was read separately and
    correctly. What reached the patient's report screen was a value
    BELOW its own interval's lower bound carrying a flag that says it is
    high, on the marker this disease is monitored by.

    THE SPACED SPELLING IS READ WHERE THE CELL BOUNDARY PROVES IT. A
    space is what separates two columns on a flattened row — 「693
    50-310」 is a reading and an interval — so 「1 180」 is read as one
    number only on the cell-per-line layout, where the cell is the
    number. See `_NUMBER_CELL_SOURCE`.
    """

    def _field(self, rows, key):
        result = analyze_fshd_report("\n".join(rows), "other", "enzyme.jpeg")
        fields = {item["field_name"]: item for item in result["fshd"]["structured_fields"]}
        return fields.get(key)

    def test_a_grouped_reading_is_not_truncated_to_its_first_group(self):
        cell = self._field((
            "示例市第一人民医院检验报告单",
            "检验目的: 心肌酶谱",
            "肌酸激酶(CK) 3,250 偏高 50-310 U/L",
        ), "ck")
        self.assertEqual(cell["field_value"], "3250")
        self.assertEqual(cell["normalized_value"], 3250.0)

    def test_the_flag_and_the_reading_no_longer_contradict_each_other(self):
        cell = self._field((
            "示例市第一人民医院检验报告单",
            "检验目的: 心肌酶谱",
            "肌酸激酶(CK) 3,250 偏高 50-310 U/L",
        ), "ck")
        self.assertEqual(cell["abnormal_flag"], "high")
        self.assertEqual(cell["unit"], "U/L")
        self.assertGreater(cell["normalized_value"], cell["reference_high"])

    def test_a_space_grouped_cell_is_one_number(self):
        cell = self._field((
            "示例市第一人民医院检验报告单",
            "检验目的: 心肌酶谱",
            "项目", "结果", "提示", "参考区间", "单位",
            "乳酸脱氢酶(LDH)", "1 180", "偏高", "120-250", "U/L",
        ), "ldh")
        self.assertEqual(cell["field_value"], "1180")
        self.assertEqual(cell["normalized_value"], 1180.0)
        self.assertEqual(cell["unit"], "U/L")

    def test_the_printed_row_is_still_the_evidence(self):
        """The reading is canonical; the snippet is what the page said."""
        cell = self._field((
            "示例市第一人民医院检验报告单",
            "检验目的: 心肌酶谱",
            "肌酸激酶(CK) 3,250 偏高 50-310 U/L",
        ), "ck")
        self.assertIn("3,250", cell["source_text"])

    def test_a_reading_and_an_interval_are_still_two_numbers(self):
        """The space form may not merge a reading with the interval it is
        printed next to — the failure this file has fixed twice."""
        cell = self._field((
            "示例市第一人民医院检验报告单",
            "检验目的: 心肌酶谱",
            "乳酸脱氢酶(LDH) 319 120-250 U/L",
        ), "ldh")
        self.assertEqual(cell["field_value"], "319")
        self.assertEqual(cell["reference_range_raw"], "120-250")

    def test_the_generic_table_reader_publishes_one_number_too(self):
        rows = extract_lab_table_rows([
            "示例市第一人民医院 检验报告单",
            "项目", "结果", "单位",
            "某个没人写过规则的指标", "12,500", "U/L",
        ])
        self.assertEqual(rows[0]["value"], "12500")


class ThePercentOfPredictedIsOnItsOwnRowTest(unittest.TestCase):
    """FVC 占预计值 AND FEV1 占预计值 WERE BOTH THE FEV1/FVC RATIO.

    `\b` fires on both sides of the solidus in 「FEV1/FVC」, so 「FVC」
    matched the second half of the ratio's name and 「FEV1」 the first.
    And the pattern forbade digits between a name and its capture, so on
    the ordinary layout — 实测值 before 占预计值 on one line — it could
    not see past the reading in litres to the percentage beside it, and
    went looking down the page instead. Both failures land on the same
    row: the ratio's.

    Pulmonary function is the surveillance this disease is monitored by,
    and 75.4% of predicted FVC is a different clinical picture from
    70.6%.
    """

    ROWS = (
        "示例市第一人民医院 肺通气功能检查报告",
        "项目 单位 实测值 占预计值",
        "FVC 用力肺活量 L 2.72 70.6%",
        "FEV1 一秒量 L 2.05 64.1%",
        "FEV1/FVC 一秒率 % 75.4%",
        "结论: 中度限制性通气功能障碍。",
    )

    def _panel(self):
        result = analyze_fshd_report("\n".join(self.ROWS), "other", "pft.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "pulmonary_function")
        return result["fshd"]["normalized_summary"]["cardio_respiratory_panel"]

    def test_each_metric_reads_the_percentage_off_its_own_row(self):
        panel = self._panel()
        self.assertEqual(panel["fvc_pred_pct"], 70.6)
        self.assertEqual(panel["fev1_pred_pct"], 64.1)

    def test_the_ratio_is_still_the_ratio(self):
        self.assertEqual(self._panel()["fev1_fvc"], 75.4)

    def test_the_measured_volumes_are_unchanged(self):
        panel = self._panel()
        self.assertEqual(panel["fvc"], 2.72)
        self.assertEqual(panel["fev1"], 2.05)

    def test_no_field_is_published_twice_with_two_answers(self):
        result = analyze_fshd_report("\n".join(self.ROWS), "other", "pft.jpeg")
        readings = {}
        for item in result["fshd"]["structured_fields"]:
            readings.setdefault(item["field_name"], set()).add(item["field_value"])
        for name, values in readings.items():
            with self.subTest(field=name):
                self.assertEqual(len(values), 1, name)

    def test_the_three_column_layout_still_reads_the_measured_value(self):
        """预计值 / 实测值 / 占预计值 — the layout the table patterns read."""
        result = analyze_fshd_report("\n".join((
            "示例市第一人民医院 通气弥散残气检查报告",
            "FVC [L] 5.55 3.45 62.1",
            "FEV1 [L] 4.65 3.03 65.0",
            "FEV1/FVC [%] 83.20 87.72 105.4",
        )), "other", "pft.jpeg")
        panel = result["fshd"]["normalized_summary"]["cardio_respiratory_panel"]
        self.assertEqual(panel["fvc"], 3.45)
        self.assertEqual(panel["fvc_pred_pct"], 62.1)

    def test_the_diffusion_row_does_not_answer_for_the_ratio_row(self):
        """「DLCO/VA」 is 「DLCO」 to a word boundary, the same way."""
        result = analyze_fshd_report("\n".join((
            "示例市第一人民医院 肺功能检查报告",
            "DLCO 弥散量 mmol/min/kPa 6.20 68.5%",
            "DLCO/VA 比弥散量 mmol/min/kPa/L 1.45 92.1%",
        )), "other", "pft.jpeg")
        panel = result["fshd"]["normalized_summary"]["cardio_respiratory_panel"]
        self.assertEqual(panel["dlco_pred_pct"], 68.5)


class AnAnalytesOwnAbbreviationIsNotItsResultTest(unittest.TestCase):
    """「颜色(COL)」 WAS PUBLISHED AS A URINE COLOUR OF 「COL)」.

    The free-text rows capture the first run of non-space after the
    name, and the separator gap admitted brackets while refusing Latin.
    So on the commonest 尿常规 printing of all, the gap took the opening
    bracket and the capture took what was inside it — and the reading
    the laboratory printed was not merely unread but REPLACED, on the
    two rows of this panel a patient can check by eye.
    """

    def _panel(self, *rows):
        result = analyze_fshd_report("\n".join(rows), "other", "urine.jpeg")
        return result["fshd"]["normalized_summary"]["lab_panel"]

    def test_the_colour_and_the_clarity_are_the_printed_readings(self):
        panel = self._panel(
            "示例市第一人民医院检验报告单",
            "检验目的: 尿常规",
            "颜色(COL) 淡黄色",
            "透明度(CLA) 清亮",
        )
        self.assertEqual(panel["urine_color"], "淡黄色")
        self.assertEqual(panel["urine_clarity"], "清亮")

    def test_a_name_cell_with_no_abbreviation_still_reads(self):
        panel = self._panel(
            "示例市第一人民医院检验报告单",
            "检验目的: 尿常规",
            "颜色 深黄色",
            "透明度: 微浊",
        )
        self.assertEqual(panel["urine_color"], "深黄色")
        self.assertEqual(panel["urine_clarity"], "微浊")

    def test_a_bracketed_reading_is_not_mistaken_for_an_abbreviation(self):
        """「(-)」 is a whole reading; the hop over 「(URO)」 may not eat it."""
        panel = self._panel(
            "示例市第一人民医院检验报告单",
            "检验目的: 尿常规",
            "尿胆原(URO) 阴性(-)",
        )
        self.assertEqual(panel["urine_urobilinogen"], "阴性(-)")

    def test_the_stool_panel_prints_its_colour_the_same_way(self):
        result = analyze_fshd_report("\n".join((
            "示例市第一人民医院检验报告单",
            "检验目的: 大便常规",
            "颜色(COL) 黄褐色",
            "性状(CHA) 软便",
            "隐血试验(OBT) 阴性(-)",
        )), "other", "stool.jpeg")
        panel = result["fshd"]["normalized_summary"]["lab_panel"]
        self.assertEqual(panel["stool_color"], "黄褐色")
        self.assertEqual(panel["stool_consistency"], "软便")


class AUnitSpelledWithAChineseCounterIsAUnitTest(unittest.TestCase):
    """「个/uL」 IS THE 单位 CELL OF EVERY URINE SEDIMENT ROW.

    The unit classes admitted no CJK at all, so that cell was not a unit
    to any reader — and being CJK with no digits it was read as THE NEXT
    ANALYTE instead, which ended the row on its own unit column. The
    count shipped as a bare number, and where the laboratory prints
    单位 before 参考区间 the interval was lost with it: a sediment count
    with no unit and nothing to be abnormal against.
    """

    def _fields(self, *rows):
        result = analyze_fshd_report("\n".join(rows), "other", "urine.jpeg")
        return {item["field_name"]: item for item in result["fshd"]["structured_fields"]}

    def test_the_counter_unit_is_published(self):
        fields = self._fields(
            "示例市第一人民医院 尿液分析报告单",
            "项目", "结果", "提示", "参考区间", "单位",
            "白细胞(WBC)", "25", "高", "0-28", "个/uL",
            "红细胞(RBC)", "8", "0-16", "个/HP",
        )
        self.assertEqual(fields["urine_wbc"]["unit"], "个/uL")
        self.assertEqual(fields["urine_rbc"]["unit"], "个/HP")

    def test_the_row_does_not_end_on_its_own_unit_column(self):
        """单位 before 参考区间 — the interval sits past the unit cell."""
        fields = self._fields(
            "示例市第一人民医院 尿液分析报告单",
            "项目", "结果", "单位", "参考区间",
            "白细胞(WBC)", "25", "个/uL", "0-28",
        )
        self.assertEqual(fields["urine_wbc"]["unit"], "个/uL")
        self.assertEqual(fields["urine_wbc"]["reference_range_raw"], "0-28")

    def test_a_bare_counter_is_a_unit(self):
        rows = extract_lab_table_rows([
            "XX医院 FSHD1 D4Z4 基因检测报告",
            "项目 参考区间 结果 单位",
            "D4Z4重复单元数", ">10", "3", "个",
        ])
        self.assertEqual(rows[0]["value"], "3")
        self.assertEqual(rows[0]["unit"], "个")

    def test_the_coagulation_panel_prints_its_unit_the_same_way(self):
        """「秒」 is the 单位 cell of a prothrombin time, and it ended that
        row for the same reason 「个/uL」 ended the sediment row."""
        fields = self._fields(
            "示例市第一人民医院检验报告单",
            "检验目的: 凝血四项",
            "项目", "结果", "单位", "参考区间",
            "凝血酶原时间(PT)", "13.7", "秒", "11.0-14.5",
        )
        self.assertEqual(fields["pt"]["unit"], "秒")
        self.assertEqual(fields["pt"]["reference_range_raw"], "11.0-14.5")

    def test_a_chinese_cell_that_is_not_a_unit_is_still_not_one(self):
        for cell in ("阴性", "偏高", "未见异常", "白细胞计数"):
            with self.subTest(cell=cell):
                self.assertFalse(fshd_report_service._is_unit_cell(cell))


class AnUnlistedFlagCellIsNotTheUnitTest(unittest.TestCase):
    """THE UNIT SLOT WAS FILLED BY WHATEVER THE 提示 COLUMN PRINTED.

    `is_unit_only` asked 「is this Latin-shaped and not one of the four
    flag letters we know」, and a 提示 column prints more than four:
    「A」, 「N」, 「HI」, 「LO」, a laboratory's own house spelling. Each is
    Latin, short and symbol-free, so each was accepted as the row's
    unit — and the damage is not the wrong unit, it is that the real
    单位 column one cell further right is then never reached.

    「A」 is deliberately absent from `_LETTER_FLAG_CELLS` — a bare A
    opens 「ALT」 as often as it means abnormal — which is exactly why
    the answer here is not one more entry on a list of refusals. The
    unit reader now answers what a unit IS: a solidus, a symbol, a word
    from the unit vocabulary, or a Chinese counter. See `_is_unit_cell`.
    """

    ROWS = (
        "示例市第一人民医院检验报告单",
        "检验目的: 生化全套",
        "项目", "结果", "提示", "单位", "参考区间",
        "谷丙转氨酶(ALT)", "88", "A", "U/L", "9-50",
        "谷草转氨酶(AST)", "23", "N", "U/L", "15-40",
    )

    def _fields(self):
        result = analyze_fshd_report("\n".join(self.ROWS), "other", "bio.jpeg")
        return {item["field_name"]: item for item in result["fshd"]["structured_fields"]}

    def test_the_laboratorys_own_unit_is_reached(self):
        fields = self._fields()
        self.assertEqual(fields["alt"]["unit"], "U/L")
        self.assertEqual(fields["ast"]["unit"], "U/L")

    def test_the_row_still_reaches_its_reference_interval(self):
        fields = self._fields()
        self.assertEqual(fields["alt"]["reference_range_raw"], "9-50")
        self.assertEqual(fields["alt"]["field_value"], "88")

    def test_a_spelling_nobody_listed_is_refused_the_same_way(self):
        for cell in ("A", "N", "HI", "LO", "AB", "PANIC", "CRIT"):
            with self.subTest(cell=cell):
                self.assertFalse(fshd_report_service._is_unit_cell(cell))

    def test_a_real_unit_is_still_a_unit(self):
        for cell in ("U/L", "g/L", "10^9/L", "×10⁹/L", "%", "mmol/L", "fL", "pg", "s", "ratio"):
            with self.subTest(cell=cell):
                self.assertTrue(fshd_report_service._is_unit_cell(cell))

    def test_an_unrecognised_cell_does_not_end_the_row_either(self):
        """A 提示 cell that stopped being unit-SHAPED would be read as the
        next analyte, which costs the unit and the interval both."""
        self.assertFalse(fshd_report_service._looks_like_analyte("A"))
        self.assertFalse(fshd_report_service._looks_like_analyte("HI"))


class TwoPanelsOnOnePageAreTwoPanelsTest(unittest.TestCase):
    """AN 入院常规 PRINTOUT IS A 血常规 SECTION AND A 尿常规 SECTION.

    The page prints haemoglobin and platelets, so the specimen rule that
    rescues a pure urine report cannot fire, and it classifies
    `blood_routine`. Two things followed. The urinalysis extractor never
    ran, so the colour, the protein and the sediment counts were absent
    from a payload that named none of them missing. AND THE BLOOD
    EXTRACTOR READ DOWNWARDS: every row reader scans the whole document
    for the first line naming its analyte, so a blood analyte the 血常规
    section did not print was found in the 尿常规 section instead — a
    urine red cell count of 8 个/uL published under `rbc`, the key the
    app's 血常规 card reads.
    """

    ROWS = (
        "示例市第一人民医院 入院常规检验报告单",
        "血常规",
        "项目 结果 提示 参考区间 单位",
        "白细胞计数(WBC) 6.20 3.50-9.50 10^9/L",
        "血红蛋白量(HGB) 128 115-150 g/L",
        "血小板计数(PLT) 226 125-350 10^9/L",
        "尿常规",
        "项目 结果 提示 参考区间 单位",
        "颜色(COL) 淡黄色",
        "蛋白质(PRO) 阴性(-)",
        "白细胞(WBC) 25 高 0-28 个/uL",
        "红细胞(RBC) 8 0-16 个/uL",
    )

    def _panel(self, rows=None):
        result = analyze_fshd_report("\n".join(rows or self.ROWS), "other", "admission.jpeg")
        return result["fshd"]["normalized_summary"]["lab_panel"]

    def test_the_urine_section_is_read(self):
        panel = self._panel()
        self.assertEqual(panel["urine_wbc"], 25.0)
        self.assertEqual(panel["urine_rbc"], 8.0)
        self.assertEqual(panel["urine_color"], "淡黄色")
        self.assertEqual(panel["urine_protein"], "阴性")

    def test_the_blood_section_is_read_from_the_blood_section(self):
        panel = self._panel()
        self.assertEqual(panel["wbc"], 6.20)
        self.assertEqual(panel["hgb"], 128.0)
        self.assertEqual(panel["plt"], 226.0)

    def test_no_blood_count_is_minted_from_the_urine_section(self):
        """The blood section prints no 红细胞计数 row. Neither does the
        payload."""
        self.assertNotIn("rbc", self._panel())

    def test_the_sections_are_read_in_whichever_order_they_are_printed(self):
        reordered = (
            "示例市第一人民医院 入院常规检验报告单",
            "尿常规",
            "白细胞(WBC) 25 高 0-28 个/uL",
            "红细胞(RBC) 8 0-16 个/uL",
            "血常规",
            "白细胞计数(WBC) 6.20 3.50-9.50 10^9/L",
            "血红蛋白量(HGB) 128 115-150 g/L",
        )
        panel = self._panel(reordered)
        self.assertEqual(panel["wbc"], 6.20)
        self.assertEqual(panel["urine_wbc"], 25.0)

    def test_the_payload_says_the_page_carried_two_sections(self):
        result = analyze_fshd_report("\n".join(self.ROWS), "other", "admission.jpeg")
        self.assertTrue(
            any(
                reason.startswith("sections:")
                for reason in result["fshd"]["classification_reasons"]
            )
        )

    def test_a_single_panel_report_is_left_alone(self):
        """No heading pair, no split — a requisition naming both panels
        cannot say which rows belong to which."""
        self.assertIsNone(
            fshd_report_service._split_blood_and_urine_sections([
                "示例市第一人民医院 检验报告单",
                "检验目的: 血常规+尿常规",
                "白细胞计数(WBC) 6.20 3.5-9.5 10^9/L",
            ])
        )
        self.assertIsNone(
            fshd_report_service._split_blood_and_urine_sections([
                "示例市第一人民医院 检验报告单",
                "检验目的: 血常规",
                "白细胞计数(WBC) 6.20 3.5-9.5 10^9/L",
                "尿素(UREA) 5.2 2.9-8.2 mmol/L",
            ])
        )

    def test_a_pure_urine_report_is_still_a_urinalysis(self):
        result = analyze_fshd_report("\n".join((
            "示例市第一人民医院 尿液分析报告单",
            "白细胞(WBC) 25 高 0-28 个/uL",
            "红细胞(RBC) 15 0-16 个/uL",
        )), "other", "urine.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "urinalysis")
        panel = result["fshd"]["normalized_summary"]["lab_panel"]
        self.assertEqual(panel["urine_wbc"], 25.0)
        self.assertNotIn("wbc", panel)


if __name__ == "__main__":
    unittest.main()
