import type http from 'node:http';

/** Created exclusively by auth gates. The literal `true` type enforces provenance. */
export interface AuthUser {
  id: string;
  role: 'admin' | 'user';
  isLoggedIn: true;
}

export interface Ctx {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  params: Record<string, string>;
  user: AuthUser;
}
