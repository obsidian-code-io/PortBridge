import { Hono } from "hono";
import type Docker from "dockerode";
import type { AppEnv } from "../env.ts";
import { listTargets, type Target } from "../../docker/containers.ts";
import { dashboardPage } from "../views/dashboard.ts";
import { targetsTable, errorBanner } from "../views/targets.ts";

const DOCKER_ERROR = "Could not reach the Docker daemon. Check the socket mount.";

function filterTargets(targets: readonly Target[], query: string): Target[] {
  if (query === "") return [...targets];
  return targets.filter(
    (t) => t.name.toLowerCase().includes(query) || t.image.toLowerCase().includes(query),
  );
}

export function dashboardRoutes(docker: Docker): Hono<AppEnv> {
  const router = new Hono<AppEnv>();

  router.get("/", async (c) => {
    try {
      return c.html(dashboardPage(await listTargets(docker), c.get("csrf")));
    } catch {
      return c.html(dashboardPage([], c.get("csrf"), DOCKER_ERROR), 503);
    }
  });

  router.get("/targets", async (c) => {
    const query = (c.req.query("q") ?? "").trim().toLowerCase();
    try {
      return c.html(targetsTable(filterTargets(await listTargets(docker), query)));
    } catch {
      return c.html(errorBanner(DOCKER_ERROR), 503);
    }
  });

  return router;
}
