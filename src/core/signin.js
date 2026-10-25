/**
 * The sign-ins of the app (not the Workspace, which keeps its own): the
 * GitHub sign-in (src/workspace/session.js) and the Zaideih session got from it
 * or from Google (core/account.js). One of each per page, sharing this
 * device's storage with the Workspace.
 */
import { AUTH_URL } from "../config.js";
import { createSession } from "../workspace/session.js";
import { createAccount } from "./account.js";

let session = null;
let acct = null;

export const githubSession = () => (session ??= createSession({ authUrl: AUTH_URL, local: localStorage, tab: sessionStorage }));
export const account = () => (acct ??= createAccount({ authUrl: AUTH_URL, local: localStorage, tab: sessionStorage, githubToken: () => githubSession().token() }));
