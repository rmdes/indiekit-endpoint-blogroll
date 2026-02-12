/**
 * Blog storage operations
 * @module storage/blogs
 */

import { ObjectId } from "mongodb";

/**
 * Get collection reference
 * @param {object} application - Application instance
 * @returns {Collection} MongoDB collection
 */
function getCollection(application) {
  const db = application.getBlogrollDb();
  return db.collection("blogrollBlogs");
}

/**
 * Get all blogs
 * @param {object} application - Application instance
 * @param {object} options - Query options
 * @returns {Promise<Array>} Blogs
 */
export async function getBlogs(application, options = {}) {
  const collection = getCollection(application);
  const { category, sourceId, includeHidden = false, limit = 100, offset = 0 } = options;

  const query = { status: { $ne: "deleted" } };
  if (!includeHidden) query.hidden = { $ne: true };
  if (category) query.category = category;
  if (sourceId) query.sourceId = new ObjectId(sourceId);

  return collection
    .find(query)
    .sort({ pinned: -1, title: 1 })
    .skip(offset)
    .limit(limit)
    .toArray();
}

/**
 * Count blogs
 * @param {object} application - Application instance
 * @param {object} options - Query options
 * @returns {Promise<number>} Count
 */
export async function countBlogs(application, options = {}) {
  const collection = getCollection(application);
  const { category, includeHidden = false } = options;

  const query = { status: { $ne: "deleted" } };
  if (!includeHidden) query.hidden = { $ne: true };
  if (category) query.category = category;

  return collection.countDocuments(query);
}

/**
 * Get blog by ID
 * @param {object} application - Application instance
 * @param {string|ObjectId} id - Blog ID
 * @returns {Promise<object|null>} Blog or null
 */
export async function getBlog(application, id) {
  const collection = getCollection(application);
  const objectId = typeof id === "string" ? new ObjectId(id) : id;
  return collection.findOne({ _id: objectId });
}

/**
 * Get blog by feed URL
 * @param {object} application - Application instance
 * @param {string} feedUrl - Feed URL
 * @returns {Promise<object|null>} Blog or null
 */
export async function getBlogByFeedUrl(application, feedUrl) {
  const collection = getCollection(application);
  return collection.findOne({ feedUrl, status: { $ne: "deleted" } });
}

/**
 * Create a new blog
 * @param {object} application - Application instance
 * @param {object} data - Blog data
 * @returns {Promise<object>} Created blog
 */
export async function createBlog(application, data) {
  const collection = getCollection(application);
  const now = new Date();

  const blog = {
    sourceId: data.sourceId ? new ObjectId(data.sourceId) : null,
    title: data.title,
    description: data.description || null,
    feedUrl: data.feedUrl,
    siteUrl: data.siteUrl || null,
    feedType: data.feedType || "rss",
    category: data.category || "",
    tags: data.tags || [],
    photo: data.photo || null,
    author: data.author || null,
    status: "active",
    lastFetchAt: null,
    lastError: null,
    itemCount: 0,
    pinned: data.pinned || false,
    hidden: data.hidden || false,
    notes: data.notes || null,
    createdAt: now,
    updatedAt: now,
  };

  const result = await collection.insertOne(blog);
  return { ...blog, _id: result.insertedId };
}

/**
 * Update a blog
 * @param {object} application - Application instance
 * @param {string|ObjectId} id - Blog ID
 * @param {object} data - Update data
 * @returns {Promise<object|null>} Updated blog
 */
export async function updateBlog(application, id, data) {
  const collection = getCollection(application);
  const objectId = typeof id === "string" ? new ObjectId(id) : id;

  const update = {
    ...data,
    updatedAt: new Date(),
  };

  // Remove fields that shouldn't be updated directly
  delete update._id;
  delete update.createdAt;

  return collection.findOneAndUpdate(
    { _id: objectId },
    { $set: update },
    { returnDocument: "after" }
  );
}

/**
 * Delete a blog and its items (soft delete)
 * Marks blog as deleted so sync won't recreate it.
 * @param {object} application - Application instance
 * @param {string|ObjectId} id - Blog ID
 * @returns {Promise<boolean>} Success
 */
