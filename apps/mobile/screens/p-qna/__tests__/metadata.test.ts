import { normalizeStoredMetadata } from '../metadata';

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
