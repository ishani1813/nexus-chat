const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

export interface AuthUser {
  id: string;
  username: string;
}

export interface AuthResult {
  user: AuthUser;
  token: string;
}

async function authRequest(path: string, username: string, password: string): Promise<AuthResult> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

export function register(username: string, password: string): Promise<AuthResult> {
  return authRequest("/api/auth/register", username, password);
}

export function login(username: string, password: string): Promise<AuthResult> {
  return authRequest("/api/auth/login", username, password);
}

const TOKEN_KEY = "nexuschat_token";
const USER_KEY = "nexuschat_user";

export function saveSession(result: AuthResult) {
  localStorage.setItem(TOKEN_KEY, result.token);
  localStorage.setItem(USER_KEY, JSON.stringify(result.user));
}

export function loadSession(): AuthResult | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const userRaw = localStorage.getItem(USER_KEY);
  if (!token || !userRaw) return null;
  try {
    return { token, user: JSON.parse(userRaw) };
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
