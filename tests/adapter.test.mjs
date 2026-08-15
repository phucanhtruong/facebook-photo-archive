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
console.log("adapter tests passed");
