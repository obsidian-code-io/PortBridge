import { describe, expect, test } from "bun:test";
import type Docker from "dockerode";
import type { Config } from "../src/config.ts";
import { allocateHostPort, createForward, deleteForward, listForwards } from "../src/docker/forwards.ts";
import { buildLabels, forwardFromLabels } from "../src/docker/labels.ts";
import {
  HostPortUnavailableError,
  InvalidTargetError,
  MaxForwardsReachedError,
  NonAttachableNetworkError,
} from "../src/docker/forwards-errors.ts";
import type { Forward } from "../src/docker/forward-types.ts";

const CONFIG: Config = {
  adminToken: "0123456789abcdef",
  port: 8080,
  portRange: { start: 30000, end: 30002 },
  defaultTtlMinutes: 60,
  maxForwards: 2,
  socatImage: "alpine/socat:test",
  dockerHost: undefined,
  dataDir: "/tmp",
};

interface Sidecar {
  Id: string;
  Labels: Record<string, string>;
}

interface FakeOpts {
  targets?: Record<string, unknown>;
  networks?: Record<string, { Driver: string; Attachable?: boolean }>;
  images?: string[];
  takenPortsOnce?: Set<number>;
}

function notFound(): Error {
  return Object.assign(new Error("no such container"), { statusCode: 404 });
}

function matches(labels: Record<string, string>, filters: string[]): boolean {
  return filters.every((f) => {
    const [k, v] = f.split("=");
    return k !== undefined && labels[k] === v;
  });
}

function makeFake(opts: FakeOpts) {
  const sidecars: Sidecar[] = [];
  const created: Array<Record<string, unknown>> = [];
  const taken = new Set(opts.takenPortsOnce);
  const docker = {
    listContainers: async (o: { filters?: { label?: string[] } }) =>
      sidecars.filter((s) => matches(s.Labels, o.filters?.label ?? [])),
    getContainer: (id: string) => ({
      inspect: async () => {
        if (opts.targets && id in opts.targets) return opts.targets[id];
        throw notFound();
      },
      remove: async () => {
        const i = sidecars.findIndex((s) => s.Id === id);
        if (i < 0) throw notFound();
        sidecars.splice(i, 1);
      },
      start: async () => undefined,
    }),
    getImage: (image: string) => ({
      inspect: async () => (opts.images?.includes(image) ? {} : Promise.reject(notFound())),
    }),
    getNetwork: (name: string) => ({
      inspect: async () => opts.networks?.[name] ?? Promise.reject(notFound()),
    }),
    createContainer: async (o: Record<string, unknown>) => {
      created.push(o);
      const port = Number((o["name"] as string) && hostPortOf(o));
      if (taken.has(port)) {
        taken.delete(port);
        throw new Error("driver failed: Bind for 0.0.0.0:" + port + " failed: port is already allocated");
      }
      sidecars.push({ Id: o["name"] as string, Labels: o["Labels"] as Record<string, string> });
      return { start: async () => undefined };
    },
  };
  return { docker: docker as unknown as Docker, sidecars, created };
}

function hostPortOf(o: Record<string, unknown>): number {
  const labels = o["Labels"] as Record<string, string>;
  return Number(labels["portbridge.host.port"]);
}

function target(id: string, networks: Record<string, { IPAddress?: string }>) {
  return { Id: id + "0000000000", Name: "/" + id, Config: { Labels: {} }, NetworkSettings: { Networks: networks } };
}

describe("allocateHostPort", () => {
  test("returns lowest free port", () => {
    expect(allocateHostPort({ start: 30000, end: 30010 }, new Set([30000, 30001]))).toBe(30002);
  });
  test("throws when range exhausted", () => {
    expect(() => allocateHostPort({ start: 30000, end: 30001 }, new Set([30000, 30001]))).toThrow();
  });
});

describe("label round-trip", () => {
  test("build then parse yields the same forward", () => {
    const f: Forward = {
      id: "018f-uuid", kind: "tcp", targetName: "db", targetId: "abc123",
      targetPort: 5432, hostPort: 30000, network: "app-net",
      createdAt: 1000, expiresAt: 1600, createdBy: "admin",
    };
    expect(forwardFromLabels(buildLabels(f))).toEqual(f);
  });
  test("never TTL survives round-trip", () => {
    const labels = buildLabels({
      id: "x", kind: "tcp", targetName: "n", targetId: "i", targetPort: 1,
      hostPort: 30000, network: "bridge", createdAt: 1, expiresAt: "never", createdBy: "admin",
    });
    expect(labels["portbridge.expires.at"]).toBe("never");
    expect(forwardFromLabels(labels)?.expiresAt).toBe("never");
  });
});

