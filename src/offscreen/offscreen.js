"use strict";

let activeZip = null;

function startDownload(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(downloadId);
    });
  });
}

function base64ToUint8Array(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ZIP_START") {
    try {
      if (typeof JSZip !== "function") throw new Error("The local ZIP library is unavailable.");
      activeZip = new JSZip();
      for (const file of message.files || []) activeZip.file(file.path, file.text);
      sendResponse({ ok: true });
    } catch (error) {
      activeZip = null;
      sendResponse({ ok: false, error: error?.message || "ZIP assembly failed." });
    }
    return false;
  }

  if (message?.type === "ZIP_ADD_FILE") {
    try {
      if (!activeZip) throw new Error("ZIP session is not initialized.");
      activeZip.file(message.path, base64ToUint8Array(message.dataBase64));
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || "ZIP file assembly failed." });
    }
    return false;
  }

  if (message?.type !== "ZIP_FINISH") return false;

  (async () => {
    if (!activeZip) throw new Error("ZIP session is not initialized.");
    const zip = activeZip;
    activeZip = null;
    const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
    const objectUrl = URL.createObjectURL(blob);
    try {
      const downloadId = await startDownload({
        url: objectUrl,
        filename: message.filename,
        saveAs: false,
        conflictAction: "uniquify"
      });
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      return { ok: true, downloadId };
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || "ZIP download failed." }));
  return true;
});
