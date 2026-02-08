/**
 * Sources controller
 * @module controllers/sources
 */

import {
  getSources,
  getSource,
  createSource,
  updateSource,
  deleteSource,
} from "../storage/sources.js";
import { syncOpmlSource } from "../sync/opml.js";
import {
  syncMicrosubSource,
  getMicrosubChannels,
  isMicrosubAvailable,
} from "../sync/microsub.js";

/**
 * List sources
 * GET /sources
 */
async function list(request, response) {
  const { application } = request.app.locals;

  try {
    const rawSources = await getSources(application);

    // Convert Date objects to ISO strings for template date filter compatibility
    const sources = rawSources.map((source) => ({
      ...source,
      lastSyncAt: source.lastSyncAt
        ? (source.lastSyncAt instanceof Date
            ? source.lastSyncAt.toISOString()
            : source.lastSyncAt)
        : null,
    }));

    response.render("blogroll-sources", {
      title: request.__("blogroll.sources.title"),
      sources,
      baseUrl: request.baseUrl,
    });
  } catch (error) {
    console.error("[Blogroll] Sources list error:", error);
    response.status(500).render("error", {
      title: "Error",
      message: "Failed to load sources",
    });
  }
}

/**
 * New source form
 * GET /sources/new
 */
async function newForm(request, response) {
  const { application } = request.app.locals;

  // Check if Microsub is available and get channels
  const microsubAvailable = isMicrosubAvailable(application);
  const microsubChannels = microsubAvailable
    ? await getMicrosubChannels(application)
    : [];

  response.render("blogroll-source-edit", {
    title: request.__("blogroll.sources.new"),
    source: null,
    isNew: true,
    baseUrl: request.baseUrl,
    microsubAvailable,
    microsubChannels,
  });
}

/**
 * Create source
 * POST /sources
 */
async function create(request, response) {
  const { application } = request.app.locals;
  const {
    name,
    type,
    url,
    opmlContent,
    syncInterval,
    enabled,
    channelFilter,
    categoryPrefix,
  } = request.body;

  try {
    // Validate required fields
    if (!name || !type) {
      request.session.messages = [
        { type: "error", content: "Name and type are required" },
      ];
      return response.redirect(`${request.baseUrl}/sources/new`);
    }

    if (type === "opml_url" && !url) {
      request.session.messages = [
        { type: "error", content: "URL is required for OPML URL source" },
      ];
      return response.redirect(`${request.baseUrl}/sources/new`);
    }

    if (type === "microsub" && !isMicrosubAvailable(application)) {
      request.session.messages = [
        { type: "error", content: "Microsub plugin is not available" },
      ];
      return response.redirect(`${request.baseUrl}/sources/new`);
    }

    const sourceData = {
      name,
      type,
      url: url || null,
      opmlContent: opmlContent || null,
      syncInterval: Number(syncInterval) || 60,
      enabled: enabled === "on" || enabled === true,
    };

    // Add microsub-specific fields
    if (type === "microsub") {
      sourceData.channelFilter = channelFilter || null;
      sourceData.categoryPrefix = categoryPrefix || "";
    }

    const source = await createSource(application, sourceData);

    // Trigger initial sync based on source type
    try {
      if (type === "microsub") {
        await syncMicrosubSource(application, source);
      } else {
        await syncOpmlSource(application, source);
      }
      request.session.messages = [
        { type: "success", content: request.__("blogroll.sources.created_synced") },
      ];
    } catch (syncError) {
      request.session.messages = [
        {
          type: "warning",
          content: request.__("blogroll.sources.created_sync_failed", {
            error: syncError.message,
          }),
        },
      ];
    }

    response.redirect(`${request.baseUrl}/sources`);
  } catch (error) {
    console.error("[Blogroll] Create source error:", error);
    request.session.messages = [
      { type: "error", content: error.message },
    ];
    response.redirect(`${request.baseUrl}/sources/new`);
  }
}

