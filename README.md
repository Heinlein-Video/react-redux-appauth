# React AppAuth
## About
Opinionated React component (AuthProvider) to provide OpenID Connect and OAuth2 protocol support. Has hooks :tada:
Heavily inspired by [oidc-react](https://github.com/bjerkio/oidc-react) but without redux-oidc and the (as of now) unmaintained oidc-client-js.

Based on @openid/appauth-js.

## Quickstart
Save as a dependency.
PeerDependencies are:
  * "@reduxjs/toolkit"
  * "react"
  * "react-redux"
  * "redux"
## Usage
```
const App = () => {
  const oidcConfig = useAppSelector(selectOidcConfig).config;
  const redirectPath = '/auth/callback';
  const popupRedirectPath = '/auth/popup_callback';
  const isAuthed = useSelector(selectIsAuthed)

return (
  <Router>
  <AuthProvider
    store={store}
    authority={oidcConfig.authority}
    clientId={oidcConfig.client_id}
    redirectUri={window.location.origin + redirectPath}
    popupRedirectUri={window.location.origin + popupRedirectPath}
    scope={oidcConfig.scope}
  >
  <Route path={redirectPath}>
            <AuthCallback history={history}>
              <p>You will be redirected</p>
            </AuthCallback>
          </Route>
          <Route path={popupRedirectPath}>
            <AuthCallback history={history} isPopup>
              <p>You will be redirected</p>
            </AuthCallback>
          </Route>
    <Route default>
      {isAuthed ? <p>Authed</p>:<p>Not Authed</p>}
    <Route>
  </AuthProvider>)
}
```
