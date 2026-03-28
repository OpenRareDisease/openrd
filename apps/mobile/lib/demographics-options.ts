export interface RegionOption {
  province: string;
  cities: Array<{
    city: string;
    districts: string[];
  }>;
}

export interface PickerOption {
  label: string;
  value: string;
}

export interface DateParts {
  year: string;
  month: string;
  day: string;
}

const OTHER_CITY = '其他城市';
const OTHER_DISTRICT = '其他区县';

const createCity = (city: string, districts: string[]) => ({
  city,
  districts: Array.from(new Set([...districts, OTHER_DISTRICT])),
});

const createProvince = (
  province: string,
  cities: Array<{
    city: string;
    districts: string[];
  }>,
): RegionOption => ({
  province,
  cities: [...cities, createCity(OTHER_CITY, [])],
});

const createMunicipality = (province: string, districts: string[]): RegionOption => ({
  province,
  cities: [createCity(province, districts)],
});

export const CHINA_REGIONS: RegionOption[] = [
  createMunicipality('北京市', [
    '东城区',
    '西城区',
    '朝阳区',
    '丰台区',
    '石景山区',
    '海淀区',
    '门头沟区',
    '房山区',
    '通州区',
    '顺义区',
    '昌平区',
    '大兴区',
    '怀柔区',
    '平谷区',
    '密云区',
    '延庆区',
  ]),
  createMunicipality('天津市', [
    '和平区',
    '河东区',
    '河西区',
    '南开区',
    '河北区',
    '红桥区',
    '东丽区',
    '西青区',
    '津南区',
    '北辰区',
    '武清区',
    '宝坻区',
    '滨海新区',
    '宁河区',
    '静海区',
    '蓟州区',
  ]),
  createMunicipality('上海市', [
    '黄浦区',
    '徐汇区',
    '长宁区',
    '静安区',
    '普陀区',
    '虹口区',
    '杨浦区',
    '闵行区',
    '宝山区',
    '嘉定区',
    '浦东新区',
    '金山区',
    '松江区',
    '青浦区',
    '奉贤区',
    '崇明区',
  ]),
  createMunicipality('重庆市', [
    '万州区',
    '涪陵区',
    '渝中区',
    '大渡口区',
    '江北区',
    '沙坪坝区',
    '九龙坡区',
    '南岸区',
    '北碚区',
    '渝北区',
    '巴南区',
    '黔江区',
    '长寿区',
    '江津区',
    '合川区',
    '永川区',
    '南川区',
    '璧山区',
  ]),
  createProvince('河北省', [
    createCity('石家庄市', [
      '长安区',
      '桥西区',
      '新华区',
      '井陉矿区',
      '裕华区',
      '藁城区',
      '鹿泉区',
      '栾城区',
    ]),
    createCity('唐山市', ['路南区', '路北区', '古冶区', '开平区', '丰南区', '丰润区', '曹妃甸区']),
    createCity('保定市', ['竞秀区', '莲池区', '满城区', '清苑区', '徐水区']),
    createCity('廊坊市', ['安次区', '广阳区', '固安县', '香河县', '三河市']),
  ]),
  createProvince('山西省', [
    createCity('太原市', ['小店区', '迎泽区', '杏花岭区', '尖草坪区', '万柏林区', '晋源区']),
    createCity('大同市', ['平城区', '云冈区', '新荣区', '云州区']),
    createCity('长治市', ['潞州区', '上党区', '屯留区', '潞城区']),
    createCity('运城市', ['盐湖区', '临猗县', '万荣县', '永济市']),
  ]),
  createProvince('内蒙古自治区', [
    createCity('呼和浩特市', ['新城区', '回民区', '玉泉区', '赛罕区']),
    createCity('包头市', ['东河区', '昆都仑区', '青山区', '石拐区', '白云鄂博矿区', '九原区']),
    createCity('鄂尔多斯市', ['东胜区', '康巴什区', '达拉特旗', '准格尔旗']),
    createCity('赤峰市', ['红山区', '元宝山区', '松山区']),
  ]),
  createProvince('辽宁省', [
    createCity('沈阳市', [
      '和平区',
      '沈河区',
      '大东区',
      '皇姑区',
      '铁西区',
      '苏家屯区',
      '浑南区',
      '于洪区',
      '沈北新区',
    ]),
    createCity('大连市', [
      '中山区',
      '西岗区',
      '沙河口区',
      '甘井子区',
      '旅顺口区',
      '金州区',
      '普兰店区',
    ]),
    createCity('鞍山市', ['铁东区', '铁西区', '立山区', '千山区', '海城市']),
    createCity('锦州市', ['古塔区', '凌河区', '太和区', '凌海市']),
  ]),
  createProvince('吉林省', [
    createCity('长春市', ['南关区', '宽城区', '朝阳区', '二道区', '绿园区', '双阳区', '九台区']),
    createCity('吉林市', ['昌邑区', '龙潭区', '船营区', '丰满区']),
    createCity('四平市', ['铁西区', '铁东区', '梨树县', '公主岭市']),
    createCity('延边朝鲜族自治州', ['延吉市', '图们市', '敦化市', '珲春市']),
  ]),
  createProvince('黑龙江省', [
    createCity('哈尔滨市', [
      '道里区',
      '南岗区',
      '道外区',
      '平房区',
      '松北区',
      '香坊区',
      '呼兰区',
      '阿城区',
    ]),
    createCity('齐齐哈尔市', [
      '龙沙区',
      '建华区',
      '铁锋区',
      '昂昂溪区',
      '富拉尔基区',
      '碾子山区',
      '梅里斯达斡尔族区',
    ]),
    createCity('牡丹江市', ['东安区', '阳明区', '爱民区', '西安区']),
    createCity('大庆市', ['萨尔图区', '龙凤区', '让胡路区', '红岗区', '大同区']),
  ]),
  createProvince('江苏省', [
    createCity('南京市', [
      '玄武区',
      '秦淮区',
      '建邺区',
      '鼓楼区',
      '浦口区',
      '栖霞区',
      '雨花台区',
      '江宁区',
      '六合区',
      '溧水区',
      '高淳区',
    ]),
    createCity('苏州市', [
      '姑苏区',
      '虎丘区',
      '吴中区',
      '相城区',
      '吴江区',
      '常熟市',
      '张家港市',
      '昆山市',
      '太仓市',
    ]),
    createCity('无锡市', ['梁溪区', '锡山区', '惠山区', '滨湖区', '新吴区', '江阴市', '宜兴市']),
    createCity('常州市', ['天宁区', '钟楼区', '新北区', '武进区', '金坛区']),
    createCity('南通市', ['崇川区', '通州区', '海门区', '启东市', '如皋市']),
  ]),
  createProvince('浙江省', [
    createCity('杭州市', [
      '上城区',
      '拱墅区',
      '西湖区',
      '滨江区',
      '萧山区',
      '余杭区',
      '临平区',
      '钱塘区',
      '富阳区',
      '临安区',
    ]),
    createCity('宁波市', [
      '海曙区',
      '江北区',
      '北仑区',
      '镇海区',
      '鄞州区',
      '奉化区',
      '余姚市',
      '慈溪市',
    ]),
    createCity('温州市', ['鹿城区', '龙湾区', '瓯海区', '洞头区', '瑞安市', '乐清市']),
    createCity('绍兴市', ['越城区', '柯桥区', '上虞区', '诸暨市']),
    createCity('嘉兴市', ['南湖区', '秀洲区', '海宁市', '桐乡市']),
  ]),
  createProvince('安徽省', [
    createCity('合肥市', [
      '瑶海区',
      '庐阳区',
      '蜀山区',
      '包河区',
      '长丰县',
      '肥东县',
      '肥西县',
      '庐江县',
    ]),
    createCity('芜湖市', ['镜湖区', '弋江区', '鸠江区', '湾沚区', '繁昌区']),
    createCity('蚌埠市', ['龙子湖区', '蚌山区', '禹会区', '淮上区']),
    createCity('阜阳市', ['颍州区', '颍东区', '颍泉区', '界首市']),
  ]),
  createProvince('福建省', [
    createCity('福州市', ['鼓楼区', '台江区', '仓山区', '马尾区', '晋安区', '长乐区', '福清市']),
    createCity('厦门市', ['思明区', '海沧区', '湖里区', '集美区', '同安区', '翔安区']),
    createCity('泉州市', ['鲤城区', '丰泽区', '洛江区', '泉港区', '晋江市', '石狮市']),
    createCity('漳州市', ['芗城区', '龙文区', '龙海区']),
  ]),
  createProvince('江西省', [
    createCity('南昌市', ['东湖区', '西湖区', '青云谱区', '青山湖区', '新建区', '红谷滩区']),
    createCity('赣州市', ['章贡区', '南康区', '赣县区', '瑞金市']),
    createCity('九江市', ['濂溪区', '浔阳区', '柴桑区', '瑞昌市']),
    createCity('上饶市', ['信州区', '广丰区', '德兴市']),
  ]),
  createProvince('山东省', [
    createCity('济南市', [
      '历下区',
      '市中区',
      '槐荫区',
      '天桥区',
      '历城区',
      '长清区',
      '章丘区',
      '济阳区',
      '莱芜区',
      '钢城区',
    ]),
    createCity('青岛市', [
      '市南区',
      '市北区',
      '黄岛区',
      '崂山区',
      '李沧区',
      '城阳区',
      '即墨区',
      '胶州市',
      '平度市',
      '莱西市',
    ]),
    createCity('烟台市', ['芝罘区', '福山区', '牟平区', '莱山区', '龙口市', '蓬莱区']),
    createCity('潍坊市', ['潍城区', '寒亭区', '坊子区', '奎文区', '青州市', '诸城市']),
  ]),
  createProvince('河南省', [
    createCity('郑州市', [
      '中原区',
      '二七区',
      '管城回族区',
      '金水区',
      '上街区',
      '惠济区',
      '中牟县',
      '巩义市',
      '新郑市',
    ]),
    createCity('洛阳市', [
      '老城区',
      '西工区',
      '瀍河回族区',
      '涧西区',
      '孟津区',
      '洛龙区',
      '偃师区',
    ]),
    createCity('南阳市', ['宛城区', '卧龙区', '邓州市']),
    createCity('新乡市', ['红旗区', '卫滨区', '凤泉区', '牧野区', '卫辉市', '辉县市']),
  ]),
  createProvince('湖北省', [
    createCity('武汉市', [
      '江岸区',
      '江汉区',
      '硚口区',
      '汉阳区',
      '武昌区',
      '青山区',
      '洪山区',
      '东西湖区',
      '汉南区',
      '蔡甸区',
      '江夏区',
      '黄陂区',
      '新洲区',
    ]),
    createCity('襄阳市', ['襄城区', '樊城区', '襄州区', '枣阳市', '宜城市']),
    createCity('宜昌市', ['西陵区', '伍家岗区', '点军区', '猇亭区', '夷陵区', '宜都市']),
    createCity('黄石市', ['黄石港区', '西塞山区', '下陆区', '铁山区', '大冶市']),
  ]),
  createProvince('湖南省', [
    createCity('长沙市', [
      '芙蓉区',
      '天心区',
      '岳麓区',
      '开福区',
      '雨花区',
      '望城区',
      '长沙县',
      '浏阳市',
      '宁乡市',
    ]),
    createCity('株洲市', ['荷塘区', '芦淞区', '石峰区', '天元区', '渌口区', '醴陵市']),
    createCity('湘潭市', ['雨湖区', '岳塘区', '湘潭县', '湘乡市']),
    createCity('衡阳市', ['珠晖区', '雁峰区', '石鼓区', '蒸湘区', '南岳区']),
  ]),
  createProvince('广东省', [
    createCity('广州市', [
      '荔湾区',
      '越秀区',
      '海珠区',
      '天河区',
      '白云区',
      '黄埔区',
      '番禺区',
      '花都区',
      '南沙区',
      '从化区',
      '增城区',
    ]),
    createCity('深圳市', [
      '罗湖区',
      '福田区',
      '南山区',
      '宝安区',
      '龙岗区',
      '盐田区',
      '龙华区',
      '坪山区',
      '光明区',
    ]),
    createCity('佛山市', ['禅城区', '南海区', '顺德区', '三水区', '高明区']),
    createCity('东莞市', [
      '东城街道',
      '南城街道',
      '万江街道',
      '莞城街道',
      '虎门镇',
      '长安镇',
      '常平镇',
      '厚街镇',
      '松山湖',
    ]),
    createCity('珠海市', ['香洲区', '斗门区', '金湾区']),
  ]),
  createProvince('广西壮族自治区', [
    createCity('南宁市', ['兴宁区', '青秀区', '江南区', '西乡塘区', '良庆区', '邕宁区', '武鸣区']),
    createCity('桂林市', ['秀峰区', '叠彩区', '象山区', '七星区', '雁山区', '临桂区']),
    createCity('柳州市', ['城中区', '鱼峰区', '柳南区', '柳北区', '柳江区']),
    createCity('北海市', ['海城区', '银海区', '铁山港区', '合浦县']),
  ]),
  createProvince('海南省', [
    createCity('海口市', ['秀英区', '龙华区', '琼山区', '美兰区']),
    createCity('三亚市', ['海棠区', '吉阳区', '天涯区', '崖州区']),
    createCity('儋州市', ['那大镇', '白马井镇', '洋浦经济开发区']),
    createCity('三沙市', ['西沙区', '南沙区']),
  ]),
  createProvince('四川省', [
    createCity('成都市', [
      '锦江区',
      '青羊区',
      '金牛区',
      '武侯区',
      '成华区',
      '龙泉驿区',
      '青白江区',
      '新都区',
      '温江区',
      '双流区',
      '郫都区',
      '新津区',
    ]),
    createCity('绵阳市', ['涪城区', '游仙区', '安州区', '江油市']),
    createCity('德阳市', ['旌阳区', '罗江区', '广汉市', '什邡市']),
    createCity('宜宾市', ['翠屏区', '南溪区', '叙州区']),
  ]),
  createProvince('贵州省', [
    createCity('贵阳市', ['南明区', '云岩区', '花溪区', '乌当区', '白云区', '观山湖区', '清镇市']),
    createCity('遵义市', ['红花岗区', '汇川区', '播州区', '仁怀市']),
    createCity('六盘水市', ['钟山区', '六枝特区', '盘州市']),
    createCity('毕节市', ['七星关区']),
  ]),
  createProvince('云南省', [
    createCity('昆明市', [
      '五华区',
      '盘龙区',
      '官渡区',
      '西山区',
      '东川区',
      '呈贡区',
      '晋宁区',
      '安宁市',
    ]),
    createCity('曲靖市', ['麒麟区', '沾益区', '马龙区', '宣威市']),
    createCity('玉溪市', ['红塔区', '江川区', '澄江市']),
    createCity('大理白族自治州', ['大理市', '祥云县', '鹤庆县']),
  ]),
  createProvince('西藏自治区', [
    createCity('拉萨市', ['城关区', '堆龙德庆区', '达孜区', '林周县']),
    createCity('日喀则市', ['桑珠孜区', '南木林县']),
    createCity('林芝市', ['巴宜区']),
  ]),
  createProvince('陕西省', [
    createCity('西安市', [
      '新城区',
      '碑林区',
      '莲湖区',
      '灞桥区',
      '未央区',
      '雁塔区',
      '阎良区',
      '临潼区',
      '长安区',
      '高陵区',
      '鄠邑区',
    ]),
    createCity('咸阳市', ['秦都区', '杨陵区', '渭城区', '兴平市']),
    createCity('宝鸡市', ['渭滨区', '金台区', '陈仓区']),
    createCity('榆林市', ['榆阳区', '横山区', '神木市']),
  ]),
  createProvince('甘肃省', [
    createCity('兰州市', ['城关区', '七里河区', '西固区', '安宁区', '红古区']),
    createCity('天水市', ['秦州区', '麦积区']),
    createCity('酒泉市', ['肃州区', '玉门市', '敦煌市']),
    createCity('庆阳市', ['西峰区']),
  ]),
  createProvince('青海省', [
    createCity('西宁市', ['城东区', '城中区', '城西区', '城北区', '湟中区']),
    createCity('海东市', ['乐都区', '平安区']),
    createCity('海西蒙古族藏族自治州', ['德令哈市', '格尔木市']),
  ]),
  createProvince('宁夏回族自治区', [
    createCity('银川市', ['兴庆区', '西夏区', '金凤区', '永宁县', '贺兰县', '灵武市']),
    createCity('石嘴山市', ['大武口区', '惠农区', '平罗县']),
    createCity('吴忠市', ['利通区', '红寺堡区', '青铜峡市']),
  ]),
  createProvince('新疆维吾尔自治区', [
    createCity('乌鲁木齐市', [
      '天山区',
      '沙依巴克区',
      '新市区',
      '水磨沟区',
      '头屯河区',
      '达坂城区',
      '米东区',
    ]),
    createCity('克拉玛依市', ['独山子区', '克拉玛依区', '白碱滩区', '乌尔禾区']),
    createCity('喀什地区', ['喀什市', '疏附县', '疏勒县']),
    createCity('伊犁哈萨克自治州', ['伊宁市', '奎屯市']),
  ]),
  {
    province: '香港特别行政区',
    cities: [
      createCity('香港特别行政区', [
        '中西区',
        '湾仔区',
        '东区',
        '南区',
        '油尖旺区',
        '深水埗区',
        '九龙城区',
        '黄大仙区',
        '观塘区',
        '荃湾区',
        '屯门区',
        '元朗区',
        '北区',
        '大埔区',
        '西贡区',
        '沙田区',
        '葵青区',
        '离岛区',
      ]),
    ],
  },
  {
    province: '澳门特别行政区',
    cities: [
      createCity('澳门特别行政区', [
        '花地玛堂区',
        '圣安多尼堂区',
        '大堂区',
        '望德堂区',
        '风顺堂区',
        '嘉模堂区',
        '圣方济各堂区',
        '路氹填海区',
      ]),
    ],
  },
  createProvince('台湾省', [
    createCity('台北市', [
      '中正区',
      '大同区',
      '中山区',
      '松山区',
      '大安区',
      '万华区',
      '信义区',
      '士林区',
      '北投区',
      '内湖区',
      '南港区',
      '文山区',
    ]),
    createCity('新北市', [
      '板桥区',
      '三重区',
      '中和区',
      '永和区',
      '新庄区',
      '新店区',
      '土城区',
      '芦洲区',
    ]),
    createCity('高雄市', [
      '新兴区',
      '前金区',
      '苓雅区',
      '盐埕区',
      '鼓山区',
      '旗津区',
      '前镇区',
      '三民区',
      '左营区',
      '楠梓区',
    ]),
    createCity('台中市', ['中区', '东区', '南区', '西区', '北区', '西屯区', '南屯区', '北屯区']),
  ]),
];

