export const sessionConfig = () => ({
  password: process.env.SESSION_SECRET!,
  name: "luaux_session",
  maxAge: 60 * 60 * 24 * 30,
});

export type SessionUser = {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
};

export type StoredUser = SessionUser & { email?: string | null };

export type SessionData = {
  oauth_state?: string;
  user?: StoredUser;
  isAdmin?: boolean;
};
