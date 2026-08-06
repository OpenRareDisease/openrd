/**
 * 罕见病身份与权益 — the screen.
 *
 * The one thing only the screen can get wrong: the card's content must
 * reach the patient even when the picture cannot be drawn. There is no
 * canvas on the native shell, and `renderAnesthesiaCardPng` returns null
 * there by design — a screen that set the model only on success would
 * answer a tap with nothing, on the page whose whole product is a set of
 * document numbers someone needs at a counter.
 */

import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ FontAwesome6: 'FontAwesome6' }));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      React.createElement('SafeAreaView', null, children),
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => true,
  }),
}));

jest.mock('../../../lib/anesthesia-card-image', () => ({
  __esModule: true,
  renderAnesthesiaCardPng: jest.fn(),
}));

import RareDiseaseStatusScreen from '../index';
import { renderAnesthesiaCardPng } from '../../../lib/anesthesia-card-image';

const asMock = (fn: unknown) => fn as jest.Mock;

const RENDERED = { uri: 'data:image/png;base64,AAA', width: 1500, height: 3000 };

const collectText = (node: unknown): string => {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (node && typeof node === 'object' && 'children' in node) {
    return collectText((node as { children: unknown }).children);
  }
  return '';
};

const render = () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<RareDiseaseStatusScreen />);
  });
  return tree;
};

const pressGenerate = (tree: TestRenderer.ReactTestRenderer, label: string) => {
  // Button leaves accessibilityLabel defaulting to its label, so this
  // presses the control by the name a screen reader announces.
  const node = tree.root.findAll(
    (instance) =>
      instance.props.accessibilityRole === 'button' &&
      instance.props.accessibilityLabel === label &&
      typeof instance.props.onPress === 'function',
  )[0];
  act(() => {
    node.props.onPress();
  });
};

beforeEach(() => {
  asMock(renderAnesthesiaCardPng).mockReset();
});

describe('四节正文', () => {
  it('目录身份、协作网、门诊慢特病、以及「给不了什么」四节都在', () => {
    asMock(renderAnesthesiaCardPng).mockReturnValue(RENDERED);
    const text = collectText(render().toJSON());
    expect(text).toContain('序号 25');
    expect(text).toContain('国卫办医函〔2019〕157号');
    expect(text).toContain('进目录 ≠ 进门诊慢特病');
    expect(text).toContain('目录目前给不了你什么');
  });

  it('每一节都印了出处', () => {
    asMock(renderAnesthesiaCardPng).mockReturnValue(RENDERED);
    const text = collectText(render().toJSON());
    expect(text.split('出处：').length - 1).toBeGreaterThanOrEqual(5);
  });

  it('资料截至日期在正文之前', () => {
    asMock(renderAnesthesiaCardPng).mockReturnValue(RENDERED);
    const text = collectText(render().toJSON());
    expect(text.indexOf('资料截至')).toBeLessThan(text.indexOf('序号 25'));
  });
});

describe('说明卡', () => {
  it('未生成时不显示图片，也不显示文字版', () => {
    asMock(renderAnesthesiaCardPng).mockReturnValue(RENDERED);
    const tree = render();
    expect(collectText(tree.toJSON())).not.toContain('罕见病身份与权益说明卡');
    expect(tree.root.findAllByType('Image' as never)).toHaveLength(0);
  });

  it('生成成功时图片和文字版都在', () => {
    asMock(renderAnesthesiaCardPng).mockReturnValue(RENDERED);
    const tree = render();
    pressGenerate(tree, '生成说明卡');
    const text = collectText(tree.toJSON());
    expect(text).toContain('罕见病身份与权益说明卡');
    expect(text).toContain('国卫医政发〔2023〕26号');
    expect(text).toContain('长按图片即可保存到手机相册');
  });

  it('画不出图片时，文字版仍然完整出现', () => {
    // The native shell, and any browser where canvas is unavailable.
    // Revert the「set the model before rendering the PNG」ordering in
    // handleGenerate and this goes red.
    asMock(renderAnesthesiaCardPng).mockReturnValue(null);
    const tree = render();
    pressGenerate(tree, '生成说明卡');
    const text = collectText(tree.toJSON());
    expect(text).toContain('这台设备上生成不了图片');
    expect(text).toContain('国卫医政发〔2023〕26号');
    expect(text).toContain('无改变病程的治疗药物');
  });

  it('画不出图片时按钮还在，可以再试一次', () => {
    asMock(renderAnesthesiaCardPng).mockReturnValue(null);
    const tree = render();
    pressGenerate(tree, '生成说明卡');
    expect(collectText(tree.toJSON())).toContain('再试一次生成图片');

    asMock(renderAnesthesiaCardPng).mockReturnValue(RENDERED);
    pressGenerate(tree, '再试一次生成图片');
    const text = collectText(tree.toJSON());
    expect(text).toContain('长按图片即可保存到手机相册');
    expect(text).not.toContain('再试一次生成图片');
  });

  it('图片的宽高比来自渲染结果，不是猜的', () => {
    asMock(renderAnesthesiaCardPng).mockReturnValue(RENDERED);
    const tree = render();
    pressGenerate(tree, '生成说明卡');
    const image = tree.root.findAll(
      (instance) =>
        typeof instance.props.accessibilityLabel === 'string' &&
        instance.props.accessibilityLabel.includes('说明卡图片'),
    )[0];
    const flattened = ([] as unknown[]).concat(image.props.style).filter(Boolean);
    expect(flattened).toContainEqual({ aspectRatio: RENDERED.width / RENDERED.height });
  });

  it('卡片说明写明卡上没有个人信息', () => {
    // It is generated with no passport and shown to a stranger at a
    // counter; a patient hesitating over that is a patient not using it.
    asMock(renderAnesthesiaCardPng).mockReturnValue(RENDERED);
    expect(collectText(render().toJSON())).toContain('卡上不含你的任何个人信息');
  });
});
