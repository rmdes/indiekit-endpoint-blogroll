/**
 * Public API controller
 * @module controllers/api
 */

import { ObjectId } from "mongodb";
import { getBlogs, countBlogs, getBlog, getCategories } from "../storage/blogs.js";
import { getItems, getItemsForBlog } from "../storage/items.js";
import { getSyncStatus } from "../sync/scheduler.js";
import { generateOpml } from "../sync/opml.js";
import { discoverFeeds } from "../utils/feed-discovery.js";
import { handleMicrosubWebhook, isMicrosubAvailable } from "../sync/microsub.js";

/**
 * List blogs with optional filtering
 * GET /api/blogs
 */
async function listBlogs(request, response) {
  const { application } = request.app.locals;

  const { category, source, sort, limit = 100, offset = 0 } = request.query;

  try {
    const blogs = await getBlogs(application, {
      category,
      source,
      sort,
      limit: Number(limit),
      offset: Number(offset),
    });

    const total = await countBlogs(application, { category, source });

    response.json({
      items: blogs.map(sanitizeBlog),
      total,
      hasMore: Number(offset) + blogs.length < total,
    });
  } catch (error) {
    console.error("[Blogroll API] listBlogs error:", error);
    response.status(500).json({ error: "Failed to fetch blogs" });
  }
}

/**
 * Get single blog with recent items
 * GET /api/blogs/:id
 */
async function getBlogDetail(request, response) {
  const { application } = request.app.locals;
  const { id } = request.params;

  try {
    if (!ObjectId.isValid(id)) {
      return response.status(400).json({ error: "Invalid blog ID" });
    }

    const blog = await getBlog(application, id);
    if (!blog) {
      return response.status(404).json({ error: "Blog not found" });
    }

    // Pass blog to getItemsForBlog to avoid duplicate lookup
    // This handles both regular and Microsub-sourced blogs transparently
    const items = await getItemsForBlog(application, blog._id, 20, blog);

    response.json({
      ...sanitizeBlog(blog),
      items: items.map(sanitizeItem),
    });
  } catch (error) {
    console.error("[Blogroll API] getBlog error:", error);
    response.status(500).json({ error: "Failed to fetch blog" });
  }
}

/**
 * List items across all blogs
 * GET /api/items
 */
async function listItems(request, response) {
  const { application } = request.app.locals;

  const { blog, category, limit = 50, offset = 0 } = request.query;

  try {
    const result = await getItems(application, {
      blogId: blog,
      category,
      limit: Number(limit),
      offset: Number(offset),
    });

    response.json({
      items: result.items.map((item) => ({
        ...sanitizeItem(item),
        blog: item.blog
          ? {
              id: item.blog._id.toString(),
              title: item.blog.title,
              siteUrl: item.blog.siteUrl,
              category: item.blog.category,
              photo: item.blog.photo,
            }
          : null,
      })),
      hasMore: result.hasMore,
    });
  } catch (error) {
    console.error("[Blogroll API] listItems error:", error);
    response.status(500).json({ error: "Failed to fetch items" });
  }
}

/**
 * List categories
 * GET /api/categories
 */
async function listCategories(request, response) {
  const { application } = request.app.locals;

  try {
    const categories = await getCategories(application);

    response.json({
      items: categories.map((c) => ({ name: c._id, count: c.count })),
    });
  } catch (error) {
    console.error("[Blogroll API] listCategories error:", error);
    response.status(500).json({ error: "Failed to fetch categories" });
  }
}

/**
 * Status endpoint
 * GET /api/status
 */
async function status(request, response) {
  const { application } = request.app.locals;

  try {
    const syncStatus = await getSyncStatus(application);
    response.json(syncStatus);
  } catch (error) {
    console.error("[Blogroll API] status error:", error);
    response.status(500).json({ error: "Failed to fetch status" });
  }
}

/**
 * Export OPML
 * GET /api/opml
 */
async function exportOpml(request, response) {
  const { application } = request.app.locals;

  try {
    const blogs = await getBlogs(application, { limit: 1000 });
    const opml = generateOpml(blogs, "Blogroll");

    response.set("Content-Type", "text/x-opml");
    response.set("Content-Disposition", 'attachment; filename="blogroll.opml"');
    response.send(opml);
  } catch (error) {
    console.error("[Blogroll API] exportOpml error:", error);
    response.status(500).json({ error: "Failed to export OPML" });
  }
}

