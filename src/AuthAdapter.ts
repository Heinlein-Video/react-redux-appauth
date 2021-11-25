import {
  AppAuthError,
  AuthorizationNotifier,
  AuthorizationRequest,
  AuthorizationRequestHandler,
  AuthorizationRequestResponse,
  AuthorizationServiceConfiguration,
  BaseTokenRequestHandler,
  DefaultCrypto,
  FetchRequestor,
  GRANT_TYPE_AUTHORIZATION_CODE,
  GRANT_TYPE_REFRESH_TOKEN,
  LocalStorageBackend,
  nowInSeconds,
  RedirectRequestHandler,
  StringMap,
  TokenError,
  TokenErrorJson,
  TokenRequest,
  TokenResponse,
  TokenResponseJson,
} from '@openid/appauth';
import {
  AuthProviderSignInProps,
  AuthProviderSignOutProps,
} from './AuthInterface';
import { IResponse } from './AuthSlice';
import { IFrameWindow } from './helper/IFrameHelper';
import { IFrameRequestHandler } from './helper/IFrameRequestHandler';
import { PopupWindow } from './helper/PopupHelper';
import { PopupRequestHandler } from './helper/PopupRequestHandler';
import { UnixTimeStamp } from './util';

export enum EventType {
  EXPIRED,
  RENEWED,
}

const TIMER_DURATION = 5 * 1000; // 5s in ms

export interface AuthSettings {
  clientId: string;
  redirectUri: string;
  authority: string;
  silentRedirectUri?: string;
  extras?: StringMap;
  scope: string;
  silentRequestTimeout?: number;
  popupRedirectUri?: string;
  signoutRedirectUri?: string;
}

/**
 * AuthAdapter, a wrapper around appauth-js to provide a OIDC library in one class.
 */
export class AuthAdapter {
  private _notifier: AuthorizationNotifier;
  private _authorizationHandler: AuthorizationRequestHandler;
  private _tokenHandler: ExtendedTokenRequestHandler;

  private _configuration: AuthorizationServiceConfiguration | undefined;

  private _refreshToken: string | undefined;
  private _accessTokenResponse: ExtendedOidcTokenResponse | undefined;
  private _timerHandle: ReturnType<typeof setInterval>;

  private _settings: AuthSettings;
  private _crypto = new DefaultCrypto();
  private _localStorage = new LocalStorageBackend();

  private _handlers: Array<
    (type: EventType, token_response: ExtendedOidcTokenResponse) => void
  > = [];
  private _popupAuthorizationHandler: PopupRequestHandler;
  private _popupNotifier: AuthorizationNotifier;

  private _iframeAuthorizationHandler: IFrameRequestHandler;
  private _iframeNotifier: AuthorizationNotifier;

  constructor(settings: AuthSettings) {
    this._notifier = new AuthorizationNotifier();
    this._popupNotifier = new AuthorizationNotifier();
    this._iframeNotifier = new AuthorizationNotifier();
    this._authorizationHandler = new RedirectRequestHandler(this._localStorage);
    this._popupAuthorizationHandler = new PopupRequestHandler(
      this._localStorage,
    );
    this._iframeAuthorizationHandler = new IFrameRequestHandler(
      this._localStorage,
    );
    const fetchRequestor = new FetchRequestor();
    this._tokenHandler = new ExtendedTokenRequestHandler(fetchRequestor);

    // set notifier to deliver responses
    this._authorizationHandler.setAuthorizationNotifier(this._notifier);
    this._popupAuthorizationHandler.setAuthorizationNotifier(
      this._popupNotifier,
    );
    this._iframeAuthorizationHandler.setAuthorizationNotifier(
      this._iframeNotifier,
    );

    // interval that checks if a token is about to expire
    this._timerHandle = setInterval(() => this.checkExpire(), TIMER_DURATION);

    this._settings = settings;

    // set a listener to listen for authorization responses
    // make refresh and access token requests.
    this._notifier.setAuthorizationListener((request, response, error) => {
      console.log('Authorization request complete ', request, response, error);
      if (response) {
        let codeVerifier: string | undefined;
        if (request.internal && request.internal.code_verifier) {
          codeVerifier = request.internal.code_verifier;
        }
        this.finishAuthorization(response.code, codeVerifier)
          .then(() => this.refreshTokens())
          .then(() => {
            this._handlers.forEach((fn) => {
              fn(EventType.RENEWED, this._accessTokenResponse!);
            });
            console.log('All Done.');
          });
      }
    });

    this._popupNotifier.setAuthorizationListener((request, response, error) => {
      PopupWindow.notifyOpener(request, response, error);
    });

    this._iframeNotifier.setAuthorizationListener(
      (request, response, error) => {
        IFrameWindow.notifyOpener(request, response, error);
      },
    );
  }

