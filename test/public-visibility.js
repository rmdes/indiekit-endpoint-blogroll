import assert from "node:assert";
import { describe, it } from "node:test";

import { ObjectId } from "mongodb";

import { apiController } from "../lib/controllers/api.js";
import { getBlog } from "../lib/storage/blogs.js";

/**
 * A hidden or deleted blog, and its items, must never reach a public route
 * (Strix pentest of 2026-10-27, #20). The fake collections below evaluate the
 * queries the storage layer builds, so these tests fail if any public path
 * forgets the visibility predicate — not just the one the report named.
 */

// Minimal evaluator for the query operators this plugin uses.
const get = (doc, path) => path.split(".").reduce((v, k) => v?.[k], doc);
const same = (a, b) => String(a ?? null) === String(b ?? null);
const matches = (doc, query) =>
  Object.entries(query).every(([path, cond]) => {
    const value = get(doc, path);
    if (cond && typeof cond === "object" && !(cond instanceof ObjectId)) {
      if ("$ne" in cond) return !same(value, cond.$ne);
      if ("$in" in cond) return cond.$in.some((c) => same(value, c));
      throw new Error(`fake db: unsupported query ${JSON.stringify(cond)}`);
    }
    return same(value, cond);
  });

const cursor = (docs) => ({
  sort: () => cursor(docs),
  skip: (n) => cursor(docs.slice(n)),
  limit: (n) => cursor(docs.slice(0, n)),
  toArray: async () => docs,
});

const fakeCollection = (docs, all) => ({
  find: (q = {}) => cursor(docs.filter((d) => matches(d, q))),
  findOne: async (q = {}) => docs.find((d) => matches(d, q)) ?? null,
  countDocuments: async (q = {}) => docs.filter((d) => matches(d, q)).length,
  aggregate: (pipeline) => {
    let rows = docs;
    for (const stage of pipeline) {
      if (stage.$match) rows = rows.filter((d) => matches(d, stage.$match));
      else if (stage.$lookup) {
        const { from, localField, foreignField, as } = stage.$lookup;
        rows = rows.map((d) => ({
          ...d,
          [as]: all[from].filter((f) => same(f[foreignField], d[localField])),
        }));
      } else if (stage.$unwind) {
        const field = stage.$unwind.slice(1);
        rows = rows.flatMap((d) => d[field].map((v) => ({ ...d, [field]: v })));
      } else if (stage.$group) {
        const counts = new Map();
        for (const d of rows) counts.set(d.category, (counts.get(d.category) || 0) + 1);
        rows = [...counts].map(([_id, count]) => ({ _id, count }));
      } else if (!stage.$sort) {
        throw new Error(`fake db: unsupported stage ${Object.keys(stage)}`);
      }
    }
    return cursor(rows);
  },
});

const id = () => new ObjectId();
const visible = { _id: id(), title: "Visible", category: "c", status: "active", hidden: false };
const hidden = { _id: id(), title: "Hidden", category: "c", status: "active", hidden: true };
// microsub sync and older data can leave a deleted blog without hidden: true
const deleted = { _id: id(), title: "Deleted", category: "c", status: "deleted", hidden: false };
const feedId = id();
const hiddenMicrosub = {
  _id: id(),
  title: "Hidden microsub",
  category: "c",
  status: "active",
  hidden: true,
  source: "microsub",
  microsubFeedId: feedId,
};
const deletedMicrosub = { ...hiddenMicrosub, _id: id(), title: "Deleted microsub", hidden: false, status: "deleted" };
const visibleMicrosub = { ...hiddenMicrosub, _id: id(), title: "Visible microsub", hidden: false, microsubFeedId: id() };

const data = {
  blogrollBlogs: [visible, hidden, deleted, hiddenMicrosub, deletedMicrosub, visibleMicrosub],
  blogrollItems: [visible, hidden, deleted].map((b) => ({
    _id: id(),
    blogId: b._id,
    title: `${b.title} item`,
    published: "2026-10-01T00:00:00.000Z",
  })),
  microsub_items: [
    { _id: id(), feedId, name: "Microsub item", published: "2026-10-01T00:00:00.000Z" },
    { _id: id(), feedId: visibleMicrosub.microsubFeedId, name: "Visible microsub item", published: "2026-10-01T00:00:00.000Z" },
  ],
};

const application = {
  getBlogrollDb: () => ({ collection: (name) => fakeCollection(data[name], data) }),
  collections: new Map([["microsub_items", fakeCollection(data.microsub_items, data)]]),
};

const call = async (handler, { params = {}, query = {} } = {}) => {
  const response = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
    },
    set() {},
    send(body) {
      this.body = body;
    },
  };
  await handler({ app: { locals: { application } }, params, query }, response);
  return response;
};

const titles = (items) => items.map((i) => i.title).sort();
const removed = [hidden, deleted, hiddenMicrosub, deletedMicrosub];

describe("public blog detail", () => {
  it("serves a visible blog with its items", async () => {
    const response = await call(apiController.getBlog, { params: { id: String(visible._id) } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(titles(response.body.items), ["Visible item"]);
  });

  for (const blog of removed) {
    it(`returns 404 for ${blog.title}`, async () => {
      const response = await call(apiController.getBlog, { params: { id: String(blog._id) } });
      assert.equal(response.statusCode, 404, JSON.stringify(response.body));
    });
  }
});

describe("public item listing", () => {
  it("lists only items of visible blogs", async () => {
    const response = await call(apiController.listItems);
    assert.deepEqual(titles(response.body.items), ["Visible item", "Visible microsub item"]);
  });

  it("returns only that blog's items for ?blog=", async () => {
    for (const [blog, expected] of [
      [visible, ["Visible item"]],
      [visibleMicrosub, ["Visible microsub item"]],
    ]) {
      const response = await call(apiController.listItems, { query: { blog: String(blog._id) } });
      assert.deepEqual(titles(response.body.items), expected);
    }
  });

  for (const blog of removed) {
    it(`returns no items for ?blog=${blog.title}`, async () => {
      const response = await call(apiController.listItems, { query: { blog: String(blog._id) } });
      assert.deepEqual(response.body.items, []);
    });
  }
});

describe("public blog listing, categories and OPML", () => {
  it("lists only visible blogs", async () => {
    const response = await call(apiController.listBlogs);
    assert.deepEqual(titles(response.body.items), ["Visible", "Visible microsub"]);
    assert.equal(response.body.total, 2);
  });

  it("counts only visible blogs per category", async () => {
    const response = await call(apiController.listCategories);
    assert.deepEqual(response.body.items, [{ name: "c", count: 2 }]);
  });

  it("exports only visible blogs as OPML", async () => {
    for (const [handler, params] of [
      [apiController.exportOpml, {}],
      [apiController.exportOpmlCategory, { category: "c" }],
    ]) {
      const response = await call(handler, { params });
      assert.match(response.body, /Visible/);
      for (const blog of removed) assert.doesNotMatch(response.body, new RegExp(blog.title));
    }
  });
});

describe("admin lookup", () => {
  it("still sees hidden and deleted blogs", async () => {
    for (const blog of removed) {
      assert.equal((await getBlog(application, blog._id))?.title, blog.title);
    }
  });
});
