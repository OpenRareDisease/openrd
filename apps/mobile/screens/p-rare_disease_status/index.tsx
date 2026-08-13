import { useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../common/Button';
import ScreenHeader from '../common/ScreenHeader';
import styles from './styles';
import { renderAnesthesiaCardPng, type RenderedCard } from '../../lib/anesthesia-card-image';
import {
  RARE_DISEASE_CONTENT_AS_OF,
  RARE_DISEASE_DISCLAIMER,
  RARE_DISEASE_INTRO,
  RARE_DISEASE_LOCALITY_NOTE,
  RARE_DISEASE_SECTIONS,
  buildRareDiseaseCard,
  type RareDiseaseCardModel,
} from '../../lib/rare-disease-status-content';

/**
 * 罕见病身份与权益说明卡.
 *
 * A reading page plus one printable artefact. The card is a PNG for the
 * same reason the anesthesia card is (see lib/anesthesia-card-image.ts):
 * it gets held up at a 医保 or 残联 window, or long-pressed into a photo
 * roll so it is there in a queue with no signal. WeChat's in-app browser
 * — where a large share of these patients open the site — has no print
 * dialog and turns a PDF into a viewer they then have to escape.
 *
 * The card's clinical-equivalent text is always rendered too, and the
 * text is set unconditionally while the picture is allowed to fail. On
 * the native shell there is no canvas at all; a page that answered that
 * with a dead button would have withheld the content rather than the
 * convenience.
 */
const RareDiseaseStatusScreen = () => {
  const [card, setCard] = useState<RenderedCard | null>(null);
  const [model, setModel] = useState<RareDiseaseCardModel | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);

  const handleGenerate = () => {
    setCardError(null);
    const next = buildRareDiseaseCard(RARE_DISEASE_CONTENT_AS_OF);
    // Text first and independent of the canvas: one model, two carriers,
    // and the carrier that can fail is the picture.
    setModel(next);
    const rendered = renderAnesthesiaCardPng(next);
    if (!rendered) {
      setCard(null);
      setCardError(
        '这台设备上生成不了图片，下面的文字版内容完全一样，可以直接给窗口看，或者复制发出去。',
      );
      return;
    }
    setCard(rendered);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.safeArea}>
        <ScreenHeader title="罕见病身份与权益" />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.intro}>{RARE_DISEASE_INTRO}</Text>

          <View style={styles.provenance}>
            <Text style={styles.provenanceDate}>资料截至 {RARE_DISEASE_CONTENT_AS_OF}</Text>
            <Text style={styles.provenanceNote}>{RARE_DISEASE_LOCALITY_NOTE}</Text>
          </View>

          {RARE_DISEASE_SECTIONS.map((section) => (
            <View key={section.id} style={styles.section}>
              <Text style={styles.sectionTitle} accessibilityRole="header">
                {section.title}
              </Text>
              {section.lede ? <Text style={styles.sectionLede}>{section.lede}</Text> : null}
              {section.points.map((point) => (
                <View key={point} style={styles.point}>
                  <View style={styles.pointRule} />
                  <Text style={styles.pointText}>{point}</Text>
                </View>
              ))}
              <View style={styles.sourceRow}>
                <Text style={styles.sourceText}>出处：{section.source}</Text>
              </View>
            </View>
          ))}

          <View style={styles.cardBlock}>
            <View>
              <Text style={styles.cardTitle} accessibilityRole="header">
                生成说明卡
              </Text>
              <Text style={styles.cardSubtitle}>
                一张可以举给窗口看的图片，长按可保存到相册，排队时没有网也能打开。卡上不含你的任何个人信息
                —— 它说明的是病种和文号，不是你。
              </Text>
            </View>

            {card ? (
              <>
                <Image
                  source={{ uri: card.uri }}
                  // From the render, not a guess: the height falls out of
                  // how the text wraps.
                  style={[styles.cardImage, { aspectRatio: card.width / card.height }]}
                  resizeMode="contain"
                  accessibilityLabel="罕见病身份与权益说明卡图片，内容与下方文字相同"
                />
                <Text style={styles.cardSubtitle}>长按图片即可保存到手机相册。</Text>
              </>
            ) : null}

            {/* Reappears when the text landed but the picture did not, so
                there is a second attempt short of reloading the page. */}
            {model && card ? null : (
              <Button
                label={model ? '再试一次生成图片' : '生成说明卡'}
                // `images`, not `image`: Icon.tsx's GLYPH map has no
                // entry for the singular, so it falls back to a bare
                // ellipse and warns on every render.
                icon="images"
                variant="tinted"
                fullWidth
                accessibilityHint="生成一张可保存的图片和一份可复制的文字版，供在窗口出示"
                onPress={handleGenerate}
              />
            )}

            {cardError ? <Text style={styles.cardSubtitle}>{cardError}</Text> : null}

            {model ? (
              <View style={styles.cardTextBlock}>
                <Text style={styles.cardTextHint}>
                  下面是同一张卡的文字版，内容与图片一致，可长按选中复制。
                </Text>
                <Text style={styles.cardTextTitle} selectable>
                  {model.title}
                </Text>
                <Text style={styles.cardTextName} selectable>
                  {model.patientName}
                </Text>
                {model.patientLines.map((line, index) => (
                  <Text key={`meta-${index}`} style={styles.cardTextMeta} selectable>
                    {line}
                  </Text>
                ))}
                {model.sections.map((section, sectionIndex) => (
                  <View key={`section-${sectionIndex}`} style={styles.cardTextSection}>
                    <Text style={styles.cardTextHeading} selectable>
                      {section.title}
                    </Text>
                    {section.lines.map((line, lineIndex) => (
                      <Text
                        key={`line-${sectionIndex}-${lineIndex}`}
                        style={styles.cardTextLine}
                        selectable
                      >
                        {`· ${line}`}
                      </Text>
                    ))}
                  </View>
                ))}
                <Text style={styles.cardTextFine} selectable>
                  {model.disclaimer}
                </Text>
                {model.sources.map((source, index) => (
                  <Text key={`source-${index}`} style={styles.cardTextFine} selectable>
                    {source}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>

          <Text style={styles.disclaimer}>{RARE_DISEASE_DISCLAIMER}</Text>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

export default RareDiseaseStatusScreen;