  /**
   * Check if one of the two tokens is about to expire
   * For now we always auto renew the token.
   */
  checkExpire(): void {
    if (this._accessTokenResponse) {
      if (!this._accessTokenResponse.isValid(-60)) {
        this.refreshTokens().then(() => {
          this._handlers.forEach((fn) => {
            fn(EventType.RENEWED, this._accessTokenResponse!);
          });
        });
      }
      if (!this._accessTokenResponse.isRefreshValid()) {
        this.refreshTokens().then(() => {
          this._handlers.forEach((fn) => {
            fn(EventType.RENEWED, this._accessTokenResponse!);
          });
        });
      }
    }
  }
  /**
   * Adds a eventHandler to the list of handlers
   * @param fn eventHandler
   */
  addHandler(
    fn: (type: EventType, token_response: ExtendedOidcTokenResponse) => void,
  ): void {
    this._handlers.push(fn);
  }

  /**
   * Remove eventHandler from the list of handlers
   * @param fnToRemove eventHandler
   */
  removeHandler(
    fnToRemove: (
      type: EventType,
      token_response: ExtendedOidcTokenResponse,
    ) => void,
  ): void {
    this._handlers = this._handlers.filter((fn) => {
      if (fn != fnToRemove) return fn;
    });
  }

  fetchServiceConfiguration(): Promise<void> {
    const fetcher = new FetchRequestor();
    return AuthorizationServiceConfiguration.fetchFromIssuer(
      this.authority,
      fetcher,
    ).then((response) => {
      // Todo use a logger with variable loglevels here
      console.log('Fetched service configuration', response);
      this._configuration = response;
    });
  }

  get clientId(): string {
    return this._settings.clientId;
  }

  get authority(): string {
    return this._settings.authority;
  }

  /**
   * Exchange code at token endpoint to get access_token, etc.
   * @param code The code returned by the OIDC IP
   * @param codeVerifier Used code verifier
   * @returns
   */
  private finishAuthorization(
    code: string,
    codeVerifier: string | undefined,
    popup = false,
  ): Promise<void> {
    if (!this._configuration) {
      return Promise.reject(new Error('Unknown service configuration'));
    }

    const extras: StringMap = {};

    if (codeVerifier) {
      extras.code_verifier = codeVerifier;
    }

    // use the code to make the token request.
    const request = new TokenRequest({
      client_id: this.clientId,
      redirect_uri: popup
        ? this._settings.popupRedirectUri!
        : this._settings.redirectUri,
      grant_type: GRANT_TYPE_AUTHORIZATION_CODE,
      code: code,
      refresh_token: undefined,
      extras: extras,
    });

    return this._tokenHandler
      .performTokenRequest(this._configuration, request)
      .then((response) => {
        // Todo use a logger with variable loglevels here
        console.log(`Access Token is ${response.accessToken}`);
        console.log(`Refresh Token is ${response.refreshToken}`);
        this._refreshToken = response.refreshToken;
        this._accessTokenResponse = response;
        return response;
      })
      .then(() => {});
  }

  /**
   * Refresh Token
   * @returns Promise<access_token as string>
   */
  refreshTokens(): Promise<string> {
    if (!this._configuration) {
      return Promise.reject(new Error('Unknown service configuration'));
    }
    if (!this._refreshToken) {
      return Promise.reject(new Error('Missing refreshToken.'));
    }
    if (this._accessTokenResponse && this._accessTokenResponse.isValid()) {
      // do nothing
      return Promise.resolve(this._accessTokenResponse.accessToken);
    }

    const request = new TokenRequest({
      client_id: this.clientId,
      redirect_uri: this._settings.redirectUri,
      grant_type: GRANT_TYPE_REFRESH_TOKEN,
      code: undefined,
      refresh_token: this._refreshToken,
      extras: undefined,
    });

    return this._tokenHandler
      .performTokenRequest(this._configuration, request)
      .then((response) => {
        this._accessTokenResponse = response;
        this._refreshToken = response.refreshToken;
        return response.accessToken;
      });
  }

