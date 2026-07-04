# Roles & Access

Per-user API keys carry a **role**, and a role scopes which forwards its holder
may open — by **port and/or container**. Enforcement is consistent across every
create path: the web dashboard, the JSON API, and agent tunnels.

## Model

- **Role** — `{ name, scope }` where `scope = { allPorts, ports[], allContainers, containers[] }`.
  A forward to `(container, port)` is allowed iff
  `(allPorts || ports.includes(port)) && (allContainers || containers.includes(container))`.
  The admin is an implicit superuser (unrestricted).
- **API key** — one per party/user, bound to a role. Stored only as a SHA-256
  hash; the plaintext (`pbk_…`) is shown **once** at creation.
- **Access config** — the onboarding-defined universe of scopable ports/containers.

## Authentication

A credential resolves to a **Principal** at every entry point
(`resolvePrincipal`): the admin token → admin; a live key → its user + role.

- **Web** — log in with the admin token *or* a user key; the session binds the
  principal. A revoked key / deleted role invalidates the session next request.
- **API** — `Authorization: Bearer <admin-token|pbk_…>`.
- **Agent** — the control WS bearer is resolved the same way; each tunnel-open
  is enforced against the role.

## Enforcement

| Surface | Behaviour for a scoped user |
| --- | --- |
| Dashboard / `/targets` | Only in-scope targets are listed |
| Create forward (UI) | Out-of-scope container/port → 403 + reason |
| `POST /api/forwards` | Same scope check before opening |
| Extend / delete | Refused for forwards the role can't see |
| `GET /api/targets`, `/api/forwards` | Filtered to the visible set |
| Agent tunnel open | Refused with an error reply; no tunnel created |

## Management API (admin only)

```
POST   /api/roles          {name, allPorts, ports[], allContainers, containers[]} → role
GET    /api/roles
DELETE /api/roles/:id       # refused while an active key references it
POST   /api/keys           {label, roleId} → {…, key: "pbk_…"}   # key shown once
GET    /api/keys            # never returns secrets
DELETE /api/keys/:id        # revoke
GET/PUT /api/access-config  {enabled, ports[], containers[]}
```

Example — create a role and issue a key:

```bash
ROLE=$(curl -s -XPOST localhost:8080/api/roles -H "authorization: Bearer $ADMIN" \
  -H 'content-type: application/json' \
  -d '{"name":"db-readers","ports":[5432,6379],"allContainers":true}' | jq -r .id)

curl -s -XPOST localhost:8080/api/keys -H "authorization: Bearer $ADMIN" \
  -H 'content-type: application/json' -d "{\"label\":\"alice\",\"roleId\":\"$ROLE\"}" | jq -r .key
# → pbk_…  (store it now; it is never shown again)
```

## Web UI

**Settings → Roles & Access** (admin only) creates roles and issues/revokes keys
through the same modal popups as the rest of the app; the issued key is shown
once. Onboarding's final step lets the admin enable scoping and input the
forwardable ports/containers up front.
