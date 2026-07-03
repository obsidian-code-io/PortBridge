/** Hono environment: per-request variables set by the auth middleware. */
export interface AppEnv {
  Variables: {
    csrf: string;
  };
}
