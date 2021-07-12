export { PopupWindow } from './PopupHelper';

export interface NavigateParams {
  timeoutInSeconds?: number;
}
export interface Navigate {
  navigate(params: NavigateParams): void;
}
export interface NavigationHelper {
  prepare(params: NavigateParams): Promise<Navigate>;
}
export const DEFAULT_AUTHORIZE_TIMEOUT_IN_SECONDS = 60;
