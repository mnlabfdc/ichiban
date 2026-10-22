-- 使用者與權限：每人一個帳號，角色分管理員（admin）和工作人員（staff）。

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
  -- 店主帳號（id = 'owner'）的密碼是 Worker secret，這裡為 NULL
  password_hash TEXT,
  disabled_at TEXT,
  created_at TEXT NOT NULL
);

-- 登入改成綁定使用者；原本共用帳號的登入全部失效，要重新登入
DROP TABLE sessions;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions (user_id);

-- 同一個帳號連續登入失敗太多次就暫時鎖住
CREATE TABLE login_attempts (
  username TEXT PRIMARY KEY COLLATE NOCASE,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);

-- 修改紀錄記下是誰做的（名稱存當時的快照）
ALTER TABLE audit_log ADD COLUMN user_id TEXT;
ALTER TABLE audit_log ADD COLUMN user_name TEXT;

-- sets.cost 要能是 NULL（工作人員開的新款，成本待補），sales 要加 created_by。
-- SQLite 不能改欄位限制，所以重建這兩張表：先建新表、搬資料，再刪舊表、改名。
-- 先刪 sales 再刪 sets，刪 sets 時就沒有表參照它；sets_new 改名成 sets 時，
-- SQLite 會把 sales_new 的外鍵一起改成參照 sets。

CREATE TABLE sets_new (
  id TEXT PRIMARY KEY,
  barcode TEXT NOT NULL,
  name TEXT NOT NULL,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  cost INTEGER,
  price_per_draw INTEGER NOT NULL,
  total_draws INTEGER NOT NULL,
  opening_draws INTEGER NOT NULL DEFAULT 0,
  opening_revenue INTEGER NOT NULL DEFAULT 0,
  sold_draws INTEGER NOT NULL DEFAULT 0,
  revenue INTEGER NOT NULL DEFAULT 0,
  breakeven_draws INTEGER,
  status TEXT NOT NULL DEFAULT 'selling' CHECK (status IN ('selling', 'sold_out')),
  created_at TEXT NOT NULL,
  completed_at TEXT
);

INSERT INTO sets_new (id, barcode, name, branch_id, cost, price_per_draw, total_draws, opening_draws,
  opening_revenue, sold_draws, revenue, breakeven_draws, status, created_at, completed_at)
SELECT id, barcode, name, branch_id, cost, price_per_draw, total_draws, opening_draws,
  opening_revenue, sold_draws, revenue, breakeven_draws, status, created_at, completed_at
FROM sets;

CREATE TABLE sales_new (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  set_id TEXT NOT NULL REFERENCES sets_new(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  type TEXT NOT NULL CHECK (type IN ('normal', 'package', 'backfill')),
  sold_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  created_by TEXT REFERENCES users(id)
);

INSERT INTO sales_new (id, client_id, set_id, branch_id, quantity, amount, type, sold_at, created_at, revoked_at)
SELECT id, client_id, set_id, branch_id, quantity, amount, type, sold_at, created_at, revoked_at
FROM sales;

DROP TABLE sales;
DROP TABLE sets;
ALTER TABLE sets_new RENAME TO sets;
ALTER TABLE sales_new RENAME TO sales;

CREATE INDEX idx_sets_status_branch ON sets (status, branch_id);
CREATE INDEX idx_sets_barcode ON sets (barcode, created_at);
CREATE INDEX idx_sets_completed_at ON sets (completed_at);
CREATE INDEX idx_sales_set ON sales (set_id, sold_at);
CREATE INDEX idx_sales_sold_at ON sales (sold_at);
CREATE INDEX idx_sales_branch_created ON sales (branch_id, created_at);
