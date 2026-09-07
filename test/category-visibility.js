import assert from "node:assert";
import { describe, it } from "node:test";

import { UNCATEGORIZED, LOCKABLE_FIELDS } from "../lib/storage/blogs.js";

/**
 * These cover the three ways a blog could previously end up ingested but
 * unreachable in the frontend, plus the sync-clobbers-manual-edit bug.
 * They exercise the decision logic rather than MongoDB itself.
 */

// Mirrors the $group expression in getCategories().
const bucketFor = (category) =>
  category === undefined || category === null || category === ""
    ? UNCATEGORIZED
    : category;

// Mirrors the manualFields filtering in upsertBlog().
const applySync = (existing, incoming) => {
  const setFields = { ...incoming };
  for (const field of existing.manualFields || []) delete setFields[field];
  return { ...existing, ...setFields };
};

describe("category bucketing", () => {
  it("puts empty, null and missing categories in one visible bucket", () => {
    for (const value of ["", null, undefined]) {
      assert.equal(bucketFor(value), UNCATEGORIZED);
    }
  });

  it("leaves a real category untouched", () => {
    assert.equal(bucketFor("indiekit"), "indiekit");
  });

  it("never yields an empty bucket name", () => {
    for (const value of ["", null, undefined, "x"]) {
      assert.ok(bucketFor(value).length > 0);
    }
  });
});

describe("flat OPML falls back to the source name", () => {
  // Mirrors the fallback in syncOpmlSource().
  const categoryFor = (parsed, source) => parsed.category || source.name || "";

  it("uses the folder category when the OPML is nested", () => {
    assert.equal(
      categoryFor({ category: "Tech" }, { name: "HN Blog Feeds" }),
      "Tech",
    );
  });

  it("uses the source name when the OPML is flat", () => {
    assert.equal(
      categoryFor({ category: "" }, { name: "HN Blog Feeds" }),
      "HN Blog Feeds",
    );
  });
});

describe("manual edits survive a resync", () => {
  it("keeps a user-set category when sync sends its own", () => {
    const blog = { title: "Feed", category: "indiekit", manualFields: ["category"] };
    const after = applySync(blog, { title: "Feed", category: "MicrosubGithub" });

    assert.equal(after.category, "indiekit", "user category was overwritten");
  });

  it("still applies fields the user has not claimed", () => {
    const blog = { title: "Old", category: "indiekit", manualFields: ["category"] };
    const after = applySync(blog, { title: "New", category: "MicrosubGithub" });

    assert.equal(after.title, "New", "unlocked field should follow the source");
    assert.equal(after.category, "indiekit");
  });

  it("hands the field back when the user clears it", () => {
    const blog = { title: "Feed", category: "indiekit", manualFields: [] };
    const after = applySync(blog, { title: "Feed", category: "MicrosubGithub" });

    assert.equal(after.category, "MicrosubGithub");
  });

  it("locks exactly the fields a user can edit by hand", () => {
    // siteUrl is lockable too: a feed with no real homepage gets no site from
    // sync, so a hand-set one must survive the next run.
    assert.deepEqual(LOCKABLE_FIELDS, ["title", "category", "siteUrl"]);
  });
});
