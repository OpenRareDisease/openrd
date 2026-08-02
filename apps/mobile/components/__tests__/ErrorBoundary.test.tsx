import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ErrorBoundary } from '../ErrorBoundary';
import { setClientErrorReporter, type ClientErrorReport } from '../../lib/client-error-reporter';

const flattenText = (value: React.ReactNode): string => {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => flattenText(item)).join('');
  }
  return '';
};

const allText = (root: TestRenderer.ReactTestInstance): string =>
  root
    .findAllByType(Text)
    .map((node) => flattenText(node.props.children))
    .join('\n');

const Boom = (): React.ReactElement => {
  throw new Error('render exploded');
};

const render = (children: React.ReactNode): TestRenderer.ReactTestRenderer => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<ErrorBoundary>{children}</ErrorBoundary>);
  });
  return renderer;
};

describe('ErrorBoundary', () => {
  const reports: ClientErrorReport[] = [];
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    reports.length = 0;
    setClientErrorReporter((report) => {
      reports.push(report);
    });
    // React itself logs every caught error. Silencing keeps the suite
    // output readable; assertion failures still surface normally.
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    setClientErrorReporter(null);
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('renders its children when nothing throws', () => {
    const tree = render(<Text>档案</Text>);
    expect(allText(tree.root)).toContain('档案');
  });

  it('replaces a throwing subtree with a Chinese fallback instead of a blank page', () => {
    const tree = render(<Boom />);

    const text = allText(tree.root);
    expect(text).toContain('页面出了点问题');
    expect(text).toContain('重新加载');
    // The patient's first question is whether the upload they just did
    // is gone. The fallback has to answer it.
    expect(text).toContain('你已经保存和上传的内容都在');
  });

  it('never shows the raw error text to the patient', () => {
    const tree = render(<Boom />);
    expect(allText(tree.root)).not.toContain('render exploded');
  });

  it('reports the failure through the seam', () => {
    render(<Boom />);

    expect(reports).toHaveLength(1);
    expect(reports[0].origin).toBe('render');
    expect(reports[0].message).toBe('render exploded');
    expect(reports[0].componentStack).toEqual(expect.stringContaining('Boom'));
  });

  it('offers a labelled reload control that does not itself crash the app', () => {
    const tree = render(<Boom />);

    const button = tree.root.find(
      (node) =>
        node.props?.accessibilityRole === 'button' && typeof node.props?.onPress === 'function',
    );
    expect(button.props.accessibilityLabel).toBe('重新加载');

    // Platform.OS is not 'web' under jest-expo, so the native branch
    // runs: pressing remounts the subtree rather than reloading a
    // document that does not exist. The child still throws, so the
    // boundary catches again — the assertion is that pressing stays
    // inside the boundary instead of taking the app down with it.
    act(() => {
      button.props.onPress();
    });
    expect(allText(tree.root)).toContain('页面出了点问题');
    expect(reports.length).toBeGreaterThanOrEqual(2);
  });
});
