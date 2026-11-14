import { type LevelId, type GameModel } from './model';
import { LEVELS } from './levels';
import { initialModel } from './layout';
export function save(id: LevelId, model: GameModel) {
  try {
    localStorage.setItem(`voxstruct:${id}`, JSON.stringify(model));
  } catch {
    /* optional persistence */
  }
}
export function savedLevel(): LevelId {
  try {
    const id = localStorage.getItem('voxstruct:level');
    if (id && Object.hasOwn(LEVELS, id)) return id as LevelId;
  } catch {
    /* use default */
  }
  return 'tower1';
}
export function load(id: LevelId): GameModel {
  try {
    const raw = localStorage.getItem(`voxstruct:${id}`);
    if (raw) {
      const model = JSON.parse(raw) as GameModel;
      if (
        Array.isArray(model.members) &&
        model.attrs &&
        Number.isInteger(model.nextId)
      )
        return model;
    }
  } catch {
    /* use initial model */
  }
  return initialModel(LEVELS[id]);
}
export function saveLevel(levelId: LevelId) {
  try {
    localStorage.setItem('voxstruct:level', levelId);
  } catch {
    /* optional persistence */
  }
}
