import {
  reportClientError,
  scrubRoute,
  setClientErrorReporter,
  type ClientErrorReport,
} from '../client-error-reporter';

describe('scrubRoute', () => {
  it('drops the query string — it carries documentId', () => {
    expect(scrubRoute('/p-report_detail?documentId=8f0c1e2a')).toBe('/p-report_detail');
  });

  it('drops a hash tail too, without enumerating what might be in it', () => {
    expect(scrubRoute('/p-timeline_detail#eventId=42')).toBe('/p-timeline_detail');
  });

  it('drops both when the query comes first', () => {
    expect(scrubRoute('/p-report_detail?documentId=abc#frag')).toBe('/p-report_detail');
  });

  it('leaves a bare path alone', () => {
    expect(scrubRoute('/p-home')).toBe('/p-home');
  });

  it('passes undefined through rather than inventing a route', () => {
    expect(scrubRoute(undefined)).toBeUndefined();
  });
});

describe('reportClientError', () => {
  const received: ClientErrorReport[] = [];

  beforeEach(() => {
    received.length = 0;
    setClientErrorReporter((report) => {
      received.push(report);
    });
  });

  afterEach(() => {
    setClientErrorReporter(null);
  });

  it('records the message, origin and component stack', () => {
    reportClientError(new Error('Cannot read properties of undefined'), {
      origin: 'render',
      componentStack: '\n    in ReportDetail',
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      origin: 'render',
      message: 'Cannot read properties of undefined',
      componentStack: '\n    in ReportDetail',
    });
    expect(Date.parse(received[0].occurredAt)).not.toBeNaN();
  });

  it('never lets a route param reach the reporter', () => {
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { pathname: '/p-report_detail', search: '?documentId=8f0c1e2a' },
    });

    try {
      reportClientError(new Error('boom'), { origin: 'render' });
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }

    expect(received[0].route).toBe('/p-report_detail');
    expect(JSON.stringify(received[0])).not.toContain('8f0c1e2a');
  });

  it('stringifies a non-Error throw instead of dropping it', () => {
    reportClientError('render exploded', { origin: 'render' });
    expect(received[0].message).toBe('render exploded');
  });

  it('swallows a reporter that throws — a crash handler must not become the crash', () => {
    setClientErrorReporter(() => {
      throw new Error('reporter is down');
    });

    expect(() => reportClientError(new Error('boom'), { origin: 'render' })).not.toThrow();
  });
});
