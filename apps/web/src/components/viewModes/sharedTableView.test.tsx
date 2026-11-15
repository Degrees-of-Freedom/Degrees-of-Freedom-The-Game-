import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ViewModesPanel} from './ViewModesPanel';
import {sharedTableLegends, sharedTableViewReducer, SHARED_TABLE_VIEW} from './useSharedTableView';
import {activeModes, overlayLayer} from '../../viewer/viewModes';

describe('scheduled Shared table display state', () => {
  it('uses combined educational defaults and the actual accessible eye menu', () => {
    expect(overlayLayer(SHARED_TABLE_VIEW)).toBe('combined');
    expect(activeModes(SHARED_TABLE_VIEW, true)).toEqual(['loadPath', 'deflected', 'joints', 'reactions']);
    const html = renderToStaticMarkup(<ViewModesPanel modes={SHARED_TABLE_VIEW} jointsShown open scale={1}
      onOpenChange={() => {}} onPress={() => {}} dispatch={() => {}} />);
    expect(html).toContain('aria-label="View modes, 4 active"');
    expect(html).toContain('aria-label="View modes"');
    expect(html.match(/class="view-tile-main"/g)).toHaveLength(8);
    expect(html).toContain('role="switch" checked=""');
  });

  it('keeps inspector overlay and tile changes in one reducer and resets to Shared defaults', () => {
    let state = sharedTableViewReducer(SHARED_TABLE_VIEW, {type: 'toggle', mode: 'shadow'});
    expect(overlayLayer(state)).toBe('shadow-path');
    state = sharedTableViewReducer(state, {type: 'overlay', layer: 'shape'});
    expect(state).toMatchObject({deflection: 'shape', loadPath: false});
    state = sharedTableViewReducer(state, {type: 'shearAxis', axis: 2});
    state = sharedTableViewReducer(state, {type: 'labels', on: false});
    state = sharedTableViewReducer(state, {type: 'clear'});
    expect(activeModes(state, false)).toEqual([]);
    expect(state.labels).toBe(false);
    expect(sharedTableViewReducer(state, {type: 'reset'})).toEqual(SHARED_TABLE_VIEW);
  });

  it('does not publish quantitative keys while awaiting the scheduled checkpoint', () => {
    const legends = sharedTableLegends({modes: {...SHARED_TABLE_VIEW, shear: true}, jointsShown: true,
      response: {state: 'pending'}, scale: 500, jointCount: 2, peakM: 3, maxForceKN: 999, diagrams: []},
    'Current board awaits the next checkpoint');
    for (const legend of legends.filter(legend => legend.id !== 'joints')) {
      expect(legend.status).toBe('Current board awaits the next checkpoint');
      expect(legend.swatches).toEqual([]);
      expect(legend.ramp).toBeUndefined();
    }
    expect(legends.find(legend => legend.id === 'joints')?.swatches.length).toBeGreaterThan(0);
  });
});
