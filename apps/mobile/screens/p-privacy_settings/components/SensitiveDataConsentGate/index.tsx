import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Modal, ScrollView } from 'react-native';
import styles from './styles';
import { apiRequest, ApiError, recordLegalAcceptance } from '../../../../lib/api';
import {
  GUARDIAN_CONSENT_SECTIONS,
  GUARDIAN_CONSENT_TITLE,
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_VERSIONS,
  SENSITIVE_DATA_CONSENT_SECTIONS,
  SENSITIVE_DATA_CONSENT_TITLE,
  type LegalSection,
} from '../../../../lib/legal-content';
import Button from '../../../common/Button';

/**
 * 敏感个人信息处理单独同意 — the PIPL Art. 29 gate.
 *
 * WHY THIS IS A SEPARATE STEP AND NOT A CLAUSE IN THE REGISTRATION
 * AGREEMENT: Art. 29 requires 单独同意 for 敏感个人信息, and the reports
 * this app takes are as sensitive as personal information gets — MRI
 * and genetic test scans, their OCR text, D4Z4 repeat counts. A tick
 * box at registration that says「我已阅读并同意《用户协议》和《隐私政策》」
 * is a bundled consent; folding health and genetic data into it is
 * exactly the practice the article exists to forbid. So the ask lands
 * at the first report upload, which is also the first moment any of
 * that data would actually leave the patient's device — the point where
 * the question is concrete rather than hypothetical.
 *
 * WHY IT LIVES HERE: this folder owns the app's consent surfaces (the
 * seven toggles, the AI授权 levels, the audit trail entry point), and
 * the copy it shows comes from the same lib/legal-content.ts source as
 * the register modal. It is imported by the upload screens rather than
 * belonging to them; it is a candidate for screens/common if a third
 * caller appears.
 *
 * USAGE — the gate is a question, so callers await it:
 *
 *   const { gateProps, ensureSensitiveDataConsent } = useSensitiveDataConsentGate();
 *   …
 *   const consented = await ensureSensitiveDataConsent();
 *   if (!consented) return;            // user declined; upload nothing
 *   await uploadDocument(file);
 *   …
 *   <SensitiveDataConsentGate {...gateProps} />
 */

/**
 * The documents this gate can ask for.
 *
 * Two now — the Art. 29 sensitive-data consent before the first report
 * upload, and the Art. 31 children's rules during profile registration
 * when the birth date puts the patient under 14. They are one component
 * rather than two because everything that is hard here is shared: fail
 * closed on a failed read, fail closed on a failed write, resolve the
 * pending promise when the screen unmounts, and never let 拒绝 be a
 * smaller target than 同意. A second copy would get one of those wrong.
 */
const GATE_DOCUMENTS = {
  [LEGAL_DOCUMENTS.sensitiveData]: {
    title: SENSITIVE_DATA_CONSENT_TITLE,
    sections: SENSITIVE_DATA_CONSENT_SECTIONS,
    acceptLabel: '同意并继续',
    acceptHint: '记录你对敏感个人信息处理的单独同意，然后继续上传报告',
    declineLabel: '暂不同意',
  },
  [LEGAL_DOCUMENTS.guardianConsent]: {
    title: GUARDIAN_CONSENT_TITLE,
    sections: GUARDIAN_CONSENT_SECTIONS,
    acceptLabel: '我是监护人，代为同意',
    acceptHint: '记录监护人对儿童个人信息处理规则的同意，然后继续建档',
    declineLabel: '返回修改出生日期',
  },
} satisfies Record<
  string,
  {
    title: string;
    sections: LegalSection[];
    acceptLabel: string;
    acceptHint: string;
    declineLabel: string;
  }
>;

type GateDocumentId = keyof typeof GATE_DOCUMENTS;

export interface SensitiveDataConsentGateProps {
  document: GateDocumentId;
  visible: boolean;
  busy: boolean;
  error: string | null;
  onAccept: () => void;
  onDecline: () => void;
}

