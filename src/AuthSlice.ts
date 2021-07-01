import { IS_LOG } from "@openid/appauth";
import { createSlice, PayloadAction, Store } from "@reduxjs/toolkit";
import _ from "lodash";
import { UnixTimeStamp } from "./util";

// Define a type for the slice state
export interface AuthSlice {
  isLoading: boolean;
  isAuthed: boolean;
  isExpired: boolean;
  access_token?: string;
  // In 
  access_token_expire?: UnixTimeStamp;
  id_token?: string;
  refresh_token?: string;
  refresh_token_expire?: UnixTimeStamp;
  scope?: string;
  sess_state?: string 
}

export interface IResponse {
  access_token: string;
  access_token_expire: UnixTimeStamp;
  id_token: string;
  refresh_token: string;
  refresh_token_expire: UnixTimeStamp;
  scope: string;
  session_id: string 
}

const hack = (): IResponse | null  => {
  let value = localStorage.getItem("auth");
  if (value !== null) {
    return JSON.parse(value);
  } else {
    return null
  }
}

// Define the initial state using that type
const generateInitialState = () => {
  let user = hack();
  if (user !== null) {
    return {
      isLoading: true,
      // Check if refresh or access_token is expired. 
      isAuthed: (user.access_token_expire > Date.now() && user.refresh_token_expire > Date.now()),
      isExpired: (user.access_token_expire < Date.now() && user.refresh_token_expire < Date.now()),
      access_token: user.access_token,
      access_token_expire: user.access_token_expire as UnixTimeStamp,
      id_token: user.id_token,
      refresh_token: user.refresh_token,
      refresh_token_expire: user.refresh_token_expire as UnixTimeStamp
    }
  }

  return {
    isLoading: false,
    isAuthed: false,
    isExpired: false
  }
}
const initialState: AuthSlice = generateInitialState();
export const authSlice = createSlice({
  name: "auth",
  // `createSlice` will infer the state type from the `initialState` argument
  initialState,
  reducers: {
    expired: (state) => {
      state.isAuthed = false;
      state.isExpired = true;
    },
    silent_renew_error: (state) => {
      
    }, // Use the PayloadAction type to declare the contents of `action.payload`
    loaded: (state) => {
      state.isLoading = false;
    },
    logged_out: (state) => {
      state.isAuthed = false;
    },
    token_updated: (state, action: PayloadAction<IResponse>) => {
      _.merge(state, action.payload)
      state.isAuthed = true;
      state.isLoading = false;
      localStorage.setItem("auth", JSON.stringify(action.payload));
      localStorage.setItem("access_token", action.payload.access_token);
    }
  },
});

export const { expired, logged_out, token_updated , loaded} = authSlice.actions;
// Other code such as selectors can use the imported `RootState` type

// TODO find way to type this.
export const selectIsLoading = (state: {auth: AuthSlice}) => state.auth.isLoading;
export const selectIsAuthed = (state: {auth: AuthSlice}) => state.auth.isAuthed;
export default authSlice.reducer;


