/**
 * Source storage operations
 * @module storage/sources
 */

import { ObjectId } from "mongodb";

/**
 * Get collection reference
 * @param {object} application - Application instance
 * @returns {Collection} MongoDB collection
 */
function getCollection(application) {
  const db = application.getBlogrollDb();
  return db.collection("blogrollSources");
}

/**
 * Get all sources
 * @param {object} application - Application instance
 * @returns {Promise<Array>} Sources
 */
export async function getSources(application) {
  const collection = getCollection(application);
  return collection.find({}).sort({ name: 1 }).toArray();
}

/**
 * Get source by ID
 * @param {object} application - Application instance
 * @param {string|ObjectId} id - Source ID
 * @returns {Promise<object|null>} Source or null
 */
export async function getSource(application, id) {
  const collection = getCollection(application);
  const objectId = typeof id === "string" ? new ObjectId(id) : id;
  return collection.findOne({ _id: objectId });
}

/**
 * Create a new source
 * @param {object} application - Application instance
 * @param {object} data - Source data
 * @returns {Promise<object>} Created source
 */
export async function createSource(application, data) {
  const collection = getCollection(application);
  const now = new Date().toISOString();

  const source = {
    type: data.type, // "opml_url" | "opml_file" | "manual" | "json_feed" | "microsub" | "feedland"
    name: data.name,
    url: data.url || null,
    opmlContent: data.opmlContent || null,
    // Microsub-specific fields
    channelFilter: data.channelFilter || null,
    categoryPrefix: data.categoryPrefix || "",
    // FeedLand-specific fields
    feedlandInstance: data.feedlandInstance || null,
    feedlandUsername: data.feedlandUsername || null,
    feedlandCategory: data.feedlandCategory || null,
    enabled: data.enabled !== false,
    syncInterval: data.syncInterval || 60, // minutes
    lastSyncAt: null,
    lastSyncError: null,
    createdAt: now,
    updatedAt: now,
  };

  const result = await collection.insertOne(source);
  return { ...source, _id: result.insertedId };
}

/**
 * Update a source
 * @param {object} application - Application instance
 * @param {string|ObjectId} id - Source ID
 * @param {object} data - Update data
 * @returns {Promise<object|null>} Updated source
 */
export async function updateSource(application, id, data) {
  const collection = getCollection(application);
  const objectId = typeof id === "string" ? new ObjectId(id) : id;

  const update = {
    ...data,
    updatedAt: new Date().toISOString(),
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
 * Delete a source and its associated blogs
 * @param {object} application - Application instance
 * @param {string|ObjectId} id - Source ID
 * @returns {Promise<boolean>} Success
 */
export async function deleteSource(application, id) {
  const db = application.getBlogrollDb();
  const objectId = typeof id === "string" ? new ObjectId(id) : id;

  // Get blogs from this source
  const blogs = await db
    .collection("blogrollBlogs")
    .find({ sourceId: objectId })
    .toArray();
  const blogIds = blogs.map((b) => b._id);

  // Delete items from those blogs
  if (blogIds.length > 0) {
    await db.collection("blogrollItems").deleteMany({ blogId: { $in: blogIds } });
  }

  // Delete blogs from this source
  await db.collection("blogrollBlogs").deleteMany({ sourceId: objectId });

  // Delete the source
  const result = await db.collection("blogrollSources").deleteOne({ _id: objectId });
  return result.deletedCount > 0;
}

/**
 * Update source sync status
 * @param {object} application - Application instance
 * @param {string|ObjectId} id - Source ID
 * @param {object} status - Sync status
 */
export async function updateSourceSyncStatus(application, id, status) {
  const collection = getCollection(application);
  const objectId = typeof id === "string" ? new ObjectId(id) : id;

  const update = {
    updatedAt: new Date().toISOString(),
  };

  if (status.success) {
    update.lastSyncAt = new Date().toISOString();
    update.lastSyncError = null;
  } else {
    update.lastSyncError = status.error;
  }

  return collection.updateOne({ _id: objectId }, { $set: update });
}

/**
 * Get sources due for sync
 * @param {object} application - Application instance
 * @returns {Promise<Array>} Sources needing sync
 */
export async function getSourcesDueForSync(application) {
  const collection = getCollection(application);
  const now = new Date();

  return collection
    .find({
      enabled: true,
      type: { $in: ["opml_url", "json_feed", "microsub", "feedland"] },
      $or: [
        { lastSyncAt: null },
        {
          $expr: {
            $lt: [
              "$lastSyncAt",
              { $subtract: [now, { $multiply: ["$syncInterval", 60000] }] },
            ],
          },
        },
      ],
    })
    .toArray();
}