  /**
   * Check if we have a current login attempt and try to complete it depending on the type
   * @returns
   */
  completeAuthorizationRequestIfPossible(): Promise<void> {
    // Check if we have a current login attempt.
    return this._localStorage
      .getItem('appauth_current_authorization_request')
      .then((handle) => {
        if (handle) {
          return this._localStorage
            .getItem(`${handle}_appauth_authorization_request`)
            .then((result) => JSON.parse(result!))
            .then((json) => new AuthorizationRequest(json))
            .then((request) => {
              if (request.internal && request.internal.request_type) {
                switch (request.internal.request_type) {
                  default:
                  case 'redirect':
                    return this._authorizationHandler.completeAuthorizationRequestIfPossible();
                  case 'popup':
                    return this._popupAuthorizationHandler.completeAuthorizationRequestIfPossible();
                  case 'iframe':
                    return this._iframeAuthorizationHandler.completeAuthorizationRequestIfPossible();
                }
              } else {
                return this._authorizationHandler.completeAuthorizationRequestIfPossible();
              }
            });
        }
      });
  }

  signInRedirect(args?: {
    extras?: { response_mode?: string };
  }): Promise<void> {
    if (!args) {
      args = { extras: { response_mode: 'fragment' } };
    }
    if (args && !args.extras) {
      args.extras = { response_mode: 'fragment' };
    }

    const internal = {
      request_type: 'redirect',
    };

    // create a request
    const request = new AuthorizationRequest({
      client_id: this.clientId,
      redirect_uri: this._settings.redirectUri,
      scope: this._settings.scope,
      response_type: AuthorizationRequest.RESPONSE_TYPE_CODE,
      state: undefined,
      extras: args.extras,
      internal: internal,
    });

    // Set Code Verifier for PKCE
    request.setupCodeVerifier();

    if (this._configuration) {
      this._authorizationHandler.performAuthorizationRequest(
        this._configuration,
        request,
      );
      return Promise.resolve();
    } else {
      return Promise.reject('Missing configuration');
    }
  }

  signInSilent(args: AuthProviderSignInProps): Promise<void | string> {
    if (this._refreshToken) {
      return this.refreshTokens();
    } else {
      return this.signInSilentIFrame(args);
    }
  }

  signInPopup(args: AuthProviderSignInProps): Promise<void> {
    if (!args) {
      args = { extras: { response_mode: 'fragment' } };
    }
    if (!args.extras) {
      args.extras = { response_mode: 'fragment' };
    }

    const internal = {
      request_type: 'popup',
    };

    const request = new AuthorizationRequest({
      client_id: this.clientId,
      redirect_uri:
        this._settings.popupRedirectUri || this._settings.redirectUri,
      scope: this._settings.scope,
      response_type: AuthorizationRequest.RESPONSE_TYPE_CODE,
      state: undefined,
      extras: args && args.extras ? args.extras : {},
      internal: internal,
    });

    // Set Code Verifier for PKCE
    request.setupCodeVerifier();

    if (this._configuration) {
      return this._popupAuthorizationHandler
        .performAuthorizationRequest(this._configuration, request)
        .then(({ request, response }: AuthorizationRequestResponse) => {
          if (response !== null) {
            let codeVerifier: string | undefined;
            if (request.internal && request.internal.code_verifier) {
              codeVerifier = request.internal.code_verifier;
            }
            return this.finishAuthorization(response.code, codeVerifier, true)
              .then(() => this.refreshTokens())
              .then(() => {
                this._handlers.forEach((fn) => {
                  fn(EventType.RENEWED, this._accessTokenResponse!);
                });
                console.log('All Done.');
              });
          }
        });
    } else {
      return Promise.reject('Missing configuration');
    }
  }

  /**
   * Signout with our redirect
   * @param args AuthProviderSignOutProps
   */
  signOut(): void {
    this._accessTokenResponse = undefined;
    this._refreshToken = undefined;
  }

  signOutRedirect(args: AuthProviderSignOutProps): void {
    const query = new URLSearchParams();
    query.append('client_id', this.clientId);
    if (this._accessTokenResponse && this._accessTokenResponse.idToken) {
      query.append('id_token_hint', this._accessTokenResponse.idToken);
    }
    query.append(
      'post_logout_redirect_uri',
      args.redirectUri ||
        this._settings.signoutRedirectUri ||
        this._settings.redirectUri,
    );

    this._accessTokenResponse = undefined;
    this._refreshToken = undefined;
  }

