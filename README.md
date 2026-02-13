# Blogroll Endpoint for Indiekit

An Indiekit plugin that provides a comprehensive blogroll management system with feed aggregation, admin UI, and public API.

## Features

- **Multiple Source Types:** Import blogs from OPML files/URLs, Microsub subscriptions, or add manually
- **Background Feed Fetching:** Automatically syncs blogs and caches recent items
- **Microsub Integration:** Mirror your Microsub subscriptions as a blogroll (zero duplication)
- **Admin UI:** Manage sources, blogs, and view recent activity
- **Public JSON API:** Read-only endpoints for frontend integration
- **OPML Export:** Export your blogroll as OPML (all or by category)
- **Feed Discovery:** Auto-discover feeds from website URLs
- **Item Retention:** Automatic cleanup of old items (encourages fresh content discovery)

## Installation

```bash
npm install @rmdes/indiekit-endpoint-blogroll
```

## Configuration

Add to your `indiekit.config.js`:

```javascript
import BlogrollEndpoint from "@rmdes/indiekit-endpoint-blogroll";

export default {
  plugins: [
    new BlogrollEndpoint({
      mountPath: "/blogrollapi",    // Admin UI and API base path
      syncInterval: 3600000,         // 1 hour (in milliseconds)
      maxItemsPerBlog: 50,           // Items to fetch per blog
      maxItemAge: 7,                 // Days - older items auto-deleted
      fetchTimeout: 15000            // 15 seconds per feed fetch
    })
  ]
};
```

## Requirements

- **Indiekit:** `>=1.0.0-beta.25`
- **MongoDB:** Required for data storage
- **Optional:** `@rmdes/indiekit-endpoint-microsub` for Microsub integration

## Usage

### Admin UI

Navigate to `/blogrollapi` in your Indiekit instance to access:

- **Dashboard:** View sync status, blog counts, recent activity
- **Sources:** Manage OPML and Microsub sources
- **Blogs:** Add/edit/delete individual blogs, refresh feeds
- **Manual Sync:** Trigger immediate sync or clear and resync

### Source Types

1. **OPML URL:** Point to a public OPML file (e.g., your feed reader's export)
2. **OPML File:** Paste OPML XML directly into the form
3. **Microsub:** Import subscriptions from your Microsub channels
4. **Manual:** Add individual blog feeds one at a time

### Public API

All API endpoints return JSON (except OPML export which returns XML).

**List Blogs**
```
GET /blogrollapi/api/blogs?category=Tech&limit=100&offset=0
```

**Get Blog with Recent Items**
```
GET /blogrollapi/api/blogs/:id
```

**List Items Across All Blogs**
```
GET /blogrollapi/api/items?blog=<id>&category=Tech&limit=50&offset=0
```

**List Categories**
```
GET /blogrollapi/api/categories
```

**Sync Status**
```
GET /blogrollapi/api/status
```

**Export OPML**
```
GET /blogrollapi/api/opml                  (all blogs)
GET /blogrollapi/api/opml/:category        (specific category)
```

### Example Response

**GET /blogrollapi/api/blogs**
```json
{
  "items": [
    {
      "id": "507f1f77bcf86cd799439011",
      "title": "Example Blog",
      "description": "A great blog about tech",
      "feedUrl": "https://example.com/feed",
      "siteUrl": "https://example.com",
      "feedType": "rss",
      "category": "Tech",
      "tags": ["programming", "web"],
      "photo": "https://example.com/icon.png",
      "status": "active",
      "itemCount": 25,
      "pinned": false,
      "lastFetchAt": "2026-02-13T10:30:00.000Z"
    }
  ],
  "total": 42,
  "hasMore": true
}
```

**GET /blogrollapi/api/items**
```json
{
  "items": [
    {
      "id": "507f1f77bcf86cd799439011",
      "url": "https://example.com/post/hello",
      "title": "Hello World",
      "summary": "My first blog post...",
      "published": "2026-02-13T10:00:00.000Z",
      "isFuture": false,
      "author": { "name": "Jane Doe" },
      "photo": ["https://example.com/image.jpg"],
      "categories": ["announcement"],
      "blog": {
        "id": "507f1f77bcf86cd799439011",
        "title": "Example Blog",
        "siteUrl": "https://example.com",
        "category": "Tech",
        "photo": "https://example.com/icon.png"
      }
    }
  ],
  "hasMore": false
}
```

## Microsub Integration

If you have `@rmdes/indiekit-endpoint-microsub` installed, the blogroll can mirror your subscriptions:

1. Create a Microsub source in the admin UI
2. Select specific channels or sync all channels
3. Add a category prefix (optional) to distinguish Microsub blogs
4. Blogs and items are referenced, not duplicated

**Benefits:**
- Zero data duplication - items are served directly from Microsub
- Automatic orphan cleanup when feeds are unsubscribed
- Webhook support for real-time updates

## Background Sync

The plugin automatically syncs in the background:

1. **Initial Sync:** Runs 15 seconds after server startup
2. **Periodic Sync:** Runs every `syncInterval` milliseconds (default 1 hour)
3. **What it Does:**
   - Syncs enabled sources (OPML/Microsub)
   - Fetches new items from active blogs
   - Deletes items older than `maxItemAge` days
   - Updates sync statistics

**Manual Sync:**
- Trigger from the dashboard
- Use `POST /blogrollapi/sync` (protected endpoint)
- Use `POST /blogrollapi/clear-resync` to clear and resync all

## Feed Discovery

The plugin includes auto-discovery for finding feeds from website URLs:

```javascript
// In the admin UI, when adding a blog, paste a website URL
// The plugin will:
// 1. Check <link rel="alternate"> tags in HTML
// 2. Try common feed paths (/feed, /rss, /atom.xml, etc.)
// 3. Suggest discovered feeds
```

## Item Retention

By default, items older than 7 days are automatically deleted during sync. This encourages discovery of fresh content rather than archiving everything.

**To Change Retention:**
```javascript
new BlogrollEndpoint({
  maxItemAge: 30  // Keep items for 30 days instead
})
```

## Blog Status

- **active:** Blog is working, fetching items normally
- **error:** Last fetch failed (see `lastError` for details)
- **deleted:** Soft-deleted, won't be recreated by sync

## Navigation

The plugin adds itself to Indiekit's navigation:

- **Menu Item:** "Blogroll" (requires database)
- **Shortcut:** Bookmark icon in admin dashboard

## Security

- **Protected Routes:** Admin UI and management endpoints require authentication
- **Public Routes:** Read-only API endpoints are publicly accessible
- **XSS Prevention:** Feed content is sanitized with `sanitize-html`
- **Feed Discovery:** Protected to prevent abuse (requires authentication)

## Supported Feed Formats

- RSS 2.0
- Atom 1.0
- JSON Feed 1.0

## Contributing

Report issues at: https://github.com/rmdes/indiekit-endpoint-blogroll/issues

## License

MIT
