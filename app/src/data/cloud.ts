import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { create } from 'zustand';

/*
 * The account: signing in with Google and the role it has. Who may see what is
 * decided on the server (the members table and its policies, see
 * supabase/migrations); the app only follows it. The last known role is kept on
 * the device, so a signed-in device keeps working without the internet.
 */

const SERVER_URL = import.meta.env.VITE_SUPABASE_URL;
const SERVER_KEY = import.meta.env.VITE_SUPABASE_KEY;

/** False in builds without a server configured — the app then works as before. */
export const cloudEnabled = !!(SERVER_URL && SERVER_KEY);

let client: SupabaseClient | null = null;

export function cloud(): SupabaseClient {
  client ??= createClient(SERVER_URL!, SERVER_KEY!, {
    // PKCE returns ?code=… instead of #access_token=…, which would clash with the hash routes.
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

export type Role = 'admin' | 'teacher';

/**
 * 'off' — no server in this build; 'loading' — still finding out; 'out' — not signed in;
 * 'in' — a member; 'denied' — signed in with an e-mail that has no access;
 * 'error' — couldn't ask the server and there is nothing remembered.
 */
export type AccountStatus = 'off' | 'loading' | 'out' | 'in' | 'denied' | 'error';

interface AccountState {
  status: AccountStatus;
  email?: string;
  role?: Role;
  error?: string;
}

const REMEMBERED = 'uroky-account';
/** Set before leaving for Google, so the app knows to show the account after coming back. */
const RETURNING = 'uroky-signing-in';

function remembered(): { email: string; role: Role } | null {
  try {
    return JSON.parse(localStorage.getItem(REMEMBERED) ?? 'null');
  } catch {
    return null;
  }
}

/**
 * A device that has signed in before opens straight away, even offline; the
 * server is asked in the background and can still take access away.
 */
function initialAccount(): AccountState {
  if (!cloudEnabled) return { status: 'off' };
  const last = remembered();
  return last ? { status: 'in', email: last.email, role: last.role } : { status: 'loading' };
}

export const useAccount = create<AccountState>(initialAccount);

async function checkRole(email: string) {
  const { data, error } = await cloud().rpc('my_role');
  if (error) {
    const last = remembered();
    if (last?.email === email) useAccount.setState({ status: 'in', email, role: last.role, error: undefined });
    else useAccount.setState({ status: 'error', email, error: error.message });
    return;
  }
  if (data === 'admin' || data === 'teacher') {
    localStorage.setItem(REMEMBERED, JSON.stringify({ email, role: data }));
    useAccount.setState({ status: 'in', email, role: data, error: undefined });
  } else {
    localStorage.removeItem(REMEMBERED);
    useAccount.setState({ status: 'denied', email, role: undefined, error: undefined });
  }
}

export async function startAccount() {
  if (!cloudEnabled) return;
  const auth = cloud().auth;
  // Waits for the code from Google to be exchanged when we have just come back from signing in.
  const { data, error } = await auth.getSession();
  const email = data.session?.user.email?.toLowerCase();
  if (email) await checkRole(email);
  // An expired session that couldn't be refreshed for lack of internet: keep working on the remembered access.
  else if (error && remembered()) return watch();
  else {
    localStorage.removeItem(REMEMBERED);
    useAccount.setState({ status: 'out', email: undefined, role: undefined, error: error?.message });
  }
  watch();
}

function watch() {
  const auth = cloud().auth;
  auth.onAuthStateChange((event, session) => {
    // Calls to the server from inside this callback can deadlock the client, hence the timeout.
    if (event === 'SIGNED_OUT') {
      localStorage.removeItem(REMEMBERED);
      useAccount.setState({ status: 'out', email: undefined, role: undefined });
    } else if (event === 'SIGNED_IN' && session?.user.email && session.user.email.toLowerCase() !== useAccount.getState().email)
      window.setTimeout(() => checkRole(session.user.email!.toLowerCase()), 0);
  });
}

/** True once, right after coming back from Google. */
export function justSignedIn(): boolean {
  const back = localStorage.getItem(RETURNING) === '1';
  localStorage.removeItem(RETURNING);
  return back;
}

export async function signIn() {
  localStorage.setItem(RETURNING, '1');
  const { error } = await cloud().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`, queryParams: { prompt: 'select_account' } },
  });
  if (error) {
    localStorage.removeItem(RETURNING);
    throw error;
  }
}

export async function signOut() {
  localStorage.removeItem(REMEMBERED);
  await cloud().auth.signOut({ scope: 'local' });
  useAccount.setState({ status: 'out', email: undefined, role: undefined, error: undefined });
}

export async function retryAccount() {
  useAccount.setState({ status: 'loading' });
  const { data } = await cloud().auth.getSession();
  const email = data.session?.user.email?.toLowerCase();
  if (email) await checkRole(email);
  else useAccount.setState({ status: 'out' });
}

/** Someone allowed into the app (Налаштування → Доступ). */
export interface Member {
  email: string;
  role: Role;
  name: string;
  createdAt: string;
  /** null until the person has signed in for the first time */
  lastSignInAt: string | null;
}

/** The server explains refusals itself (in Ukrainian); anything else is most likely the connection. */
function failure(error: { message: string; code?: string }): Error {
  if (error.code === '42501' || error.code === '22023') return new Error(error.message);
  if (!navigator.onLine) return new Error('Немає інтернету');
  return new Error(`Не вдалося зв'язатися з сервером: ${error.message}`);
}

export async function listMembers(): Promise<Member[]> {
  const { data, error } = await cloud().rpc('list_members');
  if (error) throw failure(error);
  return (data ?? []) as Member[];
}

/** Gives the e-mail access, or changes the role and name of someone already listed. */
export async function saveMember(email: string, role: Role, name: string) {
  const { error } = await cloud().rpc('set_member', { member_email: email, member_role: role, member_name: name });
  if (error) throw failure(error);
}

export async function removeMember(email: string) {
  const { error } = await cloud().rpc('remove_member', { member_email: email });
  if (error) throw failure(error);
}

/** Live records of each type on the server, to compare with this device. */
export async function serverCounts(): Promise<Record<string, number>> {
  const { data, error } = await cloud().rpc('record_counts');
  if (error) throw error;
  return (data ?? {}) as Record<string, number>;
}
