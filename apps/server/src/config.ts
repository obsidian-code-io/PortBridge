/**
 * Environment parsing + fail-closed validation.
 *
 * The process MUST refuse to boot on invalid config. Every accessor here
 * throws `ConfigError`; `loadConfig()` is called once at bootstrap and any
 * failure aborts startup (see src/index.ts).
 */

export interface PortRange {
  readonly start: number;
  readonly end: number;
}

export interface Config {
  readonly adminToken: string;
  readonly port: number;
  readonly portRange: PortRange;
  readonly defaultTtlMinutes: number;
  readonly maxForwards: number;
  readonly socatImage: string;
  readonly dockerHost: string | undefined;
  readonly dataDir: string;
}

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

const MIN_TOKEN_LENGTH = 16;

/**
 * Default sidecar image. Pin to a digest in production so the image cannot
 * drift under you — override via SOCAT_IMAGE. Verify the digest for your
 * registry before deploy:
 *   docker buildx imagetools inspect alpine/socat:1.8.0.0
 */
const DEFAULT_SOCAT_IMAGE = "alpine/socat:1.8.0.0";

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new ConfigError(`Missing required environment variable: ${name}`);
  }
  return value;
}

function positiveIntEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== raw) {
    throw new ConfigError(`Invalid positive integer for ${name}: "${raw}"`);
  }
  return parsed;
}

function parsePortRange(raw: string): PortRange {
  const match = /^(\d+)-(\d+)$/.exec(raw);
  const startStr = match?.[1];
  const endStr = match?.[2];
  if (startStr === undefined || endStr === undefined) {
    throw new ConfigError(`Malformed PORT_RANGE (expected "start-end"): "${raw}"`);
  }
  const start = Number.parseInt(startStr, 10);
  const end = Number.parseInt(endStr, 10);
  if (start < 1 || end > 65535 || start > end) {
    throw new ConfigError(`Invalid PORT_RANGE bounds (1-65535, start<=end): "${raw}"`);
  }
  return { start, end };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const adminToken = requiredEnv(env, "ADMIN_TOKEN");
  if (adminToken.length < MIN_TOKEN_LENGTH) {
    throw new ConfigError(`ADMIN_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
  }
  const dockerHost = env.DOCKER_HOST;
  return {
    adminToken,
    port: positiveIntEnv(env, "PORT", 8080),
    portRange: parsePortRange(env.PORT_RANGE ?? "30000-30999"),
    defaultTtlMinutes: positiveIntEnv(env, "DEFAULT_TTL_MINUTES", 60),
    maxForwards: positiveIntEnv(env, "MAX_FORWARDS", 50),
    socatImage: env.SOCAT_IMAGE ?? DEFAULT_SOCAT_IMAGE,
    dockerHost: dockerHost === undefined || dockerHost === "" ? undefined : dockerHost,
    dataDir: env.DATA_DIR ?? "/app/data",
  };
}