export async function deleteBlog(application, id) {
  const db = application.getBlogrollDb();
  const objectId = typeof id === "string" ? new ObjectId(id) : id;

  // Delete items for this blog
  await db.collection("blogrollItems").deleteMany({ blogId: objectId });

  // Soft delete: mark as deleted so upsertBlog won't recreate it
  const result = await db.collection("blogrollBlogs").updateOne(
    { _id: objectId },
    {
      $set: {
        status: "deleted",
        hidden: true,
        deletedAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );
  return result.modifiedCount > 0;
}

/**
 * Update blog fetch status
 * @param {object} application - Application instance
 * @param {string|ObjectId} id - Blog ID
 * @param {object} status - Fetch status
 */
export async function updateBlogStatus(application, id, status) {
  const collection = getCollection(application);
  const objectId = typeof id === "string" ? new ObjectId(id) : id;

  const update = {
    updatedAt: new Date(),
  };

  if (status.success) {
    update.status = "active";
    update.lastFetchAt = new Date();
    update.lastError = null;
    if (status.itemCount !== undefined) {
      update.itemCount = status.itemCount;
    }
    if (status.title) update.title = status.title;
    if (status.photo) update.photo = status.photo;
    if (status.siteUrl) update.siteUrl = status.siteUrl;
  } else {
    update.status = "error";
    update.lastError = status.error;
  }

  return collection.updateOne({ _id: objectId }, { $set: update });
}

/**
 * Get blogs due for refresh
 * @param {object} application - Application instance
 * @param {number} maxAge - Max age in minutes before refresh
 * @returns {Promise<Array>} Blogs needing refresh
 */
export async function getBlogsDueForRefresh(application, maxAge = 60) {
  const collection = getCollection(application);
  const cutoff = new Date(Date.now() - maxAge * 60000);

  return collection
    .find({
      hidden: { $ne: true },
      status: { $ne: "deleted" },
      $or: [{ lastFetchAt: null }, { lastFetchAt: { $lt: cutoff } }],
    })
    .toArray();
}

/**
 * Get categories with counts
 * @param {object} application - Application instance
 * @returns {Promise<Array>} Categories with counts
 */
export async function getCategories(application) {
  const collection = getCollection(application);

  return collection
    .aggregate([
      { $match: { hidden: { $ne: true }, status: { $ne: "deleted" }, category: { $ne: "" } } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ])
    .toArray();
}

/**
 * Upsert a blog (for OPML sync)
 * @param {object} application - Application instance
 * @param {object} data - Blog data
 * @returns {Promise<object>} Result with upserted flag
 */
export async function upsertBlog(application, data) {
  const collection = getCollection(application);
  const now = new Date();

  // Skip if a blog with this feedUrl was soft-deleted
  const deleted = await collection.findOne({
    feedUrl: data.feedUrl,
    status: "deleted",
  });
  if (deleted) {
    return { upserted: false, modified: false, skippedDeleted: true };
  }

  const filter = { feedUrl: data.feedUrl };
  if (data.sourceId) {
    filter.sourceId = new ObjectId(data.sourceId);
  }

  // Build $set with base fields
  const setFields = {
    title: data.title,
    siteUrl: data.siteUrl,
    feedType: data.feedType,
    category: data.category,
    sourceId: data.sourceId ? new ObjectId(data.sourceId) : null,
    updatedAt: now,
  };

  // Conditionally add microsub/optional fields to $set when provided
  if (data.source !== undefined) setFields.source = data.source;
  if (data.microsubFeedId !== undefined) setFields.microsubFeedId = data.microsubFeedId;
  if (data.microsubChannelId !== undefined) setFields.microsubChannelId = data.microsubChannelId;
  if (data.microsubChannelName !== undefined) setFields.microsubChannelName = data.microsubChannelName;
  if (data.skipItemFetch !== undefined) setFields.skipItemFetch = data.skipItemFetch;
  if (data.photo !== undefined) setFields.photo = data.photo;
  if (data.lastFetchAt !== undefined) setFields.lastFetchAt = data.lastFetchAt;
  if (data.status !== undefined) setFields.status = data.status;

  // $setOnInsert only for fields NOT already in $set (avoids MongoDB path conflicts)
  const insertDefaults = {
    description: null,
    tags: [],
    author: null,
    lastError: null,
    itemCount: 0,
    pinned: false,
    hidden: false,
    notes: null,
    createdAt: now,
  };

  // Add defaults for optional fields only when they're NOT in $set
  if (!("source" in setFields)) insertDefaults.source = null;
  if (!("microsubFeedId" in setFields)) insertDefaults.microsubFeedId = null;
  if (!("microsubChannelId" in setFields)) insertDefaults.microsubChannelId = null;
  if (!("microsubChannelName" in setFields)) insertDefaults.microsubChannelName = null;
  if (!("skipItemFetch" in setFields)) insertDefaults.skipItemFetch = false;
  if (!("photo" in setFields)) insertDefaults.photo = null;
  if (!("lastFetchAt" in setFields)) insertDefaults.lastFetchAt = null;
  if (!("status" in setFields)) insertDefaults.status = "active";

  const result = await collection.updateOne(
    filter,
    {
      $set: setFields,
      $setOnInsert: insertDefaults,
    },
    { upsert: true }
  );

  return {
    upserted: result.upsertedCount > 0,
    modified: result.modifiedCount > 0,
  };
}