/**
 * Export OPML for category
 * GET /api/opml/:category
 */
async function exportOpmlCategory(request, response) {
  const { application } = request.app.locals;
  const { category } = request.params;

  try {
    const blogs = await getBlogs(application, { category, limit: 1000 });
    const opml = generateOpml(blogs, `Blogroll - ${category}`);

    response.set("Content-Type", "text/x-opml");
    response.set(
      "Content-Disposition",
      `attachment; filename="blogroll-${encodeURIComponent(category)}.opml"`
    );
    response.send(opml);
  } catch (error) {
    console.error("[Blogroll API] exportOpmlCategory error:", error);
    response.status(500).json({ error: "Failed to export OPML" });
  }
}

/**
 * Discover feeds from a website URL
 * GET /api/discover?url=...
 */
async function discover(request, response) {
  const { url } = request.query;

  if (!url) {
    return response.status(400).json({ error: "URL parameter required" });
  }

  try {
    const result = await discoverFeeds(url);
    response.json(result);
  } catch (error) {
    console.error("[Blogroll API] discover error:", error);
    response.status(500).json({ error: "Failed to discover feeds" });
  }
}

// Helper functions

/**
 * Sanitize blog for API response
 * @param {object} blog - Blog document
 * @returns {object} Sanitized blog
 */
function sanitizeBlog(blog) {
  const sanitized = {
    id: blog._id.toString(),
    title: blog.title,
    description: blog.description,
    feedUrl: blog.feedUrl,
    siteUrl: blog.siteUrl,
    feedType: blog.feedType,
    category: blog.category,
    tags: blog.tags,
    photo: blog.photo,
    author: blog.author,
    status: blog.status,
    itemCount: blog.itemCount,
    pinned: blog.pinned,
    lastFetchAt: blog.lastFetchAt,
    lastItemAt: blog.lastItemAt || null,
    source: blog.source || null,
  };

  // Include Microsub metadata if applicable
  if (blog.source === "microsub") {
    sanitized.microsubChannel = blog.microsubChannelName;
  }

  return sanitized;
}

/**
 * Sanitize item for API response
 * @param {object} item - Item document
 * @returns {object} Sanitized item
 */
function sanitizeItem(item) {
  const published = item.published ? new Date(item.published) : null;
  return {
    id: item._id.toString(),
    url: item.url,
    title: item.title,
    summary: item.summary,
    published: item.published,
    isFuture: published ? published > new Date() : false,
    author: item.author,
    photo: item.photo,
    categories: item.categories,
  };
}

/**
 * Microsub webhook handler
 * Receives subscription change notifications from Microsub
 * POST /api/microsub-webhook
 */
async function microsubWebhook(request, response) {
  const { application } = request.app.locals;

  try {
    // Verify Microsub is available
    if (!isMicrosubAvailable(application)) {
      return response.status(503).json({
        ok: false,
        error: "Microsub integration not available",
      });
    }

    const { action, url, channelName, title } = request.body;

    if (!action || !url) {
      return response.status(400).json({
        ok: false,
        error: "Missing required fields: action and url",
      });
    }

    const result = await handleMicrosubWebhook(application, {
      action,
      url,
      channelName,
      title,
    });

    response.json(result);
  } catch (error) {
    console.error("[Blogroll API] microsubWebhook error:", error);
    response.status(500).json({
      ok: false,
      error: "Webhook processing failed",
    });
  }
}

/**
 * Check Microsub integration status
 * GET /api/microsub-status
 */
async function microsubStatus(request, response) {
  const { application } = request.app.locals;

  try {
    const available = isMicrosubAvailable(application);

    if (!available) {
      return response.json({
        available: false,
        message: "Microsub plugin not installed or collections not available",
      });
    }

    // Get count of microsub-sourced blogs
    const db = application.getBlogrollDb();
    const microsubBlogCount = await db.collection("blogrollBlogs").countDocuments({
      source: { $regex: /^microsub/ },
    });

    response.json({
      available: true,
      blogs: microsubBlogCount,
    });
  } catch (error) {
    console.error("[Blogroll API] microsubStatus error:", error);
    response.status(500).json({
      available: false,
      error: error.message,
    });
  }
}

export const apiController = {
  listBlogs,
  getBlog: getBlogDetail,
  listItems,
  listCategories,
  status,
  exportOpml,
  exportOpmlCategory,
  discover,
  microsubWebhook,
  microsubStatus,
};
