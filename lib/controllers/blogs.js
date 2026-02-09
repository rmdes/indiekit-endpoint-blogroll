/**
 * Blogs controller
 * @module controllers/blogs
 */

import {
  getBlogs,
  getBlog,
  getBlogByFeedUrl,
  createBlog,
  updateBlog,
  deleteBlog,
} from "../storage/blogs.js";
import { getItemsForBlog, deleteItemsForBlog } from "../storage/items.js";
import { syncBlogItems } from "../sync/feed.js";

/**
 * List blogs
 * GET /blogs
 */
async function list(request, response) {
  const { application } = request.app.locals;
  const { category, status: filterStatus } = request.query;

  try {
    const blogs = await getBlogs(application, {
      category,
      includeHidden: true,
      limit: 100,
    });

    // Filter by status if specified
    let filteredBlogs = blogs;
    if (filterStatus) {
      filteredBlogs = blogs.filter((b) => b.status === filterStatus);
    }

    // Get unique categories for filter dropdown
    const categories = [...new Set(blogs.map((b) => b.category).filter(Boolean))];

    // Extract flash messages for native Indiekit notification banner
    const flash = consumeFlashMessage(request);

    response.render("blogroll-blogs", {
      title: request.__("blogroll.blogs.title"),
      blogs: filteredBlogs,
      categories,
      filterCategory: category,
      filterStatus,
      baseUrl: request.baseUrl,
      ...flash,
    });
  } catch (error) {
    console.error("[Blogroll] Blogs list error:", error);
    response.status(500).render("error", {
      title: "Error",
      message: "Failed to load blogs",
    });
  }
}

/**
 * New blog form
 * GET /blogs/new
 */
function newForm(request, response) {
  response.render("blogroll-blog-edit", {
    title: request.__("blogroll.blogs.new"),
    blog: null,
    isNew: true,
    baseUrl: request.baseUrl,
  });
}

/**
 * Create blog
 * POST /blogs
 */
async function create(request, response) {
  const { application } = request.app.locals;
  const { feedUrl, title, siteUrl, category, tags, notes, pinned, hidden } = request.body;

  try {
    // Validate required fields
    if (!feedUrl) {
      request.session.messages = [
        { type: "error", content: "Feed URL is required" },
      ];
      return response.redirect(`${request.baseUrl}/blogs/new`);
    }

    // Check for duplicate
    const existing = await getBlogByFeedUrl(application, feedUrl);
    if (existing) {
      request.session.messages = [
        { type: "error", content: "A blog with this feed URL already exists" },
      ];
      return response.redirect(`${request.baseUrl}/blogs/new`);
    }

    const blog = await createBlog(application, {
      feedUrl,
      title: title || feedUrl,
      siteUrl: siteUrl || null,
      category: category || "",
      tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      notes: notes || null,
      pinned: pinned === "on" || pinned === true,
      hidden: hidden === "on" || hidden === true,
    });

    // Trigger initial fetch
    try {
      const result = await syncBlogItems(application, blog, application.blogrollConfig);
      if (result.success) {
        request.session.messages = [
          {
            type: "success",
            content: request.__("blogroll.blogs.created_synced", { items: result.added }),
          },
        ];
      } else {
        request.session.messages = [
          {
            type: "warning",
            content: request.__("blogroll.blogs.created_sync_failed", { error: result.error }),
          },
        ];
      }
    } catch (syncError) {
      request.session.messages = [
        {
          type: "warning",
          content: request.__("blogroll.blogs.created_sync_failed", { error: syncError.message }),
        },
      ];
    }

    response.redirect(`${request.baseUrl}/blogs`);
  } catch (error) {
    console.error("[Blogroll] Create blog error:", error);
    request.session.messages = [
      { type: "error", content: error.message },
    ];
    response.redirect(`${request.baseUrl}/blogs/new`);
  }
}

/**
 * Edit blog form
 * GET /blogs/:id
 */
