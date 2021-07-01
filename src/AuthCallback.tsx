import React, { useEffect } from "react"
import { useSelector } from "react-redux";
import { selectIsLoading } from "./AuthSlice";

interface StubHistory {
  push(uri: string): void
}

interface AuthCallbackProps {
  history: StubHistory,
  children: React.ReactNode,
  default_redirect?: string
}
/**
 * Redirects back to a stored uri from localStorage or default if none was found
 * @param AuthCallbackProps 
 * @returns 
 */
export const AuthCallback = ({history, children, default_redirect = '/'}: AuthCallbackProps) => {
  const isLoading = useSelector(selectIsLoading)
  // Check if we have somethin in localStorage redirect to that.
  useEffect(() => {
    if (!isLoading) {
      let redirectUri = localStorage.getItem('redirect-uri');
      if (redirectUri) {
        history.push(redirectUri)
      } else {
        history.push(default_redirect)
      }
    }
  }, [isLoading]);

  return (
    <>
      {children}
    </>
    );
}
