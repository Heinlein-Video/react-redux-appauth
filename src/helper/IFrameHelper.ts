/**
 * Copyright (c) Brock Allen & Dominick Baier.
 * Modified by Rudi Floren <r.floren@heinlein-video.de>
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

export interface IFrameParams {
  id?: string;
  url?: string;
  popupClosedTimerInMilliseconds?: number;
}

interface CustomIFrame extends HTMLIFrameElement {
  callbacks?: {
    [index: string]: (
      request: AuthorizationRequest,
      response: AuthorizationResponse | null,
      error: AuthorizationError | null,
    ) => void;
  };
}

/**
 * A Helper class implementing navigate to open a popup and to notify the parent window via postMessage.
 */
export class IFrameWindow implements Navigate {
  private _promise: Promise<AuthorizationResponse>;
  private _resolve: (value: AuthorizationResponse) => void = () => {};
  private _reject: (reason?: Error | AuthorizationError) => void = () => {};
  private _iframe: CustomIFrame | null;
  private _timeoutTimer: number | undefined;
  private _iframeEventListener: ((e: MessageEvent) => void) | undefined;

  constructor(params?: IFrameParams) {
    this._promise = new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });

    this._iframe = window.document.createElement('iframe');

    // shotgun approach
    this._iframe.style.visibility = 'hidden';
    this._iframe.style.position = 'absolute';
    this._iframe.width = '0px';
    this._iframe.height = '0px';
    if (params?.id) {
      this._iframe.id = params.id;
    }

    window.document.body.appendChild(this._iframe);
  }

  get promise(): Promise<AuthorizationResponse> {
    return this._promise;
  }

  /**
   * Navigates the iframe to the url given in Params
   * @param params NavigateParams & PopupParams
   * @returns
   */
  navigate(
    params: NavigateParams & IFrameParams,
  ): Promise<AuthorizationResponse> {
    if (!this._iframe) {
      this._reject(
        new Error('PopupWindow.navigate: Error opening popup window'),
      );
    } else if (!params || !params.url) {
      this._reject(new Error('PopupWindow.navigate: no url provided'));
      this._reject(new Error('No url provided'));
    } else {
      this._timeoutTimer = setTimeout(() => {
        this.cleanup();
        this._reject(new Error('IFrame Timeout'));
      }, (params.timeoutInSeconds || DEFAULT_AUTHORIZE_TIMEOUT_IN_SECONDS) * 1000);

      this._iframeEventListener = (e: MessageEvent) => {
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

      window.addEventListener('message', this._iframeEventListener);

      this._iframe.contentWindow?.location.replace(params.url);
    }

    return this.promise;
  }

  /**
   * Cleans up timers, handlers and removes the iframe
   */
  private cleanup() {
    if (this._timeoutTimer !== null) {
      window.clearTimeout(this._timeoutTimer);
    }
    this._timeoutTimer = undefined;
    if (this._iframeEventListener) {
      window.removeEventListener('message', this._iframeEventListener, false);
    }

    if (this._iframe) {
      window.document.body.removeChild(this._iframe);
    }
    this._iframe = null;
  }

  /**
   * Aborts the current iframe try.
   */
  abort(): void {
    if (this._timeoutTimer !== null) {
      window.clearTimeout(this._timeoutTimer);
    }
    this._timeoutTimer = undefined;
    if (this._iframeEventListener) {
      window.removeEventListener('message', this._iframeEventListener, false);
    }

    if (this._iframe) {
      window.document.body.removeChild(this._iframe);
    }
    this._iframe = null;
  }

  static notifyOpener(
    request: AuthorizationRequest,
    response: AuthorizationResponse | null,
    error: AuthorizationError | null,
  ): void {
    if (window.parent && window != window.parent) {
      // Send a postMessage with the response to the opening window (only if it was on the same domain)
      window.parent.postMessage(
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
