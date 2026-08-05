import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { MIN_TOUCH_TARGET } from '../../../lib/a11y';
import { COLOR, HAIRLINE, MOTION, RADIUS, SPACE, TYPE } from '../../../lib/design';

/**
 * In-app confirmations and toasts, replacing `Alert.alert`.
 *
 * Why this exists
 * ---------------
 * `react-native-web`'s Alert is, verbatim:
 *
 *     class Alert { static alert() {} }
 *
 * An empty function. Production for this product is the Expo web
 * export, so every one of the 23 `Alert.alert` call sites in this app
 * was silent on the platform patients actually use. Saving a record
 * appeared to do nothing. Confirming a logout appeared to do nothing.
 * The account-deletion confirmation — a destructive, irreversible
 * action — appeared to do nothing, which is worse than silent: the
 * user presses again.
 *
 * Nothing warned about it. It is not a missing feature you would find
 * by reading the code either, because `Alert.alert(...)` is a
 * perfectly valid call that returns undefined.
 *
 * What this replaces it with
 * --------------------------
 *  - `confirm()` — a modal with real buttons, for anything the user
 *    must agree to before it happens. Returns a promise so the caller
 *    reads top-to-bottom instead of inverting into callbacks.
 *  - `notify()` — a banner for "it happened", which is the majority of
 *    the old Alert traffic and never needed to be modal at all.
 *
 * Both render inside the app, so they work identically on web, iOS and
 * Android, and they inherit lib/design.ts rather than the OS dialog.
 */

interface ConfirmOptions {
  title: string;
  message?: string;
  /** Label for the affirmative button. */
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * Marks the affirmative button as the dangerous one: alert fill, and
   * the action row becomes a full-width stack with the dangerous
   * action on top and cancel below it, `SPACE.lg` apart.
   *
   * This used to claim it "puts it second so a destructive action is
   * never the default position" while the code only changed the fill
   * colour — both buttons still sat in the same flex-end row, roughly
   * 62–80pt wide and `SPACE.sm` (8pt) apart. That is precisely the
   * "never shrink a target to fit a row" rule in lib/a11y.ts, on the
   * seven call sites where a mis-tap costs the most: logout, delete
   * report, withdraw consent. For a population losing grip and fine
   * motor control, 8pt of separation between 退出 and 取消 is not a
   * choice, it is a coin flip.
   *
   * Stacking is what actually buys the separation — full-width targets
   * mean the horizontal axis stops mattering at all, and 16pt of
   * vertical gap is a deliberate reach rather than a slip. See
   * `dialogActionsStacked` below and the tests in
   * __tests__/AppDialog.test.tsx.
   */
  destructive?: boolean;
}

interface NotifyOptions {
  title: string;
  message?: string;
  tone?: 'success' | 'error' | 'info';
  /** Optional single action, e.g. 「查看我的档案」. */
  action?: { label: string; onPress: () => void };
}

interface DialogApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  notify: (options: NotifyOptions) => void;
}

const DialogContext = createContext<DialogApi | null>(null);

/**
 * Read the dialog API.
 *
 * Throws rather than returning a no-op when the provider is missing —
 * a silent no-op is the exact failure this module exists to remove.
 */
export const useAppDialog = (): DialogApi => {
  const api = useContext(DialogContext);
  if (!api) {
    throw new Error('useAppDialog must be used inside <AppDialogProvider>');
  }
  return api;
};

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/**
 * The dialog card, scaled in on a spring.
 *
 * `Modal animationType="fade"` crossfades the whole overlay, which
 * reads as the screen being swapped rather than as something being
 * presented over it. iOS scales presented content; this restores that
 * without giving up the modal's own backdrop handling.
 */
