(function installContentBridge() {
  "use strict";
  const adapter = globalThis.FacebookPhotoArchiveAdapter;
  const limits = {
    maxExpansionActions: 30,
    maxExpansionMs: 45_000,
    maxComments: 500,
    maxImages: 30
  };

  if (!adapter) return;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "RUN_ARCHIVE") {
      adapter.run({ url: message.url || location.href }, limits, (progress) => {
        chrome.runtime.sendMessage({ type: "CONTENT_PROGRESS", jobId: message.jobId, message: progress }).catch(() => {});
      }).then((result) => sendResponse({ ok: true, result }))
        .catch((error) => sendResponse({ ok: false, error: error?.message || "Facebook data could not be read." }));
      return true;
    }

    if (message?.type === "FETCH_IMAGE") {
      fetch(message.url, { credentials: "include", cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Image request returned HTTP ${response.status}.`);
          return sendResponse({ ok: true, contentType: response.headers.get("content-type") || "application/octet-stream", buffer: await response.arrayBuffer() });
        })
        .catch((error) => sendResponse({ ok: false, error: error?.message || "Authenticated image fetch failed." }));
      return true;
    }
    return false;
  });
})();
