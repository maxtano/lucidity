import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StudioHome, type StudioHomeProps } from './StudioHome';

const props: StudioHomeProps = {
  storyboards: [],
  activeId: '',
  onOpen: () => {
    throw new Error('Rendering must not open a storyboard');
  },
  onDelete: () => {
    throw new Error('Rendering must not delete a storyboard');
  },
  onCreate: () => {
    throw new Error('Rendering must not create a storyboard');
  },
  onOpenStarter: () => {
    throw new Error('Rendering must not create or open the starter storyboard');
  },
  onImport: () => {
    throw new Error('Rendering must not import a storyboard');
  },
};

describe('studio home', () => {
  it('leads with storyboards and a compact invitation to open the starter project', () => {
    const html = renderToStaticMarkup(<StudioHome {...props} />);
    expect(html).toContain('Your first storyboard is waiting.');
    expect(html).toContain('Create your first storyboard');
    expect(html).toContain('Import storyboard');
    expect(html).toContain('<h1 id="studio-home-title">Your storyboards</h1>');
    expect(html).toContain('Open storyboard');
    expect(html).toContain('One drone. Props off. Preview, assign, run.');
    expect(html.match(/Your storyboards/g)).toHaveLength(1);
    expect(html).not.toContain('Your next show');
    expect(html).not.toContain('Studio workflow');
    expect(html).not.toContain('Open first drone test');
    expect(html).not.toContain('Your storyboard stays unchanged');
    expect(html).not.toContain('Start bench show');
    expect(html).not.toContain('studio-home-drone-art');
    expect(html).not.toContain('studio-home-bench-art');
    expect(html).not.toContain('Midnight bloom');
  });

  it('renders only supplied storyboards, with escaped names and their actual summaries', () => {
    const html = renderToStaticMarkup(
      <StudioHome
        {...props}
        activeId="mine"
        storyboards={[
          {
            id: 'mine',
            name: 'My <first> show',
            droneCount: 1,
            sceneCount: 3,
            duration: 13,
            updatedAt: 1791806400000,
            bench: true,
          },
          {
            id: 'second',
            name: 'Another idea',
            droneCount: 24,
            sceneCount: 6,
            duration: 120.5,
            updatedAt: NaN,
          },
        ]}
      />
    );
    expect(html).toContain('aria-label="Open My &lt;first&gt; show"');
    expect(html).toContain('aria-label="Open Another idea"');
    expect(html).toContain('aria-label="Delete My &lt;first&gt; show"');
    expect(html).toContain('aria-label="Delete Another idea"');
    expect(html.match(/<article class="studio-home-storyboard">/g)).toHaveLength(2);
    for (const markup of html.match(/<button\b[\s\S]*?<\/button>/g) ?? []) {
      expect(markup.match(/<button\b/g)).toHaveLength(1);
    }
    expect(html.match(/Last opened/g)).toHaveLength(1);
    expect(html).toContain('<dt>Drones</dt><dd>1</dd>');
    expect(html).toContain('<dt>Scenes</dt><dd>3</dd>');
    expect(html).toContain('<dt>Duration</dt><dd>0:13</dd>');
    expect(html).toContain('<dt>Duration</dt><dd>2:01</dd>');
    expect(html).toContain('Saved locally');
    expect(html.match(/Props-off sequence/g)).toHaveLength(1);
    expect(html.match(/Formation study/g)).toHaveLength(1);
    expect(html).not.toContain('Your first storyboard is waiting.');
  });

  it('labels a saved hover storyboard as a simulation study', () => {
    const html = renderToStaticMarkup(<StudioHome {...props} storyboards={[{
      id: 'hover', name: 'One drone · 1 ft hover', droneCount: 1,
      sceneCount: 1, duration: 9, updatedAt: 0, flightStudy: true,
    }]} />);
    expect(html).toContain('Flight study · simulation');
    expect(html).not.toContain('Formation study');
  });

  it('labels a flight candidate with its required field checks', () => {
    const html = renderToStaticMarkup(<StudioHome {...props} storyboards={[{
      id: 'flight', name: 'First live hover', droneCount: 1,
      sceneCount: 1, duration: 11, updatedAt: 0, flightCandidate: true,
    }]} />);
    expect(html).toContain('Flight candidate · field checks required');
    expect(html).not.toContain('preparation only');
  });

  it('keeps New and Import available when embedded in the application shell', () => {
    const html = renderToStaticMarkup(<StudioHome {...props} embedded />);
    expect(html).toContain('New storyboard');
    expect(html).toContain('Import storyboard');
    expect(html).toContain('Open storyboard');
    expect(html).not.toContain('studio-home-brand');
  });

  it('keeps deleted storyboards recoverable without offering to open them', () => {
    const html = renderToStaticMarkup(
      <StudioHome
        {...props}
        deletedStoryboards={[
          {
            id: 'old',
            name: 'Old <show>',
            droneCount: 1,
            sceneCount: 3,
            duration: 13,
            updatedAt: 1791806400000,
          },
        ]}
        onRestore={() => {
          throw new Error('Rendering must not restore a storyboard');
        }}
      />
    );
    expect(html).toContain('<details class="studio-home-deleted">');
    expect(html).toContain('Recently deleted <span>(1)</span>');
    expect(html).toContain('aria-label="Restore Old &lt;show&gt;"');
    expect(html).not.toContain('aria-label="Open Old');
    expect(html).not.toContain('aria-label="Delete Old');
    expect(html).toContain('First drone test');
    expect(html).toContain('Your first storyboard is waiting.');
    expect(html).not.toContain('Permanently delete');
  });
});
