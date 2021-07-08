import React, { useEffect } from "react"
import { useSelector } from "react-redux";
import { selectIsLoading } from "./AuthSlice";

interface StubHistory {
  push(uri: string): void
}

interface AuthCallbackProps {
  history: StubHistory,
  default_redirect?: string,
  isPopup?: boolean
}
/**
 * Redirects back to a stored uri from localStorage or default if none was found
 * @param AuthCallbackProps 
 * @returns 
 */
export const AuthCallback: React.FC<AuthCallbackProps> = ({history, children, default_redirect = '/', isPopup = false}) => {
  const isLoading = useSelector(selectIsLoading);
  
  // Check if we have something in localStorage redirect to that.
  useEffect(() => {
    if (!isLoading && !isPopup) {
      const redirectUri = localStorage.getItem('redirect-uri');
      if (redirectUri) {
        localStorage.removeItem('redirect-uri');
        history.push(redirectUri)
      } else {
        history.push(default_redirect)
      }
    }
  }, [isLoading, isPopup]);

  return (
    <>
      {children}
    </>
    );
}