describe("createForward", () => {
  test("uses container name over user-defined network and emits correct socat cmd + labels", async () => {
    const fake = makeFake({
      targets: { web: target("web", { "app-net": { IPAddress: "10.0.0.5" } }) },
      networks: { "app-net": { Driver: "bridge" } },
      images: ["alpine/socat:test"],
    });
    const fwd = await createForward(fake.docker, CONFIG, { targetId: "web", targetPort: 80, ttlMinutes: 60 });
    expect(fwd.hostPort).toBe(30000);
    expect(fwd.network).toBe("app-net");
    const opts = fake.created[0]!;
    expect(opts["Cmd"]).toEqual(["TCP-LISTEN:30000,fork,reuseaddr", "TCP-CONNECT:web:80"]);
    const labels = opts["Labels"] as Record<string, string>;
    expect(labels["portbridge.managed"]).toBe("true");
    expect(labels["portbridge.host.port"]).toBe("30000");
    // listForwards reconstructs it purely from labels
    const listed = await listForwards(fake.docker);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.hostPort).toBe(30000);
  });

  test("bridge fallback connects by target IP, not name", async () => {
    const fake = makeFake({
      targets: { db: target("db", { bridge: { IPAddress: "172.17.0.9" } }) },
      images: ["alpine/socat:test"],
    });
    const fwd = await createForward(fake.docker, CONFIG, { targetId: "db", targetPort: 5432, ttlMinutes: 15 });
    expect(fwd.network).toBe("bridge");
    expect((fake.created[0]!["Cmd"] as string[])[1]).toBe("TCP-CONNECT:172.17.0.9:5432");
  });

  test("non-attachable overlay is rejected", async () => {
    const fake = makeFake({
      targets: { svc: target("svc", { overlay1: {} }) },
      networks: { overlay1: { Driver: "overlay", Attachable: false } },
      images: ["alpine/socat:test"],
    });
    await expect(
      createForward(fake.docker, CONFIG, { targetId: "svc", targetPort: 80, ttlMinutes: 60 }),
    ).rejects.toBeInstanceOf(NonAttachableNetworkError);
  });

  test("retries past an already-allocated host port", async () => {
    const fake = makeFake({
      targets: { web: target("web", { "app-net": { IPAddress: "10.0.0.5" } }) },
      networks: { "app-net": { Driver: "bridge" } },
      images: ["alpine/socat:test"],
      takenPortsOnce: new Set([30000]),
    });
    const fwd = await createForward(fake.docker, CONFIG, { targetId: "web", targetPort: 80, ttlMinutes: 60 });
    expect(fwd.hostPort).toBe(30001);
  });

  test("enforces MAX_FORWARDS (fail closed)", async () => {
    const fake = makeFake({
      targets: { web: target("web", { "app-net": { IPAddress: "10.0.0.5" } }) },
      networks: { "app-net": { Driver: "bridge" } },
      images: ["alpine/socat:test"],
    });
    await createForward(fake.docker, CONFIG, { targetId: "web", targetPort: 80, ttlMinutes: 60 });
    await createForward(fake.docker, CONFIG, { targetId: "web", targetPort: 81, ttlMinutes: 60 });
    await expect(
      createForward(fake.docker, CONFIG, { targetId: "web", targetPort: 82, ttlMinutes: 60 }),
    ).rejects.toBeInstanceOf(MaxForwardsReachedError);
  });

  test("refuses to forward to a managed sidecar (SR-4)", async () => {
    const managed = { Id: "sidecarid", Name: "/portbridge-x", Config: { Labels: { "portbridge.managed": "true" } }, NetworkSettings: { Networks: {} } };
    const fake = makeFake({ targets: { sidecarid: managed }, images: ["alpine/socat:test"] });
    await expect(
      createForward(fake.docker, CONFIG, { targetId: "sidecarid", targetPort: 80, ttlMinutes: 60 }),
    ).rejects.toBeInstanceOf(InvalidTargetError);
  });

  test("manual host port out of range is rejected", async () => {
    const fake = makeFake({
      targets: { web: target("web", { "app-net": { IPAddress: "10.0.0.5" } }) },
      networks: { "app-net": { Driver: "bridge" } },
      images: ["alpine/socat:test"],
    });
    await expect(
      createForward(fake.docker, CONFIG, { targetId: "web", targetPort: 80, hostPort: 40000, ttlMinutes: 60 }),
    ).rejects.toBeInstanceOf(HostPortUnavailableError);
  });
});

describe("deleteForward", () => {
  test("removes the sidecar and is idempotent", async () => {
    const fake = makeFake({
      targets: { web: target("web", { "app-net": { IPAddress: "10.0.0.5" } }) },
      networks: { "app-net": { Driver: "bridge" } },
      images: ["alpine/socat:test"],
    });
    const fwd = await createForward(fake.docker, CONFIG, { targetId: "web", targetPort: 80, ttlMinutes: 60 });
    await deleteForward(fake.docker, fwd.id);
    expect(await listForwards(fake.docker)).toHaveLength(0);
    await deleteForward(fake.docker, fwd.id); // second call is a no-op success
  });
});
