CREATE TABLE IF NOT EXISTS stickfigure_rooms (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS stickfigure_rooms_expires ON stickfigure_rooms(expires);
