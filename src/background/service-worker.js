import { LIMITS, MESSAGE_TYPES } from "../shared/constants.js";

const jobs = new Map();

function safeText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function createArchiveId(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}_${pad(date.getDate())}${pad(date.getMonth() + 1)}${String(date.getFullYear()).slice(-2)}`;
}

function fileExtension(contentType, url) {
  const mime = String(contentType || "").split(";")[0].toLowerCase();
  const byMime = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "image/gif": "gif", "image/avif": "avif", "image/bmp": "bmp"
  };
  if (byMime[mime]) return byMime[mime];
  try {
    const extension = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
    if (extension && ["jpg", "jpeg", "png", "webp", "gif", "avif", "bmp"].includes(extension)) {
      return extension === "jpeg" ? "jpg" : extension;
    }
  } catch { /* use a safe default */ }
  return "jpg";
}

function sendProgress(jobId, message, extra = {}) {
  const payload = { type: MESSAGE_TYPES.JOB_PROGRESS, jobId, message, ...extra };
  chrome.runtime.sendMessage(payload).catch(() => {});
  chrome.storage.local.set({ [`job:${jobId}`]: { ...payload, updatedAt: Date.now() } }).catch(() => {});
}

function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) return reject(new Error(error.message));
      if (!tabs?.[0]) return reject(new Error("No active browser tab was found."));
      resolve(tabs[0]);
    });
  });
}

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) return reject(new Error(error.message));
      resolve(response);
    });
  });
}

async function runContentJob(tab, jobId) {
  const message = { type: MESSAGE_TYPES.RUN_ARCHIVE, jobId, url: tab.url };
  try {
    return await sendToTab(tab.id, message);
  } catch (firstError) {
    if (!tab.id) throw firstError;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["src/content/facebook-adapter.js", "src/content/content.js"]
      });
      return await sendToTab(tab.id, message);
    } catch (secondError) {
      throw new Error(`Facebook page access failed. Reload the photo page and try again. (${secondError.message || firstError.message})`);
    }
  }
}

async function fetchImageFromServiceWorker(url, referrer) {
  const response = await fetch(url, {
    credentials: "include",
    cache: "force-cache",
    referrer,
    referrerPolicy: "unsafe-url",
    headers: { Accept: "image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`server returned ${contentType} instead of an image`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > LIMITS.maxImageBytes) {
    throw new Error("image exceeds the per-image limit");
  }
  return { contentType, dataBase64: arrayBufferToBase64(buffer) };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

async function fetchImage(job, candidate) {
  let timer;
  try {
    const localFetch = fetchImageFromServiceWorker(candidate.url, job.url);
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("request timed out")), LIMITS.imageFetchTimeoutMs);
    });
    return await Promise.race([localFetch, timeout]);
  } catch (serviceWorkerError) {
    if (!job.tabId) throw serviceWorkerError;
    try {
      const response = await sendToTab(job.tabId, {
        type: MESSAGE_TYPES.FETCH_IMAGE,
        url: candidate.url,
        referrer: job.url,
        maxBytes: LIMITS.maxImageBytes
      });
      if (!response?.ok) throw new Error(response?.error || "request failed");
      if (!response.dataBase64) throw new Error("Facebook returned no image data");
      return { contentType: response.contentType, dataBase64: response.dataBase64 };
    } catch (contentError) {
      throw new Error(`Extension fetch: ${serviceWorkerError.message || "failed"}; Facebook tab fetch: ${contentError.message || "failed"}`);
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function ensureOffscreenDocument() {
  if (chrome.offscreen.hasDocument) {
    if (await chrome.offscreen.hasDocument()) return;
  }
  try {
    await chrome.offscreen.createDocument({
      url: "src/offscreen/offscreen.html",
      reasons: ["BLOBS"],
      justification: "Assemble the archive ZIP from downloaded authenticated image bytes."
    });
  } catch (error) {
    if (!String(error?.message || error).toLowerCase().includes("already exists")) throw error;
  }
}

async function assembleZip(filename, files) {
  await ensureOffscreenDocument();
  let response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.ZIP_START,
    filename,
    files: files.filter((file) => typeof file.text === "string")
  });
  if (!response?.ok) throw new Error(response?.error || "ZIP assembly failed.");
  for (const file of files.filter((item) => item.dataBase64)) {
    response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.ZIP_ADD_FILE,
      path: file.path,
      dataBase64: file.dataBase64
    });
    if (!response?.ok) throw new Error(response?.error || "ZIP file assembly failed.");
  }
  response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.ZIP_FINISH });
  if (!response?.ok) throw new Error(response?.error || "ZIP download failed.");
  if (!response.objectUrl) throw new Error("ZIP assembly returned no downloadable file.");
  if (!chrome.downloads?.download) throw new Error("Chrome's Downloads permission is unavailable. Reload the extension and try again.");

  const downloadId = await new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: response.objectUrl,
      filename,
      saveAs: false,
      conflictAction: "uniquify"
    }, (id) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(id);
    });
  });
  return { ok: true, downloadId };
}

async function archiveJob(job) {
  const archiveId = createArchiveId();
  sendProgress(job.jobId, "Reading Facebook photo data...");
  const response = await runContentJob({ id: job.tabId, url: job.url }, job.jobId);
  if (!response?.ok || !response.result) {
    throw new Error(response?.error || "Facebook did not return photo data.");
  }

  const { metadata, comments, images, stats } = response.result;
  if (!images?.length) throw new Error("No downloadable photo candidates were found on this Facebook page.");

  const prefix = `${archiveId}/`;
  const files = [
    { path: `${prefix}metadata.json`, text: JSON.stringify(metadata, null, 2) },
    { path: `${prefix}comments.json`, text: JSON.stringify(comments || [], null, 2) },
    { path: `${prefix}archive.json`, text: JSON.stringify({ archiveId, stats, sourceUrl: job.url, createdAt: new Date().toISOString() }, null, 2) }
  ];
  const imageIndex = [];
  const errors = [];
  let totalBytes = 0;

  for (let index = 0; index < images.length; index += 1) {
    const candidate = images[index];
    sendProgress(job.jobId, `Downloading image ${index + 1} of ${images.length}...`);
    try {
      const fetched = await fetchImage(job, candidate);
      const byteLength = Math.floor((fetched.dataBase64?.length || 0) * 3 / 4);
      if (!byteLength) throw new Error("empty response");
      if (byteLength > LIMITS.maxImageBytes) throw new Error("image exceeds the per-image limit");
      if (totalBytes + byteLength > LIMITS.maxTotalImageBytes) throw new Error("total image limit reached");

      const extension = fileExtension(fetched.contentType, candidate.url);
      const name = `images/${String(index + 1).padStart(3, "0")}.${extension}`;
      files.push({ path: `${prefix}${name}`, dataBase64: fetched.dataBase64 });
      imageIndex.push({ ...candidate, path: name, contentType: fetched.contentType, bytes: byteLength });
      totalBytes += byteLength;
    } catch (error) {
      errors.push({ url: candidate.url, error: error?.message || "download failed" });
    }
  }

  if (!imageIndex.length) {
    const firstError = errors[0];
    const reason = firstError?.error
      ? ` First error for ${firstError.url.slice(0, 160)}: ${firstError.error}`
      : "";
    throw new Error(`Facebook image candidates were found, but none could be downloaded.${reason} Keep Facebook open and try again.`);
  }
  files.push({ path: `${prefix}images/index.json`, text: JSON.stringify(imageIndex, null, 2) });
  if (errors.length) files.push({ path: `${prefix}errors.json`, text: JSON.stringify(errors, null, 2) });

  sendProgress(job.jobId, "Creating ZIP archive...");
  await assembleZip(`${archiveId}.zip`, files);
  sendProgress(job.jobId, `Download started: ${archiveId}.zip`, { done: true, archiveId });
  return { archiveId, imageCount: imageIndex.length, skippedImages: errors.length };
}

function startArchive(sendResponse) {
  getActiveTab().then((tab) => {
    const title = safeText(tab.title, "Untitled Facebook tab");
    const url = safeText(tab.url, "");
    const jobId = crypto.randomUUID();
    const job = { jobId, tabId: tab.id, url, title };
    jobs.set(jobId, job);
    sendResponse({ ok: true, jobId, title, url });
    sendProgress(jobId, `Started archive for:\n${title}\n${url}`);
    archiveJob(job).catch((error) => {
      const message = error?.message || "The archive failed unexpectedly.";
      sendProgress(jobId, message, { error: true, done: true });
      chrome.storage.local.set({ [`job:${jobId}`]: { error: message, done: true, updatedAt: Date.now() } }).catch(() => {});
    }).finally(() => jobs.delete(jobId));
  }).catch((error) => sendResponse({ ok: false, error: error?.message || "Could not read the active tab." }));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MESSAGE_TYPES.START_ARCHIVE) {
    startArchive(sendResponse);
    return true;
  }
  if (message?.type === "CONTENT_PROGRESS") {
    sendProgress(message.jobId, message.message || "Reading Facebook data...");
    return false;
  }
  return false;
});
