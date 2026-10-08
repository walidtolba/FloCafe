'use strict';

/**
 * Hot-reload dev mode: runs the real Electron app (so printing, backups, and
 * other electronAPI-backed features keep working), but points its main window
 * at `next dev` (Fast Refresh) instead of the static Next.js export — so
 * frontend edits apply instantly without rebuilding/restarting.
 *
 * The backend (Express :3001, KDS :3002, Server App :3003) still starts the
 * normal way, inside Electron's own process — this only changes where the
 * window's HTML/JS comes from.
 *
 * Dev-only: npm run build / build:frontend / the packaged app never set
 * FLO_DEV_HOT_URL or NEXT_PUBLIC_API_BASE_URL, so nothing here affects a build.
 */

const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');

const rootDir = path.join(__dirname, '..', '..');
const frontendDir = path.join(rootDir, 'frontend');
const useShell = process.platform === 'win32';
const FRONTEND_PORT = 3000;
const API_PORT = 3001;

function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for ${url}`));
        } else {
          setTimeout(attempt, 300);
        }
      });
    };
    attempt();
  });
}

console.log('[dev:hot] Cleaning ports 3000-3003...');
spawnSync('node', ['kill-ports.js', '3000', '3001', '3002', '3003'], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: useShell,
});

console.log('[dev:hot] Building backend...');
const buildResult = spawnSync('npm', ['run', 'build'], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: useShell,
});
if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exitCode = code ?? 0;
}

function spawnChild(name, cmd, args, opts) {
  const child = spawn(cmd, args, { stdio: 'inherit', shell: useShell, ...opts });
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.log(`[dev:hot] ${name} exited (code ${code}) — shutting down...`);
      shutdown(code ?? 0);
    }
  });
  children.push(child);
  return child;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

(async () => {
  console.log('[dev:hot] Starting frontend dev server (Fast Refresh) on :3000...');
  spawnChild('frontend', 'npm', ['run', 'dev'], {
    cwd: frontendDir,
    env: {
      ...process.env,
      NEXT_PUBLIC_API_BASE_URL: `http://localhost:${API_PORT}`,
    },
  });

  try {
    await waitForHttp(`http://localhost:${FRONTEND_PORT}`, 60000);
  } catch (err) {
    console.error(`[dev:hot] ${err.message}`);
    return shutdown(1);
  }
  if (shuttingDown) return;

  console.log('[dev:hot] Launching Electron, pointed at the dev server...');
  const electronPath = require('electron');
  spawnChild('electron', electronPath, ['.'], {
    cwd: rootDir,
    env: {
      ...process.env,
      FLO_DEV_HOT_URL: `http://localhost:${FRONTEND_PORT}`,
    },
  });

  console.log('');
  console.log('[dev:hot] Ready. Frontend edits hot-reload instantly inside the app window.');
  console.log('[dev:hot] Backend edits need Ctrl+C + re-run.');
})();
