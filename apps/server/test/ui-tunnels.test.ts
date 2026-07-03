import { describe, expect, test } from "bun:test";
import type Docker from "dockerode";
import { deleteForward } from "../src/docker/forwards.ts";
import { managedForwardsTable } from "../src/web/views/forwards.ts";
import type { Forward, ForwardRegistry } from "../src/docker/forward-types.ts";

const tcpForward: Forward = {
  id: "tcp-abc", kind: "tcp", targetName: "web", targetId: "w1", targetPort: 80,
  hostPort: 30000, network: "bridge", createdAt: 1, expiresAt: "never", createdBy: "admin",
};
const tunnelForward: Forward = {
  id: "tun-xyz", kind: "agent-tunnel", targetName: "db", targetId: "d1", targetPort: 5432,
  hostPort: null, network: "bridge", createdAt: 1, expiresAt: "never", createdBy: "admin",
};

function emptyRegistry(): ForwardRegistry {
  return { list: () => [], size: () => 0, has: () => false, close: () => undefined, extend: () => undefined, expireDue: () => [] };
}

describe("managed forwards table", () => {
  test("renders tcp with host:port and agent-tunnel with a 'via agent' badge + kill", async () => {
    const html = String(await managedForwardsTable([tcpForward, tunnelForward], "1.2.3.4", 1));
    expect(html).toContain("1.2.3.4:30000"); // tcp address
    expect(html).toContain("via agent"); // agent-tunnel badge (no host:port)
    expect(html).toContain("db:5432"); // tunnel target
    expect(html).toContain("kill"); // agent-tunnel action
    expect(html).toContain("delete"); // tcp action
  });

  test("empty state points first-time users at the CLI", async () => {
    const html = String(await managedForwardsTable([], "1.2.3.4", 1));
    expect(html).toContain("portbridge tunnel");
  });
});

describe("deleteForward kind-branching (kill vs sidecar removal)", () => {
  test("an agent-tunnel id routes to registry.close(id, reason)", async () => {
    const closed: string[] = [];
    const registry: ForwardRegistry = {
      ...emptyRegistry(),
      has: (id) => id === "tun-xyz",
      close: (id, reason) => (closed.push(`${id}:${reason}`), tunnelForward),
    };
    const docker = { listContainers: async () => { throw new Error("should not touch docker for a tunnel"); } } as unknown as Docker;
    await deleteForward(docker, registry, "tun-xyz", "ui");
    expect(closed).toEqual(["tun-xyz:ui"]);
  });

  test("a tcp id force-removes the sidecar (no registry.close)", async () => {
    const removed: string[] = [];
    const docker = {
      listContainers: async () => [{ Id: "sidecar1" }],
      getContainer: (id: string) => ({ remove: async () => void removed.push(id) }),
    } as unknown as Docker;
    await deleteForward(docker, emptyRegistry(), "tcp-abc", "ui");
    expect(removed).toEqual(["sidecar1"]);
  });
});
