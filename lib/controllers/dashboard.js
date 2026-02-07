/**
 * Dashboard controller
 * @module controllers/dashboard
 */

import { getSources } from "../storage/sources.js";
import { getBlogs, countBlogs } from "../storage/blogs.js";
import { countItems } from "../storage/items.js";
import { runFullSync, clearAndResync, getSyncStatus } from "../sync/scheduler.js";

/**
 * Dashboard page
 * GET /
 */
async function get(request, response) {
  const { application } = request.app.locals;

  try {
    const [rawSources, blogs, blogCount, itemCount, syncStatus] = await Promise.all([
      getSources(application),
      getBlogs(application, { limit: 10 }),
      countBlogs(application),
      countItems(application),
      getSyncStatus(application),
    ]);

    // Convert Date objects to ISO strings for template date filter compatibility
    const sources = rawSources.map((source) => ({
      ...source,
      lastSyncAt: source.lastSyncAt
        ? (source.lastSyncAt instanceof Date
            ? source.lastSyncAt.toISOString()
            : source.lastSyncAt)
        : null,
    }));

    // Get blogs with errors
    const errorBlogs = await getBlogs(application, { includeHidden: true, limit: 100 });
    const blogsWithErrors = errorBlogs.filter((b) => b.status === "error");

    response.render("blogroll-dashboard", {
      title: request.__("blogroll.title"),
      sources,
      recentBlogs: blogs,
      stats: {
        sources: sources.length,
        blogs: blogCount,
        items: itemCount,
        errors: blogsWithErrors.length,
      },
      syncStatus,
      blogsWithErrors: blogsWithErrors.slice(0, 5),
      baseUrl: request.baseUrl,
    });
  } catch (error) {
    console.error("[Blogroll] Dashboard error:", error);
    response.status(500).render("error", {
      title: "Error",
      message: "Failed to load dashboard",
    });
  }
}

/**
 * Manual sync trigger
 * POST /sync
 */
async function sync(request, response) {
  const { application } = request.app.locals;

  try {
    const result = await runFullSync(application, application.blogrollConfig);

    if (result.skipped) {
      request.session.messages = [
        { type: "warning", content: request.__("blogroll.sync.already_running") },
      ];
    } else if (result.success) {
      request.session.messages = [
        {
          type: "success",
          content: request.__("blogroll.sync.success", {
            blogs: result.blogs.success,
            items: result.items.added,
          }),
        },
      ];
    } else {
      request.session.messages = [
        { type: "error", content: request.__("blogroll.sync.error", { error: result.error }) },
      ];
    }
  } catch (error) {
    console.error("[Blogroll] Manual sync error:", error);
    request.session.messages = [
      { type: "error", content: request.__("blogroll.sync.error", { error: error.message }) },
    ];
  }

  response.redirect(request.baseUrl);
}

/**
 * Clear and re-sync
 * POST /clear-resync
 */
async function clearResync(request, response) {
  const { application } = request.app.locals;

  try {
    const result = await clearAndResync(application, application.blogrollConfig);

    if (result.success) {
      request.session.messages = [
        {
          type: "success",
          content: request.__("blogroll.sync.cleared_success", {
            blogs: result.blogs.success,
            items: result.items.added,
          }),
        },
      ];
    } else {
      request.session.messages = [
        { type: "error", content: request.__("blogroll.sync.error", { error: result.error }) },
      ];
    }
  } catch (error) {
    console.error("[Blogroll] Clear resync error:", error);
    request.session.messages = [
      { type: "error", content: request.__("blogroll.sync.error", { error: error.message }) },
    ];
  }

  response.redirect(request.baseUrl);
}

/**
 * Status API (for dashboard)
 * GET /api/status (duplicated in api.js for public access)
 */
async function status(request, response) {
  const { application } = request.app.locals;

  try {
    const syncStatus = await getSyncStatus(application);
    response.json(syncStatus);
  } catch (error) {
    console.error("[Blogroll] Status error:", error);
    response.status(500).json({ error: "Failed to fetch status" });
  }
}

export const dashboardController = {
  get,
  sync,
  clearResync,
  status,
};
