# Facebook Photo Archive

A Chromium MV3 extension that archives the current Facebook photo post into a ZIP file.

## Output

Each download is named `HHmmss_DDMMYY.zip` and contains an inner folder with the same archive ID:

```text
HHmmss_DDMMYY/
├── archive.json
├── metadata.json
├── comments.json
├── errors.json                 # only when some image candidates fail
└── images/
    ├── index.json
    ├── 001.jpg
    └── ...
```

The extension uses only local runtime JavaScript. JSZip is vendored under `src/vendor/`.


## Load locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this folder.
4. Open a Facebook photo post while signed in and click the extension's **Download** button.

Chrome does not allow an extension to pin itself. To pin it after loading, open the puzzle-piece Extensions menu in the toolbar and click the pin icon next to **Facebook Photo Archive**.

The extension keeps conservative limits: up to 30 comment-expansion actions, 500 comments, 30 image candidates, 20 MB per image, and 150 MB total image bytes. Image bytes are sent between extension contexts as bounded base64 messages and reconstructed as typed arrays before JSZip receives them.
