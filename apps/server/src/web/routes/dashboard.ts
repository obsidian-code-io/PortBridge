import { Hono } from "hono";
import type Docker from "dockerode";
import type { AppEnv } from "../env.ts";
import { listTargets, type Target } from "../../docker/containers.ts";
import type { Principal } from "../../access/types.ts";
import { targetVisible } from "../../access/visibility.ts";
import { dashboardPage } from "../views/dashboard.ts";
import { targetsTable, errorBanner } from "../views/targets.ts";

const DOCKER_ERROR = "Could not reach the Docker daemon. Check the socket mount.";

function filterTargets(targets: readonly Target[], query: string): Target[] {
  if (query === "") return [...targets];
  return targets.filter(
    (t) => t.name.toLowerCase().includes(query) || t.image.toLowerCase().includes(query),
  );
}

// A keyed user only sees targets its role allows; admin sees everything.
async function visibleTargets(docker: Docker, principal: Principal): Promise<Target[]> {
  return (await listTargets(docker)).filter((t) => targetVisible(principal, t));
}

export function dashboardRoutes(docker: Docker): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get("/", async (c) => {
    try {
      return c.html(dashboardPage(await visibleTargets(docker, c.get("principal")), c.get("brand"), c.get("csrf")));
    } catch {
      return c.html(dashboardPage([], c.get("brand"), c.get("csrf"), DOCKER_ERROR), 503);
    }
  });

  router.get("/targets", async (c) => {
    const query = (c.req.query("q") ?? "").trim().toLowerCase();
    try {
      return c.html(targetsTable(filterTargets(await visibleTargets(docker, c.get("principal")), query)));
    } catch {
      return c.html(errorBanner(DOCKER_ERROR), 503);
    }
  });

  return router;
}
