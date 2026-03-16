/**
 * Taurus Daemon — the main entry point.
 *
 * Boots DB, creates Daemon, starts HTTP server, handles shutdown.
 * ./taurus runs this. Web UI on :7777.
 */

import 'dotenv/config';
import { Database, setupAssociations } from './db/index.js';

// Import models so Sequelize registers them
import './db/models/Run.js';
import './db/models/Message.js';
import './db/models/Folder.js';
import './db/models/Agent.js';
import './db/models/AgentLog.js';
import './db/models/User.js';

import { Daemon } from './daemon/daemon.js';
import { createServer } from './server/server.js';
import { attachTerminalWs } from './server/ws.js';
import { acquireLock, releaseLock } from './daemon/lockfile.js';
import { resetApiKeyUserCache } from './server/auth/index.js';
import User from './db/models/User.js';
import Folder from './db/models/Folder.js';

const PORT = parseInt(process.env.TAURUS_PORT ?? '7777', 10);

// ── CLI subcommands ──

async function handleAddUser(): Promise<void> {
  const args = process.argv.slice(3);
  let username = '', password = '', email = '', role: 'admin' | 'user' = 'user';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && args[i + 1]) { username = args[++i]; }
    else if (args[i] === '--password' && args[i + 1]) { password = args[++i]; }
    else if (args[i] === '--email' && args[i + 1]) { email = args[++i]; }
    else if (args[i] === '--role' && args[i + 1]) { role = args[++i] as 'admin' | 'user'; }
  }

  if (!username || !password || !email) {
    console.error('Usage: taurus adduser --username <name> --password <pass> --email <email> [--role admin|user]');
    process.exit(1);
  }

  await Database.sync();
  await setupAssociations();

  const hash = await User.hashPassword(password);
  const { v4: uuidv4 } = await import('uuid');
  const user = await User.create({
    id: uuidv4(),
    username,
    email,
    password_hash: hash,
    role,
  });

  // Create root folder for the new user
  await Folder.ensureRootForUser(user.id);

  console.log(`User created: ${username} (${user.id}), role: ${role}`);
  await Database.close();
  process.exit(0);
}

// ── Main daemon ──

async function main() {
  // Check for subcommands before daemon boot
  const subcommand = process.argv[2];
  if (subcommand === 'adduser') {
    return handleAddUser();
  }

  // Prevent multiple instances from running
  acquireLock(PORT);

  await Database.sync();
  await setupAssociations();

  // Ensure default user exists
  const { user: defaultUser, password: defaultPassword } = await User.ensureDefaultUser();

  // Ensure root folder for the default user
  await Folder.ensureRootForUser(defaultUser.id);

  // Reset API key user cache after user setup
  resetApiKeyUserCache();

  const daemon = new Daemon();
  await daemon.init();

  const server = createServer(daemon, PORT);
  attachTerminalWs(server, daemon);
  // Keep-alive timeout: close idle connections after 5s to avoid exhausting
  // the browser's 6-connection-per-host limit (SSE streams are long-lived).
  server.keepAliveTimeout = 5_000;

  const agentCount = daemon.agentCount();
  server.listen(PORT, () => {
    console.log('');
    console.log('  ┌──────────────────────────────────────────┐');
    console.log('  │            Taurus Daemon v0.1.0          │');
    console.log('  ├──────────────────────────────────────────┤');
    console.log(`  │  URL:      http://localhost:${String(PORT).padEnd(13)}│`);
    console.log(`  │  Agents:   ${String(agentCount).padEnd(30)}│`);
    if (defaultPassword) {
      console.log('  ├──────────────────────────────────────────┤');
      console.log('  │  Auto-generated user:                    │');
      console.log('  │                                          │');
      console.log(`  │  Login:    ${defaultUser.username.padEnd(30)}│`);
      console.log(`  │  Password: ${defaultPassword.padEnd(30)}│`);
    } else {
      console.log('  ├──────────────────────────────────────────┤');
      console.log(`  │  User:     ${defaultUser.username.padEnd(30)}│`);
      console.log('  │  Password has been changed               │');
    }
    console.log('  └──────────────────────────────────────────┘');
    console.log('');
  });

  // Graceful shutdown — debounce to avoid double-fire from terminal signal propagation
  let shutdownCount = 0;
  let shutdownInProgress = false;
  let lastSignalTime = 0;

  async function handleShutdown() {
    const now = Date.now();
    if (now - lastSignalTime < 500) return; // debounce
    lastSignalTime = now;
    shutdownCount++;

    if (shutdownCount === 1 && !shutdownInProgress) {
      shutdownInProgress = true;
      console.log('\nGraceful shutdown... (press Ctrl+C again to force)');
      try {
        await daemon.shutdown();
        server.close();
        await Database.close();
        releaseLock();
        process.exit(0);
      } catch (err) {
        console.error('Shutdown error:', err);
        releaseLock();
        process.exit(1);
      }
    } else if (shutdownCount >= 2) {
      console.log('\nForce shutdown — killing all children...');
      daemon.forceShutdown();
      releaseLock();
      setTimeout(() => process.exit(1), 2000);
    }
  }

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  releaseLock();
  process.exit(1);
});
