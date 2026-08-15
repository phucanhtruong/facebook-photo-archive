export const MESSAGE_TYPES = Object.freeze({
  START_ARCHIVE: "START_ARCHIVE",
  RUN_ARCHIVE: "RUN_ARCHIVE",
  FETCH_IMAGE: "FETCH_IMAGE",
  JOB_PROGRESS: "JOB_PROGRESS",
  ASSEMBLE_ZIP: "ASSEMBLE_ZIP",
  ZIP_DONE: "ZIP_DONE"
});

export const LIMITS = Object.freeze({
  maxExpansionActions: 30,
  maxExpansionMs: 45_000,
  maxComments: 500,
  maxImages: 30,
  maxImageBytes: 25 * 1024 * 1024,
  maxTotalImageBytes: 150 * 1024 * 1024,
  imageFetchTimeoutMs: 25_000
});
