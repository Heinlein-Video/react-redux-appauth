import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useAuth } from '.';
import { selectIsLoading } from './AuthSlice';

interface StubHistory {
  push(uri: string): void;
}

interface AuthCallbackProps {
  history: StubHistory;
  defaultRedirect?: string;
  isPopup?: boolean;
  isSilent?: boolean;
  onError?: () => React.ReactNode;
}
/**
 * Redirects back to a stored uri from localStorage or default if none was found
 * @param AuthCallbackProps
 * @returns
 */
export const AuthCallback: React.FC<AuthCallbackProps> = ({
  history,
  children,
  onError,
  defaultRedirect = '/',
  isPopup = false,
  isSilent = false,
}) => {
  const isLoading = useSelector(selectIsLoading);
  const auth = useAuth();
  const [showError, setShowError] = useState<boolean>(false);

  // Check if we have something in localStorage redirect to that.
  useEffect(() => {
    if (!isLoading) {
      auth
        .signinCallback()
        .then(() => {
          if (!isPopup && !isSilent) {
            const redirectUri = localStorage.getItem('redirect-uri');
            if (redirectUri) {
              localStorage.removeItem('redirect-uri');
              history.push(redirectUri);
            } else {
              history.push(defaultRedirect);
            }
          }
        })
        .catch((e) => {
          console.log(e);
          setShowError(true);
        });
    }
  }, [isLoading, isPopup]);

  if (showError && onError !== undefined) {
    return <>{onError()}</>;
  }
  return <>{children}</>;
};
