import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const cloudConfigured = Boolean(url && key);
export const supabase = cloudConfigured ? createClient(url, key) : null;

export async function api(path, body) {
  const {
    data: { session },
  } = supabase ? await supabase.auth.getSession() : { data: {} };
  if (!session)
    throw new Error("Connect your private cloud account to use this feature.");
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (
    !(response.headers.get("content-type") || "").includes("application/json")
  ) {
    throw new Error(
      "Cloud API unavailable. The local Vite preview runs the interface only; use a configured Vercel deployment for cloud features.",
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The cloud service returned an unreadable response. Please try again.",
    );
  }
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

let database;
function openMedia() {
  if (!database)
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open("hyte-media", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("files");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        database = null;
        reject(new Error("Device storage could not be opened."));
      };
    });
  return database;
}
export async function media(action, key, value) {
  const db = await openMedia();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      "files",
      action === "get" ? "readonly" : "readwrite",
    );
    const store = transaction.objectStore("files");
    const request =
      action === "get"
        ? store.get(key)
        : action === "delete"
          ? store.delete(key)
          : store.put(value, key);
    let result;
    request.onsuccess = () => {
      result = request.result;
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () =>
      reject(
        new Error("Could not save the image. Your device storage may be full."),
      );
    transaction.onabort = () =>
      reject(new Error("Image storage was interrupted. Please try again."));
  });
}

export async function imageData(file, maxDimension = 2200) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error(
      "Choose a JPEG, PNG, or WebP image. On iPhone, export HEIC as JPEG first.",
    );
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Choose an image smaller than 20 MB.");
  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", 0.88);
    if (data.length > 3_000_000)
      throw new Error(
        "This image is too detailed to process. Crop it or choose a smaller version.",
      );
    return data;
  } finally {
    URL.revokeObjectURL(src);
  }
}

export function download(name, contents, type = "text/plain;charset=utf-8") {
  const link = document.createElement("a");
  const url = URL.createObjectURL(new Blob([contents], { type }));
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
