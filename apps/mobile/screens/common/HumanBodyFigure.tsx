import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Ellipse, Rect } from 'react-native-svg';
import {
  CLINICAL_COLORS,
  type BodyRegionId,
  type BodyRegionMap,
  type BodyView,
  getBodyHeatColor,
} from '../../lib/clinical-visuals';

type Shape =
  | { kind: 'circle'; props: React.ComponentProps<typeof Circle> }
  | { kind: 'ellipse'; props: React.ComponentProps<typeof Ellipse> }
  | { kind: 'rect'; props: React.ComponentProps<typeof Rect> };

const BASE_SHAPES: Shape[] = [
  { kind: 'circle', props: { cx: 60, cy: 18, r: 12 } },
  { kind: 'rect', props: { x: 54, y: 30, width: 12, height: 10, rx: 6 } },
  { kind: 'ellipse', props: { cx: 60, cy: 64, rx: 24, ry: 30 } },
  { kind: 'rect', props: { x: 44, y: 88, width: 32, height: 34, rx: 16 } },
  { kind: 'ellipse', props: { cx: 60, cy: 124, rx: 22, ry: 14 } },
  { kind: 'rect', props: { x: 30, y: 48, width: 12, height: 52, rx: 6 } },
  { kind: 'rect', props: { x: 78, y: 48, width: 12, height: 52, rx: 6 } },
  { kind: 'rect', props: { x: 26, y: 96, width: 10, height: 42, rx: 5 } },
  { kind: 'rect', props: { x: 84, y: 96, width: 10, height: 42, rx: 5 } },
  { kind: 'rect', props: { x: 43, y: 136, width: 14, height: 54, rx: 7 } },
  { kind: 'rect', props: { x: 63, y: 136, width: 14, height: 54, rx: 7 } },
  { kind: 'rect', props: { x: 45, y: 190, width: 12, height: 40, rx: 6 } },
  { kind: 'rect', props: { x: 63, y: 190, width: 12, height: 40, rx: 6 } },
];

const FRONT_REGION_SHAPES: Record<BodyRegionId, Shape[]> = {
  face: [{ kind: 'circle', props: { cx: 60, cy: 18, r: 12 } }],
  leftShoulder: [{ kind: 'ellipse', props: { cx: 42, cy: 48, rx: 14, ry: 11 } }],
  rightShoulder: [{ kind: 'ellipse', props: { cx: 78, cy: 48, rx: 14, ry: 11 } }],
  leftUpperArmFront: [{ kind: 'rect', props: { x: 30, y: 54, width: 12, height: 48, rx: 6 } }],
  rightUpperArmFront: [{ kind: 'rect', props: { x: 78, y: 54, width: 12, height: 48, rx: 6 } }],
  leftUpperArmBack: [],
  rightUpperArmBack: [],
  leftTorso: [{ kind: 'rect', props: { x: 41, y: 58, width: 14, height: 56, rx: 7 } }],
  rightTorso: [{ kind: 'rect', props: { x: 65, y: 58, width: 14, height: 56, rx: 7 } }],
  leftGlute: [],
  rightGlute: [],
  leftThighFront: [{ kind: 'rect', props: { x: 43, y: 136, width: 14, height: 54, rx: 7 } }],
  rightThighFront: [{ kind: 'rect', props: { x: 63, y: 136, width: 14, height: 54, rx: 7 } }],
  leftThighBack: [],
  rightThighBack: [],
  leftShin: [{ kind: 'rect', props: { x: 45, y: 190, width: 12, height: 40, rx: 6 } }],
  rightShin: [{ kind: 'rect', props: { x: 63, y: 190, width: 12, height: 40, rx: 6 } }],
  leftCalf: [],
  rightCalf: [],
};

