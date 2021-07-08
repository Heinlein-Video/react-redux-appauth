/*
 * Copyright 2017 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the
 * License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  AuthorizationError,
  AuthorizationRequest,
  AuthorizationRequestHandler,
  AuthorizationRequestResponse,
  AuthorizationResponse,
  AuthorizationServiceConfiguration,
  BasicQueryStringUtils,
  Crypto,
  DefaultCrypto,
  LocalStorageBackend,
  StorageBackend,
} from '@openid/appauth';
import { PopupParams, PopupWindow } from './PopupHelper';

/** key for authorization request. */
const authorizationRequestKey = (handle: string) => {
  return `${handle}_appauth_authorization_request`;
};

/** key for authorization service configuration */
const authorizationServiceConfigurationKey = (handle: string) => {
  return `${handle}_appauth_authorization_service_configuration`;
};

/** key in local storage which represents the current authorization request. */
const AUTHORIZATION_REQUEST_HANDLE_KEY =
  'appauth_current_authorization_request';

interface PopupRequesthandlerParams extends PopupParams {
  timeoutInSeconds?: number
}
/**
 * Represents an AuthorizationRequestHandler which uses a standard
 * redirect based code flow.
 */
export class PopupRequestHandler extends AuthorizationRequestHandler {
  private _popup: PopupWindow | undefined;
  private _params?: PopupRequesthandlerParams;
  constructor(
    // use the provided storage backend
    // or initialize local storage with the default storage backend which
    // uses window.localStorage
    public storageBackend: StorageBackend = new LocalStorageBackend(),
    utils = new BasicQueryStringUtils(),
    crypto: Crypto = new DefaultCrypto(),
  ) {
    super(utils, crypto);
  }

  setParams(params: PopupRequesthandlerParams): void {
    this._params = params;
  }

  /**
   * Opens a new popup and return a Promise that resolves to AuthorizationRequestResponse.
   * We can do this, as we do not reload this window.
   *
   * @param configuration OIDC config
   * @param request Auth Request
   */
  performAuthorizationRequest(
    configuration: AuthorizationServiceConfiguration,
    request: AuthorizationRequest,
  ): Promise<AuthorizationRequestResponse> {
    const handle = this.crypto.generateRandom(10);

    // before you make request, persist all request related data in local storage.
    const persisted = Promise.all([
      this.storageBackend.setItem(AUTHORIZATION_REQUEST_HANDLE_KEY, handle),
      // Calling toJson() adds in the code & challenge when possible
      request
        .toJson()
        .then((result) =>
          this.storageBackend.setItem(
            authorizationRequestKey(handle),
            JSON.stringify(result),
          ),
        ),
      this.storageBackend.setItem(
        authorizationServiceConfigurationKey(handle),
        JSON.stringify(configuration.toJson()),
      ),
    ]);

    return persisted.then(() => {
      this._popup = new PopupWindow(this._params);
      if (this._popup) {
        this._popup.navigate({
          url: this.buildRequestUrl(configuration, request),
          id: request.state,
        });
        // The Popup notifies the opener and then the WindowPopup promise resolves.
        return this._popup.promise.then((authorizationResponse) => {
          return Promise.all([
            this.storageBackend.removeItem(AUTHORIZATION_REQUEST_HANDLE_KEY),
            this.storageBackend.removeItem(authorizationRequestKey(handle)),
            this.storageBackend.removeItem(
              authorizationServiceConfigurationKey(handle),
            ),
          ]).then(() => {
            console.log('Delivering authorization response');
            return {
              request: request,
              response: authorizationResponse,
              error: null,
            } as AuthorizationRequestResponse;
          });
        });
      } else {
        // Cleanup
        return Promise.all([
          this.storageBackend.removeItem(AUTHORIZATION_REQUEST_HANDLE_KEY),
          this.storageBackend.removeItem(authorizationRequestKey(handle)),
          this.storageBackend.removeItem(
            authorizationServiceConfigurationKey(handle),
          ),
        ]).then(() => {
          return Promise.reject('Failed to create / get popup');
        });
      }
    });
  }

  /**
   * Attempts to introspect the contents of storage backend and returns a AuthorizationRequestResponse if the Response is meant for the current request.
   */
  protected completeAuthorizationRequest(): Promise<AuthorizationRequestResponse | null> {
    return this.storageBackend
      .getItem(AUTHORIZATION_REQUEST_HANDLE_KEY)
      .then((handle) => {
        if (handle) {
          // we have a pending request.
          // fetch authorization request, and check state
          return (
            this.storageBackend
              .getItem(authorizationRequestKey(handle))
              // requires a corresponding instance of result
              // TODO(rahulrav@): check for inconsitent state here
              .then((result) => JSON.parse(result!))
              .then((json) => new AuthorizationRequest(json))
              .then((request) => {
                // check redirect_uri and state
                const queryParams = new URLSearchParams(
                  window.location.hash.replace('#', '?'),
                );
                const state: string | undefined =
                  queryParams.get('state') || undefined;
                const code: string | undefined =
                  queryParams.get('code') || undefined;
                const error: string | undefined =
                  queryParams.get('error') || undefined;
                if (state && code) {
                  const shouldNotify = state === request.state;
                  let authorizationResponse: AuthorizationResponse | null =
                    null;
                  let authorizationError: AuthorizationError | null = null;
                  if (shouldNotify) {
                    if (error) {
                      // get additional optional info.
                      const errorUri = queryParams.get('error_uri') || undefined;
                      const errorDescription =
                        queryParams.get('error_description') || undefined;
                      authorizationError = new AuthorizationError({
                        error: error,
                        error_description: errorDescription,
                        error_uri: errorUri,
                        state: state,
                      });
                    } else {
                      authorizationResponse = new AuthorizationResponse({
                        code: code,
                        state: state,
                      });
                    }
                    return {
                      request: request,
                      response: authorizationResponse,
                      error: authorizationError,
                    } as AuthorizationRequestResponse;
                  }
                }
                return Promise.resolve(null);
              })
          );
        } else {
          return null;
        }
      });
  }
}
