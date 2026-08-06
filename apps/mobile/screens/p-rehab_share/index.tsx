import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '../common/ScreenHeader';
import SegmentedControl from '../common/SegmentedControl';
import styles from './styles';
import OrthosisFlow from './OrthosisFlow';
import HomeExercisePlan from './HomeExercisePlan';

/**
 * 康复：辅具与运动.
 *
 * What was here before
 * --------------------
 * `UnavailableScreen`, saying 康复训练内容当前为试运行版本，暂未开放.
 * The route, the settings entry and a 561-line stylesheet for a video
 * player all existed; the content did not. Both flows on this screen
 * are built from documents that were already in the corpus:
 *
 *  - 辅具选择 — the Dutch FSHD guideline 5.4 (AFO ladder + walking-aid
 *    ladder), whose branch variables are the same muscles this product
 *    already scores.
 *  - 六个月居家运动 — Bankolé 2016, plus King & Pandya and the same
 *    guideline's 5.2.
 *
 * Why two tabs and not two routes
 * -------------------------------
 * 5.4 is explicit that an orthosis and a walking aid are prescribed and
 * trained together, and 5.2's own recommendation about strength
 * training exists to optimise gait and balance — i.e. the same problem
 * the aids address. They are one conversation with a rehabilitation
 * clinician, and both flows end by handing over a list to have it with.
 * Adding a route would also have meant editing app/ and _layout.tsx,
 * which this change does not own.
 *
 * The tab is component state, not a URL param: this app ships as a web
 * export opened inside WeChat's browser, where a query string is a
 * thing patients cannot see and cannot edit, and neither flow has any
 * state worth deep-linking into.
 */

type TabKey = 'orthosis' | 'exercise';

const SEGMENTS = [
  { key: 'orthosis', label: '辅具选择' },
  { key: 'exercise', label: '六个月运动' },
];

const RehabShareScreen = () => {
  const [tab, setTab] = useState<TabKey>('orthosis');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.safeArea}>
        <ScreenHeader title="康复：辅具与运动" />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <SegmentedControl
            segments={SEGMENTS}
            value={tab}
            onChange={(key) => setTab(key as TabKey)}
            accessibilityLabel="康复内容分类"
            style={styles.segmented}
          />

          {tab === 'orthosis' ? <OrthosisFlow /> : <HomeExercisePlan />}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

export default RehabShareScreen;
