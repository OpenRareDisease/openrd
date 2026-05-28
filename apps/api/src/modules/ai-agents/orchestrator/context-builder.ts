/**
 * Context builder — turn executed tool results into LLM `tool`
 * messages, dedup citations, and report what patient fields actually
 * made it into the final prompt.
 *
 * Every retrieved chunk flows through `renderChunkForPrompt`, which
 * is the only sanctioned path that produces prompt-ready text from a
 * `RetrievedChunk`. That guarantee is what makes the field-only
 * privacy model from PR #23 enforceable: retrievers can stuff raw
 * data in `metadata.fields` and the renderer is the only place it
 * gets surfaced (after the redactor runs).
 */

import type { ExecutedToolCall } from './executor.js';
import type { AppLogger } from '../../../config/logger.js';
import type { Citation, RetrievedChunk } from '../retrievers/base.js';
import type { RedactionMode } from '../security/allowlist.js';
import { renderChunkForPrompt } from '../security/render.js';

/** Sources whose contribution counts as "personal data". When any of
 *  these appear, the orchestrator surfaces a "本回答用到了你的..."
 *  hint to the UI and the audit row carries usedPersonalData=true. */
const PERSONAL_SOURCES = new Set(['patient_profile', 'patient_reports']);

export interface ToolMessagePayload {
  toolCallId: string;
  toolName: string;
  /** Final rendered text to feed back to the LLM as `tool` content.
   *  Never contains a raw value that wasn't on the allowlist. */
  content: string;
}

export interface BuiltContext {
  toolMessages: ToolMessagePayload[];
  citations: Citation[];
  fieldsUsed: string[];
  usedPersonalData: boolean;
}

export interface BuildContextOptions {
  mode: RedactionMode;
  logger: AppLogger;
}

/**
 * Sentinel pair wrapping every retrieved chunk so the LLM can tell
 * tool-returned text apart from system / user instructions. Anything
 * between BEGIN_DOC and END_DOC is reference material; embedded
 * directives like "ignore previous instructions" are part of the
 * document, not commands to follow. Paired with the system-prompt
 * note in run.ts (DEFAULT_SYSTEM_PROMPT) so the model is told this
 * contract explicitly.
 *
 * The delimiters are deliberately verbose ASCII rather than something
 * a passing attacker would type by accident, but we still strip any
 * accidental occurrences inside chunk content as belt-and-braces.
 */
const CHUNK_BEGIN = '<<<BEGIN_DOC_CHUNK>>>';
const CHUNK_END = '<<<END_DOC_CHUNK>>>';

const stripDelimiters = (content: string): string =>
  content.split(CHUNK_BEGIN).join('').split(CHUNK_END).join('');

const renderChunks = (
  chunks: RetrievedChunk[],
  opts: BuildContextOptions,
): { text: string; fieldsUsed: string[] } => {
  if (chunks.length === 0) {
    return { text: '（无内容）', fieldsUsed: [] };
  }
  const sections: string[] = [];
  const fieldsUsedSet = new Set<string>();
  chunks.forEach((chunk, idx) => {
    const rendered = renderChunkForPrompt(chunk, opts);
    if (!rendered.content) return;
    const header = `【片段${idx + 1}】${
      chunk.sourceFile ? `(${chunk.source} / ${chunk.sourceFile})` : `(${chunk.source})`
    }`;
    const safeContent = stripDelimiters(rendered.content);
    sections.push(`${header}\n${CHUNK_BEGIN}\n${safeContent}\n${CHUNK_END}`);
    rendered.fieldsUsed.forEach((f) => fieldsUsedSet.add(f));
  });
  return {
    text: sections.length > 0 ? sections.join('\n\n') : '（无可用内容）',
    fieldsUsed: [...fieldsUsedSet],
  };
};

export const buildContext = (
  executed: ExecutedToolCall[],
  opts: BuildContextOptions,
): BuiltContext => {
  const toolMessages: ToolMessagePayload[] = [];
  const citationByChunk = new Map<string, Citation>();
  const allFieldsUsed = new Set<string>();
  let usedPersonalData = false;

  for (const call of executed) {
    if (call.error || !call.retrieval) {
      // The raw `call.error` can contain DB column names, parameter
      // values, even fragments of patient data (the executor wraps
      // whatever the retriever throws). Reflecting that back into the
      // LLM prompt risks the model echoing it into the user-visible
      // answer. Use a generic message + the toolCallId as the
      // correlation handle; the real detail is in the logs.
      if (call.error) {
        opts.logger.warn(
          { toolCallId: call.toolCallId, tool: call.toolName, error: call.error },
          'tool execution failed; redacted message will be sent to LLM',
        );
      }
      toolMessages.push({
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        content: `tool error (id=${call.toolCallId}): retrieval failed, please answer using general knowledge only`,
      });
      continue;
    }

    const { text, fieldsUsed } = renderChunks(call.retrieval.chunks, opts);
    fieldsUsed.forEach((f) => allFieldsUsed.add(f));
    if (PERSONAL_SOURCES.has(call.retrieval.retrieverId) && call.retrieval.chunks.length > 0) {
      usedPersonalData = true;
    }

    toolMessages.push({
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      content: `${call.display}\n\n${text}`,
    });

    for (const citation of call.retrieval.citations) {
      if (!citationByChunk.has(citation.chunkId)) {
        citationByChunk.set(citation.chunkId, citation);
      }
    }
  }

  return {
    toolMessages,
    citations: [...citationByChunk.values()],
    fieldsUsed: [...allFieldsUsed],
    usedPersonalData,
  };
};
