#!/usr/local/bin/node
// @ts-check

import { execFileSync, spawn } from "child_process"
import fs from "fs"
import net from "net"
import os from "os"
import path from "path"
import process from "process"

// Probe the real bind so the kernel decides (CAP_NET_BIND_SERVICE, port sysctls),
// not a UID guess.
async function assertPortBindable(port) {
  await new Promise((resolve) => {
    const probe = net.createServer()
    probe.once("error", (err) => {
      if (err.code === "EACCES") {
        console.error(`Cannot bind port ${port} as the current user: set HOPP_ALTERNATE_PORT to a free port >= 1024, or run as root / grant CAP_NET_BIND_SERVICE.`)
        process.exit(1)
      }
      if (err.code === "EADDRINUSE") {
        console.error(`Port ${port} is already in use inside the container: set HOPP_ALTERNATE_PORT to a free port.`)
        process.exit(1)
      }
      console.warn(`Skipping bind preflight for port ${port} (${err.code})`)
      resolve()
    })
    probe.listen(port, () => probe.close(resolve))
  })
}

// Empty means unset (compose passes undefined vars as ""), so the :80 default applies.
if (process.env.HOPP_ALTERNATE_PORT === "") delete process.env.HOPP_ALTERNATE_PORT
if (process.env.HOPP_AIO_ALTERNATE_PORT === "") delete process.env.HOPP_AIO_ALTERNATE_PORT

// Back-compat: fall back to the legacy var when the new one is unset.
const legacyPortApplied = !process.env.HOPP_ALTERNATE_PORT && !!process.env.HOPP_AIO_ALTERNATE_PORT
if (legacyPortApplied) {
  process.env.HOPP_ALTERNATE_PORT = process.env.HOPP_AIO_ALTERNATE_PORT
}

const useSubpathAccess = process.env.ENABLE_SUBPATH_BASED_ACCESS === "true"

// Sanity-check the value; real bindability is probed below.
const RESERVED_PORTS = ["8080", "3200"]
const altPort = process.env.HOPP_ALTERNATE_PORT
// Name whichever var the operator actually set.
const altPortVar = legacyPortApplied ? "HOPP_AIO_ALTERNATE_PORT" : "HOPP_ALTERNATE_PORT"
if (altPort !== undefined) {
  if (!(/^[0-9]+$/.test(altPort) && +altPort >= 1 && +altPort <= 65535)) {
    console.error(`${altPortVar}="${altPort}" is invalid: use an integer in 1-65535 (e.g. 8000).`)
    process.exit(1)
  }
  if (RESERVED_PORTS.includes(String(+altPort))) {
    console.error(`${altPortVar}="${altPort}" is already used by this image (${RESERVED_PORTS.join(", ")}); pick another port (e.g. 8000).`)
    process.exit(1)
  }
  if (!useSubpathAccess) {
    console.warn(`${altPortVar} has no effect in multiport mode (Caddy binds 3000/3100/3170); it applies only when ENABLE_SUBPATH_BASED_ACCESS=true.`)
  }
}

// Only subpath mode binds the configurable port; multiport uses fixed ports.
if (useSubpathAccess) {
  await assertPortBindable(+(process.env.HOPP_ALTERNATE_PORT ?? 80))
}

function runChildProcessWithPrefix(command, args, prefix) {
  const childProcess = spawn(command, args);

  childProcess.stdout.on('data', (data) => {
    const output = data.toString().trim().split('\n');
    output.forEach((line) => {
      console.log(`${prefix} | ${line}`);
    });
  });

  childProcess.stderr.on('data', (data) => {
    const error = data.toString().trim().split('\n');
    error.forEach((line) => {
      console.error(`${prefix} | ${line}`);
    });
  });

  childProcess.on('close', (code) => {
    console.log(`${prefix} Child process exited with code ${code}`);
  });

  childProcess.on('error', (stuff) => {
    console.log("error")
    console.log(stuff)
  })

  return childProcess
}

// Tracks every long-running process this script supervises (Postgres, Caddy,
// backend, webapp-server) so SIGINT/SIGTERM can fan out to all of them and the
// fail-fast exit handlers can be disarmed during an intentional shutdown.
const supervisedChildren = []
let shuttingDown = false

// --- Embedded Postgres (opt-in, used by the aio-standalone image target) ---
//
// Runs before everything else: the backend hard-crashes on boot if migrations
// haven't been applied yet (no retry logic exists for that), so Postgres must
// be initialized, started, ready, and migrated before the backend child below
// is spawned.
const embeddedPg = process.env.HOPP_EMBEDDED_POSTGRES === "true"

