import {
  AppAuthError,
  AuthorizationNotifier,
  AuthorizationRequest,
  AuthorizationRequestHandler,
  AuthorizationServiceConfiguration,
  BaseTokenRequestHandler,
  FetchRequestor,
  GRANT_TYPE_AUTHORIZATION_CODE,
  GRANT_TYPE_REFRESH_TOKEN,
  nowInSeconds,
  RedirectRequestHandler,
  StringMap,
  TokenError,
  TokenErrorJson,
  TokenRequest,
  TokenRequestHandler,
  TokenResponse,
  TokenResponseJson,
  TokenType,
} from "@openid/appauth";
import { IResponse } from "./AuthSlice";
import { PopupWindow } from "./helper/PopupHelper";
import { UnixTimeStamp } from "./util";

export enum EventType {
  EXPIRED,
  RENEWED,
}

const TIMER_DURATION = 5 * 1000; // 5s in ms

export interface AuthSettings {
  clientId: string;
  redirectUri: string;
  authority: string;
  silentRedirectUrl?: string;
  extras?: StringMap;
  scope: string;
  silentRequestTimeout?: number;
  popupRedirectUrl?: string;
}

export class AuthAdapter {
  private _notifier: AuthorizationNotifier;
  private _authorizationHandler: AuthorizationRequestHandler;
  private _tokenHandler: ExtendedTokenRequestHandler;

  private _configuration: AuthorizationServiceConfiguration | undefined;

  private _refreshToken: string | undefined;
  private _accessTokenResponse: ExtendedOidcTokenResponse | undefined;
  private _timerHandle: number;

  private _settings: AuthSettings;

  private _handlers: Array<
    (type: EventType, token_response: ExtendedOidcTokenResponse) => void
  > = [];

  constructor(settings: AuthSettings) {
    this._notifier = new AuthorizationNotifier();
    this._authorizationHandler = new RedirectRequestHandler();
    let fetchRequestor = new FetchRequestor();
    this._tokenHandler = new ExtendedTokenRequestHandler(fetchRequestor);

    // set notifier to deliver responses
    this._authorizationHandler.setAuthorizationNotifier(this._notifier);

    this._timerHandle = setInterval(() => this.checkExpire(), TIMER_DURATION);

    this._settings = settings;

    // set a listener to listen for authorization responses
    // make refresh and access token requests.
    this._notifier.setAuthorizationListener((request, response, error) => {
      console.log("Authorization request complete ", request, response, error);
      if (response) {
        let codeVerifier: string | undefined;
        if (request.internal && request.internal.code_verifier) {
          codeVerifier = request.internal.code_verifier;
        }
        this.finishAuthorization(response.code, codeVerifier)
          .then((result) => this.refreshTokens())
          .then(() => {
            this._handlers.forEach((fn) => {
              fn(EventType.RENEWED, this._accessTokenResponse!);
            });
            console.log("All Done.");
          });
      }
    });
  }

