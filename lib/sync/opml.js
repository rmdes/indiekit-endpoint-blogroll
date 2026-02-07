/**
 * OPML parsing and synchronization
 * @module sync/opml
 */

import { parseStringPromise } from "xml2js";
import { upsertBlog } from "../storage/blogs.js";
import { updateSourceSyncStatus } from "../storage/sources.js";

/**
 * Parse OPML content and extract blog entries
 * @param {string} opmlContent - OPML XML content
 * @returns {Promise<Array>} Array of blog entries
 */
export async function parseOpml(opmlContent) {
  const result = await parseStringPromise(opmlContent, { explicitArray: false });
  const blogs = [];

  const body = result?.opml?.body;
  if (!body?.outline) return blogs;

  const outlines = Array.isArray(body.outline) ? body.outline : [body.outline];

  for (const outline of outlines) {
    // Handle nested outlines (categories)
    if (outline.outline) {
      const children = Array.isArray(outline.outline)
        ? outline.outline
        : [outline.outline];
      const category = outline.$?.text || outline.$?.title || "";

      for (const child of children) {
        if (child.$ && child.$.xmlUrl) {
          blogs.push({
            title: child.$.text || child.$.title || "Unknown",
            feedUrl: child.$.xmlUrl,
            siteUrl: child.$.htmlUrl || "",
            feedType: detectFeedType(child.$.type),
            category,
          });
        }
      }
    } else if (outline.$ && outline.$.xmlUrl) {
      // Direct feed outline (no category)
      blogs.push({
        title: outline.$.text || outline.$.title || "Unknown",
        feedUrl: outline.$.xmlUrl,
        siteUrl: outline.$.htmlUrl || "",
        feedType: detectFeedType(outline.$.type),
        category: "",
      });
    }
  }

  return blogs;
}

/**
 * Detect feed type from OPML type attribute
 * @param {string} type - OPML type attribute
 * @returns {string} Feed type
 */
function detectFeedType(type) {
  if (!type) return "rss";
  const t = type.toLowerCase();
  if (t.includes("atom")) return "atom";
  if (t.includes("json")) return "jsonfeed";
  return "rss";
}

/**
 * Fetch and parse OPML from URL
 * @param {string} url - OPML URL
 * @param {number} timeout - Fetch timeout in ms
 * @returns {Promise<Array>} Array of blog entries
 */
export async function fetchAndParseOpml(url, timeout = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Indiekit-Blogroll/1.0",
        Accept: "application/xml, text/xml, text/x-opml, */*",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const content = await response.text();
    return parseOpml(content);
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw error;
  }
}

/**
 * Sync blogs from an OPML source
 * @param {object} application - Application instance
 * @param {object} source - Source document
 * @returns {Promise<object>} Sync result
 */
export async function syncOpmlSource(application, source) {
  let blogs;

  try {
    if (source.type === "opml_url") {
      blogs = await fetchAndParseOpml(source.url);
    } else if (source.type === "opml_file") {
      blogs = await parseOpml(source.opmlContent);
    } else {
      throw new Error(`Unsupported source type: ${source.type}`);
    }

    let added = 0;
    let updated = 0;

    for (const blog of blogs) {
      const result = await upsertBlog(application, {
        ...blog,
        sourceId: source._id,
      });

      if (result.upserted) added++;
      else if (result.modified) updated++;
    }

    // Update source sync status
    await updateSourceSyncStatus(application, source._id, { success: true });

    console.log(
      `[Blogroll] Synced OPML source "${source.name}": ${added} added, ${updated} updated, ${blogs.length} total`
    );

    return { success: true, added, updated, total: blogs.length };
  } catch (error) {
    // Update source with error status
    await updateSourceSyncStatus(application, source._id, {
      success: false,
      error: error.message,
    });

    console.error(`[Blogroll] OPML sync failed for "${source.name}":`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Generate OPML XML from blogs
 * @param {Array} blogs - Array of blog objects
 * @param {string} title - OPML title
 * @returns {string} OPML XML
 */
export function generateOpml(blogs, title = "Blogroll") {
  // Group blogs by category
  const grouped = {};
  for (const blog of blogs) {
    const cat = blog.category || "Uncategorized";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(blog);
  }

  let outlines = "";
  for (const [category, categoryBlogs] of Object.entries(grouped)) {
    const children = categoryBlogs
      .map(
        (b) =>
          `      <outline text="${escapeXml(b.title)}" type="rss" xmlUrl="${escapeXml(b.feedUrl)}" htmlUrl="${escapeXml(b.siteUrl || "")}"/>`
      )
      .join("\n");
    outlines += `    <outline text="${escapeXml(category)}">\n${children}\n    </outline>\n`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${escapeXml(title)}</title>
    <dateCreated>${new Date().toUTCString()}</dateCreated>
  </head>
  <body>
${outlines}  </body>
</opml>`;
}

/**
 * Escape XML special characters
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeXml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
