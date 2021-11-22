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
import { IFrameParams, IFrameWindow } from './IFrameHelper';

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

interface IFrameRequesthandlerParams extends IFrameParams {
  timeoutInSeconds?: number;
}
/**
 * Represents an AuthorizationRequestHandler which uses a standard
 * redirect based code flow.
 */
export class IFrameRequestHandler extends AuthorizationRequestHandler {
  private _IFrame: IFrameWindow | undefined;
  private _params?: IFrameRequesthandlerParams;
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

  setParams(params: IFrameRequesthandlerParams): void {
    this._params = params;
  }

  /**
   * Creates new IFrame and return a Promise that resolves to AuthorizationRequestResponse.
   * We can do this, as we do not reload this window.
   *
   * @param configuration OIDC config
   * @param request Auth Request
   */
  performAuthorizationRequest(
    configuration: AuthorizationServiceConfiguration,
    request: AuthorizationRequest,
  ): Promise<AuthorizationRequestResponse> {
    this._IFrame = new IFrameWindow(this._params);
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
    ]).catch((e) => {
      if (this._IFrame) {
        this._IFrame.abort();
      }
      return Promise.reject(
        new Error(`Failed to store OIDC request in local-storage: ${e}`),
      );
    });

    return persisted
      .then(() => {
        if (this._IFrame) {
          this._IFrame.navigate({
            url: this.buildRequestUrl(configuration, request),
            id: request.state,
          });
          // The IFrame notifies the opener and then the WindowIFrame promise resolves.
          return this._IFrame.promise
            .then((authorizationResponse) => {
              return Promise.all([
                this.storageBackend.removeItem(
                  AUTHORIZATION_REQUEST_HANDLE_KEY,
                ),
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
            })
            .catch((e) => {
              if (e.error != undefined) {
                return Promise.reject(e);
              } else {
                return Promise.reject(
                  new Error(
                    `Invalid response from completeAuthorizationRequest: ${e.toString()}`,
                  ),
                );
              }
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
            return Promise.reject(new Error('Failed to create / get IFrame'));
          });
        }
      })
      .catch((e) => {
        if (this._IFrame) {
          this._IFrame.abort();
        }
        return Promise.reject(e);
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
          return this.storageBackend
            .getItem(authorizationRequestKey(handle))
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
              if (state && (code || error)) {
                const shouldNotify = state === request.state;
                let authorizationResponse: AuthorizationResponse | null = null;
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
                  } else if (code) {
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
              return null;
            });
        } else {
          return null;
        }
      });
  }
}
