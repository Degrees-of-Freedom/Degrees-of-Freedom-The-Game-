import { describe, expect, it } from 'vitest';
import { analyzeGame } from '../game/analysis';
import { exampleModel } from '../game/examples';
import { LEVELS } from '../game/levels';
import { computeLoadPath, traceToGround } from './loadPath';

describe('force-weighted load path', () => {
  it('routes a reference tower to a support and reports support shares', async () => {
    const result=await analyzeGame(exampleModel('tower1')!, LEVELS.tower1);
    const path=computeLoadPath(result, 0)!;
    expect(path.members.size).toBe(result.ctx!.els.length);
    expect(path.shares.reduce((sum,s)=>sum+s.fraction,0)).toBeCloseTo(1);
    const trace=traceToGround(path,'4,4,6');
    expect(trace.end).not.toBeNull();
    expect(trace.members.size).toBeGreaterThan(0);
  });
  it('rejects a missing load combination or failed analysis', async () => {
    const result=await analyzeGame({members:[],attrs:{},nextId:1},LEVELS.sandbox);
    expect(computeLoadPath(result,0)).toBeNull();
    expect(computeLoadPath(result,99)).toBeNull();
  });
});