/**
 * Edit source form
 * GET /sources/:id
 */
async function edit(request, response) {
  const { application } = request.app.locals;
  const { id } = request.params;

  try {
    const source = await getSource(application, id);

    if (!source) {
      return response.status(404).render("404");
    }

    // Check if Microsub is available and get channels
    const microsubAvailable = isMicrosubAvailable(application);
    const microsubChannels = microsubAvailable
      ? await getMicrosubChannels(application)
      : [];

    response.render("blogroll-source-edit", {
      title: request.__("blogroll.sources.edit"),
      source,
      isNew: false,
      baseUrl: request.baseUrl,
      microsubAvailable,
      microsubChannels,
    });
  } catch (error) {
    console.error("[Blogroll] Edit source error:", error);
    response.status(500).render("error", {
      title: "Error",
      message: "Failed to load source",
    });
  }
}

/**
 * Update source
 * POST /sources/:id
 */
async function update(request, response) {
  const { application } = request.app.locals;
  const { id } = request.params;
  const {
    name,
    type,
    url,
    opmlContent,
    syncInterval,
    enabled,
    channelFilter,
    categoryPrefix,
  } = request.body;

  try {
    const source = await getSource(application, id);

    if (!source) {
      return response.status(404).render("404");
    }

    const updateData = {
      name,
      type,
      url: url || null,
      opmlContent: opmlContent || null,
      syncInterval: Number(syncInterval) || 60,
      enabled: enabled === "on" || enabled === true,
    };

    // Add microsub-specific fields
    if (type === "microsub") {
      updateData.channelFilter = channelFilter || null;
      updateData.categoryPrefix = categoryPrefix || "";
    }

    await updateSource(application, id, updateData);

    request.session.messages = [
      { type: "success", content: request.__("blogroll.sources.updated") },
    ];

    response.redirect(`${request.baseUrl}/sources`);
  } catch (error) {
    console.error("[Blogroll] Update source error:", error);
    request.session.messages = [
      { type: "error", content: error.message },
    ];
    response.redirect(`${request.baseUrl}/sources/${id}`);
  }
}

/**
 * Delete source
 * POST /sources/:id/delete
 */
async function remove(request, response) {
  const { application } = request.app.locals;
  const { id } = request.params;

  try {
    const source = await getSource(application, id);

    if (!source) {
      return response.status(404).render("404");
    }

    await deleteSource(application, id);

    request.session.messages = [
      { type: "success", content: request.__("blogroll.sources.deleted") },
    ];

    response.redirect(`${request.baseUrl}/sources`);
  } catch (error) {
    console.error("[Blogroll] Delete source error:", error);
    request.session.messages = [
      { type: "error", content: error.message },
    ];
    response.redirect(`${request.baseUrl}/sources`);
  }
}

/**
 * Sync single source
 * POST /sources/:id/sync
 */
async function sync(request, response) {
  const { application } = request.app.locals;
  const { id } = request.params;

  try {
    const source = await getSource(application, id);

    if (!source) {
      return response.status(404).render("404");
    }

    // Use appropriate sync function based on source type
    let result;
    if (source.type === "microsub") {
      result = await syncMicrosubSource(application, source);
    } else {
      result = await syncOpmlSource(application, source);
    }

    if (result.success) {
      request.session.messages = [
        {
          type: "success",
          content: request.__("blogroll.sources.synced", {
            added: result.added,
            updated: result.updated,
          }),
        },
      ];
    } else {
      request.session.messages = [
        { type: "error", content: result.error },
      ];
    }

    response.redirect(`${request.baseUrl}/sources`);
  } catch (error) {
    console.error("[Blogroll] Sync source error:", error);
    request.session.messages = [
      { type: "error", content: error.message },
    ];
    response.redirect(`${request.baseUrl}/sources`);
  }
}

export const sourcesController = {
  list,
  newForm,
  create,
  edit,
  update,
  remove,
  sync,
};
