// Beginner Windows entry point. Connection credentials remain in process memory.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = fileURLToPath(new URL('../', import.meta.url));
const entry = fileURLToPath(import.meta.url);
let child;
let cancelled = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  cancelled = true;
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try { process.kill(-child.pid, signal); } catch { /* child group already exited */ }
  }
});
async function run(command, args, env = process.env, shell = false) {
  if (cancelled) throw new Error('Startup cancelled.');
  const code = await new Promise((done, reject) => {
    child = spawn(command, args, { cwd: root, env, shell, stdio: 'inherit', detached: process.platform !== 'win32' });
    child.once('error', () => reject(new Error('A required command could not start. Check Node.js/npm and Windows PowerShell.')));
    child.once('exit', code => done(code));
  });
  if (code !== 0 && !cancelled) throw new Error('Startup stopped. Check the preceding message and PostgreSQL connection.');
}
async function checkPort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`Port ${port} is already in use. Close the previous PayBD terminal or stop that service first.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
async function main() {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Install Node.js 24, then start the demo again.');
  if (!process.env.DATABASE_URL?.trim()) {
    if (process.argv.includes('--database-ready')) throw new Error('DATABASE_URL cannot be empty.');
    if (process.platform !== 'win32') throw new Error('Set DATABASE_URL in this process environment before using this existing-PostgreSQL launcher.');
    console.log('Use your existing PostgreSQL database. Nothing will be dropped or reset.');
    console.log('Connection format: postgresql://USER:PASSWORD@localhost:5432/payment_gateway');
    console.log('The connection is hidden while you type and is not saved to disk.');
    // Static PowerShell command: the connection is never interpolated into a
    // command line, printed, written to a file, or added to shell history.
    const prompt = `
$ErrorActionPreference = 'Stop'
$pointer = [IntPtr]::Zero
try {
  $secure = Read-Host 'DATABASE_URL (hidden)' -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  & $env:PAYBD_NODE_EXECUTABLE $env:PAYBD_WINDOWS_ENTRY --database-ready
  exit $LASTEXITCODE
} catch {
  Write-Host 'Unable to start the demo. Check the connection and prerequisites.'
  exit 1
} finally {
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
}`;
    await run('powershell.exe', ['-NoProfile', '-Command', prompt], {
      ...process.env, PAYBD_NODE_EXECUTABLE: process.execPath, PAYBD_WINDOWS_ENTRY: entry,
    });
    return;
  }
  try {
    const url = new URL(process.env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) throw new Error();
  } catch { throw new Error('DATABASE_URL must be a PostgreSQL URL with a database name. Its value has not been displayed.'); }
  await checkPort(3000);
  await checkPort(3001);
  console.log('Installing the locked dependencies. The first start needs an Internet connection.');
  await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'setup'], process.env, process.platform === 'win32');
  if (cancelled) return;
  console.log('Starting DEMO MODE with your existing PostgreSQL. Keep this window open.');
  await run(process.execPath, ['scripts/dev.mjs', '--open-shop']);
}
main().catch(error => {
  if (cancelled) return;
  console.error(error.message);
  process.exitCode = 1;
});
