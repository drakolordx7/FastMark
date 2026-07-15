const api = typeof browser !== "undefined" ? browser : chrome;

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({
    id: "fastmark-save",
    title: "Save to FastMark",
    contexts: ["page", "link"],
  });
  api.contextMenus.create({
    id: "fastmark-search",
    title: "Search FastMark for “%s”",
    contexts: ["selection"],
  });
});

api.contextMenus.onClicked.addListener(async (info, tab) => {
  const cfg = await api.storage.local.get(["baseUrl", "token"]);
  if (!cfg.baseUrl || !cfg.token) {
    api.notifications?.create?.({
      type: "basic",
      title: "FastMark",
      message: "Sign in via the FastMark popup first",
    });
    return;
  }
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.token}`,
  };
  const base = cfg.baseUrl.replace(/\/$/, "");

  if (info.menuItemId === "fastmark-save") {
    const url = info.linkUrl || tab?.url;
    const title = tab?.title;
    await fetch(`${base}/api/bookmarks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url, title }),
    });
  }

  if (info.menuItemId === "fastmark-search" && info.selectionText) {
    const q = encodeURIComponent(info.selectionText);
    api.tabs.create({ url: `${base}/library?q=${q}` });
  }
});
