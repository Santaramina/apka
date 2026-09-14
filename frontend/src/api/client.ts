import { Platform } from "react-native";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";

let authToken: string | null = null;

export function setAuthToken(t: string | null) {
  authToken = t;
}
export function getAuthToken() {
  return authToken;
}

type Opts = { method?: string; body?: any; isForm?: boolean };

export async function apiFetch<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (!opts.isForm) headers["Content-Type"] = "application/json";
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const res = await fetch(`${BASE}/api${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.isForm ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let msg = `Błąd ${res.status}`;
    try {
      const j = await res.json();
      if (j?.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {}
    const err: any = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res as any;
}

export function fileUrl(path: string): string {
  return `${BASE}/api/files/${path}?token=${encodeURIComponent(authToken || "")}`;
}

export function pdfUrl(estimateId: string): string {
  return `${BASE}/api/estimates/${estimateId}/pdf?token=${encodeURIComponent(authToken || "")}`;
}

// Upload a local file (image/audio). Handles web vs native body shape.
export async function uploadFile(uri: string, name: string, type: string): Promise<{ path: string; url: string }> {
  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    form.append("file", blob, name);
  } else {
    form.append("file", { uri, name, type } as any);
  }
  return apiFetch("/upload", { method: "POST", body: form, isForm: true });
}
