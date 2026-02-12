/**
 * Microsub integration - sync subscriptions from Microsub channels
 * @module sync/microsub
 *
 * IMPORTANT: This module uses a REFERENCE-BASED approach to avoid data duplication.
 * - Blogs from Microsub are stored with `source: "microsub"` and `microsubFeedId`
 * - Items are NOT copied to blogrollItems - we query microsub_items directly
 * - The blogroll API joins data from both collections as needed
 */

import { upsertBlog, getBlogByFeedUrl } from "../storage/blogs.js";
import { updateSourceSyncStatus } from "../storage/sources.js";

/**
 * Sync blogs from Microsub subscriptions
 * Creates references to Microsub feeds, NOT copies of the data
 * @param {object} application - Application instance
 * @param {object} source - Source document with microsub config
 * @returns {Promise<object>} Sync result
 */
export async function syncMicrosubSource(application, source) {
  try {
    // Get Microsub collections via Indiekit's collection system
    const channelsCollection = application.collections?.get("microsub_channels");
    const feedsCollection = application.collections?.get("microsub_feeds");

    if (!channelsCollection || !feedsCollection) {
      throw new Error("Microsub collections not available. Is the Microsub plugin installed?");
    }

    // Get channels (optionally filter by specific channel)
    const channelQuery = source.channelFilter
      ? { uid: source.channelFilter }
      : {};
    const channels = await channelsCollection.find(channelQuery).toArray();

    if (channels.length === 0) {
      console.log("[Blogroll] No Microsub channels found");
      await updateSourceSyncStatus(application, source._id, { success: true });
      return { success: true, added: 0, updated: 0, total: 0 };
    }

    let added = 0;
    let updated = 0;
    let total = 0;
    const currentMicrosubFeedIds = [];

    for (const channel of channels) {
      // Get all feeds subscribed in this channel
      const feeds = await feedsCollection.find({ channelId: channel._id }).toArray();

      for (const feed of feeds) {
        total++;
        currentMicrosubFeedIds.push(feed._id.toString());

        // Store REFERENCE to Microsub feed, not a copy
        // Items will be queried from microsub_items directly
        const blogData = {
          title: feed.title || extractDomainFromUrl(feed.url),
          feedUrl: feed.url,
          siteUrl: extractSiteUrl(feed.url),
          feedType: "rss",
          category: source.categoryPrefix
            ? `${source.categoryPrefix}${channel.name}`
            : channel.name,
          // Mark as microsub source - items come from microsub_items, not blogrollItems
          source: "microsub",
          sourceId: source._id,
          // Store reference IDs for joining with Microsub data
          microsubFeedId: feed._id.toString(),
          microsubChannelId: channel._id.toString(),
          microsubChannelName: channel.name,
          // Mirror status from Microsub (don't duplicate, just reference)
          status: feed.status === "error" ? "error" : "active",
          lastFetchAt: feed.lastFetchedAt || null,
          photo: feed.photo || null,
          // Flag to skip item fetching - Microsub handles this
          skipItemFetch: true,
        };

        const result = await upsertBlog(application, blogData);

        if (result.upserted) added++;
        else if (result.modified) updated++;
      }
    }

    // Orphan detection: soft-delete blogs whose microsub feed no longer exists
    let orphaned = 0;
    if (currentMicrosubFeedIds.length > 0) {
      const db = application.getBlogrollDb();
      const orphanResult = await db.collection("blogrollBlogs").updateMany(
        {
          source: "microsub",
          sourceId: source._id,
          microsubFeedId: { $nin: currentMicrosubFeedIds },
          status: { $ne: "deleted" },
        },
        {
          $set: {
            status: "deleted",
            hidden: true,
            deletedAt: new Date(),
            updatedAt: new Date(),
          },
        }
      );
      orphaned = orphanResult.modifiedCount;
      if (orphaned > 0) {
        console.log(`[Blogroll] Cleaned up ${orphaned} orphaned Microsub blog(s) no longer subscribed`);
      }
    }

    // Update source sync status
    await updateSourceSyncStatus(application, source._id, { success: true });

    console.log(
      `[Blogroll] Synced Microsub source "${source.name}": ${added} added, ${updated} updated, ${orphaned} orphaned, ${total} total from ${channels.length} channels (items served from Microsub)`
    );

    return { success: true, added, updated, orphaned, total };
  } catch (error) {
    // Update source with error status
    await updateSourceSyncStatus(application, source._id, {
      success: false,
      error: error.message,
    });

    console.error(`[Blogroll] Microsub sync failed for "${source.name}":`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get items for a Microsub-sourced blog
 * Queries microsub_items directly instead of blogrollItems
 * @param {object} application - Application instance
 * @param {object} blog - Blog with microsubFeedId
 * @param {number} limit - Max items to return
 * @returns {Promise<Array>} Items from Microsub
 */
export async function getMicrosubItemsForBlog(application, blog, limit = 20) {
  if (!blog.microsubFeedId) {
    return [];
  }

  const itemsCollection = application.collections?.get("microsub_items");
  if (!itemsCollection) {
    return [];
  }

  const { ObjectId } = await import("mongodb");
  const feedId = new ObjectId(blog.microsubFeedId);

  const items = await itemsCollection
    .find({ feedId })
    .sort({ published: -1 })
    .limit(limit)
    .toArray();

  // Transform Microsub item format to Blogroll format
  return items.map((item) => ({
    _id: item._id,
    blogId: blog._id,
    url: item.url,
    title: item.name || item.url,
    summary: item.summary || item.content?.text?.substring(0, 300),
    published: item.published,
    author: item.author?.name,
    photo: item.photo?.[0] || item.featured,
    categories: item.category || [],
  }));
}

/**
 * Handle Microsub subscription webhook
 * Called when a feed is subscribed/unsubscribed in Microsub
 * @param {object} application - Application instance
 * @param {object} data - Webhook data
 * @param {string} data.action - "subscribe" or "unsubscribe"
 * @param {string} data.url - Feed URL
 * @param {string} data.channelName - Channel name
 * @param {string} [data.title] - Feed title
 * @returns {Promise<object>} Result
 */
export async function handleMicrosubWebhook(application, data) {
  const { action, url, channelName, title } = data;

  if (action === "subscribe") {
    // Check if blog already exists
    const existing = await getBlogByFeedUrl(application, url);

    if (existing) {
      // Update category if it's from microsub
      if (existing.source === "microsub") {
        console.log(`[Blogroll] Webhook: Feed ${url} already exists, skipping`);
        return { ok: true, action: "skipped", reason: "already_exists" };
      }
      // Don't overwrite manually added blogs
      return { ok: true, action: "skipped", reason: "manual_entry" };
    }

    // Add new blog
    await upsertBlog(application, {
      title: title || extractDomainFromUrl(url),
      feedUrl: url,
      siteUrl: extractSiteUrl(url),
      feedType: "rss",
      category: channelName || "Microsub",
      source: "microsub-webhook",
      status: "pending",
    });

    console.log(`[Blogroll] Webhook: Added feed ${url} from Microsub`);
    return { ok: true, action: "added" };
  }

  if (action === "unsubscribe") {
    // Mark as inactive rather than delete (preserve history)
    const existing = await getBlogByFeedUrl(application, url);

    if (existing && existing.source?.startsWith("microsub")) {
      // Update status to inactive
      const db = application.getBlogrollDb();
      await db.collection("blogrollBlogs").updateOne(
        { _id: existing._id },
        {
          $set: {
            status: "inactive",
            unsubscribedAt: new Date(),
            updatedAt: new Date(),
          },
        }
      );

      console.log(`[Blogroll] Webhook: Marked feed ${url} as inactive`);
      return { ok: true, action: "deactivated" };
    }

    return { ok: true, action: "skipped", reason: "not_found_or_not_microsub" };
  }

  return { ok: false, error: `Unknown action: ${action}` };
}

/**
 * Get all Microsub channels for source configuration UI
 * @param {object} application - Application instance
 * @returns {Promise<Array>} Array of channels
 */
export async function getMicrosubChannels(application) {
  const channelsCollection = application.collections?.get("microsub_channels");

  if (!channelsCollection) {
    return [];
  }

  const channels = await channelsCollection.find({}).sort({ order: 1 }).toArray();

  return channels.map((ch) => ({
    uid: ch.uid,
    name: ch.name,
    _id: ch._id.toString(),
  }));
}

/**
 * Check if Microsub plugin is available
 * @param {object} application - Application instance
 * @returns {boolean} True if Microsub is available
 */
export function isMicrosubAvailable(application) {
  return !!(
    application.collections?.get("microsub_channels") &&
    application.collections?.get("microsub_feeds")
  );
}

/**
 * Extract domain from URL for fallback title
 * @param {string} url - Feed URL
 * @returns {string} Domain name
 */
function extractDomainFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Extract site URL from feed URL
 * @param {string} feedUrl - Feed URL
 * @returns {string} Site URL
 */
function extractSiteUrl(feedUrl) {
  try {
    const parsed = new URL(feedUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}
