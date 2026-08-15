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

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
    }
    return btoa(binary);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "RUN_ARCHIVE") {
      adapter.run({ url: message.url || location.href }, limits, (progress) => {
        chrome.runtime.sendMessage({ type: "CONTENT_PROGRESS", jobId: message.jobId, message: progress }).catch(() => {});
      }).then((result) => sendResponse({ ok: true, result }))
        .catch((error) => sendResponse({ ok: false, error: error?.message || "Facebook data could not be read." }));
      return true;
    }

    if (message?.type === "FETCH_IMAGE") {
      fetch(message.url, {
        credentials: "include",
        cache: "force-cache",
        referrer: message.referrer || location.href,
        referrerPolicy: "unsafe-url",
        headers: { Accept: "image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8" }
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Image request returned HTTP ${response.status}.`);
          const buffer = await response.arrayBuffer();
          if (message.maxBytes && buffer.byteLength > message.maxBytes) {
            throw new Error(`image exceeds the ${Math.round(message.maxBytes / 1024 / 1024)} MB per-image limit`);
          }
          const contentType = response.headers.get("content-type") || "application/octet-stream";
          if (!contentType.toLowerCase().startsWith("image/")) {
            throw new Error(`Facebook returned ${contentType} instead of an image`);
          }
          return sendResponse({
            ok: true,
            contentType,
            dataBase64: arrayBufferToBase64(buffer)
          });
        })
        .catch((error) => sendResponse({ ok: false, error: error?.message || "Authenticated image fetch failed." }));
      return true;
    }
    return false;
  });
})();
