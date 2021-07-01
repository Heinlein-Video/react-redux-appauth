import { AuthorizationNotifier, AuthorizationRequest, AuthorizationRequestHandler, AuthorizationServiceConfiguration, GRANT_TYPE_AUTHORIZATION_CODE, StringMap, TokenRequest, TokenRequestHandler } from '@openid/appauth';
import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { AuthAdapter, EventType, ExtendedOidcTokenResponse } from './AuthAdapter';
import { AuthAdapterProps, AuthContextProps, AuthProviderProps } from './AuthInterface';
import { expired, loaded, logged_out, selectIsAuthed, selectIsLoading, token_updated } from './AuthSlice';


/**
 * @private
 * @hidden
 * @param location
 */
 export const hasCodeInUrl = (location: Location): boolean => {
  const searchParams = new URLSearchParams(location.search);
  const hashParams = new URLSearchParams(location.hash.replace('#', '?'));

  return Boolean(
    searchParams.get('code') ||
      searchParams.get('id_token') ||
      searchParams.get('session_state') ||
      hashParams.get('code') ||
      hashParams.get('id_token') ||
      hashParams.get('session_state'),
  );
};


const initAdapter = (props: AuthAdapterProps): AuthAdapter => {
  if (props.authAdapter) return props.authAdapter;
  return new AuthAdapter(
    props
  )
}

export const AuthContext = React.createContext<AuthContextProps | undefined>(undefined);
export const AuthProvider: FC<AuthProviderProps> = ({
  store,
  children,
...props
}) => {
  return (<Provider store={store}><AuthProviderContext store={store} {...props}>{children}</AuthProviderContext></Provider>)
}

// Todo add an onError callback
const AuthProviderContext: FC<AuthProviderProps> = ({
  store,
  children,
  autoSignIn = true,
  onBeforeSignIn,
  onSignIn,
  onSignOut,
  ...props
}) => {
  const dispatch = useDispatch();
  const isLoading = useSelector(selectIsLoading);
  const isAuthed = useSelector(selectIsAuthed);
  // const [userData, setUserData] = useState<User | null>(null);

  const [adapter] = useState<AuthAdapter>(initAdapter(props));

  const signOutHooks = async (): Promise<void> => {
    // setUserData(null);
    dispatch(logged_out())
    onSignOut && onSignOut();
  };

  const signInPopupHooks = async (): Promise<void> => {
    const userFromPopup = await adapter.signinPopup({});
  //   setUserData(userFromPopup);
    onSignIn && onSignIn(userFromPopup);
  //   await userManager.signinPopupCallback();
  };

  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const getUser = useCallback(async (): Promise<void> => {
    /**
     * Check if the user is returning back from OIDC. Todo retry a couple of times before dispatching an error state
     */
    if (hasCodeInUrl(location)) {
      await adapter.fetchServiceConfiguration().then(() => {
        console.log("Test")
        adapter.completeAuthorizationRequestIfPossible();
      });
      // setUserData(user);
      return;
    }

    // const user = await userManager!.getUser();
    if ((isAuthed) && autoSignIn) {
      onBeforeSignIn && onBeforeSignIn();
      // userManager.signinRedirect();
    } else if (isMountedRef.current) {
      // setUserData(user);
      dispatch(loaded())
    }
    return;
  }, [location, adapter, dispatch, isAuthed, autoSignIn, onBeforeSignIn, onSignIn]);

  useEffect(() => {
    getUser();
  }, [getUser]);

  const register = useCallback(async () => {
    // for refreshing react state when new state is available in e.g. session storage
    const updateState = async (type: EventType, token_response: ExtendedOidcTokenResponse | undefined) => {
      switch (type) {
        case EventType.RENEWED:
          isMountedRef.current && token_response!.toReduxState().then((value) => dispatch(token_updated(value)));
          break;
        case EventType.EXPIRED:
          isMountedRef.current && dispatch(expired());
      }
      
    };
    await adapter.fetchServiceConfiguration();
    adapter.addHandler(updateState);

    return () => adapter.removeHandler(updateState);
  }, [adapter, dispatch]);

  useEffect(() => {
    register()
  }, [register]);

  return (<Provider store={store}>
    <AuthContext.Provider value={{
      signIn: async (args?: {}): Promise<void> => {
        await adapter.signinRedirect(args);
      },
      signInPopup: async (): Promise<void> => {
        await signInPopupHooks();
      },
      signOut: async (): Promise<void> => {
        await adapter.signOut({});
        await signOutHooks();
      },
      signOutRedirect: async (args?: {}): Promise<void> => {
        await adapter!.signoutRedirect(args);
        await signOutHooks();
      },
      isLoading,
    }}
    >
      {children}
    </AuthContext.Provider>
    </Provider> 
  )
}
