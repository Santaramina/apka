import { Platform } from "react-native";
import { File, UploadType } from "expo-file-system";

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

// Upload a local file (image/audio).
// Native (iOS/Android): uses expo-file-system's NATIVE multipart upload (file.upload),
// because the { uri, name, type } FormData shape is not supported by Expo/iOS networking
// ("Unsupported FormDataPart implementation"). Web keeps the Blob + FormData path.
export async function uploadFile(uri: string, name: string, type: string): Promise<{ path: string; url: string; content_type: string }> {
  if (Platform.OS === "web") {
    const form = new FormData();
    const blob = await (await fetch(uri)).blob();
    form.append("file", blob, name);
    return apiFetch("/upload", { method: "POST", body: form, isForm: true });
  }

  const headers: Record<string, string> = {};
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const file = new File(uri);
  const res = await file.upload(`${BASE}/api/upload`, {
    httpMethod: "POST",
    uploadType: UploadType.MULTIPART,
    fieldName: "file",
    mimeType: type,
    headers,
  });

  if (res.status < 200 || res.status >= 300) {
    let msg = `Błąd ${res.status}`;
    try {
      const j = JSON.parse(res.body);
      if (j?.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {}
    // Diagnostics for developers only (not surfaced to the user UI).
    console.warn("[upload] failed", { status: res.status, body: res.body?.slice?.(0, 300), mimeType: type, name, uri });
    const err: any = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return JSON.parse(res.body);
}