const PresentedCard = ({ children }: { children: ReactNode }) => {
  const scale = useSharedValue<number>(MOTION.presentScaleFrom);
  useEffect(() => {
    scale.value = withSpring(1, MOTION.present);
    return () => {
      scale.value = MOTION.presentScaleFrom;
    };
  }, [scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View
      style={[styles.dialog, style]}
      entering={FadeIn.duration(MOTION.enter)}
      exiting={FadeOut}
    >
      {children}
    </Animated.View>
  );
};

export const AppDialogProvider = ({ children }: { children: ReactNode }) => {
  const [confirmState, setConfirmState] = useState<PendingConfirm | null>(null);
  const [notice, setNotice] = useState<NotifyOptions | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setConfirmState({ ...options, resolve });
      }),
    [],
  );

  const notify = useCallback((options: NotifyOptions) => {
    setNotice(options);
  }, []);

  const settle = (value: boolean) => {
    setConfirmState((current) => {
      current?.resolve(value);
      return null;
    });
  };

  const api = useMemo(() => ({ confirm, notify }), [confirm, notify]);

  const toneColor =
    notice?.tone === 'error' ? COLOR.alert : notice?.tone === 'success' ? COLOR.good : COLOR.accent;

  // Destructive confirmations stack; everything else keeps the compact
  // trailing row. See the `destructive` doc comment for why.
  const isDestructive = confirmState?.destructive === true;

  const cancelButton = (
    <TouchableOpacity
      key="cancel"
      style={[
        styles.dialogButton,
        styles.dialogButtonGhost,
        isDestructive && styles.dialogButtonBlock,
      ]}
      accessibilityRole="button"
      onPress={() => settle(false)}
    >
      <Text style={styles.dialogButtonGhostText}>{confirmState?.cancelLabel ?? '取消'}</Text>
    </TouchableOpacity>
  );

  const affirmButton = (
    <TouchableOpacity
      key="affirm"
      style={[
        styles.dialogButton,
        isDestructive ? styles.dialogButtonDanger : styles.dialogButtonPrimary,
        isDestructive && styles.dialogButtonBlock,
      ]}
      accessibilityRole="button"
      onPress={() => settle(true)}
    >
      <Text style={styles.dialogButtonPrimaryText}>{confirmState?.confirmLabel ?? '确定'}</Text>
    </TouchableOpacity>
  );

  return (
    <DialogContext.Provider value={api}>
      {children}

      <Modal
        visible={confirmState !== null}
        transparent
        animationType="fade"
        // Android back / web Esc must resolve the promise, not leave
        // the caller awaiting forever.
        onRequestClose={() => settle(false)}
      >
        <View style={styles.overlay}>
          <PresentedCard>
            <Text style={styles.dialogTitle}>{confirmState?.title}</Text>
            {confirmState?.message ? (
              <ScrollView style={styles.dialogBody}>
                <Text style={styles.dialogMessage}>{confirmState.message}</Text>
              </ScrollView>
            ) : null}
            {/* Dangerous action first in the stack, so it is also first
                in reading and focus order — the patient meets what the
                dialog is asking before the way out of it, instead of
                tabbing past 取消 into 删除. */}
            <View style={isDestructive ? styles.dialogActionsStacked : styles.dialogActions}>
              {isDestructive ? [affirmButton, cancelButton] : [cancelButton, affirmButton]}
            </View>
          </PresentedCard>
        </View>
      </Modal>

      <Modal
        visible={notice !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setNotice(null)}
      >
        <View style={styles.overlay}>
          <PresentedCard>
            <View style={[styles.noticeRule, { backgroundColor: toneColor }]} />
            <Text style={styles.dialogTitle}>{notice?.title}</Text>
            {/* Scrollable for the same reason confirm's body is: the
                longest copy in the app lands here — a per-file failure
                list from a batch upload runs one line per file, and an
                un-scrollable body silently clips the files the patient
                most needs to see. */}
            {notice?.message ? (
              <ScrollView style={styles.dialogBody}>
                <Text style={styles.dialogMessage}>{notice.message}</Text>
              </ScrollView>
            ) : null}
            <View style={styles.dialogActions}>
              {notice?.action ? (
                <TouchableOpacity
                  style={[styles.dialogButton, styles.dialogButtonGhost]}
                  accessibilityRole="button"
                  onPress={() => {
                    const run = notice.action?.onPress;
                    setNotice(null);
                    run?.();
                  }}
                >
                  <Text style={styles.dialogButtonGhostText}>{notice.action.label}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.dialogButton, styles.dialogButtonPrimary]}
                accessibilityRole="button"
                onPress={() => setNotice(null)}
              >
                <Text style={styles.dialogButtonPrimaryText}>知道了</Text>
              </TouchableOpacity>
            </View>
          </PresentedCard>
        </View>
      </Modal>
    </DialogContext.Provider>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACE.xl,
    backgroundColor: 'rgba(23, 39, 46, 0.32)',
  },
  dialog: {
    width: '100%',
    maxWidth: 340,
    gap: SPACE.md,
    padding: SPACE.xl,
    borderRadius: RADIUS.surface,
    backgroundColor: COLOR.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
  },
  noticeRule: {
    width: 28,
    height: 2,
    borderRadius: 1,
  },
  dialogTitle: {
    ...TYPE.title,
  },
  dialogBody: {
    maxHeight: 260,
  },
  dialogMessage: {
    ...TYPE.body,
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACE.sm,
    paddingTop: SPACE.xs,
  },
  /** Destructive layout. `stretch` is what makes each button the full
   *  width of the card, and the gap is `lg` rather than `sm` so the
   *  two targets are a deliberate reach apart. Both are asserted in
   *  __tests__/AppDialog.test.tsx — this is the whole fix, so it does
   *  not get to regress quietly into a row again. */
  dialogActionsStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: SPACE.lg,
    paddingTop: SPACE.sm,
  },
  dialogButton: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: SPACE.lg,
    borderRadius: RADIUS.control,
  },
  /** Full-width variant: the label has to be centred by hand once the
   *  button stops being sized by its own content. */
  dialogButtonBlock: {
    alignItems: 'center',
  },
  dialogButtonGhost: {
    borderWidth: HAIRLINE,
    borderColor: COLOR.lineStrong,
    backgroundColor: COLOR.surface,
  },
  dialogButtonGhostText: {
    ...TYPE.label,
  },
  dialogButtonPrimary: {
    backgroundColor: COLOR.accent,
  },
  dialogButtonDanger: {
    backgroundColor: COLOR.alert,
  },
  dialogButtonPrimaryText: {
    ...TYPE.label,
    color: COLOR.onAccent,
  },
});
