export type SetStatus = "selling" | "sold_out";
export type SaleType = "normal" | "package" | "backfill";
export type AuditAction = "create" | "update" | "revoke" | "delete" | "transfer";
export type Role = "admin" | "staff";

export interface Branch {
  id: number;
  name: string;
}

/** 登入中的使用者 */
export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  /** 店主帳號：密碼在 Worker secret，不能在系統裡修改 */
  isOwner: boolean;
}

export interface UserDto extends AuthUser {
  disabled: boolean;
  createdAt: string;
}

/** 工作人員也能看到的套資料：沒有成本、已收金額、回本線，反推不出成本 */
export interface PublicSetDto {
  id: string;
  barcode: string;
  name: string;
  branchId: number;
  branchName: string;
  pricePerDraw: number;
  totalDraws: number;
  /** 已賣抽數（含期初） */
  soldDraws: number;
  status: SetStatus;
  createdAt: string;
  completedAt: string | null;
}

/** 管理員看到的完整套資料 */
export interface SetDto extends PublicSetDto {
  /** null：工作人員開的新款，成本待補 */
  cost: number | null;
  openingDraws: number;
  openingRevenue: number;
  /** 已收金額（含期初） */
  revenue: number;
  /** 已回本時的回本線位置；還沒回本或成本待補時為 null */
  breakevenDraws: number | null;
  /** 只有套管理列表會帶：有沒有任何銷售紀錄（含已撤銷） */
  hasSales?: boolean;
}

export interface SaleDto {
  id: string;
  clientId: string;
  setId: string;
  setName: string;
  branchId: number;
  branchName: string;
  quantity: number;
  amount: number;
  type: SaleType;
  soldAt: string;
  createdAt: string;
  revokedAt: string | null;
  /** 登打的人；上線使用者功能之前的紀錄為 null */
  createdByName: string | null;
}

export interface AuditEntry {
  id: number;
  entity: "sale" | "set";
  entityId: string;
  action: AuditAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  userName: string | null;
  createdAt: string;
}

export interface ApiErrorBody {
  error: string;
  code: string;
  remaining?: number;
}

/** 櫃檯的結果只帶工作人員也能看的套資料 */
export interface CounterSale {
  sale: SaleDto;
  set: PublicSetDto;
}

export type ScanResponse =
  | ({ status: "recorded"; duplicate: boolean } & CounterSale)
  | { status: "choose"; candidates: PublicSetDto[] };

export interface SaleWithSet {
  sale: SaleDto;
  set: SetDto;
}

export interface DashboardResponse {
  version: number;
  branches: Branch[];
  /** 管理員拿到 SetDto，工作人員拿到 PublicSetDto */
  sets: (SetDto | PublicSetDto)[];
}

/** 開套時帶入同條碼最近一套的資料；工作人員拿不到 cost */
export interface SetPrefill {
  name: string;
  pricePerDraw: number;
  totalDraws: number;
  cost?: number | null;
}

export interface ReportResponse {
  from: string;
  to: string;
  branches: Branch[];
  totals: { branchId: number; revenue: number; draws: number }[];
  days: { date: string; branchId: number; revenue: number; draws: number }[];
  perSet: { setId: string; setName: string; branchId: number; draws: number; revenue: number }[];
  completed: SetDto[];
}

export function hasCostInfo(set: SetDto | PublicSetDto): set is SetDto {
  return "revenue" in set;
}

export const SALE_TYPE_LABEL: Record<SaleType, string> = {
  normal: "一般",
  package: "包套",
  backfill: "補登",
};

export const STATUS_LABEL: Record<SetStatus, string> = {
  selling: "販售中",
  sold_out: "完售",
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: "管理員",
  staff: "工作人員",
};
