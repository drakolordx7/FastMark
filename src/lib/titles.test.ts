import assert from "node:assert/strict";
import { cleanTitle } from "./titles";
import { canonicalizeUrl, isTopLevelUrl, pathDepth, siteHost } from "./urls";

assert.equal(
  cleanTitle("Best Tools &#39;2024&#39; | Example Site", "example.com"),
  "Best Tools '2024'",
);

assert.equal(
  canonicalizeUrl("HTTPS://WWW.Example.com/path/?utm_source=x&b=2&a=1"),
  "https://example.com/path?a=1&b=2",
);

assert.equal(siteHost("https://www.reddit.com/r/foo"), "reddit.com");
assert.equal(pathDepth("https://reddit.com/"), 0);
assert.equal(pathDepth("https://reddit.com/r/foo"), 2);
assert.equal(isTopLevelUrl("https://reddit.com"), true);
assert.equal(isTopLevelUrl("https://reddit.com/r/foo"), false);

console.log("titles/urls tests passed");
