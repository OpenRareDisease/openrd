import { Text, View } from 'react-native';
import Button from '../common/Button';
import styles from './styles';
import { getPullQuote, type Story } from '../../lib/community-stories-content';

/**
 * One story on the shelf.
 *
 * Four bands, in a deliberate order: what it is (title + byline), what
 * it is about in our words, what the author actually wrote, and the way
 * out to the original.
 *
 * The author's passage is the only thing on this page with a teal rule
 * beside it. That is the entire authorship signal — a reader who
 * notices nothing else still sees that one block is set apart from the
 * paragraph above it, and the attribution line names whose it is.
 *
 * `continuesSerial` collapses the gap and the top border so instalments
 * 2–4 of《不管如何，你得长大》hang off part 1 as one column instead of
 * reading as four separate stories that share an author.
 */
interface StoryCardProps {
  story: Story;
  /** True when the card directly above is the previous instalment. */
  continuesSerial?: boolean;
  onReadOriginal: (story: Story) => void;
}

const StoryCard = ({ story, continuesSerial, onReadOriginal }: StoryCardProps) => {
  const quote = getPullQuote(story);

  return (
    <View
      style={[styles.card, continuesSerial ? styles.cardSerialContinuation : null]}
      accessibilityLabel={story.title + '，' + story.origin.byline}
    >
      {story.serial ? (
        <Text style={styles.serialBadge}>
          {'连载 ' + story.serial.part + ' / ' + story.serial.total + '　' + story.serial.name}
        </Text>
      ) : null}

      <Text style={styles.cardTitle} accessibilityRole="header">
        {story.title}
      </Text>
      <Text style={styles.cardByline}>{story.origin.byline + '　' + story.origin.publishedOn}</Text>

      <Text style={styles.cardBlurb}>{story.blurb}</Text>

      {quote ? (
        <View style={styles.quote}>
          <View style={styles.quoteRule} />
          <View style={{ flex: 1 }}>
            {/* The author's words. Nothing on this page is allowed to
                look like this except an excerpt. */}
            <Text style={styles.quoteText} selectable>
              {quote.text}
            </Text>
            <Text style={styles.quoteAttribution}>
              {'—— 摘自《' + story.origin.originalTitle + '》'}
            </Text>
          </View>
        </View>
      ) : null}

      {story.caution ? <Text style={styles.caution}>{story.caution}</Text> : null}

      <View style={styles.cardActions}>
        <Button
          label="读原文"
          variant="tinted"
          trailingIcon="arrow-up-right-from-square"
          onPress={() => onReadOriginal(story)}
        />
      </View>
    </View>
  );
};

export default StoryCard;
