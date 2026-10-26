import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createZorroStopStoryboard } from '../core/zorro-test';
import { ZorroStopTestPanel, idleSetupError } from './ZorroStopTestPanel';

describe('props-off idle run panel', () => {
  it('shows one concise run control and blocks it without a connected aircraft', () => {
    const html = renderToStaticMarkup(<ZorroStopTestPanel project={createZorroStopStoryboard()} now={0} serviceUnavailable={false} onSnapshot={() => {}} />);
    expect(html).toContain('Run storyboard</button>');
    expect(html).toContain('Connect a physical drone to begin.');
    expect(html).not.toContain('Zorro');
    expect(html).toContain('disabled=""');
  });
  it('shows the measured auto-disarm delay when it blocks a 20-second run', () => {
    const parameters = ['RC6_OPTION', 'DISARM_DELAY'].map((name, index) => ({
      name, value: index === 0 ? 31 : 10, type: 2, index, count: 2, receivedAt: 100, revision: 1,
    }));
    expect(idleSetupError({ aircraftId: 'one', startedAt: 100, state: 'partial', expected: 2, received: 2, parameters }, 100, 100))
      .toContain('10 seconds');
  });
  it('distinguishes an unread skip-check parameter from skipped checks', () => {
    const parameters = Object.entries({ RC6_OPTION: 31, DISARM_DELAY: 30, MOT_SPIN_ARM: 0.1 }).map(([name, value], index) => ({
      name, value, type: 9, index, count: 4, receivedAt: 100, revision: 1,
    }));
    const snapshot = { aircraftId: 'one', startedAt: 100, state: 'partial' as const, expected: 4, received: 3, parameters };
    expect(idleSetupError(snapshot, 100, 100)).toContain('have not been read');
    expect(idleSetupError({ ...snapshot, parameters: [...parameters, {
      name: 'ARMING_SKIPCHK', value: 1, type: 9, index: 3, count: 4, receivedAt: 100, revision: 1,
    }] }, 100, 100)).toContain('must be cleared');
  });
});
