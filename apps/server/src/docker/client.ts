/**
 * dockerode singleton. Honors DOCKER_HOST (e.g. a tecnativa/docker-socket-proxy
 * endpoint); otherwise talks to the mounted UNIX socket.
 *
 * SECURITY: the Docker socket is root-equivalent. Nothing in this file logs
 * request bodies or credentials.
 */

import Docker from "dockerode";
import type { Config } from "../config.ts";

const DEFAULT_SOCKET = "/var/run/docker.sock";
const DEFAULT_TCP_PORT = 2375;

let singleton: Docker | undefined;

function optionsFromDockerHost(dockerHost: string): Docker.DockerOptions {
  const url = new URL(dockerHost);
  if (url.protocol === "unix:") {
    return { socketPath: url.pathname };
  }
  const port = Number.parseInt(url.port, 10);
  return {
    protocol: url.protocol === "https:" ? "https" : "http",
    host: url.hostname,
    port: Number.isInteger(port) ? port : DEFAULT_TCP_PORT,
  };
}

/** Returns the process-wide dockerode client, constructing it on first use. */
export function getDocker(config: Config): Docker {
  if (singleton !== undefined) return singleton;
  singleton = config.dockerHost
    ? new Docker(optionsFromDockerHost(config.dockerHost))
    : new Docker({ socketPath: DEFAULT_SOCKET });
  return singleton;
}
