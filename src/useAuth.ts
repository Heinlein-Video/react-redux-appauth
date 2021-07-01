/* eslint @typescript-eslint/explicit-function-return-type: 0 */
import { useContext } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AuthContext } from './AuthProvider';
import { AuthContextProps } from './AuthInterface';
import { selectIsLoading } from './AuthSlice';


// export const useAuth = (): AuthHookProps => {
//   const dispatch = useDispatch();
  
//   const signIn = async () => {

//   }

//   const signInPopup = async () => {

//   }
  
//   const signOut = async () => {

//   }
//   const signOutRedirect = async () => {

//   }
//   const isLoading = useSelector(selectIsLoading)
  
//   return {signIn, signInPopup, signOut, signOutRedirect, isLoading};
// };
export const useAuth = (): AuthContextProps => {
  const context = useContext<AuthContextProps | undefined>(AuthContext);
  
  if (!context) {
    throw new Error('AuthProvider context is undefined, please verify you are calling useAuth() as child of a <AuthProvider> component.');
  }
  
  return context;
};
