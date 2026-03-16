/**
 * User credential verification — bcrypt-based password check.
 */

import User from '../../db/models/User.js';

/** Verify username + password. Returns User on success, null on failure. */
export async function verifyUserCredentials(username: string, password: string): Promise<InstanceType<typeof User> | null> {
  const user = await User.findOne({ where: { username } });
  if (!user) return null;
  const ok = await user.verifyPassword(password);
  return ok ? user : null;
}
