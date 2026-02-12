/**
 * Feed fetching and parsing for blogroll
 * @module sync/feed
 */

import { Readable } from "node:stream";
import FeedParser from "feedparser";
import sanitizeHtml from "sanitize-html";
import crypto from "node:crypto";

import { upsertItem } from "../storage/items.js";
import { updateBlogStatus } from "../storage/blogs.js";

const SANITIZE_OPTIONS = {
  allowedTags: [
    "a",
    "b",
    "i",
    "em",
    "strong",
    "p",
    "br",
    "ul",
    "ol",
    "li",
    "blockquote",
    "code",
    "pre",
  ],
  allowedAttributes: { a: ["href"] },
};

/**
 * Fetch and parse a blog feed
 * @param {string} url - Feed URL
 * @param {object} options - Options
 * @returns {Promise<object>} Parsed feed with items
 */
export async function fetchAndParseFeed(url, options = {}) {
  const { timeout = 15000, maxItems = 50 } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Indiekit-Blogroll/1.0",
        Accept:
          "application/atom+xml, application/rss+xml, application/json, application/feed+json, */*",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const content = await response.text();
    const contentType = response.headers.get("Content-Type") || "";

    // Check for JSON Feed
    if (contentType.includes("json") || content.trim().startsWith("{")) {
      try {
        return parseJsonFeed(content, url, maxItems);
      } catch {
        // Not valid JSON, try XML
      }
    }

    // Parse as RSS/Atom
    return parseXmlFeed(content, url, maxItems);
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw error;
  }
}

/**
 * Parse XML feed (RSS/Atom)
 * @param {string} content - XML content
 * @param {string} feedUrl - Feed URL
 * @param {number} maxItems - Max items to parse
 * @returns {Promise<object>} Parsed feed
 */
async function parseXmlFeed(content, feedUrl, maxItems) {
  return new Promise((resolve, reject) => {
    const feedparser = new FeedParser({ feedurl: feedUrl });
    const items = [];
    let meta;

    feedparser.on("error", reject);
    feedparser.on("meta", (m) => {
      meta = m;
    });

    feedparser.on("readable", function () {
      let item;
      while ((item = this.read()) && items.length < maxItems) {
        items.push(normalizeItem(item, feedUrl));
      }
    });

    feedparser.on("end", () => {
      resolve({
        title: meta?.title,
        description: meta?.description,
        siteUrl: meta?.link,
        photo: meta?.image?.url || meta?.favicon,
        author: meta?.author ? { name: meta.author } : undefined,
        items,
      });
    });

    Readable.from([content]).pipe(feedparser);
  });
}

/**
 * Parse JSON Feed
 * @param {string} content - JSON content
 * @param {string} feedUrl - Feed URL
 * @param {number} maxItems - Max items to parse
 * @returns {object} Parsed feed
 */
function parseJsonFeed(content, feedUrl, maxItems) {
  const feed = JSON.parse(content);

  const items = (feed.items || []).slice(0, maxItems).map((item) => ({
    uid: generateUid(feedUrl, item.id || item.url),
    url: item.url || item.external_url,
    title: decodeEntities(item.title) || "Untitled",
    content: {
      html: item.content_html
        ? sanitizeHtml(item.content_html, SANITIZE_OPTIONS)
        : undefined,
      text: item.content_text,
    },
    summary: decodeEntities(item.summary) || truncateText(item.content_text, 300),
    published: item.date_published ? new Date(item.date_published).toISOString() : new Date().toISOString(),
    updated: item.date_modified ? new Date(item.date_modified).toISOString() : undefined,
    author: item.author || (item.authors?.[0]),
    photo: item.image ? [item.image] : undefined,
    categories: item.tags || [],
  }));

  return {
    title: feed.title,
    description: feed.description,
    siteUrl: feed.home_page_url,
    photo: feed.icon || feed.favicon,
    author: feed.author || (feed.authors?.[0]),
    items,
  };
}

/**
 * Normalize RSS/Atom item to common format
 * @param {object} item - FeedParser item
 * @param {string} feedUrl - Feed URL
 * @returns {object} Normalized item
 */
