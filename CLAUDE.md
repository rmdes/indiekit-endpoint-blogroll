# CLAUDE.md - Blogroll Endpoint

## Package Overview

`@rmdes/indiekit-endpoint-blogroll` is an Indiekit plugin that provides a comprehensive blogroll management system. It aggregates blog feeds from multiple sources (OPML files/URLs, Microsub subscriptions), fetches and caches recent items, and exposes both an admin UI and public JSON API.

**Key Capabilities:**
- Aggregates blogs from OPML (URL or file), JSON feeds, FeedLand, or manual entry
- Integrates with Microsub plugin to mirror subscriptions
- FeedLand integration (feedland.com or self-hosted) with category discovery
- Background feed fetching with configurable intervals
- Admin UI for managing sources, blogs, and viewing recent items
- Public read-only JSON API for frontend integration
- OPML export functionality

**npm Package:** `@rmdes/indiekit-endpoint-blogroll`
**Version:** 1.0.17
**Mount Path:** `/blogrollapi` (default, configurable)

## Architecture

### Data Flow

```
Sources (OPML/Microsub/FeedLand) → Blogs → Items
         ↓                   ↓        ↓
    blogrollSources    blogrollBlogs  blogrollItems
                                      microsub_items (reference)
```

1. **Sources** define where blogs come from (OPML URL, OPML file, Microsub channels, FeedLand)
2. **Blogs** are individual feed subscriptions with metadata
3. **Items** are recent posts/articles from blogs (cached for 7 days by default)

**Special Case: Microsub Integration**
- Microsub-sourced blogs store REFERENCES (`microsubFeedId`) not copies
- Items are queried from `microsub_items` collection directly (no duplication)
- Blogroll API transparently joins data from both sources

### MongoDB Schema

**blogrollSources**
```javascript
{
  _id: ObjectId,
  type: "opml_url" | "opml_file" | "manual" | "json_feed" | "microsub" | "feedland",
  name: String,           // Display name
  url: String | null,     // For opml_url, json_feed
  opmlContent: String | null,  // For opml_file
  // Microsub-specific
  channelFilter: String | null,  // Specific channel UID or null for all
  categoryPrefix: String,        // Prefix for blog categories
  // FeedLand-specific
  feedlandInstance: String | null,  // e.g., "https://feedland.com"
  feedlandUsername: String | null,  // FeedLand screen name
  feedlandCategory: String | null,  // Category filter (or null for all)
  enabled: Boolean,
  syncInterval: Number,   // Minutes between syncs
  lastSyncAt: String | null,     // ISO 8601
  lastSyncError: String | null,
  createdAt: String,      // ISO 8601
  updatedAt: String       // ISO 8601
}
```

**blogrollBlogs**
```javascript
{
  _id: ObjectId,
  sourceId: ObjectId | null,  // Reference to blogrollSources
  title: String,
  description: String | null,
  feedUrl: String,            // Unique identifier
  siteUrl: String | null,
  feedType: "rss" | "atom" | "jsonfeed",
  category: String,           // For grouping/filtering
  tags: String[],
  photo: String | null,       // Blog icon/avatar
  author: Object | null,      // { name: String }
  status: "active" | "error" | "deleted",
  lastFetchAt: String | null,  // ISO 8601
  lastError: String | null,
  itemCount: Number,
  pinned: Boolean,
  hidden: Boolean,
  notes: String | null,
  // Microsub-specific (when source === "microsub")
  source: "microsub" | null,
  microsubFeedId: String | null,     // Reference to microsub_feeds._id
  microsubChannelId: String | null,
  microsubChannelName: String | null,
  skipItemFetch: Boolean,            // True for Microsub blogs
  createdAt: String,       // ISO 8601
  updatedAt: String        // ISO 8601
}
```

**blogrollItems**
```javascript
{
  _id: ObjectId,
  blogId: ObjectId,            // Reference to blogrollBlogs
  uid: String,                 // Unique hash from feedUrl + itemId
  url: String,
  title: String,
  content: { html: String, text: String },
  summary: String,
  published: String,           // ISO 8601
  updated: String | null,      // ISO 8601
  author: Object | null,       // { name: String }
  photo: String[] | null,      // Image URLs
  categories: String[],
  fetchedAt: String            // ISO 8601
}
```

