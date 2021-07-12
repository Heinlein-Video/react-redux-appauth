/**
 * Copyright (c) Brock Allen & Dominick Baier.
 * Modified by Rudi Floren <r.florenqheinlein-video.de>
 * Originally licensed under the Apache License, Version 2.0
 */

import {
  AuthorizationError,
  AuthorizationRequest,
  AuthorizationResponse,
} from '@openid/appauth';
import {
  NavigateParams,
  Navigate,
  DEFAULT_AUTHORIZE_TIMEOUT_IN_SECONDS,
} from '.';
import { AuthPostMessage } from '../AuthInterface';

export interface PopupParams {
  popupWindowTarget?: string;
  popupWindowFeatures?: string;
  id?: string;
  url?: string;
  popupClosedTimerInMilliseconds?: number;
}

interface CustomWindow extends Window {
  callbacks?: {
    [index: string]: (
      request: AuthorizationRequest,
      response: AuthorizationResponse | null,
      error: AuthorizationError | null,
    ) => void;
  };
}

const CheckForPopupClosedInterval = 500;
const DefaultPopupFeatures =
  'location=no,toolbar=no,width=500,height=500,left=100,top=100;';

const DefaultPopupTarget = '_blank';

/**
 * A Helper class implementing navigate to open a popup and to notify the parent window via postMessage.
 */
export class PopupWindow implements Navigate {
  private _promise: Promise<AuthorizationResponse>;
  private _resolve: (value: AuthorizationResponse) => void = () => {};
  private _reject: (reason?: Error | AuthorizationError) => void = () => {};
  private _popup: CustomWindow | null;
  private _checkForPopupClosedTimer: number | undefined;
  private _popupEventListener: ((e: MessageEvent) => void) | undefined;

  constructor(params?: PopupParams) {
    this._promise = new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });

    const target = params
      ? params.popupWindowTarget || DefaultPopupTarget
      : DefaultPopupTarget;
    const features = params
      ? params.popupWindowFeatures || DefaultPopupFeatures
      : DefaultPopupFeatures;

    this._popup = window.open('', target, features);
  }

  get promise(): Promise<AuthorizationResponse> {
    return this._promise;
  }

  /**
   * Navigates the popup to the url given in Params
   * @param params NavigateParams & PopupParams
   * @returns
   */
  navigate(
    params: NavigateParams & PopupParams,
  ): Promise<AuthorizationResponse> {
    if (!this._popup) {
      this._reject(
        new Error('PopupWindow.navigate: Error opening popup window'),
      );
    } else if (!params || !params.url) {
      this._reject(new Error('PopupWindow.navigate: no url provided'));
      this._reject(new Error('No url provided'));
    } else {
      this._checkForPopupClosedTimer = window.setInterval(() => {
        if (!this._popup || this._popup.closed) {
          this.cleanup();
          clearTimeout(timeoutId);
          this._reject(new Error('Popup window closed'));
        }
      }, params.popupClosedTimerInMilliseconds || CheckForPopupClosedInterval);

      const timeoutId = setTimeout(() => {
        clearInterval(this._checkForPopupClosedTimer);
        this.cleanup();
        this._reject(new Error('Popup Timeout'));
      }, (params.timeoutInSeconds || DEFAULT_AUTHORIZE_TIMEOUT_IN_SECONDS) * 1000);

      this._popupEventListener = (e: MessageEvent) => {
        if (!e.data || e.data.type !== 'authorization_response') {
          return;
        }

        this.cleanup();
        if (e.data.response) {
          return this._resolve(e.data.response);
        }
        if (e.data.error) {
          return this._reject(e.data.error);
        }
        return this._reject(
          new Error('OIDC: Both response and error where empty'),
        );
      };

      window.addEventListener('message', this._popupEventListener);

      this._popup.focus();
      this._popup.window.location.replace(params.url);
    }

    return this.promise;
  }

  /**
   * Cleans up timers, handlers and closes the popup
   */
  private cleanup() {
    if (this._checkForPopupClosedTimer !== null) {
      window.clearInterval(this._checkForPopupClosedTimer);
    }
    this._checkForPopupClosedTimer = undefined;
    if (this._popupEventListener) {
      window.removeEventListener('message', this._popupEventListener, false);
    }

    if (this._popup) {
      this._popup.close();
    }
    this._popup = null;
  }

  /**
   * Aborts the current Popup try.
   */
  abort(): void {
    if (this._checkForPopupClosedTimer !== null) {
      window.clearInterval(this._checkForPopupClosedTimer);
    }
    this._checkForPopupClosedTimer = undefined;
    if (this._popupEventListener) {
      window.removeEventListener('message', this._popupEventListener, false);
    }

    if (this._popup) {
      this._popup.close();
    }
    this._popup = null;
  }

  static notifyOpener(
    request: AuthorizationRequest,
    response: AuthorizationResponse | null,
    error: AuthorizationError | null,
  ): void {
    if (window.opener && window != window.opener) {
      // Send a postMessage with the response to the opening window (only if it was on the same domain)
      window.opener.postMessage(
        {
          type: 'authorization_response',
          request: request,
          response: response,
          error: error,
        } as AuthPostMessage,
        window.location.origin,
      );
    }
  }
}
