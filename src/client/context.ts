import { createContext, useContext } from "react";
import type { AuthUser, Branch } from "../shared/types";

export interface AppState {
  user: AuthUser;
  isAdmin: boolean;
  branches: Branch[];
  /** 這台電腦所屬的分店 */
  branchId: number;
  branchName: string;
  branchNameOf: (id: number) => string;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const state = useContext(AppContext);
  if (!state) throw new Error("AppContext 未設定");
  return state;
}
