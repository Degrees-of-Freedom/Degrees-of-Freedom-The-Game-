/** Build-time settings read by `solver/index.ts`. */
interface ImportMetaEnv {
  /** Address of an OpenSees service to use instead of the in-browser solver. */
  readonly VITE_OPENSEES_URL?: string;
  /** Set to `opensees` to use the service started by `npm run dev:opensees`. */
  readonly VITE_SOLVER?: string;
}
