import { Linking, Modal, ScrollView, Text, View } from 'react-native';
import Button from '../common/Button';
import styles from './styles';
import { READ_ORIGINAL_NOTE, type Story } from '../../lib/community-stories-content';

/**
 *「读原文」— what happens when there is no link to open.
 *
 * The shelf publishes excerpts, so every card needs a way out to the
 * whole thing. Ordinarily that is a URL. We do not have 21 of them:
 * the archived PDFs carry the 推荐阅读 links to *other* articles but
 * not their own permalink, and three of the four serial parts can be
 * inferred from those cross-references rather than read off them. An
 * inferred permalink that turns out to be wrong hands a patient a
 * stranger's life story under this author's name, which is a worse
 * outcome than a missing link by a wide margin.
 *
 * So this sheet is the honest fallback: the complete locator, printed
 * large enough to read and `selectable` so it can be long-pressed and
 * pasted into WeChat's search field — which is where most of these
 * patients already are, since this app ships as a web export that is
 * usually opened inside WeChat's in-app browser.
 *
 * The moment someone fills in `origin.url` after opening it and
 * checking it lands on the right article, the button below appears and
 * this sheet becomes a link. Nothing else has to change. That is the
 * only reason the field is optional rather than absent.
 */
interface ReadOriginalSheetProps {
  story: Story | null;
  onClose: () => void;
}

const ReadOriginalSheet = ({ story, onClose }: ReadOriginalSheetProps) => {
  if (!story) return null;

  const { origin } = story;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <View style={styles.sheet} accessibilityViewIsModal accessibilityLabel="读原文">
          <Text style={styles.sheetTitle} accessibilityRole="header">
            读原文
          </Text>

          <ScrollView>
            <Text style={styles.sheetNote}>{READ_ORIGINAL_NOTE}</Text>

            <View style={styles.locator}>
              <View style={styles.locatorRow}>
                <Text style={styles.locatorLabel}>原标题</Text>
                <Text style={styles.locatorValue} selectable>
                  {origin.originalTitle}
                </Text>
              </View>
              <View style={styles.locatorRow}>
                <Text style={styles.locatorLabel}>公众号</Text>
                <Text style={styles.locatorValue} selectable>
                  {origin.account}
                </Text>
              </View>
              <View style={styles.locatorRow}>
                <Text style={styles.locatorLabel}>作者</Text>
                <Text style={styles.locatorValue} selectable>
                  {origin.byline}
                </Text>
              </View>
              <View style={styles.locatorRow}>
                <Text style={styles.locatorLabel}>发表日期</Text>
                <Text style={styles.locatorValue}>{origin.publishedOn}</Text>
              </View>
              <View>
                <Text style={styles.locatorLabel}>本站存档</Text>
                <Text style={styles.locatorValueFaint} selectable>
                  {origin.sourceFile}
                </Text>
              </View>
            </View>

            <View style={styles.sheetActions}>
              {origin.url ? (
                <Button
                  label="打开原文"
                  variant="prominent"
                  fullWidth
                  trailingIcon="arrow-up-right-from-square"
                  // `openURL` rather than `canOpenURL` first: the only
                  // scheme reachable here is https, and a canOpenURL
                  // false on web is a false negative that would hide a
                  // link that works.
                  onPress={() => {
                    void Linking.openURL(origin.url as string);
                  }}
                />
              ) : null}
              <Button label="关闭" variant="plain" fullWidth onPress={onClose} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export default ReadOriginalSheet;
