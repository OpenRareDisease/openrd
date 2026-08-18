import unittest

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


if __name__ == "__main__":
    unittest.main()
