export const MESSAGE_TYPES = Object.freeze({
  START_ARCHIVE: "START_ARCHIVE",
  RUN_ARCHIVE: "RUN_ARCHIVE",
  FETCH_IMAGE: "FETCH_IMAGE",
  JOB_PROGRESS: "JOB_PROGRESS",
  ZIP_START: "ZIP_START",
  ZIP_ADD_FILE: "ZIP_ADD_FILE",
  ZIP_FINISH: "ZIP_FINISH",
  ZIP_DONE: "ZIP_DONE"
});

export const LIMITS = Object.freeze({
  maxExpansionActions: 30,
  maxExpansionMs: 45_000,
  maxComments: 500,
  maxImages: 30,
  // Base64 is used for Chrome runtime messages; keep each message below Chrome's limit.
  maxImageBytes: 20 * 1024 * 1024,
  maxTotalImageBytes: 150 * 1024 * 1024,
  imageFetchTimeoutMs: 25_000
});
