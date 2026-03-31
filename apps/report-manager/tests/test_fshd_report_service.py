import unittest

from app.services.fshd_report_service import analyze_fshd_report


class FshdReportServiceCoverageTest(unittest.TestCase):
    def test_blood_routine(self):
        text = """
        福建医科大学附属第一医院检验报告单
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
        福建医科大学附属第一医院 彩色超声诊断报告单
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
        福建医科大学附属第一医院 彩色超声诊断报告单
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
        福建医科大学附属第一医院 彩色超声诊断报告单
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
        福建医科大学附属第一医院 心电图报告
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
        福建医科大学附属第一医院核医学报告单
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
        福建医科大学附属第一医院检验报告单
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
        福建医科大学附属第一医院13C呼气试验检验报告
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
        福建医科大学附属第一医院核医学报告单
        检验目的: 血清肌红蛋白(Mb)
        肌红蛋白(MYO) 158.810 ↑ 0-110 ug/L
        """
        result = analyze_fshd_report(text, "other", "Mb.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "muscle_enzyme")
        panel = result["fshd"]["normalized_summary"]["lab_panel"]
        self.assertEqual(panel["mb"], 158.81)

    def test_muscle_mri(self):
        text = """
        福建医科大学附属第一医院 磁共振检查报告单
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
        福建医科大学附属第一医院 通气弥散残气检查报告
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
        福建医科大学附属第一医院检验报告单
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
        福建医科大学附属第一医院检验报告单
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
        福建医科大学附属第一医院检验报告单
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
        福建医科大学附属第一医院检验报告单
        检验目的: D-二聚体定量
        D-二聚体定量(D-Dimer) 0.06 0-0.55
        """
        result = analyze_fshd_report(text, "other", "D-Dimer.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "coagulation")
        panel = result["fshd"]["normalized_summary"]["lab_panel"]
        self.assertEqual(panel["d_dimer"], 0.06)

    def test_syphilis_screening(self):
        text = """
        福建医科大学附属第一医院检验报告单
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

    def test_il6(self):
        text = """
        福建医科大学附属第一医院检验报告单
        检验目的: IL-6
        白介素6(IL-6) 2.04 <10 pg/ml
        """
        result = analyze_fshd_report(text, "other", "IL-6.jpeg")
        self.assertEqual(result["fshd"]["report_type"], "biochemistry")
        panel = result["fshd"]["normalized_summary"]["lab_panel"]
        self.assertEqual(panel["il6"], 2.04)

    def test_stool_routine(self):
        text = """
        福建医科大学附属第一医院检验报告单
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


if __name__ == "__main__":
    unittest.main()
