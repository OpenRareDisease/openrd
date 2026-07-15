import { buildFollowupFeedback } from '../followup-feedback';

const base = {
  stairClimbSeconds: 18.5,
  previousStairClimbSeconds: 19.0,
  sleepScore: 7,
  previousSleepScore: 7,
  totalRecords: 5,
};

describe('buildFollowupFeedback', () => {
  it('reports a faster climb with the correct direction and magnitude', () => {
    const text = buildFollowupFeedback(base);
    expect(text).toContain('上楼比上次快了 0.5 秒');
    expect(text).toContain('睡眠评分与上次持平');
    expect(text).toContain('已累计 5 次日常记录');
  });

  it('reports a slower climb without alarmist framing', () => {
    const text = buildFollowupFeedback({
      ...base,
      stairClimbSeconds: 20.2,
      previousStairClimbSeconds: 19.0,
    });
    expect(text).toContain('上楼比上次慢了 1.2 秒');
    expect(text).toContain('不必焦虑');
  });

  it('treats sub-epsilon deltas as flat — stopwatch noise is not progress', () => {
    const text = buildFollowupFeedback({
      ...base,
      stairClimbSeconds: 18.98,
      previousStairClimbSeconds: 19.0,
    });
    expect(text).toContain('上楼用时与上次基本持平');
  });

  it('first record gets an encouraging baseline message, no comparison', () => {
    const text = buildFollowupFeedback({
      ...base,
      previousStairClimbSeconds: null,
      previousSleepScore: null,
      totalRecords: 1,
    });
    expect(text).toContain('第一条上楼记录已保存');
    expect(text).not.toContain('睡眠评分');
    expect(text).toContain('已累计 1 次日常记录');
  });

  it('sleep deltas report both directions', () => {
    expect(buildFollowupFeedback({ ...base, sleepScore: 9 })).toContain('睡眠评分比上次高 2 分');
    expect(buildFollowupFeedback({ ...base, sleepScore: 4 })).toContain('睡眠评分比上次低 3 分');
  });

  it('totalRecords floors at 1', () => {
    expect(buildFollowupFeedback({ ...base, totalRecords: 0 })).toContain('已累计 1 次日常记录');
  });
});
