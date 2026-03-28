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

const OTHER_CITY = '其他城市';
const OTHER_DISTRICT = '其他区县';

const withOtherDistrict = (districts: string[]) => [...districts, OTHER_DISTRICT];

export const CHINA_REGIONS: RegionOption[] = [
  {
    province: '北京市',
    cities: [
      {
        city: '北京市',
        districts: withOtherDistrict(['东城区', '西城区', '朝阳区', '海淀区', '丰台区', '通州区']),
      },
    ],
  },
  {
    province: '天津市',
    cities: [
      {
        city: '天津市',
        districts: withOtherDistrict(['和平区', '河西区', '南开区', '河北区', '滨海新区']),
      },
    ],
  },
  {
    province: '上海市',
    cities: [
      {
        city: '上海市',
        districts: withOtherDistrict(['黄浦区', '徐汇区', '静安区', '浦东新区', '闵行区']),
      },
    ],
  },
  {
    province: '重庆市',
    cities: [
      {
        city: '重庆市',
        districts: withOtherDistrict(['渝中区', '江北区', '沙坪坝区', '南岸区', '渝北区']),
      },
    ],
  },
  {
    province: '河北省',
    cities: [
      { city: '石家庄市', districts: withOtherDistrict(['长安区', '桥西区', '新华区', '裕华区']) },
      { city: '唐山市', districts: withOtherDistrict(['路南区', '路北区', '丰南区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '山西省',
    cities: [
      {
        city: '太原市',
        districts: withOtherDistrict(['小店区', '迎泽区', '杏花岭区', '万柏林区']),
      },
      { city: '大同市', districts: withOtherDistrict(['平城区', '云冈区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '内蒙古自治区',
    cities: [
      {
        city: '呼和浩特市',
        districts: withOtherDistrict(['新城区', '回民区', '玉泉区', '赛罕区']),
      },
      { city: '包头市', districts: withOtherDistrict(['昆都仑区', '青山区', '东河区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '辽宁省',
    cities: [
      { city: '沈阳市', districts: withOtherDistrict(['和平区', '沈河区', '皇姑区', '铁西区']) },
      {
        city: '大连市',
        districts: withOtherDistrict(['中山区', '西岗区', '沙河口区', '甘井子区']),
      },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '吉林省',
    cities: [
      { city: '长春市', districts: withOtherDistrict(['南关区', '朝阳区', '二道区', '绿园区']) },
      { city: '吉林市', districts: withOtherDistrict(['昌邑区', '船营区', '丰满区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '黑龙江省',
    cities: [
      { city: '哈尔滨市', districts: withOtherDistrict(['道里区', '南岗区', '道外区', '香坊区']) },
      { city: '齐齐哈尔市', districts: withOtherDistrict(['龙沙区', '建华区', '铁锋区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '江苏省',
    cities: [
      {
        city: '南京市',
        districts: withOtherDistrict(['玄武区', '秦淮区', '鼓楼区', '建邺区', '江宁区']),
      },
      { city: '苏州市', districts: withOtherDistrict(['姑苏区', '虎丘区', '吴中区', '相城区']) },
      { city: '无锡市', districts: withOtherDistrict(['梁溪区', '滨湖区', '新吴区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '浙江省',
    cities: [
      {
        city: '杭州市',
        districts: withOtherDistrict(['上城区', '拱墅区', '西湖区', '滨江区', '余杭区']),
      },
      { city: '宁波市', districts: withOtherDistrict(['海曙区', '江北区', '鄞州区', '北仑区']) },
      { city: '温州市', districts: withOtherDistrict(['鹿城区', '龙湾区', '瓯海区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '安徽省',
    cities: [
      { city: '合肥市', districts: withOtherDistrict(['庐阳区', '蜀山区', '包河区', '瑶海区']) },
      { city: '芜湖市', districts: withOtherDistrict(['镜湖区', '弋江区', '鸠江区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '福建省',
    cities: [
      { city: '福州市', districts: withOtherDistrict(['鼓楼区', '台江区', '仓山区', '晋安区']) },
      { city: '厦门市', districts: withOtherDistrict(['思明区', '湖里区', '集美区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '江西省',
    cities: [
      {
        city: '南昌市',
        districts: withOtherDistrict(['东湖区', '西湖区', '青云谱区', '红谷滩区']),
      },
      { city: '赣州市', districts: withOtherDistrict(['章贡区', '南康区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '山东省',
    cities: [
      { city: '济南市', districts: withOtherDistrict(['历下区', '市中区', '槐荫区', '历城区']) },
      { city: '青岛市', districts: withOtherDistrict(['市南区', '市北区', '崂山区', '黄岛区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '河南省',
    cities: [
      {
        city: '郑州市',
        districts: withOtherDistrict(['中原区', '二七区', '金水区', '管城回族区']),
      },
      { city: '洛阳市', districts: withOtherDistrict(['西工区', '涧西区', '洛龙区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '湖北省',
    cities: [
      {
        city: '武汉市',
        districts: withOtherDistrict(['江岸区', '江汉区', '武昌区', '洪山区', '东西湖区']),
      },
      { city: '襄阳市', districts: withOtherDistrict(['襄城区', '樊城区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '湖南省',
    cities: [
      { city: '长沙市', districts: withOtherDistrict(['芙蓉区', '天心区', '岳麓区', '开福区']) },
      { city: '株洲市', districts: withOtherDistrict(['荷塘区', '芦淞区', '天元区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '广东省',
    cities: [
      {
        city: '广州市',
        districts: withOtherDistrict(['越秀区', '天河区', '海珠区', '白云区', '番禺区']),
      },
      {
        city: '深圳市',
        districts: withOtherDistrict(['福田区', '南山区', '罗湖区', '宝安区', '龙岗区']),
      },
      { city: '佛山市', districts: withOtherDistrict(['禅城区', '南海区', '顺德区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '广西壮族自治区',
    cities: [
      { city: '南宁市', districts: withOtherDistrict(['青秀区', '兴宁区', '江南区', '西乡塘区']) },
      { city: '桂林市', districts: withOtherDistrict(['秀峰区', '叠彩区', '七星区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '海南省',
    cities: [
      { city: '海口市', districts: withOtherDistrict(['龙华区', '秀英区', '琼山区', '美兰区']) },
      { city: '三亚市', districts: withOtherDistrict(['海棠区', '吉阳区', '天涯区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '四川省',
    cities: [
      {
        city: '成都市',
        districts: withOtherDistrict(['锦江区', '青羊区', '武侯区', '成华区', '高新区']),
      },
      { city: '绵阳市', districts: withOtherDistrict(['涪城区', '游仙区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '贵州省',
    cities: [
      { city: '贵阳市', districts: withOtherDistrict(['南明区', '云岩区', '观山湖区']) },
      { city: '遵义市', districts: withOtherDistrict(['红花岗区', '汇川区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '云南省',
    cities: [
      { city: '昆明市', districts: withOtherDistrict(['五华区', '盘龙区', '西山区', '官渡区']) },
      { city: '曲靖市', districts: withOtherDistrict(['麒麟区', '沾益区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '西藏自治区',
    cities: [
      { city: '拉萨市', districts: withOtherDistrict(['城关区', '堆龙德庆区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '陕西省',
    cities: [
      { city: '西安市', districts: withOtherDistrict(['新城区', '碑林区', '雁塔区', '未央区']) },
      { city: '咸阳市', districts: withOtherDistrict(['秦都区', '渭城区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '甘肃省',
    cities: [
      { city: '兰州市', districts: withOtherDistrict(['城关区', '七里河区', '安宁区']) },
      { city: '天水市', districts: withOtherDistrict(['秦州区', '麦积区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '青海省',
    cities: [
      { city: '西宁市', districts: withOtherDistrict(['城东区', '城中区', '城西区', '城北区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '宁夏回族自治区',
    cities: [
      { city: '银川市', districts: withOtherDistrict(['兴庆区', '金凤区', '西夏区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '新疆维吾尔自治区',
    cities: [
      {
        city: '乌鲁木齐市',
        districts: withOtherDistrict(['天山区', '沙依巴克区', '水磨沟区', '新市区']),
      },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
  {
    province: '香港特别行政区',
    cities: [
      {
        city: '香港特别行政区',
        districts: ['中西区', '湾仔区', '东区', '油尖旺区', OTHER_DISTRICT],
      },
    ],
  },
  {
    province: '澳门特别行政区',
    cities: [
      { city: '澳门特别行政区', districts: ['花地玛堂区', '大堂区', '望德堂区', OTHER_DISTRICT] },
    ],
  },
  {
    province: '台湾省',
    cities: [
      { city: '台北市', districts: withOtherDistrict(['中正区', '大安区', '信义区', '士林区']) },
      { city: '高雄市', districts: withOtherDistrict(['新兴区', '苓雅区', '左营区']) },
      { city: OTHER_CITY, districts: [OTHER_DISTRICT] },
    ],
  },
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

export const parseDateParts = (value: string) => {
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
