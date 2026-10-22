# 一番賞成本追蹤器

兩家分店共用的網頁系統：櫃檯用條碼槍刷一番賞外盒記帳，看板即時顯示每套離回本還有多遠，並提供營收報表。需求與決策見 [SPEC.md](SPEC.md)。

一個 Cloudflare Worker 同時提供 API（Hono）和前端（React），資料庫是 D1。

## 本機開發

需要 Node.js 22 以上。

```sh
npm install
cp .dev.vars.example .dev.vars   # 本機用的店主帳密，可以自己改
npm run db:migrate:local         # 建立本機 D1 資料表（只要跑一次；新增 migration 後再跑）
npm run dev                      # http://localhost:5173
```

## 帳號

- **店主**：`ADMIN_USERNAME`／`ADMIN_PASSWORD`（本機在 `.dev.vars`，正式環境是 Worker secret）。固定是管理員、不能停用；所有管理員密碼都忘了時用它登入。
- **其他人**：店主或管理員在「使用者」頁新增，角色分管理員和工作人員。工作人員只看得到櫃檯、看板（只有抽數）和本分店今天的銷售，API 也拿不到成本。
- 新電腦第一次要由管理員登入選分店，之後再登出、改登工作人員帳號。

本機資料存在 `.wrangler/state`，刪掉這個資料夾再跑一次 `db:migrate:local` 就是全新的資料庫。

## 測試

```sh
npm test            # 計算邏輯 + API（用 wrangler 的記憶體 D1 跑真的 migrations）
npm run typecheck
npm run build
```

## 結構

```
migrations/          D1 資料表（Branch、Set、Sale、AuditLog、Meta；0002 加上 User、Session、LoginAttempt）
src/shared/          前後端共用：回本計算、台灣時間換算、型別
src/worker/          Hono API
  auth.ts            登入、登入鎖定、requireAuth／requireAdmin
  passwords.ts       PBKDF2 密碼雜湊（受免費方案 10ms CPU 限制，1 萬次）
  sales-service.ts   新增、修改、撤銷銷售（同一個 batch 重算套的彙總欄位、寫修改紀錄、版本號加 1）
  db.ts              查詢與重算回本線的 SQL；toPublicSet() 是給工作人員的套資料（沒有成本）
  routes/            counter、sets、sales、dashboard、reports、audit、users
src/client/          React 前端
  pages/Counter.tsx  櫃檯：排隊送出、多套選單、斷線偵測與確認
tests/               vitest
```

## 分店名稱

`migrations/0001_init.sql` 預設建立「分店1」「分店2」。上線前想改成實際店名，直接改這個檔案裡的 `INSERT INTO branches`（還沒部署前改最簡單），或之後用 `wrangler d1 execute` 執行 `UPDATE branches SET name = ... WHERE id = ...`。

## 部署（還沒做）

1. `npx wrangler login`
2. `npx wrangler d1 create ichiban --location apac`，把拿到的 `database_id` 填進 `wrangler.jsonc`
3. `npx wrangler d1 migrations apply ichiban --remote`
4. `npx wrangler secret put ADMIN_USERNAME`、`npx wrangler secret put ADMIN_PASSWORD`
5. `npm run build && npx wrangler deploy`
