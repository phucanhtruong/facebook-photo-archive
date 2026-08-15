import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/content/facebook-adapter.js", import.meta.url), "utf8");
const context = {
  location: { href: "https://www.facebook.com/photo/?fbid=922233833712078&set=pcb.1048781394674662" },
  URL,
  URLSearchParams,
  decodeURIComponent,
  Date,
  console,
  globalThis: {}
};
context.globalThis = context;
vm.runInNewContext(source, context);

const adapter = context.FacebookPhotoArchiveAdapter;
assert.ok(adapter, "adapter is installed");
const parsed = adapter.parsePhotoPage(context.location.href);
assert.equal(parsed.isFacebook, true);
assert.equal(parsed.isPhotoPage, true);
assert.equal(parsed.fbid, "922233833712078");
assert.equal(parsed.setId, "pcb.1048781394674662");
assert.equal(adapter.parsePhotoPage("https://www.google.com/"), null);
assert.equal(adapter.parsePhotoPage("https://www.facebook.com/groups/example").isPhotoPage, false);

const signedImageUrl = "https://scontent.fsgn19-1.fna.fbcdn.net/v/t39.30808-6/photo.jpg?_nc_sid=abc123&oe=123456";
const image = {
  currentSrc: signedImageUrl,
  src: signedImageUrl,
  naturalWidth: 1200,
  naturalHeight: 800,
  getAttribute: () => null,
  closest: () => null,
  getBoundingClientRect: () => ({ width: 1200, height: 800, right: 1200, bottom: 800, left: 0, top: 0 })
};
context.document = {
  images: [image],
  querySelectorAll: () => [],
  querySelector: () => null
};
context.getComputedStyle = () => ({ display: "block", visibility: "visible" });
context.innerWidth = 1600;
context.innerHeight = 1000;
const extracted = adapter.extractImages({ ogImage: null });
assert.equal(extracted.length, 1);
assert.equal(extracted[0].url, signedImageUrl, "deduplication must not strip signed CDN URL parameters");
console.log("adapter tests passed");