export const getCityOptions = (province: string): PickerOption[] => {
  const region = CHINA_REGIONS.find((item) => item.province === province);
  if (!region) {
    return [];
  }

  return region.cities.map((item) => ({ label: item.city, value: item.city }));
};

export const getDistrictOptions = (province: string, city: string): PickerOption[] => {
  const region = CHINA_REGIONS.find((item) => item.province === province);
  const cityItem = region?.cities.find((item) => item.city === city);
  if (!cityItem) {
    return [];
  }

  return cityItem.districts.map((item) => ({ label: item, value: item }));
};

export const provinceOptions: PickerOption[] = CHINA_REGIONS.map((item) => ({
  label: item.province,
  value: item.province,
}));

export const genderOptions: PickerOption[] = [
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'non_binary', label: '非二元' },
  { value: 'prefer_not_to_say', label: '不透露' },
];

const currentYear = new Date().getFullYear();

export const birthYearOptions: PickerOption[] = Array.from(
  { length: currentYear - 1939 },
  (_, index) => {
    const year = String(currentYear - index);
    return { label: year, value: year };
  },
);

export const birthMonthOptions: PickerOption[] = Array.from({ length: 12 }, (_, index) => {
  const month = String(index + 1).padStart(2, '0');
  return { label: `${month} 月`, value: month };
});

export const getBirthDayOptions = (year: string, month: string): PickerOption[] => {
  const safeYear = Number(year);
  const safeMonth = Number(month);
  const totalDays = safeYear > 0 && safeMonth > 0 ? new Date(safeYear, safeMonth, 0).getDate() : 31;

  return Array.from({ length: totalDays }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    return { label: `${day} 日`, value: day };
  });
};

export const parseDateParts = (value: string): DateParts => {
  const matched = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) {
    return { year: '', month: '', day: '' };
  }

  return {
    year: matched[1],
    month: matched[2],
    day: matched[3],
  };
};

export const composeDate = (year: string, month: string, day: string) => {
  if (!year || !month || !day) {
    return '';
  }

  return `${year}-${month}-${day}`;
};

export const buildRegionLabel = (parts: {
  regionProvince?: string | null;
  regionCity?: string | null;
  regionDistrict?: string | null;
}) => [parts.regionProvince, parts.regionCity, parts.regionDistrict].filter(Boolean).join(' ');
