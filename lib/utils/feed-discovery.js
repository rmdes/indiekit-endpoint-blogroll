/**
 * RSS/Atom feed discovery from website URLs
 * @module utils/feed-discovery
 */

/**
 * Discover RSS/Atom feeds from a website URL
 * @param {string} websiteUrl - The website URL to check
 * @param {number} timeout - Fetch timeout in ms
 * @returns {Promise<object>} Discovery result with feeds array
 */
export async function discoverFeeds(websiteUrl, timeout = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // Normalize URL
    let url = websiteUrl.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Indiekit-Blogroll/1.0 (Feed Discovery)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}`, feeds: [] };
    }

    const html = await response.text();
    const feeds = [];
    const baseUrl = new URL(url);

    // Find <link rel="alternate"> feeds in HTML
    const linkRegex =
      /<link[^>]+rel=["']alternate["'][^>]*>/gi;
    const typeRegex = /type=["']([^"']+)["']/i;
    const hrefRegex = /href=["']([^"']+)["']/i;
    const titleRegex = /title=["']([^"']+)["']/i;

    const feedTypes = [
      "application/rss+xml",
      "application/atom+xml",
      "application/feed+json",
      "application/json",
      "text/xml",
    ];

    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const linkTag = match[0];
      const typeMatch = typeRegex.exec(linkTag);
      const hrefMatch = hrefRegex.exec(linkTag);

      if (hrefMatch) {
        const type = typeMatch ? typeMatch[1].toLowerCase() : "";
        const href = hrefMatch[1];
        const titleMatch = titleRegex.exec(linkTag);
        const title = titleMatch ? titleMatch[1] : null;

        // Check if it's a feed type
        if (feedTypes.some((ft) => type.includes(ft.split("/")[1]))) {
          // Resolve relative URLs
          const feedUrl = new URL(href, baseUrl).href;

          feeds.push({
            url: feedUrl,
            type: type.includes("atom")
              ? "atom"
              : type.includes("json")
                ? "json"
                : "rss",
            title,
          });
        }
      }
    }

    // Also check common feed paths if no feeds found in HTML
    if (feeds.length === 0) {
      const commonPaths = [
        "/feed",
        "/feed.xml",
        "/rss",
        "/rss.xml",
        "/atom.xml",
        "/feed/atom",
        "/feed/rss",
        "/index.xml",
        "/blog/feed",
        "/blog/rss",
        "/.rss",
        "/feed.json",
      ];

      for (const path of commonPaths) {
        try {
          const feedUrl = new URL(path, baseUrl).href;
          const feedResponse = await fetch(feedUrl, {
            method: "HEAD",
            signal: controller.signal,
            headers: {
              "User-Agent": "Indiekit-Blogroll/1.0 (Feed Discovery)",
            },
          });

          if (feedResponse.ok) {
            const contentType = feedResponse.headers.get("content-type") || "";
            if (
              contentType.includes("xml") ||
              contentType.includes("rss") ||
              contentType.includes("atom") ||
              contentType.includes("json")
            ) {
              feeds.push({
                url: feedUrl,
                type: contentType.includes("atom")
                  ? "atom"
                  : contentType.includes("json")
                    ? "json"
                    : "rss",
                title: null,
              });
              break; // Found one, stop checking
            }
          }
        } catch {
          // Ignore individual path errors
        }
      }
    }

    // Try to extract page title for blog name
    let pageTitle = null;
    const titleTagMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
    if (titleTagMatch) {
      pageTitle = titleTagMatch[1].trim();
      // Clean up common suffixes
      pageTitle = pageTitle
        .replace(/\s*[-|–—]\s*.*$/, "")
        .replace(/\s*:\s*Home.*$/i, "")
        .trim();
    }

    return {
      success: true,
      feeds,
      pageTitle,
      siteUrl: baseUrl.origin,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return { success: false, error: "Request timed out", feeds: [] };
    }
    return { success: false, error: error.message, feeds: [] };
  } finally {
    clearTimeout(timeoutId);
  }
}
