import { describe, expect, test } from "bun:test";
import type Docker from "dockerode";
import { resolveDial, TargetUnreachableError } from "../src/agent/reachability.ts";
import { TargetNotFoundError } from "../src/docker/forwards-errors.ts";

function notFound(): Error {
  return Object.assign(new Error("no such container"), { statusCode: 404 });
}

function fakeDocker(targets: Record<string, unknown>) {
  return {
    getContainer: (id: string) => ({
      inspect: async () => {
        if (id in targets) return targets[id];
        throw notFound();
      },
    }),
    getNetwork: () => ({ inspect: async () => ({ Driver: "bridge" }) }),
  } as unknown as Docker;
}

function onBridge(id: string, ip: string) {
  return { Id: id + "-id", Name: "/" + id, Config: { Labels: {} }, NetworkSettings: { Networks: { bridge: { IPAddress: ip } } } };
}

describe("resolveDial (SSRF guard + reachability)", () => {
  test("rejects an unknown container (client cannot pivot the server)", async () => {
    const docker = fakeDocker({});
    await expect(resolveDial(docker, new Set(["bridge"]), "ghost", 5432)).rejects.toBeInstanceOf(TargetNotFoundError);
  });

  test("rejects a target on a network the server is NOT on", async () => {
    const docker = fakeDocker({ db: onBridge("db", "172.17.0.5") });
    await expect(resolveDial(docker, new Set(["some-other-net"]), "db", 5432)).rejects.toBeInstanceOf(
      TargetUnreachableError,
    );
  });

  test("resolves to a concrete dial address when the server shares the network", async () => {
    const docker = fakeDocker({ db: onBridge("db", "172.17.0.5") });
    const dial = await resolveDial(docker, new Set(["bridge"]), "db", 5432);
    expect(dial).toEqual({ host: "172.17.0.5", port: 5432, network: "bridge", targetName: "db", targetId: "db-id".slice(0, 12) });
  });

  test("the dial host always comes from Docker, never from client input", async () => {
    // The client supplies only targetId + targetPort; host is the resolved bridge IP.
    const docker = fakeDocker({ svc: onBridge("svc", "10.9.9.9") });
    const dial = await resolveDial(docker, new Set(["bridge"]), "svc", 8080);
    expect(dial.host).toBe("10.9.9.9"); // not attacker-controlled
    expect(dial.port).toBe(8080);
  });
});
