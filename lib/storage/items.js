/**
 * Item storage operations
 * @module storage/items
 */

import { ObjectId } from "mongodb";

/**
 * Get collection reference
 * @param {object} application - Application instance
 * @returns {Collection} MongoDB collection
 */
function getCollection(application) {
  const db = application.getBlogrollDb();
  return db.collection("blogrollItems");
}

/**
 * Get items with optional filtering
 * @param {object} application - Application instance
 * @param {object} options - Query options
 * @returns {Promise<Array>} Items with blog info
 */
export async function getItems(application, options = {}) {
  const db = application.getBlogrollDb();
  const { blogId, category, limit = 50, offset = 0 } = options;

  const pipeline = [
    { $sort: { published: -1 } },
    { $skip: offset },
    { $limit: limit + 1 }, // Fetch one extra to check hasMore
    {
      $lookup: {
        from: "blogrollBlogs",
        localField: "blogId",
        foreignField: "_id",
        as: "blog",
      },
    },
    { $unwind: "$blog" },
    { $match: { "blog.hidden": { $ne: true } } },
  ];

  if (blogId) {
    pipeline.unshift({ $match: { blogId: new ObjectId(blogId) } });
  }

  if (category) {
    pipeline.push({ $match: { "blog.category": category } });
  }

  const items = await db.collection("blogrollItems").aggregate(pipeline).toArray();

  const hasMore = items.length > limit;
  if (hasMore) items.pop();

  return { items, hasMore };
}

/**
 * Get items for a specific blog
 * @param {object} application - Application instance
 * @param {string|ObjectId} blogId - Blog ID
 * @param {number} limit - Max items
 * @returns {Promise<Array>} Items
 */
export async function getItemsForBlog(application, blogId, limit = 20) {
  const collection = getCollection(application);
  const objectId = typeof blogId === "string" ? new ObjectId(blogId) : blogId;

  return collection
    .find({ blogId: objectId })
    .sort({ published: -1 })
    .limit(limit)
    .toArray();
}

/**
 * Count items
 * @param {object} application - Application instance
 * @param {object} options - Query options
 * @returns {Promise<number>} Count
 */
export async function countItems(application, options = {}) {
  const collection = getCollection(application);
  const query = {};

  if (options.blogId) {
    query.blogId = new ObjectId(options.blogId);
  }

  return collection.countDocuments(query);
}

/**
 * Upsert an item
 * @param {object} application - Application instance
 * @param {object} data - Item data
 * @returns {Promise<object>} Result with upserted flag
 */
export async function upsertItem(application, data) {
  const collection = getCollection(application);
  const now = new Date();

  const result = await collection.updateOne(
    { blogId: new ObjectId(data.blogId), uid: data.uid },
    {
      $set: {
        url: data.url,
        title: data.title,
        content: data.content,
        summary: data.summary,
        published: data.published,
        updated: data.updated,
        author: data.author,
        photo: data.photo,
        categories: data.categories || [],
        fetchedAt: now,
      },
      $setOnInsert: {
        blogId: new ObjectId(data.blogId),
        uid: data.uid,
      },
    },
    { upsert: true }
  );

  return {
    upserted: result.upsertedCount > 0,
    modified: result.modifiedCount > 0,
  };
}

/**
 * Delete items for a blog
 * @param {object} application - Application instance
 * @param {string|ObjectId} blogId - Blog ID
 * @returns {Promise<number>} Deleted count
 */
export async function deleteItemsForBlog(application, blogId) {
  const collection = getCollection(application);
  const objectId = typeof blogId === "string" ? new ObjectId(blogId) : blogId;

  const result = await collection.deleteMany({ blogId: objectId });
  return result.deletedCount;
}

/**
 * Delete old items beyond retention period
 * This encourages discovery by showing only recent content
 * @param {object} application - Application instance
 * @param {number} maxAgeDays - Max age in days (default 7)
 * @returns {Promise<number>} Deleted count
 */
export async function deleteOldItems(application, maxAgeDays = 7) {
  const collection = getCollection(application);
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

  const result = await collection.deleteMany({
    published: { $lt: cutoff },
  });

  if (result.deletedCount > 0) {
    console.log(`[Blogroll] Cleaned up ${result.deletedCount} items older than ${maxAgeDays} days`);
  }

  return result.deletedCount;
}

/**
 * Get item by ID
 * @param {object} application - Application instance
 * @param {string|ObjectId} id - Item ID
 * @returns {Promise<object|null>} Item or null
 */
export async function getItem(application, id) {
  const collection = getCollection(application);
  const objectId = typeof id === "string" ? new ObjectId(id) : id;
  return collection.findOne({ _id: objectId });
}
