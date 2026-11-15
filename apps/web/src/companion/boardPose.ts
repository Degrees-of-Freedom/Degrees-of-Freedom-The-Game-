import { REST, type MotionName, type Pose } from "./motion";

/**
 * The board companion's current pose, shared with its second view: the model
 * standing on the islet in the 3D scene (`viewer/companionFigure.ts`).
 *
 * The companion control owns the animator, the clip choice and the idle
 * schedule. Its animator publishes every sampled pose here, and the scene
 * reads the latest one each frame, so the badge and the islet figure always
 * move from the same clip. Only one board companion is mounted at a time;
 * a control that unmounts publishes rest so the islet figure settles.
 */
export interface BoardPose {
  readonly pose: Pose;
  /** The clip being played, or null at rest. */
  readonly motion: MotionName | null;
}

let latest: BoardPose = { pose: REST, motion: null };

export function publishBoardPose(pose: Pose, motion: MotionName | null) {
  latest = { pose, motion };
}

export function boardPose(): BoardPose {
  return latest;
}
