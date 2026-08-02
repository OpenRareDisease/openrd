import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLOR, RADIUS, SPACE, TYPE } from '../lib/design';
import { COMFORTABLE_TOUCH_TARGET } from '../lib/a11y';
import { reportClientError } from '../lib/client-error-reporter';

/**
 * Root error boundary.
 *
 * The web export is the channel that actually ships, and on it an
 * uncaught throw anywhere in the tree unmounts React to a blank white
 * page. No message, no back button, no way to tell whether the app is
 * broken or the phone is — for a patient mid-upload of a hospital
 * report, indistinguishable from having lost their data. This puts a
 * floor under that: the tree still unmounts, but something readable
 * and Chinese stands in its place, and the failure gets recorded
 * instead of vanishing.
 *
 * It has to be a class. `componentDidCatch` / `getDerivedStateFromError`
 * have no hooks equivalent — this is the one component in the app that
 * cannot be a function.
 *
 * What it deliberately does not do
 * --------------------------------
 * It does not try to recover in place on the web. React has already
 * torn down the subtree that threw, and whatever module-level state
 * put it there (a half-hydrated context, a bad cached shape) is still
 * there; re-rendering the same tree usually just throws again and
 * turns one crash into a loop. A full document reload is the honest
 * reset. On native there is no document to reload, so the button
 * remounts the subtree instead — the best available answer there.
 */

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Route params are scrubbed inside the reporter, not here — see
    // client-error-reporter.ts. They carry documentId.
    reportClientError(error, {
      origin: 'render',
      componentStack: info.componentStack ?? undefined,
    });
  }

  private handleReset = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
      return;
    }
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <View style={styles.page}>
        <View style={styles.block}>
          <Text style={styles.title}>页面出了点问题</Text>
          {/* No error text, no stack: it would be English and minified,
              and the only thing it could tell a patient is that
              something they cannot act on went wrong. What they need to
              know is that their data is safe on the server. */}
          <Text style={styles.body}>
            这一页没能正常显示，已经记录下来了。你已经保存和上传的内容都在，重新打开就能继续。
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重新加载"
            onPress={this.handleReset}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          >
            <Text style={styles.buttonLabel}>重新加载</Text>
          </Pressable>
          <Text style={styles.hint}>如果反复出现，请在「关于我们」里联系我们。</Text>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: COLOR.paper,
    justifyContent: 'center',
    paddingHorizontal: SPACE.gutter,
  },
  block: {
    gap: SPACE.lg,
  },
  title: {
    ...TYPE.title,
    color: COLOR.ink,
  },
  body: {
    ...TYPE.body,
    color: COLOR.inkSoft,
  },
  button: {
    // COMFORTABLE_TOUCH_TARGET rather than the 48pt floor: this is the
    // only control on the screen and the hand pressing it may be a
    // weak one (see lib/a11y.ts).
    minHeight: COMFORTABLE_TOUCH_TARGET,
    borderRadius: RADIUS.control,
    backgroundColor: COLOR.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE.xl,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonLabel: {
    ...TYPE.bodyStrong,
    color: COLOR.onAccent,
  },
  hint: {
    ...TYPE.caption,
    color: COLOR.inkMuted,
  },
});
