import type { BrandConfig } from "../brand/types.ts";

/** Hono environment: per-request variables set by middleware. */
export interface AppEnv {
  Variables: {
    csrf: string;
    brand: BrandConfig;
  };
}
