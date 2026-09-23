// v7: old login credentials are intentionally invalidated; all user/business data remains.
export const AUTH_SESSIONS_SCHEMA = `
CREATE TABLE auth_sessions (
 id TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL,
 renewed_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 absolute_expires_at INTEGER NOT NULL,
 CHECK(created_at <= renewed_at AND renewed_at < expires_at AND expires_at <= absolute_expires_at)
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_expiry ON auth_sessions(expires_at);
DROP TABLE refresh_tokens;
`;