  /**
   * Check if one of the two tokens is about to expire.
   * For now we always auto renew the token
   */
  checkExpire() {
    if (this._accessTokenResponse) {
      if (!this._accessTokenResponse.isValid()) {
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

  addHandler(
    fn: (type: EventType, token_response: ExtendedOidcTokenResponse) => void
  ) {
    this._handlers.push(fn);
  }

  removeHandler(
    fnToRemove: (
      type: EventType,
      token_response: ExtendedOidcTokenResponse
    ) => void
  ) {
    this._handlers = this._handlers.filter((fn) => {
      if (fn != fnToRemove) return fn;
    });
  }

  fetchServiceConfiguration(): Promise<void> {
    const fetcher = new FetchRequestor();
    return AuthorizationServiceConfiguration.fetchFromIssuer(
      this.authority,
      fetcher
    ).then((response) => {
      console.log("Fetched service configuration", response);
      this._configuration = response;
    });
  }

  get clientId() {
    return this._settings.clientId;
  }

  get authority() {
    return this._settings.authority;
  }

  // Todo Type Args
  private startSignin(args?: { extras?: {} }): Promise<void> {
    console.log("Starting signIn")
    // create a request
    let request = new AuthorizationRequest({
      client_id: this.clientId,
      redirect_uri: this._settings.redirectUri,
      scope: this._settings.scope,
      response_type: AuthorizationRequest.RESPONSE_TYPE_CODE,
      state: undefined,
      extras: args && args.extras ? args.extras : {},
    });

    if (this._configuration) {
      this._authorizationHandler.performAuthorizationRequest(
        this._configuration,
        request
      );
      return Promise.resolve();
    } else {
      return Promise.reject("Missing configuration");
    }
  }

  /**
   * Exchange code at token endpoint to get access_token, etc.
   * @param code
   * @param codeVerifier
   * @returns
   */
  private finishAuthorization(
    code: string,
    codeVerifier: string | undefined
  ): Promise<void> {
    if (!this._configuration) {
      console.log("Unknown service configuration");
      return Promise.reject("Unknown service configuration");
    }

    const extras: StringMap = {};

    if (codeVerifier) {
      extras.code_verifier = codeVerifier;
    }

    // use the code to make the token request.
    let request = new TokenRequest({
      client_id: this.clientId,
      redirect_uri: this._settings.redirectUri,
      grant_type: GRANT_TYPE_AUTHORIZATION_CODE,
      code: code,
      refresh_token: undefined,
      extras: extras,
    });

    return this._tokenHandler
      .performTokenRequest(this._configuration, request)
      .then((response) => {
        console.log(`Refresh Token is ${response.refreshToken}`);
        this._refreshToken = response.refreshToken;
        this._accessTokenResponse = response;
        return response;
      })
      .then(() => {});
  }

  /**
   * Refresh Token
   * @returns
   */
  refreshTokens(): Promise<string> {
    if (!this._configuration) {
      console.log("Unknown service configuration");
      return Promise.reject("Unknown service configuration");
    }
    if (!this._refreshToken) {
      console.log("Missing refreshToken.");
      return Promise.resolve("Missing refreshToken.");
    }
    if (this._accessTokenResponse && this._accessTokenResponse.isValid()) {
      // do nothing
      return Promise.resolve(this._accessTokenResponse.accessToken);
    }

    let request = new TokenRequest({
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
   *
   * @returns
   */
  completeAuthorizationRequestIfPossible(): Promise<void> {
    return this._authorizationHandler.completeAuthorizationRequestIfPossible();
  }

  // todo type args
  signinRedirect(args?: {extras?: {response_mode?: string}}) {
    if (!args) {
      args = {extras: {response_mode: "fragment"}}
    }
    if (args && !args.extras) {
      args.extras = {response_mode: "fragment"}
    }
    this.startSignin(args);
  }
  // todo type args
  signinSilent(args: any) {
    if (this._refreshToken) {
      this.refreshTokens();
    } else {
      this.signinSilentIFrame();
    }
  }

  // todo type args
  signinPopup(args: any) {
    let url =
      args.redirect_uri ||
      this._settings.popupRedirectUrl ||
      this._settings.redirectUri;
  }

  // todo type args
  signOut(args: any) {
    this._accessTokenResponse = undefined;
    this._refreshToken = undefined;
  }

  signoutRedirect(args: any) {
    
  }

  private signinSilentIFrame(
    args: {
      redirect_uri?: string;
      prompt?: string;
      silentRequestTimeout?: number;
    } = {}
  ) {
    //   let url = args.redirect_uri || this._settings.silentRedirectUrl || this._settings.redirectUrl;
    //   if (url === undefined) {
    //     return Promise.reject(new Error("No silent_redirect_uri configured"))
    //   }
    //   args.redirect_uri = url;
    //   args.prompt = args.prompt || "none";
    //   return this.startSignin(args, this._iFrameHelper, {
    //     startUrl: url,
    //     silentRequestTimeout: args.silentRequestTimeout || this._settings.silentRequestTimeout
    // })
  }
}

// OIDC Specifics
export interface ExtendedTokenResponseJson extends TokenResponseJson {
  refresh_expires_in?: string;
  session_state?: string;
  "not-before-policy"?: boolean;
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
    if (response["not-before-policy"]) {
      this.notBeforePolicy = response["not-before-policy"];
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
      "not-before-policy": this.notBeforePolicy,
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
        "Missing extended OIDC (expiresIn, idToken, refreshExpiresIn or sessionState"
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
      let now = nowInSeconds();
      return now < this.issuedAt + this.refreshExpiresIn + buffer;
    } else {
      return true;
    }
  }
}

class ExtendedTokenRequestHandler extends BaseTokenRequestHandler {
  private isExtendedTokenResponse(
    response: ExtendedTokenResponseJson | TokenErrorJson
  ): response is ExtendedTokenResponseJson {
    return (response as TokenErrorJson).error === undefined;
  }

  performTokenRequest(
    configuration: AuthorizationServiceConfiguration,
    request: TokenRequest
  ): Promise<ExtendedOidcTokenResponse> {
    let cleaned_request = request.toStringMap();
    if (request.grantType === GRANT_TYPE_REFRESH_TOKEN) {
      delete cleaned_request["redirect_uri"]
    }
    let tokenResponse = this.requestor.xhr<
      ExtendedTokenResponseJson | TokenErrorJson
    >({
      url: configuration.tokenEndpoint,
      method: "POST",
      dataType: "json", // adding implicit dataType
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: this.utils.stringify(request.toStringMap()),
    });

    return tokenResponse.then((response) => {
      if (this.isExtendedTokenResponse(response)) {
        return new ExtendedOidcTokenResponse(response);
      } else {
        return Promise.reject<ExtendedOidcTokenResponse>(
          new AppAuthError(response.error, new TokenError(response))
        );
      }
    });
  }
}
