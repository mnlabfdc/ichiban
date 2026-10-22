-- 時間欄位一律存 UTC 的 ISO 字串（例如 2026-10-21T06:30:00.000Z），字串排序就是時間排序。
-- 金額都是新台幣整數。

CREATE TABLE branches (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

INSERT INTO branches (id, name) VALUES (1, '分店1'), (2, '分店2');

CREATE TABLE sets (
  id TEXT PRIMARY KEY,
  barcode TEXT NOT NULL,
  name TEXT NOT NULL,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  cost INTEGER NOT NULL,
  price_per_draw INTEGER NOT NULL,
  total_draws INTEGER NOT NULL,
  opening_draws INTEGER NOT NULL DEFAULT 0,
  opening_revenue INTEGER NOT NULL DEFAULT 0,
  -- 以下三個是彙總欄位，每次銷售變動時依 SPEC「計算」重算
  sold_draws INTEGER NOT NULL DEFAULT 0,
  revenue INTEGER NOT NULL DEFAULT 0,
  breakeven_draws INTEGER,
  status TEXT NOT NULL DEFAULT 'selling' CHECK (status IN ('selling', 'sold_out')),
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX idx_sets_status_branch ON sets (status, branch_id);
CREATE INDEX idx_sets_barcode ON sets (barcode, created_at);
CREATE INDEX idx_sets_completed_at ON sets (completed_at);

CREATE TABLE sales (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  set_id TEXT NOT NULL REFERENCES sets(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  type TEXT NOT NULL CHECK (type IN ('normal', 'package', 'backfill')),
  sold_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX idx_sales_set ON sales (set_id, sold_at);
CREATE INDEX idx_sales_sold_at ON sales (sold_at);
CREATE INDEX idx_sales_branch_created ON sales (branch_id, created_at);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL CHECK (entity IN ('sale', 'set')),
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'revoke', 'delete', 'transfer')),
  "before" TEXT,
  "after" TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_audit_entity ON audit_log (entity, entity_id, id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO meta (key, value) VALUES ('data_version', '0');
