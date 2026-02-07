/**
 * Background sync scheduler
 * @module sync/scheduler
 */

import { getSources } from "../storage/sources.js";
import { getBlogs, countBlogs } from "../storage/blogs.js";
import { countItems, deleteOldItems } from "../storage/items.js";
import { syncOpmlSource } from "./opml.js";
import { syncBlogItems } from "./feed.js";

let syncInterval = null;
let isRunning = false;

/**
 * Run full sync of all sources and blogs
 * @param {object} application - Application instance
 * @param {object} options - Sync options
 * @returns {Promise<object>} Sync results
 */
export async function runFullSync(application, options = {}) {
  const {
    maxItemsPerBlog = 50,
    fetchTimeout = 15000,
    maxItemAge = 7, // days - encourage discovery with fresh content
  } = options;

  if (isRunning) {
    console.log("[Blogroll] Sync already running, skipping");
    return { skipped: true };
  }

  isRunning = true;
  console.log("[Blogroll] Starting full sync...");
  const startTime = Date.now();

  try {
    // First, clean up old items to encourage discovery
    const deletedItems = await deleteOldItems(application, maxItemAge);

    // Sync all enabled OPML/JSON sources
    const sources = await getSources(application);
    const enabledSources = sources.filter(
      (s) => s.enabled && ["opml_url", "opml_file", "json_feed"].includes(s.type)
    );

    let sourcesSuccess = 0;
    let sourcesFailed = 0;

    for (const source of enabledSources) {
      try {
        const result = await syncOpmlSource(application, source);
        if (result.success) sourcesSuccess++;
        else sourcesFailed++;
      } catch (error) {
        console.error(`[Blogroll] Source sync failed (${source.name}):`, error.message);
        sourcesFailed++;
      }
    }

    // Sync all non-hidden blogs
    const blogs = await getBlogs(application, { includeHidden: false, limit: 1000 });

    let blogsSuccess = 0;
    let blogsFailed = 0;
    let newItems = 0;

    for (const blog of blogs) {
      try {
        const result = await syncBlogItems(application, blog, {
          maxItems: maxItemsPerBlog,
          timeout: fetchTimeout,
        });

        if (result.success) {
          blogsSuccess++;
          newItems += result.added || 0;
        } else {
          blogsFailed++;
        }
      } catch (error) {
        console.error(`[Blogroll] Blog sync failed (${blog.title}):`, error.message);
        blogsFailed++;
      }
    }

    const duration = Date.now() - startTime;

    // Update sync stats in meta collection
    const db = application.getBlogrollDb();
    await db.collection("blogrollMeta").updateOne(
      { key: "syncStats" },
      {
        $set: {
          key: "syncStats",
          lastFullSync: new Date(),
          duration,
          sources: {
            total: enabledSources.length,
            success: sourcesSuccess,
            failed: sourcesFailed,
          },
          blogs: {
            total: blogs.length,
            success: blogsSuccess,
            failed: blogsFailed,
          },
          items: {
            added: newItems,
            deleted: deletedItems,
          },
        },
      },
      { upsert: true }
    );

    console.log(
      `[Blogroll] Full sync complete in ${duration}ms: ` +
        `${sourcesSuccess}/${enabledSources.length} sources, ` +
        `${blogsSuccess}/${blogs.length} blogs, ` +
        `${newItems} new items, ${deletedItems} old items removed`
    );

    return {
      success: true,
      duration,
      sources: { total: enabledSources.length, success: sourcesSuccess, failed: sourcesFailed },
      blogs: { total: blogs.length, success: blogsSuccess, failed: blogsFailed },
      items: { added: newItems, deleted: deletedItems },
    };
  } catch (error) {
    console.error("[Blogroll] Full sync failed:", error.message);
    return { success: false, error: error.message };
  } finally {
    isRunning = false;
  }
}

/**
 * Get sync status
 * @param {object} application - Application instance
 * @returns {Promise<object>} Status info
 */
export async function getSyncStatus(application) {
  const db = application.getBlogrollDb();

  const [blogCount, itemCount, syncStats] = await Promise.all([
    countBlogs(application),
    countItems(application),
    db.collection("blogrollMeta").findOne({ key: "syncStats" }),
  ]);

  return {
    status: "ok",
    isRunning,
    blogs: { count: blogCount },
    items: { count: itemCount },
    lastSync: syncStats?.lastFullSync || null,
    lastSyncStats: syncStats || null,
  };
}

/**
 * Clear all data and resync
 * @param {object} application - Application instance
 * @param {object} options - Options
 * @returns {Promise<object>} Result
 */
export async function clearAndResync(application, options = {}) {
  const db = application.getBlogrollDb();

  console.log("[Blogroll] Clearing all items for resync...");

  // Clear all items (but keep blogs and sources)
  await db.collection("blogrollItems").deleteMany({});

  // Reset blog item counts and status
  await db.collection("blogrollBlogs").updateMany(
    {},
    {
      $set: {
        itemCount: 0,
        lastFetchAt: null,
        status: "active",
        lastError: null,
      },
    }
  );

  // Run full sync
  return runFullSync(application, options);
}

/**
 * Start background sync scheduler
 * @param {object} Indiekit - Indiekit instance
 * @param {object} options - Options
 */
export function startSync(Indiekit, options) {
  const { syncInterval: interval, maxItemAge = 7 } = options;
  const application = Indiekit.config.application;

  // Initial sync after short delay (let server start up)
  setTimeout(async () => {
    if (application.getBlogrollDb()) {
      console.log("[Blogroll] Running initial sync...");
      await runFullSync(application, { ...options, maxItemAge });
    }
  }, 15000);

  // Periodic sync
  syncInterval = setInterval(async () => {
    if (application.getBlogrollDb()) {
      await runFullSync(application, { ...options, maxItemAge });
    }
  }, interval);

  console.log(
    `[Blogroll] Scheduler started (interval: ${Math.round(interval / 60000)}min, item retention: ${maxItemAge} days)`
  );
}

/**
 * Stop background sync scheduler
 */
export function stopSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log("[Blogroll] Scheduler stopped");
  }
}
