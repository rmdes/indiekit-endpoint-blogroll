/**
 * Item storage operations
 * @module storage/items
 *
 * IMPORTANT: This module handles items from TWO sources:
 * - Regular blogs: items stored in blogrollItems collection
 * - Microsub blogs: items queried from microsub_items collection (no duplication)
 */

import { ObjectId } from "mongodb";
import { getMicrosubItemsForBlog } from "../sync/microsub.js";

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
 * Combines items from blogrollItems (regular blogs) and microsub_items (Microsub blogs)
 * @param {object} application - Application instance
 * @param {object} options - Query options
 * @returns {Promise<Array>} Items with blog info
 */
export async function getItems(application, options = {}) {
  const db = application.getBlogrollDb();
  const { blogId, category, limit = 50, offset = 0 } = options;

  // If requesting items for a specific blog, check if it's a Microsub blog
  if (blogId) {
    const blog = await db.collection("blogrollBlogs").findOne({ _id: new ObjectId(blogId) });
    if (blog?.source === "microsub" && blog.microsubFeedId) {
      const microsubItems = await getMicrosubItemsForBlog(application, blog, limit + 1);
      const itemsWithBlog = microsubItems.map((item) => ({ ...item, blog }));
      const hasMore = itemsWithBlog.length > limit;
      if (hasMore) itemsWithBlog.pop();
      return { items: itemsWithBlog, hasMore };
    }
  }

  // Get regular items from blogrollItems
  const regularPipeline = [
    { $sort: { published: -1 } },
    {
      $lookup: {
        from: "blogrollBlogs",
        localField: "blogId",
        foreignField: "_id",
        as: "blog",
      },
    },
    { $unwind: "$blog" },
    // Exclude hidden blogs and Microsub blogs (their items come from microsub_items)
    { $match: { "blog.hidden": { $ne: true }, "blog.source": { $ne: "microsub" } } },
  ];

  if (blogId) {
    regularPipeline.unshift({ $match: { blogId: new ObjectId(blogId) } });
  }

  if (category) {
    regularPipeline.push({ $match: { "blog.category": category } });
  }

  const regularItems = await db.collection("blogrollItems").aggregate(regularPipeline).toArray();

  // Get items from Microsub-sourced blogs
  const microsubBlogsQuery = {
    source: "microsub",
    hidden: { $ne: true },
  };
  if (category) {
    microsubBlogsQuery.category = category;
  }

  const microsubBlogs = await db.collection("blogrollBlogs").find(microsubBlogsQuery).toArray();

  let microsubItems = [];
  for (const blog of microsubBlogs) {
    if (blog.microsubFeedId) {
      const items = await getMicrosubItemsForBlog(application, blog, 100);
      microsubItems.push(...items.map((item) => ({ ...item, blog })));
    }
  }

  // Combine and sort all items by published date
  const allItems = [...regularItems, ...microsubItems];
  allItems.sort((a, b) => {
    const dateA = a.published ? new Date(a.published) : new Date(0);
    const dateB = b.published ? new Date(b.published) : new Date(0);
    return dateB - dateA;
  });

  // Apply pagination
  const paginatedItems = allItems.slice(offset, offset + limit + 1);
  const hasMore = paginatedItems.length > limit;
  if (hasMore) paginatedItems.pop();

  return { items: paginatedItems, hasMore };
}

/**
 * Get items for a specific blog
 * Handles both regular blogs (blogrollItems) and Microsub blogs (microsub_items)
 * @param {object} application - Application instance
 * @param {string|ObjectId} blogId - Blog ID
 * @param {number} limit - Max items
 * @param {object} blog - Optional blog document (to avoid extra lookup)
 * @returns {Promise<Array>} Items
 */
export async function getItemsForBlog(application, blogId, limit = 20, blog = null) {
  const db = application.getBlogrollDb();
  const objectId = typeof blogId === "string" ? new ObjectId(blogId) : blogId;

  // Get blog if not provided
  if (!blog) {
    blog = await db.collection("blogrollBlogs").findOne({ _id: objectId });
  }

  // For Microsub-sourced blogs, query microsub_items directly
  if (blog?.source === "microsub" && blog.microsubFeedId) {
    return getMicrosubItemsForBlog(application, blog, limit);
  }

  // For regular blogs, query blogrollItems
  const collection = getCollection(application);
  return collection
    .find({ blogId: objectId })
    .sort({ published: -1 })
    .limit(limit)
    .toArray();
}

// Retention period for item counts (match Microsub retention)
const ITEM_RETENTION_DAYS = 30;

/**
 * Count items (including Microsub items)
 * Only counts items within the retention period
 * @param {object} application - Application instance
 * @param {object} options - Query options
 * @returns {Promise<number>} Count
 */
export async function countItems(application, options = {}) {
  const db = application.getBlogrollDb();

  // Calculate cutoff date for counting
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ITEM_RETENTION_DAYS);

  // Count regular items (within retention period)
  const regularQuery = { published: { $gte: cutoffDate } };
  if (options.blogId) {
    regularQuery.blogId = new ObjectId(options.blogId);
  }
  const regularCount = await db.collection("blogrollItems").countDocuments(regularQuery);

  // Count Microsub items for microsub-sourced blogs (within retention period)
  let microsubCount = 0;
  const itemsCollection = application.collections?.get("microsub_items");

  if (itemsCollection) {
    if (options.blogId) {
      // Count for specific blog
      const blog = await db.collection("blogrollBlogs").findOne({ _id: new ObjectId(options.blogId) });
      if (blog?.source === "microsub" && blog.microsubFeedId) {
        microsubCount = await itemsCollection.countDocuments({
          feedId: new ObjectId(blog.microsubFeedId),
          published: { $gte: cutoffDate },
        });
      }
    } else {
      // Count all Microsub items from blogroll-associated feeds
      const microsubBlogs = await db
        .collection("blogrollBlogs")
        .find({ source: "microsub", microsubFeedId: { $exists: true } })
        .toArray();

      const feedIds = microsubBlogs
        .map((b) => b.microsubFeedId)
        .filter(Boolean)
        .map((id) => new ObjectId(id));

      if (feedIds.length > 0) {
        microsubCount = await itemsCollection.countDocuments({
          feedId: { $in: feedIds },
          published: { $gte: cutoffDate },
        });
      }
    }
  }

  return regularCount + microsubCount;
}

/**
 * Upsert an item
 * @param {object} application - Application instance
 * @param {object} data - Item data
 * @returns {Promise<object>} Result with upserted flag
 */
export async function upsertItem(application, data) {
  const collection = getCollection(application);
  const now = new Date().toISOString();

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