if (embeddedPg) {
  const pgUser = process.env.HOPP_EMBEDDED_DB_USER || "hoppscotch"
  const pgPassword = process.env.HOPP_EMBEDDED_DB_PASSWORD
  const pgDb = process.env.HOPP_EMBEDDED_DB_NAME || "hoppscotch"
  const pgData = process.env.PGDATA || "/data/postgres"

  if (!pgPassword) {
    console.error("HOPP_EMBEDDED_DB_PASSWORD must be set when HOPP_EMBEDDED_POSTGRES=true.")
    process.exit(1)
  }

  // Embedded mode is the single source of truth for DATABASE_URL: any
  // externally-supplied value is overwritten to avoid silent drift from the
  // Postgres instance actually managed here.
  process.env.DATABASE_URL = `postgresql://${pgUser}:${encodeURIComponent(pgPassword)}@127.0.0.1:5432/${pgDb}`
  process.env.PGPASSWORD = pgPassword

  // Setting process.env here only affects this script and the children it
  // spawns below -- a `docker exec` into the running container starts a
  // separate process attached directly to the container, which does NOT see
  // env vars a sibling process set at runtime, only the container's original
  // static env. Tools meant to be run that way (e.g. the create-user CLI) load
  // this file themselves via dotenv, the same way prisma.config.ts does.
  fs.writeFileSync(
    "/dist/backend/.env",
    `DATABASE_URL=${process.env.DATABASE_URL}\n`,
    { mode: 0o600 }
  )

  // Real Postgres refuses to run as UID 0. When this image runs as root (the
  // default, no USER directive is set), drop to the apk package's "postgres"
  // system user for Postgres-related commands only, via su-exec. When it runs
  // as an arbitrary non-root UID (OpenShift-style, GID 0 -- already a supported
  // mode for this image family), su-exec would need root to switch user and
  // isn't needed anyway: Postgres just has to own its data directory, not run
  // as a specific named user, so commands run directly as the current UID.
  const asRoot = process.getuid ? process.getuid() === 0 : false

  const runAsPgSync = (cmd, args, stdio = "inherit") => {
    if (asRoot) {
      return execFileSync("su-exec", ["postgres", cmd, ...args], { stdio })
    }
    return execFileSync(cmd, args, { stdio })
  }

  const spawnAsPg = (cmd, args, prefix) =>
    asRoot
      ? runChildProcessWithPrefix("su-exec", ["postgres", cmd, ...args], prefix)
      : runChildProcessWithPrefix(cmd, args, prefix)

  if (asRoot) {
    execFileSync("chown", ["-R", "postgres:postgres", pgData])
  }

  const needsInitdb = !fs.existsSync(path.join(pgData, "PG_VERSION"))
  if (needsInitdb) {
    console.log(`Postgres | Initializing data directory at ${pgData}...`)
    // --pwfile keeps the initial superuser password off the process list;
    // written by whoever runs this script (root or the arbitrary UID), then
    // handed to initdb (possibly running as the separate "postgres" user).
    const pwFile = path.join(os.tmpdir(), `hopp-pg-pwfile-${process.pid}`)
    fs.writeFileSync(pwFile, pgPassword, { mode: 0o600 })
    if (asRoot) execFileSync("chown", ["postgres:postgres", pwFile])
    try {
      runAsPgSync("initdb", ["-D", pgData, "--allow-group-access", "-U", pgUser, "--pwfile", pwFile])
    } finally {
      fs.rmSync(pwFile, { force: true })
    }
  }

  // Client tools below only ever connect over TCP (-h 127.0.0.1), and this
  // image has no /run/postgresql for a Unix socket lock file (unlike
  // Debian-based Postgres images, which create it at package-install time) --
  // disabling the socket avoids needing to create/own that directory at all,
  // including under an arbitrary non-root UID.
  const pgProcess = spawnAsPg("postgres", ["-D", pgData, "-h", "127.0.0.1", "-p", "5432", "-c", "unix_socket_directories="], "Postgres")
  supervisedChildren.push(pgProcess)

  pgProcess.on("exit", (code) => {
    terminate(`Exiting process because Postgres exited with code ${code}`, code ?? 1)
  })

  console.log("Postgres | Waiting for readiness...")
  const pgReadyDeadline = Date.now() + 60_000
  for (;;) {
    try {
      execFileSync("pg_isready", ["-h", "127.0.0.1", "-p", "5432"], { stdio: "ignore" })
      break
    } catch {
      if (Date.now() > pgReadyDeadline) {
        console.error("Postgres did not become ready within 60s")
        process.exit(1)
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  console.log("Postgres | Ready")

  // initdb only creates the postgres/template0/template1 databases. stdio must
  // be captured (not "inherit") here so the "already exists" check below can
  // actually see stderr -- execFileSync only populates err.stderr when the
  // child's output was piped, not when it was inherited.
  try {
    runAsPgSync("createdb", ["-h", "127.0.0.1", "-p", "5432", "-U", pgUser, pgDb], ["ignore", "pipe", "pipe"])
  } catch (err) {
    const stderr = err?.stderr ? err.stderr.toString() : ""
    if (!stderr.includes("already exists")) {
      if (stderr) console.error(stderr)
      throw err
    }
  }

  console.log("Postgres | Running prisma migrate deploy...")
  // node_modules/.bin/prisma is pnpm's #!/bin/sh wrapper script, not JS --
  // execute it directly (it re-execs into the real prisma CLI itself) rather
  // than passing it to `node`, which fails trying to parse shell syntax.
  execFileSync("node_modules/.bin/prisma", ["migrate", "deploy"], {
    cwd: "/dist/backend",
    env: process.env,
    stdio: "inherit",
  })
  console.log("Postgres | Migrations applied")
}

const envFileContent = Object.entries(process.env)
  .filter(([env]) => env.startsWith("VITE_"))
  .sort(([envA], [envB]) => envA.localeCompare(envB))
  .map(([env, val]) => `${env}=${
    (val.startsWith("\"") && val.endsWith("\""))
      ? val
      : `"${val}"`
  }`)
  .join("\n")

// Write to a temp dir (not cwd) so a non-root UID needn't own the working directory.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hopp-env-"))
const buildEnvPath = path.join(tmpDir, "build.env")

try {
  fs.writeFileSync(buildEnvPath, envFileContent)
  // Call the global binary directly (not npx, which needs a writable $HOME cache).
  execFileSync("import-meta-env", ["-x", buildEnvPath, "-e", buildEnvPath, "-p", "/site/**/*"], { stdio: "inherit" })
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

const caddyFileName = useSubpathAccess ? 'aio-subpath-access.Caddyfile' : 'aio-multiport-setup.Caddyfile'
const caddyProcess = runChildProcessWithPrefix("caddy", ["run", "--config", `/etc/caddy/${caddyFileName}`, "--adapter", "caddyfile"], "App/Admin Dashboard Caddy")
const backendProcess = runChildProcessWithPrefix("node", ["/dist/backend/dist/src/main.js"], "Backend Server")
const webappProcess = runChildProcessWithPrefix("webapp-server", [], "Webapp Server")

supervisedChildren.push(caddyProcess, backendProcess, webappProcess)

caddyProcess.on("exit", (code) => {
  // code is null on signal death; report failure, not success.
  terminate(`Exiting process because Caddy Server exited with code ${code}`, code ?? 1)
})

backendProcess.on("exit", (code) => {
  terminate(`Exiting process because Backend Server exited with code ${code}`, code ?? 1)
})

webappProcess.on("exit", (code) => {
  terminate(`Exiting process because Webapp Server exited with code ${code}`, code ?? 1)
})

// Every shutdown path -- an external signal (Kubernetes/`docker stop` send
// SIGTERM, not SIGINT) or one supervised child dying unexpectedly -- funnels
// through here, so Postgres (when embedded) always gets a clean SIGTERM
// instead of being killed mid-checkpoint whenever a sibling process exits.
function terminate(reason, exitCode) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(reason)

  for (const child of supervisedChildren) {
    child.kill("SIGTERM")
  }

  const forceExitTimer = setTimeout(() => {
    console.error("Graceful shutdown timed out, forcing exit")
    process.exit(exitCode)
  }, 10_000)
  forceExitTimer.unref()

  Promise.all(
    supervisedChildren.map((child) =>
      // A child that has already exited (e.g. the one that triggered this
      // shutdown) will never emit another "exit" event -- resolve immediately
      // instead of waiting on one that isn't coming.
      child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => child.once("exit", resolve))
    )
  ).then(() => {
    clearTimeout(forceExitTimer)
    process.exit(exitCode)
  })
}

process.on('SIGINT', () => terminate('SIGINT received, shutting down...', 0))
process.on('SIGTERM', () => terminate('SIGTERM received, shutting down...', 0))