async function edit(request, response) {
  const { application } = request.app.locals;
  const { id } = request.params;

  try {
    const blog = await getBlog(application, id);

    if (!blog) {
      return response.status(404).render("404");
    }

    const rawItems = await getItemsForBlog(application, blog._id, 10);
    const items = rawItems.map((item) => ({
      ...item,
      published:
        item.published instanceof Date
          ? item.published.toISOString()
          : item.published,
    }));

    // Extract flash messages for native Indiekit notification banner
    const flash = consumeFlashMessage(request);

    response.render("blogroll-blog-edit", {
      title: request.__("blogroll.blogs.edit"),
      blog,
      items,
      isNew: false,
      baseUrl: request.baseUrl,
      ...flash,
    });
  } catch (error) {
    console.error("[Blogroll] Edit blog error:", error);
    response.status(500).render("error", {
      title: "Error",
      message: "Failed to load blog",
    });
  }
}

/**
 * Update blog
 * POST /blogs/:id
 */
async function update(request, response) {
  const { application } = request.app.locals;
  const { id } = request.params;
  const { feedUrl, title, siteUrl, category, tags, notes, pinned, hidden } = request.body;

  try {
    const blog = await getBlog(application, id);

    if (!blog) {
      return response.status(404).render("404");
    }

    await updateBlog(application, id, {
      feedUrl,
      title: title || feedUrl,
      siteUrl: siteUrl || null,
      category: category || "",
      tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      notes: notes || null,
      pinned: pinned === "on" || pinned === true,
      hidden: hidden === "on" || hidden === true,
    });

    request.session.messages = [
      { type: "success", content: request.__("blogroll.blogs.updated") },
    ];

    response.redirect(`${request.baseUrl}/blogs`);
  } catch (error) {
    console.error("[Blogroll] Update blog error:", error);
    request.session.messages = [
      { type: "error", content: error.message },
    ];
    response.redirect(`${request.baseUrl}/blogs/${id}`);
  }
}

/**
 * Delete blog
 * POST /blogs/:id/delete
 */
async function remove(request, response) {
  const { application } = request.app.locals;
  const { id } = request.params;

  try {
    const blog = await getBlog(application, id);

    if (!blog) {
      return response.status(404).render("404");
    }

    await deleteBlog(application, id);

    request.session.messages = [
      { type: "success", content: request.__("blogroll.blogs.deleted") },
    ];

    response.redirect(`${request.baseUrl}/blogs`);
  } catch (error) {
    console.error("[Blogroll] Delete blog error:", error);
    request.session.messages = [
      { type: "error", content: error.message },
    ];
    response.redirect(`${request.baseUrl}/blogs`);
  }
}

/**
 * Refresh blog
 * POST /blogs/:id/refresh
 */
async function refresh(request, response) {
  const { application } = request.app.locals;
  const { id } = request.params;

  try {
    const blog = await getBlog(application, id);

    if (!blog) {
      return response.status(404).render("404");
    }

    const result = await syncBlogItems(application, blog, application.blogrollConfig);

    if (result.success) {
      request.session.messages = [
        {
          type: "success",
          content: request.__("blogroll.blogs.refreshed", { items: result.added }),
        },
      ];
    } else {
      request.session.messages = [
        { type: "error", content: result.error },
      ];
    }

    response.redirect(`${request.baseUrl}/blogs/${id}`);
  } catch (error) {
    console.error("[Blogroll] Refresh blog error:", error);
    request.session.messages = [
      { type: "error", content: error.message },
    ];
    response.redirect(`${request.baseUrl}/blogs/${id}`);
  }
}

/**
 * Extract and clear flash messages from session
 * Returns { success, error } for Indiekit's native notificationBanner
 */
function consumeFlashMessage(request) {
  const result = {};
  if (request.session?.messages?.length) {
    const msg = request.session.messages[0];
    if (msg.type === "success") result.success = msg.content;
    else if (msg.type === "error" || msg.type === "warning") result.error = msg.content;
    request.session.messages = null;
  }
  return result;
}

export const blogsController = {
  list,
  newForm,
  create,
  edit,
  update,
  remove,
  refresh,
};
