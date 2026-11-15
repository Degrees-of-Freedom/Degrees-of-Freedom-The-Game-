import { useCallback, useEffect, useReducer, useState } from 'react';
import { updateSettings, useSettings } from '../../menu/settings';
import { buildLegends, type LegendInput, type ViewLegend } from '../../viewer/viewLegends';
import { DEFAULT_VIEW_MODES, viewModesReducer, type ViewModeAction, type ViewModeId, type ViewModes } from '../../viewer/viewModes';

/** Shared table always exposes the accepted combined response by default. */
export const SHARED_TABLE_VIEW: ViewModes = {
  ...DEFAULT_VIEW_MODES, loadPath: true, shearAxis: 2, momentAxis: 4,
};

export function sharedTableViewReducer(state: ViewModes, action: ViewModeAction): ViewModes {
  return action.type === 'reset' ? SHARED_TABLE_VIEW : viewModesReducer(state, action);
}

/** Derive keys only from quantities already admitted by the checkpoint guard.
 * An enabled tile is a display preference, never permission to start a solve. */
export function sharedTableLegends(input: LegendInput, unavailable?: string): ViewLegend[] {
  return buildLegends(input).map(legend => ({
    ...legend,
    ...(legend.status && unavailable ? {status: unavailable} : {}),
    ...(legend.id === 'loadPath' && !legend.status ? {notes: [...legend.notes,
      'Illustrative combined gravity transfer. No individual-load attribution.']} : {}),
    ...(legend.id === 'instability' && !legend.status ? {notes: [
      'Returned solver modes are separate normalized diagnostic illustrations, not loaded deflection or collapse.']} : {}),
  }));
}

/** Presentation-only state for the scheduled Shared table route. Unlike the
 * experimental on-demand hook this module cannot load or invoke a solver. */
export function useSharedTableView() {
  const settings = useSettings();
  const [state, reduce] = useReducer(sharedTableViewReducer, SHARED_TABLE_VIEW);
  const [panelOpen, setPanelOpen] = useState(false);
  const jointsShown = settings.releaseJointDisplay === 'all';
  const press = useCallback((mode: ViewModeId) => {
    if (mode === 'joints') updateSettings({releaseJointDisplay: jointsShown ? 'selected' : 'all'});
    else reduce({type: 'toggle', mode});
  }, [jointsShown]);
  const dispatch = useCallback((action: ViewModeAction) => {
    if (action.type === 'clear') updateSettings({releaseJointDisplay: 'off'});
    if (action.type === 'reset') updateSettings({releaseJointDisplay: 'all'});
    reduce(action);
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName));
      if (event.key.toLowerCase() !== 'v' || event.ctrlKey || event.metaKey || event.altKey || event.repeat || typing) return;
      event.preventDefault();
      setPanelOpen(open => !open);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return {state, dispatch, press, jointsShown, panelOpen, setPanelOpen};
}
