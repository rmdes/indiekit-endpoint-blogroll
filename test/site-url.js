import assert from "node:assert";
import { describe, it } from "node:test";

import { extractSiteUrl } from "../lib/sync/microsub.js";

/**
 * extractSiteUrl used to return the feed URL's origin unconditionally, which
 * invented a homepage for feeds that have none. These cases are taken from real
 * subscriptions on the live sites.
 */

describe("extractSiteUrl", () => {
  it("keeps the origin when subscribed to a site directly (h-feed)", () => {
    // Microsub often subscribes to the page itself, not an XML file.
    assert.equal(extractSiteUrl("https://kevinmarks.com/"), "https://kevinmarks.com");
    assert.equal(extractSiteUrl("https://kevinmarks.com"), "https://kevinmarks.com");
  });

  it("keeps the origin for conventional feed paths", () => {
    const cases = [
      "https://paulrobertlloyd.com/feed.xml",
      "https://example.com/index.xml",
      "https://example.com/rss.xml",
      "https://example.com/atom.xml",
      "https://example.com/feed",
      "https://example.com/feed/",
      "https://example.com/rss",
      "https://example.com/feeds/posts.xml",
    ];

    for (const url of cases) {
      assert.equal(
        extractSiteUrl(url),
        "https://" + new URL(url).host,
        `expected a site for ${url}`,
      );
    }
  });

  it("declines to invent a site for a webhook or app path", () => {
    // The case that started this: an n8n webhook is not a blog homepage.
    assert.equal(extractSiteUrl("https://n8.rmendes.net/webhook/indiekit-activity"), "");
    assert.equal(extractSiteUrl("https://example.com/api/v1/posts.json"), "");
    assert.equal(extractSiteUrl("https://example.com/some/deep/path"), "");
  });

  it("returns empty for unparseable input rather than throwing", () => {
    assert.equal(extractSiteUrl("not a url"), "");
    assert.equal(extractSiteUrl(""), "");
    assert.equal(extractSiteUrl(undefined), "");
  });

  it("never returns a value the frontend would show as a bare origin lie", () => {
    // Whatever comes back is either empty (frontend falls back to the feed)
    // or a real origin — never a truncated deep path presented as a homepage.
    for (const url of [
      "https://n8.rmendes.net/webhook/x",
      "https://kevinmarks.com/",
      "https://example.com/feed.xml",
    ]) {
      const site = extractSiteUrl(url);
      assert.ok(site === "" || site === "https://" + new URL(url).host);
    }
  });
});