const SensitiveDataConsentGate: React.FC<SensitiveDataConsentGateProps> = ({
  document,
  visible,
  busy,
  error,
  onAccept,
  onDecline,
}) => {
  const copy = GATE_DOCUMENTS[document];
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Android's hardware back must land on 拒绝, not on a dismissed
      // modal that leaves the awaiting promise hanging forever.
      onRequestClose={onDecline}
    >
      <View style={styles.overlay}>
        <View style={styles.card} accessibilityViewIsModal accessibilityLabel={copy.title}>
          <Text style={styles.title} accessibilityRole="header">
            {copy.title}
          </Text>
          <ScrollView style={styles.body}>
            {copy.sections.map((section) => (
              <View key={section.title} style={styles.section}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <Text style={styles.sectionBody}>{section.body}</Text>
              </View>
            ))}
          </ScrollView>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {/* 同意 is NOT the visually dominant button by accident of being
            first: both options are full-width and equally reachable,
            because a consent screen whose refusal is a small grey link
            is a dark pattern, and this one governs genetic data. */}
          <Button
            label={copy.acceptLabel}
            variant="prominent"
            fullWidth
            busy={busy}
            onPress={onAccept}
            accessibilityHint={copy.acceptHint}
          />
          <View style={styles.declineRow}>
            <Button
              label={copy.declineLabel}
              variant="plain"
              fullWidth
              disabled={busy}
              onPress={onDecline}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default SensitiveDataConsentGate;

interface AcceptanceSummary {
  acceptances: Array<{ document: string; version: string; acceptedAt: string }>;
}

/**
 * State machine behind the gate.
 *
 * `ensureSensitiveDataConsent()` resolves true when the ledger already
 * carries an acceptance (at ANY version — a revised text should prompt
 * a re-read, not retroactively invalidate reports already uploaded),
 * otherwise it shows the document and resolves with what the user
 * chose.
 *
 * It fails CLOSED in both directions that matter:
 *
 *  - If the status read fails (offline, 500), we ask rather than
 *    assume. Uploading a genetic report because a GET timed out is the
 *    one outcome that cannot be undone.
 *  - If the acceptance WRITE fails, the promise does not resolve true
 *    and the modal stays up with the error. An upload that proceeded on
 *    an unrecorded consent is the exact defect this whole change
 *    exists to remove.
 */
export const useSensitiveDataConsentGate = (
  document: GateDocumentId = LEGAL_DOCUMENTS.sensitiveData,
) => {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs, not state: these are read inside promise callbacks that
  // close over the render they were created in, and a stale `granted`
  // there would re-ask a user who already consented in this session.
  const grantedRef = useRef(false);
  const resolverRef = useRef<((accepted: boolean) => void) | null>(null);

  const settle = useCallback((accepted: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setVisible(false);
    setBusy(false);
    resolve?.(accepted);
  }, []);

  // A screen unmounted mid-question (navigation away, a back gesture)
  // would otherwise leave the caller's `await` pending for the life of
  // the app, and with it whatever upload flow was holding the file.
  useEffect(
    () => () => {
      const resolve = resolverRef.current;
      resolverRef.current = null;
      resolve?.(false);
    },
    [],
  );

  const ensureSensitiveDataConsent = useCallback(async (): Promise<boolean> => {
    if (grantedRef.current) {
      return true;
    }
    try {
      const summary = await apiRequest<AcceptanceSummary>('/legal/acceptances');
      if (summary?.acceptances?.some((item) => item.document === document) === true) {
        grantedRef.current = true;
        return true;
      }
    } catch {
      // Fall through to asking. See the fail-closed note above.
    }

    setError(null);
    setVisible(true);
    return new Promise<boolean>((resolve) => {
      // A second call while the modal is already up would orphan the
      // first caller's promise. Resolve it as declined before taking
      // over, so no upload flow is left waiting on a resolver that
      // nothing will ever call.
      resolverRef.current?.(false);
      resolverRef.current = resolve;
    });
  }, [document]);

  const onAccept = useCallback(() => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        // lib/api's recordLegalAcceptance, not a hand-rolled POST: the
        // consent ledger is PIPL evidence and needs exactly one writer,
        // so the request shape cannot drift between the two places that
        // record an acceptance.
        await recordLegalAcceptance(document, LEGAL_DOCUMENT_VERSIONS[document]);
        grantedRef.current = true;
        settle(true);
      } catch (err) {
        setBusy(false);
        setError(err instanceof ApiError ? err.message : '同意记录保存失败，请检查网络后重试');
      }
    })();
  }, [busy, document, settle]);

  const onDecline = useCallback(() => {
    if (busy) return;
    settle(false);
  }, [busy, settle]);

  return {
    ensureSensitiveDataConsent,
    gateProps: {
      document,
      visible,
      busy,
      error,
      onAccept,
      onDecline,
    } as SensitiveDataConsentGateProps,
  };
};
