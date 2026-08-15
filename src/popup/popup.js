const button = document.getElementById("downloadBtn");
const status = document.getElementById("status");

function setStatus(message, kind = "") {
  status.textContent = message;
  status.dataset.kind = kind;
}

function displayTitle(title, url) {
  const safeTitle = typeof title === "string" && title.trim()
    ? title.trim()
    : "Untitled Facebook tab";
  const safeUrl = typeof url === "string" && url.trim() ? url.trim() : "Current tab";
  return `${safeTitle}\n${safeUrl}`;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "JOB_PROGRESS") return;
  if (message.jobId && button.dataset.jobId && message.jobId !== button.dataset.jobId) return;
  setStatus(message.message || "Working...");
  if (message.done) {
    button.disabled = false;
    delete button.dataset.jobId;
  }
});

button.addEventListener("click", async () => {
  button.disabled = true;
  delete button.dataset.jobId;
  setStatus("Reading the current Facebook tab...");

  try {
    const response = await chrome.runtime.sendMessage({ type: "START_ARCHIVE" });
    if (!response?.ok) {
      throw new Error(response?.error || "The archive could not be started.");
    }

    button.dataset.jobId = response.jobId || "";
    setStatus(`Started archive for:\n${displayTitle(response.title, response.url)}`);
  } catch (error) {
    setStatus(error?.message || "The archive could not be started.", "error");
    button.disabled = false;
  }
});