const BACK_REGION_SHAPES: Record<BodyRegionId, Shape[]> = {
  face: [{ kind: 'circle', props: { cx: 60, cy: 18, r: 12 } }],
  leftShoulder: [{ kind: 'ellipse', props: { cx: 42, cy: 50, rx: 14, ry: 11 } }],
  rightShoulder: [{ kind: 'ellipse', props: { cx: 78, cy: 50, rx: 14, ry: 11 } }],
  leftUpperArmFront: [],
  rightUpperArmFront: [],
  leftUpperArmBack: [{ kind: 'rect', props: { x: 30, y: 54, width: 12, height: 48, rx: 6 } }],
  rightUpperArmBack: [{ kind: 'rect', props: { x: 78, y: 54, width: 12, height: 48, rx: 6 } }],
  leftTorso: [{ kind: 'rect', props: { x: 41, y: 58, width: 14, height: 56, rx: 7 } }],
  rightTorso: [{ kind: 'rect', props: { x: 65, y: 58, width: 14, height: 56, rx: 7 } }],
  leftGlute: [{ kind: 'ellipse', props: { cx: 52, cy: 124, rx: 11, ry: 11 } }],
  rightGlute: [{ kind: 'ellipse', props: { cx: 68, cy: 124, rx: 11, ry: 11 } }],
  leftThighFront: [],
  rightThighFront: [],
  leftThighBack: [{ kind: 'rect', props: { x: 43, y: 136, width: 14, height: 54, rx: 7 } }],
  rightThighBack: [{ kind: 'rect', props: { x: 63, y: 136, width: 14, height: 54, rx: 7 } }],
  leftShin: [],
  rightShin: [],
  leftCalf: [{ kind: 'rect', props: { x: 45, y: 190, width: 12, height: 40, rx: 6 } }],
  rightCalf: [{ kind: 'rect', props: { x: 63, y: 190, width: 12, height: 40, rx: 6 } }],
};

const renderShape = (shape: Shape, color: string, key: string, opacity = 1) => {
  if (shape.kind === 'circle') {
    return <Circle key={key} {...shape.props} fill={color} opacity={opacity} />;
  }
  if (shape.kind === 'ellipse') {
    return <Ellipse key={key} {...shape.props} fill={color} opacity={opacity} />;
  }
  return <Rect key={key} {...shape.props} fill={color} opacity={opacity} />;
};

type HumanBodyFigureProps = {
  view: BodyView;
  regions: BodyRegionMap;
  mode?: 'strength' | 'mri';
  title?: string;
  subtitle?: string;
};

export default function HumanBodyFigure({
  view,
  regions,
  mode = 'strength',
  title,
  subtitle,
}: HumanBodyFigureProps) {
  const regionShapes = view === 'front' ? FRONT_REGION_SHAPES : BACK_REGION_SHAPES;

  return (
    <View style={styles.figureCard}>
      {(title || subtitle) && (
        <View style={styles.copyBlock}>
          {title ? <Text style={styles.figureTitle}>{title}</Text> : null}
          {subtitle ? <Text style={styles.figureSubtitle}>{subtitle}</Text> : null}
        </View>
      )}

      <View style={styles.figureWrap}>
        <Svg width={160} height={292} viewBox="0 0 120 240">
          {BASE_SHAPES.map((shape, index) =>
            renderShape(shape, CLINICAL_COLORS.panelMuted, `base-${index}`, 0.9),
          )}
          {Object.entries(regions).map(([regionId, datum]) =>
            (regionShapes[regionId as BodyRegionId] ?? []).map((shape, index) =>
              renderShape(
                shape,
                getBodyHeatColor(datum?.intensity ?? 0, mode),
                `${regionId}-${index}`,
                0.95,
              ),
            ),
          )}
        </Svg>
      </View>

      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: getBodyHeatColor(1, mode) }]} />
          <Text style={styles.legendText}>轻度</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: getBodyHeatColor(2, mode) }]} />
          <Text style={styles.legendText}>中度</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: getBodyHeatColor(4, mode) }]} />
          <Text style={styles.legendText}>重度</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  figureCard: {
    backgroundColor: 'transparent',
  },
  copyBlock: {
    marginBottom: 12,
    gap: 4,
  },
  figureTitle: {
    color: CLINICAL_COLORS.text,
    fontSize: 15,
    fontWeight: '700',
  },
  figureSubtitle: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  figureWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 11,
  },
});
