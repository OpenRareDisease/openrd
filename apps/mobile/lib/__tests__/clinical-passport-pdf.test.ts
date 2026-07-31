import { _renderVisitPrepHtml } from '../clinical-passport-pdf';

// The exported PDF is the one artefact that leaves the app and reaches
// a clinician. It used to `escapeHtml` the AI note, which is exactly
// the wrong transform: escaping guarantees every `**`, `#` and `|`
// survives onto the printout.
describe('renderVisitPrepHtml', () => {
  it('turns markdown into structure instead of preserving it', () => {
    const html = _renderVisitPrepHtml(
      [
        '## 这段时间的变化',
        '- **上楼计时**：12 秒 → 15 秒',
        '1. 是否需要复查 MRI',
        '| 项目 | 结果 |',
        '|---|---|',
        '| FVC | 78% |',
      ].join('\n'),
    );

    expect(html).toContain('<h3 class="visit-prep-heading">这段时间的变化</h3>');
    expect(html).toContain('<strong>上楼计时</strong>');
    // The ordinal survives: 建议问医生 is a numbered list of things to
    // raise in the appointment, and a <ul> would flatten it to bullets.
    expect(html).toContain('<span class="visit-prep-marker">1.</span>');
    expect(html).toContain('FVC');
    expect(html).not.toContain('**');
    expect(html).not.toContain('##');
    expect(html).not.toMatch(/\|-+\|/);
  });

  it('still escapes html from the model', () => {
    const html = _renderVisitPrepHtml('注意 <script>alert(1)</script> 这段');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  // A model can put any string inside `(...)`.
  it('drops a non-http link target rather than emitting it', () => {
    const html = _renderVisitPrepHtml('[点这里](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('点这里');
  });
});
