/**
 * Vitest setupFile for integration tests.
 *
 * Runs in each forked process BEFORE test files.
 * Sets TAURUS_DATA_PATH to a temp directory so DB, auth secrets, and drives
 * are isolated per test file. Then initializes in-memory SQLite + model associations.
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { beforeAll, afterAll } from 'vitest';

// ── Set env BEFORE any src/ module is imported ──
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taurus-test-'));
process.env.TAURUS_DATA_PATH = tmpDir;
process.env.TAURUS_DRIVE_PATH = path.join(tmpDir, 'drives');
// Ensure auth secret file exists so crypto module doesn't blow up
const secretPath = path.join(tmpDir, '.auth_secret');
fs.writeFileSync(secretPath, 'test-secret-for-integration-tests');

beforeAll(async () => {
  // Dynamic imports so env vars are already set when paths.ts evaluates
  const { Database, setupAssociations } = await import('../../src/db/index.js');

  // Import all models so Sequelize knows about every table before sync.
  // Model.init() runs as a side effect of import, registering the table.
  await import('../../src/db/models/User.js');
  await import('../../src/db/models/Agent.js');
  await import('../../src/db/models/Run.js');
  await import('../../src/db/models/Message.js');
  await import('../../src/db/models/Folder.js');
  await import('../../src/db/models/AgentLog.js');
  await import('../../src/db/models/UserSecret.js');

  // Create tables from model definitions (fast, no migration subprocess)
  await Database.client.sync({ force: true });

  // Register model associations (User → Agent → Run → Message, cascade hooks)
  await setupAssociations();
});

afterAll(async () => {
  // Close DB
  try {
    const { Database } = await import('../../src/db/index.js');
    await Database.close();
  } catch {}

  // Clean up temp dir
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});
