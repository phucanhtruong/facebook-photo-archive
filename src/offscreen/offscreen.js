"use strict";

function startDownload(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(downloadId);
    });
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "ASSEMBLE_ZIP") return false;

  (async () => {
    if (typeof JSZip !== "function") throw new Error("The local ZIP library is unavailable.");
    const zip = new JSZip();
    for (const file of message.files || []) {
      if (typeof file.text === "string") zip.file(file.path, file.text);
      else zip.file(file.path, file.data);
    }
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
