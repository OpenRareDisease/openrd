import { normalizeStoredMetadata, synthesizeLegacyToolCalls } from '../metadata';

describe('normalizeStoredMetadata', () => {
  it('returns undefined for null / non-object input', () => {
    expect(normalizeStoredMetadata(null)).toBeUndefined();
    expect(normalizeStoredMetadata(undefined)).toBeUndefined();
    expect(normalizeStoredMetadata('not an object')).toBeUndefined();
    expect(normalizeStoredMetadata(42)).toBeUndefined();
  });

  it('passes through the rich shape without modification', () => {
    const rich = {
      toolCalls: [
        { name: 'a', toolCallId: 'c1', status: 'ok' as const, chunkCount: 3, latencyMs: 100 },
      ],
      fieldsUsed: ['gender'],
      usedPersonalData: true,
      citations: [
        {
          chunkId: 'k1',
          source: 'medical_kb',
          sourceFile: 'doc.md',
          chunkIndex: 0,
          snippet: 'snip',
        },
      ],
    };
    expect(normalizeStoredMetadata(rich)).toEqual({
      toolCalls: rich.toolCalls,
      fieldsUsed: ['gender'],
      usedPersonalData: true,
      citations: rich.citations,
    });
  });

  it('migrates a legacy string[] under toolsCalled into legacyToolNames', () => {
    // Stored chats from before ToolCallTrace landed only have tool
    // names. The renderer needs them under `legacyToolNames` so it
    // synthesises minimal trace rows instead of pretending the
    // chunkCount/latency data exists.
    const legacy = {
      toolsCalled: ['search_medical_kb', 'get_my_profile'],
      fieldsUsed: ['ageGroup'],
      usedPersonalData: false,
      citations: [],
    };
    const out = normalizeStoredMetadata(legacy);
    expect(out?.legacyToolNames).toEqual(['search_medical_kb', 'get_my_profile']);
    expect(out?.toolCalls).toBeUndefined();
    expect(out?.fieldsUsed).toEqual(['ageGroup']);
    expect(out?.usedPersonalData).toBe(false);
  });

  it('drops malformed individual fields without nuking the rest', () => {
    // Defensive: a single corrupted field (string instead of array)
    // shouldn't wipe the whole metadata. Drop the bad field; keep
    // the rest.
    const dirty = {
      toolCalls: 'wat',
      toolsCalled: ['kept'],
      fieldsUsed: { not: 'an array' },
      usedPersonalData: 'truthy-but-not-bool',
      citations: [{ chunkId: 'k1', source: 's', sourceFile: 'f', chunkIndex: 0, snippet: '' }],
    };
    const out = normalizeStoredMetadata(dirty);
    expect(out?.toolCalls).toBeUndefined();
    expect(out?.legacyToolNames).toEqual(['kept']);
    expect(out?.fieldsUsed).toBeUndefined();
    expect(out?.usedPersonalData).toBeUndefined();
    expect(out?.citations).toHaveLength(1);
  });

  it('filters non-string entries out of the legacy toolsCalled array', () => {
    const dirty = { toolsCalled: ['ok', 42, null, 'also-ok'] };
    expect(normalizeStoredMetadata(dirty)?.legacyToolNames).toEqual(['ok', 'also-ok']);
  });
});

describe('synthesizeLegacyToolCalls', () => {
  it('returns [] for undefined / empty input', () => {
    expect(synthesizeLegacyToolCalls(undefined)).toEqual([]);
    expect(synthesizeLegacyToolCalls([])).toEqual([]);
  });

  it('fills the standard defaults for each name (status ok, 0 chunks, null latency)', () => {
    const out = synthesizeLegacyToolCalls(['search_medical_kb']);
    expect(out).toEqual([
      {
        name: 'search_medical_kb',
        toolCallId: 'legacy-0-search_medical_kb',
        status: 'ok',
        chunkCount: 0,
        latencyMs: null,
      },
    ]);
  });

  it('produces distinct toolCallIds for duplicate names (multi-query-rewrite path)', () => {
    // Regression for the bot finding: the multi-query-rewrite path
    // emits `search_medical_kb` once per rewritten query, so a
    // legacy stored chat can carry the same name twice. Without
    // `${idx}-${name}` keying, React would see two list children
    // with the same key and log a warning. Pin uniqueness via a
    // Set count so a future refactor that drops `${idx}` from the
    // template trips this assertion.
    const out = synthesizeLegacyToolCalls([
      'search_medical_kb',
      'search_medical_kb',
      'search_medical_kb',
    ]);
    const ids = out.map((c) => c.toolCallId);
    expect(ids).toEqual([
      'legacy-0-search_medical_kb',
      'legacy-1-search_medical_kb',
      'legacy-2-search_medical_kb',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('preserves the order names arrived in', () => {
    // The trace cards render in input order; if the synthesis ever
    // sorted or deduped names by content, the displayed sequence
    // would no longer match what the user actually saw the first
    // time. Pin it.
    const out = synthesizeLegacyToolCalls(['c', 'a', 'b', 'a']);
    expect(out.map((c) => c.name)).toEqual(['c', 'a', 'b', 'a']);
  });
});
