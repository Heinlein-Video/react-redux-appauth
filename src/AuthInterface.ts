import {
  AuthorizationError,
  AuthorizationRequest,
  AuthorizationResponse,
  StringMap,
} from '@openid/appauth';
import { Store } from '@reduxjs/toolkit';
import { AuthAdapter } from './AuthAdapter';
import { AuthSlice } from './AuthSlice';

export interface AuthContextProps {
  /**
   * Alias for userManager.signInRedirect
   */
  signIn: (args?: AuthProviderSignInProps) => Promise<void>;
  /**
   * Alias for userManager.signinPopup
   */
  signInPopup: (args?: AuthProviderSignInProps) => Promise<void>;
  /**
   * Alias for removeUser
   */
  signOut: (args?: AuthProviderSignOutProps) => Promise<void>;
  /**
   *
   */
  signOutRedirect: (args?: AuthProviderSignOutProps) => Promise<void>;
  /**
   * Auth state: True until the library has been initialized.
   */
  isLoading: boolean;

  signinCallback: () => Promise<void>;
}

export interface AuthProviderProps {
  /**
   * Your redux store
   */
  store: Store<{ auth: AuthSlice }>;
  /**
   * If you want to provide your own AuthAdapater
   */
  authAdapter?: AuthAdapter;
  /**
   * The URL of the OIDC/OAuth2 provider.
   */
  authority: string;
  /**
   * Your client application's identifier as registered with the OIDC/OAuth2 provider.
   */
  clientId: string;
  /**
   * The redirect URI of your client application to receive a response from the OIDC/OAuth2 provider.
   */
  redirectUri: string;
  /**
   * The redirect URI of your client application to receive a response from the OIDC/OAuth2 provider when completing a background sign-in refresh.
   */
  silentRedirectUri?: string;
  /**
   * Whether the provider should automatically perform a background sign-in on mount.
   */
  silentSignin?: boolean;
  /**
   * A space-delimited list of permissions that the application requires.
   */
  scope: string;
  /**
   * Extras
   */
  extras?: StringMap;
  /**
   * Defaults to `windows.location`.
   */
  location?: Location;
  /**
   * defaults to true
   */
  autoSignIn?: boolean;
  /**
   * Flag to indicate if there should be an automatic attempt to renew the access token prior to its expiration.
   *
   * defaults to false
   */
  automaticSilentRenew?: boolean;
  /**
   *  The features parameter to window.open for the popup signin window
   *
   * defaults to 'location=no,toolbar=no,width=500,height=500,left=100,top=100'
   */
  popupWindowFeatures?: string;
  /**
   *  The URL for the page containing the call to signinPopupCallback to handle the callback from the OIDC/OAuth2
   *
   */
  popupRedirectUri?: string;
  /**
   *  The target parameter to window.open for the popup signin window.
   *
   * defaults to '_blank'
   */
  popupWindowTarget?: string;
  /**
   * On before sign in hook. Can be use to store the current url for use after signing in.
   *
   * This only gets called if autoSignIn is true
   */
  onBeforeSignIn?: () => void;
  /**
   * On sign out hook. Can be a async function.
   * @param userData User
   */
  onSignIn?: () => Promise<void> | void;
  /**
   * On sign out hook. Can be a async function.
   */
  onSignOut?: (options?: AuthProviderSignOutProps) => Promise<void> | void;
}

export interface AuthAdapterProps {
  authAdapter?: AuthAdapter;
  /**
   * The URL of the OIDC/OAuth2 provider.
   */
  authority: string;
  /**
   * Your client application's identifier as registered with the OIDC/OAuth2 provider.
   */
  clientId: string;
  /**
   * The redirect URI of your client application to receive a response from the OIDC/OAuth2 provider.
   */
  redirectUri: string;
  /**
   * The redirect URI of your client application to receive a response from the OIDC/OAuth2 provider when completing a background sign-in refresh.
   */
  silentRedirectUri?: string;
  /**
   * A space-delimited list of permissions that the application requires.
   */
  scope: string;
  /**
   * Extras
   */
  extras?: StringMap;
  /**
   * Defaults to `windows.location`.
   */
  location?: Location;
  /**
   * defaults to true
   */
  autoSignIn?: boolean;
  /**
   * Flag to indicate if there should be an automatic attempt to renew the access token prior to its expiration.
   *
   * defaults to false
   */
  automaticSilentRenew?: boolean;
  /**
   *  The features parameter to window.open for the popup signin window
   *
   * defaults to 'location=no,toolbar=no,width=500,height=500,left=100,top=100'
   */
  popupWindowFeatures?: string;
  /**
   *  The URL for the page containing the call to signinPopupCallback to handle the callback from the OIDC/OAuth2
   *
   */
  popupRedirectUri?: string;
  /**
   *  The target parameter to window.open for the popup signin window.
   *
   * defaults to '_blank'
   */
  popupWindowTarget?: string;
}

export interface AuthProviderSignOutProps {
  /**
   * Trigger a redirect of the current window to the end session endpoint
   *
   * You can also provide an object. This object will be sent with the
   * function.
   *
   * @example
   * ```javascript
   * const config = {
   *  signOutRedirect: {
   *    state: 'abrakadabra',
   *  },
   * };
   * ```
   */
  signoutRedirect?: boolean;
  postLogoutRedirectUri?: string;
}
export interface AuthProviderSignInProps {
  timeoutInSeconds?: number;
  redirect_uri?: string;
  extras?: { response_mode?: string; prompt?: string };
}

export interface AuthPostMessage {
  type: 'authorization_response';
  request: AuthorizationRequest;
  response: AuthorizationResponse | null;
  error: AuthorizationError | null;
}