function normalizeItem(item, feedUrl) {
  const description = item.description || item.summary || "";

  // Convert dates to ISO strings - feedparser returns Date objects
  const published = item.pubdate || item.date;
  const updated = item.date;

  return {
    uid: generateUid(feedUrl, item.guid || item.link),
    url: item.link || item.origlink,
    title: decodeEntities(item.title) || "Untitled",
    content: {
      html: description ? sanitizeHtml(description, SANITIZE_OPTIONS) : undefined,
      text: stripHtml(description),
    },
    summary: truncateText(stripHtml(item.summary || description), 300),
    published: published ? (published instanceof Date ? published.toISOString() : new Date(published).toISOString()) : new Date().toISOString(),
    updated: updated ? (updated instanceof Date ? updated.toISOString() : new Date(updated).toISOString()) : undefined,
    author: item.author ? { name: item.author } : undefined,
    photo: extractPhotos(item),
    categories: item.categories || [],
  };
}

/**
 * Generate unique ID for item
 * @param {string} feedUrl - Feed URL
 * @param {string} itemId - Item ID or URL
 * @returns {string} Unique hash
 */
function generateUid(feedUrl, itemId) {
  return crypto
    .createHash("sha256")
    .update(`${feedUrl}::${itemId}`)
    .digest("hex")
    .slice(0, 24);
}

/**
 * Strip HTML tags and decode HTML entities from string
 * @param {string} html - HTML string
 * @returns {string} Plain text
 */
function stripHtml(html) {
  if (!html) return "";
  return decodeEntities(
    html
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Decode HTML entities to their character equivalents
 * @param {string} str - String with HTML entities
 * @returns {string} Decoded string
 */
function decodeEntities(str) {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

/**
 * Truncate text to max length
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Max length
 * @returns {string} Truncated text
 */
function truncateText(text, maxLength) {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3).trim() + "...";
}

/**
 * Extract photos from feed item
 * @param {object} item - FeedParser item
 * @returns {Array|undefined} Photo URLs
 */
function extractPhotos(item) {
  const photos = [];

  if (item.enclosures) {
    for (const enc of item.enclosures) {
      if (enc.type?.startsWith("image/")) {
        photos.push(enc.url);
      }
    }
  }

  if (item["media:content"]) {
    const media = Array.isArray(item["media:content"])
      ? item["media:content"]
      : [item["media:content"]];
    for (const m of media) {
      if (m.type?.startsWith("image/") || m.medium === "image") {
        photos.push(m.url);
      }
    }
  }

  if (item.image?.url) {
    photos.push(item.image.url);
  }

  return photos.length > 0 ? photos : undefined;
}

/**
 * Sync items from a blog feed
 * @param {object} application - Application instance
 * @param {object} blog - Blog document
 * @param {object} options - Sync options
 * @returns {Promise<object>} Sync result
 */
export async function syncBlogItems(application, blog, options = {}) {
  const { maxItems = 50, timeout = 15000 } = options;

  try {
    const feed = await fetchAndParseFeed(blog.feedUrl, { timeout, maxItems });

    let added = 0;

    for (const item of feed.items) {
      const result = await upsertItem(application, {
        ...item,
        blogId: blog._id,
      });

      if (result.upserted) added++;
    }

    // Update blog metadata
    const updateData = {
      success: true,
      itemCount: feed.items.length,
    };

    // Update title if not manually set (still has feedUrl as title)
    if (blog.title === blog.feedUrl && feed.title) {
      updateData.title = feed.title;
    }

    // Update photo if not set
    if (!blog.photo && feed.photo) {
      updateData.photo = feed.photo;
    }

    // Update siteUrl if not set
    if (!blog.siteUrl && feed.siteUrl) {
      updateData.siteUrl = feed.siteUrl;
    }

    await updateBlogStatus(application, blog._id, updateData);

    return { success: true, added, total: feed.items.length };
  } catch (error) {
    // Update blog with error status
    await updateBlogStatus(application, blog._id, {
      success: false,
      error: error.message,
    });

    return { success: false, error: error.message };
  }
}