**blogrollMeta**
```javascript
{
  key: "syncStats",
  lastFullSync: String,        // ISO 8601
  duration: Number,            // Milliseconds
  sources: { total: Number, success: Number, failed: Number },
  blogs: { total: Number, success: Number, failed: Number },
  items: { added: Number, deleted: Number }
}
```

## Key Files

### Entry Point
- **index.js** - Plugin class, route registration, initialization

### Controllers (Protected Routes)
- **lib/controllers/dashboard.js** - Main dashboard, sync triggers
- **lib/controllers/sources.js** - CRUD for sources (OPML/Microsub)
- **lib/controllers/blogs.js** - CRUD for blogs, manual refresh
- **lib/controllers/api.js** - Both protected and public API endpoints

### Storage (MongoDB Operations)
- **lib/storage/sources.js** - Source CRUD, sync status
- **lib/storage/blogs.js** - Blog CRUD, upsert for sync, status updates
- **lib/storage/items.js** - Item CRUD, transparent Microsub integration

### Sync Engine
- **lib/sync/scheduler.js** - Background sync, interval management
- **lib/sync/opml.js** - OPML parsing, fetch from URL, export
- **lib/sync/microsub.js** - Microsub channel/feed sync, webhook handler
- **lib/sync/feedland.js** - FeedLand sync, category discovery, OPML URL builder
- **lib/sync/feed.js** - RSS/Atom/JSON Feed parsing, item fetching

### Utilities
- **lib/utils/feed-discovery.js** - Auto-discover feeds from website URLs

## Configuration

### Plugin Options
```javascript
new BlogrollEndpoint({
  mountPath: "/blogrollapi",    // Admin UI and API base path
  syncInterval: 3600000,         // 1 hour (in milliseconds)
  maxItemsPerBlog: 50,           // Items to fetch per blog
  maxItemAge: 7,                 // Days - older items deleted (encourages discovery)
  fetchTimeout: 15000            // 15 seconds per feed fetch
})
```

