/**
 * Blogroll v2 block declarations (Phase 7b — plugin block ownership).
 *
 * The `blogroll` and `feedland` sidebar widgets were site-config BUILTIN_BLOCKS
 * seeds (requiresPlugin null, gated only by the theme's legacy
 * widgetPluginRequirements render-map). Declaring them here makes site-config's
 * scanPlugins stamp `sourcePlugin` → `requiresPlugin` ("Blogroll endpoint"), so
 * the blocks are properly plugin-gated (theme ENDPOINT_SLUGS maps them to the
 * `blogroll` loadout slug). scanPlugins precedence is `built-in < plugin blocks`,
 * so these entries OVERWRITE the builtin seeds on sites where the plugin is
 * loaded; the seeds themselves are removed from site-config in Phase 7d alongside
 * the legacy-map bridge.
 *
 * Both are owned by this plugin: FeedLand is an alternate blogroll backend served
 * by the same endpoint. Descriptors are byte-faithful to the BUILTIN_BLOCKS
 * entries. Bespoke templates: the theme owns `components/widgets/blogroll.njk` and
 * `components/widgets/feedland.njk` (no generic `render.renderer`);
 * `data.source:"api"` documents the runtime fetch.
 *
 * @module lib/blocks
 */

/** @type {Array<object>} */
export const BLOGROLL_BLOCKS = [
  {
    id: "blogroll",
    version: 1,
    label: "Blogroll",
    description: "Blog recommendations",
    icon: "list",
    category: "social",
    placement: { regions: ["sidebar"], surfaces: ["homepage"] },
    multiple: false,
    data: { source: "api" },
    schema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    id: "feedland",
    version: 1,
    label: "FeedLand",
    description: "FeedLand blogroll widget",
    icon: "rss",
    category: "social",
    placement: { regions: ["sidebar"], surfaces: ["homepage"] },
    multiple: false,
    data: { source: "api" },
    schema: { type: "object", additionalProperties: false, properties: {} },
  },
];
