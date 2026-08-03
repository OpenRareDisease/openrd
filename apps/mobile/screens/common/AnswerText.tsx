import type { ReactNode } from 'react';
import {
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
} from 'react-native';
import { parseAnswer, type AnswerBlock, type TextSpan } from './answer-format';
import { COLOR, HAIRLINE, RADIUS, SPACE, TYPE } from '../../lib/design';

/**
 * Renders an AI answer.
 *
 * The parsing lives in `answer-format.ts` (and is tested there); this
 * is only the typography. Every surface that shows model-authored text
 * should use this rather than dropping the string into a `<Text>`, so
 * the Markdown is handled in one place instead of leaking onto
 * whichever screen forgot.
 */

interface AnswerTextProps {
  children: string;
  /** Base text style, so a drawer can render at a different size than
   *  the full chat without this component knowing about either. */
  style?: TextStyle;
  /**
   * Renders the plain text inside a span.
   *
   * The 问答 screen turns `[1]` into a tappable citation, and that has
   * to keep working — block formatting and citation linking are
   * orthogonal, and a component that could only do one of them would
   * force the screen carrying the most citations to opt out of
   * formatting entirely. Default is the string itself.
   */
  renderText?: (text: string) => ReactNode;
}

const spanStyle = (span: TextSpan): TextStyle[] => {
  const out: TextStyle[] = [];
  if (span.bold) out.push(styles.bold);
  if (span.italic) out.push(styles.italic);
  if (span.strike) out.push(styles.strike);
  if (span.code) out.push(styles.codeInline);
  if (span.href) out.push(styles.link);
  return out;
};

interface SpansProps {
  spans: TextSpan[];
  style?: TextStyle;
  renderText?: (text: string) => ReactNode;
}

const Spans = ({ spans, style, renderText }: SpansProps) => (
  <Text style={style}>
    {spans.map((span, index) => (
      <Text
        key={index}
        style={spanStyle(span)}
        // Opening a URL leaves the app, so it happens only on an
        // explicit tap, and only for a scheme we recognise — a model
        // can write any string inside `(...)`, and `javascript:` is a
        // string.
        onPress={
          span.href && /^https?:\/\//i.test(span.href)
            ? () => {
                void Linking.openURL(span.href as string);
              }
            : undefined
        }
        accessibilityRole={span.href ? 'link' : undefined}
      >
        {/* A code span is verbatim by definition — running the
            citation matcher over it would rewrite the code. */}
        {renderText && !span.code ? renderText(span.text) : span.text}
      </Text>
    ))}
  </Text>
);

interface BlockProps {
  block: AnswerBlock;
  style?: TextStyle;
  renderText?: (text: string) => ReactNode;
}

const Block = ({ block, style, renderText }: BlockProps) => {
  const body = StyleSheet.flatten([styles.body, style]);

  switch (block.kind) {
    case 'heading':
      return (
        <Spans
          spans={block.spans}
          // Six Markdown levels collapse to two. An answer inside a
          // chat bubble has no room for a heading hierarchy, and a
          // model's choice between ### and #### is not a considered
          // one.
          style={StyleSheet.flatten([block.level <= 2 ? styles.headingMajor : styles.heading])}
          renderText={renderText}
        />
      );

    case 'listItem':
      return (
        <View style={[styles.listRow, block.depth > 0 ? styles.listNested : null]}>
          <Text style={[styles.listMarker, style]}>{block.marker}</Text>
          <Spans
            spans={block.spans}
            style={StyleSheet.flatten([body, styles.flex])}
            renderText={renderText}
          />
        </View>
      );

    case 'pair':
      return (
        <View style={styles.pairRow}>
          <Text style={styles.pairLabel}>{block.label}</Text>
          <Spans
            spans={block.spans}
            style={StyleSheet.flatten([body, styles.flex])}
            renderText={renderText}
          />
        </View>
      );

    case 'quote':
      return (
        <View style={styles.quoteRow}>
          <View style={styles.quoteBar} />
          <Spans
            spans={block.spans}
            style={StyleSheet.flatten([body, styles.quoteText, styles.flex])}
            renderText={renderText}
          />
        </View>
      );

    case 'code':
      // Horizontally scrollable rather than wrapped: a wrapped code
      // block is unreadable, and a clipped one hides the end of the
      // line that mattered.
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.codeBlock}>
          <Text style={styles.codeText}>{block.text}</Text>
        </ScrollView>
      );

    case 'rule':
      return <View style={styles.rule} />;

    default:
      return <Spans spans={block.spans} style={body} renderText={renderText} />;
  }
};

const AnswerText = ({ children, style, renderText }: AnswerTextProps) => {
  const blocks = parseAnswer(children);
  return (
    <View style={styles.stack}>
      {blocks.map((block, index) => (
        <Block key={index} block={block} style={style} renderText={renderText} />
      ))}
    </View>
  );
};

export default AnswerText;

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

const styles = StyleSheet.create({
  stack: {
    gap: SPACE.sm,
  },
  flex: {
    flex: 1,
  },
  body: {
    ...TYPE.body,
    color: COLOR.ink,
  },

  bold: {
    fontWeight: '700',
  },
  italic: {
    fontStyle: 'italic',
  },
  strike: {
    textDecorationLine: 'line-through',
    color: COLOR.inkMuted,
  },
  link: {
    color: COLOR.accent,
    textDecorationLine: 'underline',
  },
  codeInline: {
    fontFamily: MONO,
    // Deliberately no background tint: a highlighted run inside a line
    // of Chinese forces a taller lineHeight on Android and the
    // paragraph starts to ripple.
    color: COLOR.inkSoft,
  },

  headingMajor: {
    ...TYPE.title,
    marginTop: SPACE.xs,
  },
  heading: {
    ...TYPE.heading,
    marginTop: SPACE.xs,
  },

  listRow: {
    flexDirection: 'row',
    gap: SPACE.sm,
  },
  listNested: {
    paddingLeft: SPACE.lg,
  },
  listMarker: {
    ...TYPE.body,
    color: COLOR.inkFaint,
    // Fixed width so 「1.」 and 「10.」 leave their text on the same
    // left edge — a ragged list of steps reads as a mistake.
    minWidth: 18,
  },

  /** A flattened table row. The label column is fixed-width so a run
   *  of them aligns — which is the only thing the table was doing for
   *  the reader in the first place. */
  pairRow: {
    flexDirection: 'row',
    gap: SPACE.sm,
  },
  pairLabel: {
    ...TYPE.label,
    color: COLOR.inkMuted,
    width: 84,
  },

  quoteRow: {
    flexDirection: 'row',
    gap: SPACE.md,
  },
  quoteBar: {
    width: 2,
    borderRadius: 1,
    backgroundColor: COLOR.line,
  },
  quoteText: {
    color: COLOR.inkSoft,
  },

  codeBlock: {
    backgroundColor: COLOR.well,
    borderRadius: RADIUS.control,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    padding: SPACE.md,
  },
  codeText: {
    fontFamily: MONO,
    fontSize: 13,
    lineHeight: 19,
    color: COLOR.inkSoft,
  },

  rule: {
    height: HAIRLINE,
    backgroundColor: COLOR.line,
    marginVertical: SPACE.xs,
  },
});