### Environment/Deployment
- Requires MongoDB (uses Indiekit's database connection)
- Background sync starts 15 seconds after server startup
- Periodic sync runs at `syncInterval` (default 1 hour)

## Routes

### Protected Routes (Admin UI)
```
GET    /blogrollapi/                   Dashboard (stats, recent activity)
POST   /blogrollapi/sync               Manual sync trigger
POST   /blogrollapi/clear-resync       Clear all items and resync

GET    /blogrollapi/sources            List sources
GET    /blogrollapi/sources/new        New source form
POST   /blogrollapi/sources            Create source
GET    /blogrollapi/sources/:id        Edit source form
POST   /blogrollapi/sources/:id        Update source
POST   /blogrollapi/sources/:id/delete Delete source
POST   /blogrollapi/sources/:id/sync   Sync single source

GET    /blogrollapi/blogs              List blogs
GET    /blogrollapi/blogs/new          New blog form
POST   /blogrollapi/blogs              Create blog
GET    /blogrollapi/blogs/:id          Edit blog form
POST   /blogrollapi/blogs/:id          Update blog
POST   /blogrollapi/blogs/:id/delete   Delete blog (soft delete)
POST   /blogrollapi/blogs/:id/refresh  Refresh single blog

GET    /blogrollapi/api/discover       Feed discovery (protected)
POST   /blogrollapi/api/microsub-webhook  Microsub webhook handler
GET    /blogrollapi/api/microsub-status   Microsub integration status
```

### Public Routes (Read-Only API)
```
GET    /blogrollapi/api/blogs                List blogs (JSON)
GET    /blogrollapi/api/blogs/:id            Get blog with recent items (JSON)
GET    /blogrollapi/api/items                List items across all blogs (JSON)
GET    /blogrollapi/api/categories           List categories with counts (JSON)
GET    /blogrollapi/api/status               Sync status (JSON)
GET    /blogrollapi/api/opml                 Export all blogs as OPML
GET    /blogrollapi/api/opml/:category       Export category as OPML
```

### API Query Parameters
- **GET /api/blogs**: `?category=Tech&limit=100&offset=0`
- **GET /api/items**: `?blog=<id>&category=Tech&limit=50&offset=0`

## Inter-Plugin Relationships

### Microsub Integration
- **Detection:** Checks `application.collections.get("microsub_channels")` for availability
- **Sync:** Reads `microsub_channels` and `microsub_feeds` to create blogroll references
- **Items:** Queries `microsub_items` directly (no duplication)
- **Webhook:** Receives notifications when feeds are subscribed/unsubscribed
- **Orphan Cleanup:** Soft-deletes blogs whose Microsub feed no longer exists

### Homepage Plugin
- Provides homepage sections: None (this plugin doesn't register homepage sections)
- Can be used BY homepage plugin through public API endpoints

### Data Dependencies
- **Requires:** MongoDB connection via Indiekit
- **Creates Collections:** `blogrollSources`, `blogrollBlogs`, `blogrollItems`, `blogrollMeta`
- **Reads Collections:** `microsub_channels`, `microsub_feeds`, `microsub_items` (when Microsub plugin is installed)

## Known Gotchas

### Date Handling
- **Store dates as ISO strings** (`new Date().toISOString()`), NOT Date objects
- The Nunjucks `| date` filter crashes on Date objects
- Controllers convert Date objects to ISO strings before passing to templates
- See CLAUDE.md root: "CRITICAL: Indiekit Date Handling Convention"

### Microsub Reference Architecture
- Microsub blogs have `source: "microsub"` and `skipItemFetch: true`
- Items are NOT copied to `blogrollItems` - queried from `microsub_items` directly
- The `getItems()` and `getItemsForBlog()` functions transparently join both sources
- DO NOT run feed fetch on Microsub blogs - Microsub handles that

### Soft Deletion
- Blogs are soft-deleted (`status: "deleted"`, `hidden: true`) not removed
- This prevents OPML/Microsub sync from recreating manually deleted blogs
- `upsertBlog()` skips blogs with `status: "deleted"`

### Item Retention
- Items older than `maxItemAge` (default 7 days) are auto-deleted on each sync
- This is intentional to encourage discovery of fresh content
- Adjust `maxItemAge` for longer retention

### Flash Messages
- Uses session-based flash messages for user feedback
- `consumeFlashMessage(request)` extracts and clears messages
- Returns `{ success, error }` for Indiekit's native `notificationBanner`

## Dependencies

```json
{
  "@indiekit/error": "^1.0.0-beta.25",
  "@indiekit/frontend": "^1.0.0-beta.25",
  "express": "^5.0.0",
  "feedparser": "^2.2.10",         // RSS/Atom parsing
  "sanitize-html": "^2.13.0",      // XSS prevention for feed content
  "xml2js": "^0.6.2"               // OPML parsing
}
```

## Testing Notes

- **No test suite configured** (manual testing only)
- Test against real feeds: RSS, Atom, JSON Feed
- Test OPML import (nested categories)
- Test Microsub integration (requires `@rmdes/indiekit-endpoint-microsub`)
- Test soft delete behavior (re-sync should not recreate deleted blogs)

## Common Tasks

### Add a New Source Type
1. Add type to `createSource()` in `lib/storage/sources.js`
2. Implement sync function in `lib/sync/` (e.g., `syncJsonFeedSource()`)
3. Add handler in `runFullSync()` in `lib/sync/scheduler.js`
4. Update source form UI

### Change Item Retention Period
- Modify `maxItemAge` plugin option (default 7 days)
- Items older than this are deleted on each sync

### Debug Sync Issues
- Check `blogrollMeta.syncStats` document for last sync results
- Check `blogs.lastError` and `sources.lastSyncError` for failures
- Tail logs for `[Blogroll]` prefix messages

### Integrate with Frontend
- Use public API endpoints (`/blogrollapi/api/blogs`, `/blogrollapi/api/items`)
- OPML export available at `/blogrollapi/api/opml`
- All public endpoints return JSON (except OPML which returns XML)