  private signInSilentIFrame(args: AuthProviderSignInProps = {}) {
    const url =
      args.redirect_uri ||
      this._settings.silentRedirectUri ||
      this._settings.redirectUri;

    if (!args) {
      args = { extras: { response_mode: 'fragment' } };
    }
    if (!args.extras) {
      args.extras = { response_mode: 'fragment' };
    }

    args.extras.prompt = args.extras.prompt || 'none';

    const internal = {
      request_type: 'iframe',
    };

    const request = new AuthorizationRequest({
      client_id: this.clientId,
      redirect_uri: url,
      scope: this._settings.scope,
      response_type: AuthorizationRequest.RESPONSE_TYPE_CODE,
      state: undefined,
      extras: args && args.extras ? args.extras : {},
      internal: internal,
    });

    // Set Code Verifier for PKCE
    request.setupCodeVerifier();

    if (this._configuration) {
      return this._iframeAuthorizationHandler
        .performAuthorizationRequest(this._configuration, request)
        .then(({ request, response, error }: AuthorizationRequestResponse) => {
          if (response !== null) {
            let codeVerifier: string | undefined;
            if (request.internal && request.internal.code_verifier) {
              codeVerifier = request.internal.code_verifier;
            }
            return this.finishAuthorization(response.code, codeVerifier, true)
              .then(() => this.refreshTokens())
              .then(() => {
                this._handlers.forEach((fn) => {
                  fn(EventType.RENEWED, this._accessTokenResponse!);
                });
                console.log('All Done.');
              });
          } else if (error !== null) {
            if (error.error === 'login_required') {
              return Promise.reject('login_required');
            }
          }
        });
    } else {
      return Promise.reject(new Error('Missing configuration'));
    }
  }
}

// OIDC Specifics
export interface ExtendedTokenResponseJson extends TokenResponseJson {
  refresh_expires_in?: string;
  session_state?: string;
  'not-before-policy'?: boolean;
}

export class ExtendedOidcTokenResponse extends TokenResponse {
  refreshExpiresIn: number | undefined;
  sessionState: string | undefined;
  notBeforePolicy: boolean | undefined;

  constructor(response: ExtendedTokenResponseJson) {
    super(response);
    if (response.refresh_expires_in) {
      this.refreshExpiresIn = parseInt(response.refresh_expires_in, 10);
    }
    if (response.session_state) {
      this.sessionState = response.session_state;
    }
    if (response['not-before-policy']) {
      this.notBeforePolicy = response['not-before-policy'];
    }
  }

  toJson(): ExtendedTokenResponseJson {
    return {
      access_token: this.accessToken,
      id_token: this.idToken,
      refresh_token: this.refreshToken,
      refresh_expires_in: this.refreshExpiresIn?.toString(),
      scope: this.scope,
      token_type: this.tokenType,
      issued_at: this.issuedAt,
      expires_in: this.expiresIn?.toString(),
      session_state: this.sessionState,
      'not-before-policy': this.notBeforePolicy,
    };
  }

  toReduxState(): Promise<IResponse> {
    if (
      this.expiresIn === null ||
      this.idToken === null ||
      this.refreshToken === null ||
      this.refreshExpiresIn === null ||
      this.sessionState === null ||
      this.scope === null ||
      this.sessionState === null
    ) {
      return Promise.reject(
        'Missing extended OIDC (expiresIn, idToken, refreshExpiresIn or sessionState',
      );
    }
    return Promise.resolve({
      access_token: this.accessToken,
      access_token_expire: ((this.issuedAt + this.expiresIn!) *
        1000) as UnixTimeStamp,
      id_token: this.idToken!,
      refresh_token: this.refreshToken!,
      refresh_token_expire: (this.issuedAt +
        this.expiresIn! * 1000) as UnixTimeStamp,
      scope: this.scope!,
      session_id: this.sessionState!,
    });
  }

  isRefreshValid(buffer: number = 10 * 60 * -1): boolean {
    if (this.refreshExpiresIn) {
      const now = nowInSeconds();
      return now < this.issuedAt + this.refreshExpiresIn + buffer;
    } else {
      return true;
    }
  }
}

class ExtendedTokenRequestHandler extends BaseTokenRequestHandler {
  private isExtendedTokenResponse(
    response: ExtendedTokenResponseJson | TokenErrorJson,
  ): response is ExtendedTokenResponseJson {
    return (response as TokenErrorJson).error === undefined;
  }

  performTokenRequest(
    configuration: AuthorizationServiceConfiguration,
    request: TokenRequest,
  ): Promise<ExtendedOidcTokenResponse> {
    const cleaned_request = request.toStringMap();
    if (request.grantType === GRANT_TYPE_REFRESH_TOKEN) {
      delete cleaned_request['redirect_uri'];
    }
    const tokenResponse = this.requestor.xhr<
      ExtendedTokenResponseJson | TokenErrorJson
    >({
      url: configuration.tokenEndpoint,
      method: 'POST',
      dataType: 'json', // adding implicit dataType
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: this.utils.stringify(request.toStringMap()),
    });

    return tokenResponse.then((response) => {
      if (this.isExtendedTokenResponse(response)) {
        return new ExtendedOidcTokenResponse(response);
      } else {
        return Promise.reject<ExtendedOidcTokenResponse>(
          new AppAuthError(response.error, new TokenError(response)),
        );
      }
    });
  }
}
