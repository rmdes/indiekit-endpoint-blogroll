/**
 * FeedLand synchronization
 * @module sync/feedland
 */

import { fetchAndParseOpml } from "./opml.js";
import { upsertBlog } from "../storage/blogs.js";
import { updateSourceSyncStatus } from "../storage/sources.js";

/**
 * Fetch user categories from a FeedLand instance
 * @param {string} instanceUrl - FeedLand instance URL (e.g., https://feedland.com)
 * @param {string} username - FeedLand username
 * @param {number} timeout - Fetch timeout in ms
 * @returns {Promise<object>} Category data { categories: string[], homePageCategories: string[] }
 */
export async function fetchFeedlandCategories(instanceUrl, username, timeout = 10000) {
  const baseUrl = instanceUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/getusercategories?screenname=${encodeURIComponent(username)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Indiekit-Blogroll/1.0",
        Accept: "application/json",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // FeedLand returns comma-separated strings
    const categories = data.categories
      ? data.categories.split(",").map((c) => c.trim()).filter(Boolean)
      : [];
    const homePageCategories = data.homePageCategories
      ? data.homePageCategories.split(",").map((c) => c.trim()).filter(Boolean)
      : [];

    return { categories, homePageCategories, screenname: data.screenname };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw error;
  }
}

/**
 * Build the OPML URL for a FeedLand source
 * @param {object} source - Source document with feedland fields
 * @returns {string} OPML URL
 */
export function buildFeedlandOpmlUrl(source) {
  const baseUrl = source.feedlandInstance.replace(/\/+$/, "");
  let url = `${baseUrl}/opml?screenname=${encodeURIComponent(source.feedlandUsername)}`;

  if (source.feedlandCategory) {
    url += `&catname=${encodeURIComponent(source.feedlandCategory)}`;
  }

  return url;
}

/**
 * Build the FeedLand river URL for linking back
 * @param {object} source - Source document with feedland fields
 * @returns {string} River URL
 */
export function buildFeedlandRiverUrl(source) {
  const baseUrl = source.feedlandInstance.replace(/\/+$/, "");
  return `${baseUrl}/?river=true&screenname=${encodeURIComponent(source.feedlandUsername)}`;
}

/**
 * Sync blogs from a FeedLand source
 * @param {object} application - Application instance
 * @param {object} source - Source document
 * @returns {Promise<object>} Sync result
 */
export async function syncFeedlandSource(application, source) {
  try {
    const opmlUrl = buildFeedlandOpmlUrl(source);
    const blogs = await fetchAndParseOpml(opmlUrl);

    let added = 0;
    let updated = 0;

    for (const blog of blogs) {
      // FeedLand OPML includes a category attribute with comma-separated categories.
      // Use the first category, or fall back to the source's feedlandCategory filter,
      // or use the FeedLand username as a category grouping.
      const category = blog.category
        || source.feedlandCategory
        || source.feedlandUsername
        || "";

      const result = await upsertBlog(application, {
        ...blog,
        category,
        source: "feedland",
        sourceId: source._id,
      });

      if (result.upserted) added++;
      else if (result.modified) updated++;
    }

    // Update source sync status
    await updateSourceSyncStatus(application, source._id, { success: true });

    console.log(
      `[Blogroll] Synced FeedLand source "${source.name}" (${source.feedlandUsername}@${source.feedlandInstance}): ${added} added, ${updated} updated, ${blogs.length} total`
    );

    return { success: true, added, updated, total: blogs.length };
  } catch (error) {
    // Update source with error status
    await updateSourceSyncStatus(application, source._id, {
      success: false,
      error: error.message,
    });

    console.error(
      `[Blogroll] FeedLand sync failed for "${source.name}":`,
      error.message
    );
    return { success: false, error: error.message };
  }
}
