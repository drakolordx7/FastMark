const $ = (id) => document.getElementById(id);

const api = typeof browser !== "undefined" ? browser : chrome;

async function storageGet(keys) {
  return api.storage.local.get(keys);
}
async function storageSet(obj) {
  return api.storage.local.set(obj);
}
async function storageRemove(keys) {
  return api.storage.local.remove(keys);
}

async function getConfig() {
  return storageGet(["baseUrl", "token", "cache"]);
}

async function apiFetch(path, options = {}) {
  const { baseUrl, token } = await getConfig();
  if (!baseUrl) throw new Error("Set server URL");
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function refreshUI() {
  const cfg = await getConfig();
  $("baseUrl").value = cfg.baseUrl || "";
  const loggedIn = Boolean(cfg.token);
  $("login").hidden = loggedIn;
  $("app").hidden = !loggedIn;
  $("status").textContent = loggedIn ? "signed in" : "";
  if (loggedIn) {
    try {
      const data = await apiFetch("/api/bookmarks?view=");
      const list = (data.bookmarks || []).slice(0, 40);
      await storageSet({
        cache: list.map((b) => ({
          id: b.id,
          title: b.title,
          url: b.url,
          summary: b.summary,
        })),
      });
      renderResults(list);
    } catch {
      renderResults(cfg.cache || []);
    }
  }
}

function renderResults(items) {
  const ul = $("results");
  ul.innerHTML = "";
  for (const b of items) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = b.url;
    a.target = "_blank";
    a.textContent = b.title || b.url;
    li.appendChild(a);
    ul.appendChild(li);
  }
}

$("loginBtn").addEventListener("click", async () => {
  try {
    const baseUrl = $("baseUrl").value.trim().replace(/\/$/, "");
    await storageSet({ baseUrl });
    const data = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("username").value,
        password: $("password").value,
        kind: "extension",
      }),
    });
    await storageSet({ token: data.token });
    $("password").value = "";
    await refreshUI();
  } catch (err) {
    $("status").textContent = err.message;
  }
});

$("logoutBtn").addEventListener("click", async () => {
  await storageRemove(["token"]);
  await refreshUI();
});

$("saveBtn").addEventListener("click", async () => {
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    await apiFetch("/api/bookmarks", {
      method: "POST",
      body: JSON.stringify({ url: tab.url, title: tab.title }),
    });
    $("status").textContent = "saved";
    await refreshUI();
  } catch (err) {
    $("status").textContent = err.message;
  }
});

$("htmlBtn").addEventListener("click", async () => {
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    const [{ result: html }] = await api.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.documentElement.outerHTML,
    });
    await apiFetch("/api/bookmarks", {
      method: "POST",
      body: JSON.stringify({
        url: tab.url,
        title: tab.title,
        html,
      }),
    });
    $("status").textContent = "html submitted";
    await refreshUI();
  } catch (err) {
    $("status").textContent = err.message;
  }
});

$("search").addEventListener("input", async (e) => {
  const q = e.target.value.trim().toLowerCase();
  const cfg = await getConfig();
  if (!q) {
    renderResults(cfg.cache || []);
    return;
  }
  try {
    const data = await apiFetch(`/api/search?q=${encodeURIComponent(q)}`);
    renderResults(data.results || []);
  } catch {
    const cached = (cfg.cache || []).filter((b) =>
      `${b.title || ""} ${b.url} ${b.summary || ""}`.toLowerCase().includes(q),
    );
    renderResults(cached);
  }
});

refreshUI();
