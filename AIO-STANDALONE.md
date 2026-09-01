# Hoppscotch AIO Standalone Image

One self-contained image: Postgres + backend + frontend + admin dashboard +
desktop-app bundle server, all in a single container. No external database.

## Loading the image

```bash
gunzip -c hoppscotch-aio-standalone-2026.7.0.tar.gz | docker load
```

This restores the image as `hoppscotch-aio-standalone:2026.7.0`.

## Required environment variables

| Variable | Notes |
|---|---|
| `HOPP_EMBEDDED_DB_PASSWORD` | **Required, no default.** Container refuses to start without it. |
| `HOPP_INITIAL_ADMIN_USER` | Seeded once on first boot. Not updated on later boots. |
| `HOPP_INITIAL_ADMIN_PASSWORD` | Seeded once on first boot. Not updated on later boots. |
| `DATA_ENCRYPTION_KEY` | Exactly 32 characters. |
| `VITE_ALLOWED_AUTH_PROVIDERS` | Set to `PASSWORD`. |
| `VITE_BASE_URL`, `VITE_SHORTCODE_BASE_URL`, `VITE_ADMIN_URL` | Public URLs the frontend/admin dashboard are served at. |
| `VITE_BACKEND_API_URL`, `VITE_BACKEND_GQL_URL`, `VITE_BACKEND_WS_URL` | Must point at the backend on port 3170 (`http(s)://.../v1`, `.../graphql`, `ws(s)://.../graphql`). |
| `WHITELISTED_ORIGINS` | Comma-separated list of every origin above. |

Optional (defaults shown):

| Variable | Default |
|---|---|
| `HOPP_EMBEDDED_DB_USER` | `hoppscotch` |
| `HOPP_EMBEDDED_DB_NAME` | `hoppscotch` |
| `PGDATA` | `/data/postgres` |

Do **not** set `DATABASE_URL` directly — it's derived from the `HOPP_EMBEDDED_DB_*` vars and any manually-set value is overwritten.

## Ports

| Port | Service |
|---|---|
| 3000 | Frontend |
| 3100 | Admin dashboard |
| 3170 | Backend API / GraphQL |
| 3200 | Desktop-app bundle server |

## Persistent storage — required

Mount a volume at `/data/postgres` (or wherever `PGDATA` points). Without it,
**all data is lost on every restart**, including the seeded admin account.

## Run example

```bash
docker run -d --name hoppscotch --restart=always \
  -p 3000:3000 -p 3100:3100 -p 3170:3170 -p 3200:3200 \
  -e HOPP_EMBEDDED_DB_PASSWORD='<strong password>' \
  -e HOPP_INITIAL_ADMIN_USER=admin \
  -e HOPP_INITIAL_ADMIN_PASSWORD='<strong password>' \
  -e DATA_ENCRYPTION_KEY='<32 random chars>' \
  -e VITE_ALLOWED_AUTH_PROVIDERS=PASSWORD \
  -e VITE_BASE_URL=https://hoppscotch.internal \
  -e VITE_SHORTCODE_BASE_URL=https://hoppscotch.internal \
  -e VITE_ADMIN_URL=https://hoppscotch.internal:3100 \
  -e VITE_BACKEND_API_URL=https://hoppscotch.internal:3170/v1 \
  -e VITE_BACKEND_GQL_URL=https://hoppscotch.internal:3170/graphql \
  -e VITE_BACKEND_WS_URL=wss://hoppscotch.internal:3170/graphql \
  -e WHITELISTED_ORIGINS=https://hoppscotch.internal,https://hoppscotch.internal:3100,https://hoppscotch.internal:3170 \
  -v hoppscotch-pgdata:/data/postgres \
  hoppscotch-aio-standalone:2026.7.0
```

## Important: one restart on first boot is normal

On first boot only, the backend seeds its config and the admin account, then
intentionally restarts itself. `--restart=always` (or the container
orchestrator's equivalent restart policy) is **required** for this to recover
— without it, the container just stops after the first boot and never comes
back. Expect to see exactly one restart shortly after the very first start;
every boot after that stays up normally.

## Verifying it's up

```bash
curl http://<host>:3170/v1/auth/providers
# {"providers":["PASSWORD"]}
```

Then log in at `VITE_BASE_URL` with `HOPP_INITIAL_ADMIN_USER`/`HOPP_INITIAL_ADMIN_PASSWORD`.

## Rotating the admin password later

The seeded account is never updated on later boots. To change it:

```bash
docker exec -it hoppscotch node /dist/backend/dist/src/cli/create-user.js admin --update
```

## Shutting down

The container handles `SIGTERM` (what `docker stop` / Kubernetes send) by
shutting Postgres down cleanly before exiting. Give it a few seconds —
avoid `docker kill` / `SIGKILL` except as a last resort.
