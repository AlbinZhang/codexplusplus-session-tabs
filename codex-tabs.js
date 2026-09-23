(() => {
  const KEY = "__codexChromeTabs";
  const STORE = "codex-plus.chrome-tabs.v1";
  window[KEY]?.destroy?.();

  const state = {
    tabs: [],
    currentId: "",
    renderKey: "",
    observer: null,
    timer: 0,
    mountTimer: 0,
    draggedId: "",
    suppressClick: false,
    handlers: new Map(),
  };

  const css = `
    #codex-chrome-tabs{display:flex;min-width:0;max-width:min(72vw,1200px);height:46px;align-items:flex-end;gap:2px;overflow-x:auto;overflow-y:hidden;padding:5px 4px 0;pointer-events:auto;scrollbar-width:none}
    #codex-chrome-tabs::-webkit-scrollbar{display:none}
    .codex-chrome-tab{position:relative;display:flex;min-width:150px;max-width:240px;height:37px;align-items:center;gap:8px;padding:5px 7px 4px 12px;border:1px solid color-mix(in srgb,currentColor 10%,transparent);border-bottom:0;border-radius:8px 8px 0 0;background:color-mix(in srgb,var(--color-background-primary,#202020) 82%,transparent);color:var(--color-text-secondary,#aaa);cursor:grab;no-drag:true}
    .codex-chrome-tab:active{cursor:grabbing}
    .codex-chrome-tab:hover{background:color-mix(in srgb,currentColor 7%,var(--color-background-primary,#202020));color:var(--color-text-primary,#fff)}
    .codex-chrome-tab.active{background:var(--color-background-primary,#202020);color:var(--color-text-primary,#fff);box-shadow:0 -1px 8px rgba(0,0,0,.1)}
    .codex-chrome-tab.active:after{position:absolute;right:0;bottom:0;left:0;height:2px;background:#5b75ff;content:""}
    .codex-chrome-tab-copy{min-width:0;flex:1;text-align:left;line-height:1.1}
    .codex-chrome-tab-status{display:none;width:7px;height:7px;flex:0 0 7px;border-radius:50%;background:#339cff;box-shadow:0 0 0 2px color-mix(in srgb,#339cff 18%,transparent)}
    .codex-chrome-tab.attention .codex-chrome-tab-status{display:block}
    .codex-chrome-tab.running .codex-chrome-tab-status{display:block;width:12px;height:12px;flex-basis:12px;border:2px solid color-mix(in srgb,#34c7b1 28%,transparent);border-top-color:#34c7b1;border-radius:50%;background:transparent;box-shadow:none;animation:codex-tabs-spin .8s linear infinite}
    @keyframes codex-tabs-spin{to{transform:rotate(360deg)}}
    .codex-chrome-tab-title{display:block;overflow:hidden;font-size:12px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
    .codex-chrome-tab-project{display:block;overflow:hidden;margin-top:3px;color:var(--color-text-tertiary,#777);font-size:9px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
    .codex-chrome-tab-close{display:flex;width:20px;height:20px;flex:0 0 20px;align-items:center;justify-content:center;border:0;border-radius:5px;background:transparent;color:inherit;font:16px/1 sans-serif;cursor:pointer;opacity:.62}
    .codex-chrome-tab-close:hover{background:color-mix(in srgb,currentColor 12%,transparent);opacity:1}
    [data-codex-tabs-original-title]{display:none!important}
  `;

  function load() {
    try {
      const value = JSON.parse(localStorage.getItem(STORE) || "[]");
      return Array.isArray(value) ? value.filter((tab) => tab?.id && tab?.title) : [];
    } catch { return []; }
  }

  function save() {
    localStorage.setItem(STORE, JSON.stringify(state.tabs));
  }

  function projectFromRow(row) {
    const list = row.closest('[role="list"][aria-label]');
    const label = list?.getAttribute("aria-label") || "";
    const suffix = "中的已安排任务";
    if (label.endsWith(suffix)) return label.slice(0, -suffix.length);
    return document.querySelector('header button[aria-label^="项目："]')?.getAttribute("aria-label")?.slice(3) || "本地";
  }

  function activeConversation() {
    const row = document.querySelector('[data-app-action-sidebar-thread-selected="true"][data-app-action-sidebar-thread-id]');
    if (!row) return null;
    return {
      id: row.getAttribute("data-app-action-sidebar-thread-id"),
      title: row.getAttribute("data-app-action-sidebar-thread-title") || row.getAttribute("aria-label") || "未命名会话",
      project: projectFromRow(row),
    };
  }

  function findHeader() {
    return document.querySelector('header [data-testid="app-shell-header-context-menu-surface"] ._Toolbar_3yrz9_2') ||
      document.querySelector('header [data-testid="app-shell-header-context-menu-surface"] > div > div');
  }

  function sidebarButton(label) {
    return [...document.querySelectorAll("button")].find((button) => {
      if (button.getAttribute("aria-label") !== label) return false;
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  function rowHandler(row) {
    if (!row) return null;
    const propsKey = Object.keys(row).find((key) => key.startsWith("__reactProps"));
    const handler = propsKey && row[propsKey]?.onClick;
    return typeof handler === "function" ? handler : null;
  }

  function invokeHandler(handler, row) {
    try {
      handler({
        button: 0,
        target: row || document.body,
        currentTarget: row || document.body,
        preventDefault() {},
        stopPropagation() {},
      });
      return true;
    } catch {
      return false;
    }
  }

  function switchTo(id) {
    state.currentId = id;
    state.renderKey = "";
    render();
    const findRow = () => [...document.querySelectorAll("[data-app-action-sidebar-thread-id]")]
      .find((item) => item.getAttribute("data-app-action-sidebar-thread-id") === id);
    const activate = (useInternal = true) => {
      const row = findRow();
      if (useInternal) {
        const handler = rowHandler(row) || state.handlers.get(id);
        if (handler && invokeHandler(handler, row)) return true;
      }
      if (!row) return false;
      row.click();
      return true;
    };
    if (activate()) return true;
    const collapsed = !!sidebarButton("显示侧边栏");
    if (!collapsed) return false;
    sidebarButton("显示侧边栏")?.click();
    setTimeout(() => {
      if (!activate(false)) return;
      setTimeout(() => sidebarButton("隐藏侧边栏")?.click(), 350);
    }, 120);
    return true;
  }

  function closeTab(id) {
    state.tabs = state.tabs.filter((tab) => tab.id !== id);
    save();
    render();
  }

  function moveTab(fromId, toId) {
    if (!fromId || fromId === toId) return;
    const from = state.tabs.findIndex((tab) => tab.id === fromId);
    const to = state.tabs.findIndex((tab) => tab.id === toId);
    if (from < 0 || to < 0) return;
    const [tab] = state.tabs.splice(from, 1);
    state.tabs.splice(to, 0, tab);
    save();
    state.renderKey = "";
    render();
  }

  function render() {
    const host = document.getElementById("codex-chrome-tabs");
    if (!host) return;
    const nextKey = JSON.stringify([state.currentId, state.tabs.map((tab) => [tab.id, tab.title, tab.project, !!tab.attention, !!tab.running])]);
    if (nextKey === state.renderKey) return;
    state.renderKey = nextKey;
    const existing = new Map([...host.children].map((item) => [item.dataset.codexTabId, item]));
    const fragment = document.createDocumentFragment();
    for (const tab of state.tabs) {
      let item = existing.get(tab.id);
      if (!item) {
        item = document.createElement("div");
        item.dataset.codexTabId = tab.id;
        item.draggable = true;
        item.innerHTML = '<span class="codex-chrome-tab-status" title="会话处理中或待读"></span><div class="codex-chrome-tab-copy"><span class="codex-chrome-tab-title"></span><span class="codex-chrome-tab-project"></span></div><button class="codex-chrome-tab-close" type="button" title="从标签栏移除" aria-label="从标签栏移除">×</button>';
        item.addEventListener("click", () => {
          if (state.suppressClick) return;
          switchTo(item.dataset.codexTabId);
        });
        item.addEventListener("dragstart", (event) => {
          state.draggedId = item.dataset.codexTabId;
          state.suppressClick = true;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", state.draggedId);
        });
        item.addEventListener("dragover", (event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        });
        item.addEventListener("drop", (event) => {
          event.preventDefault();
          moveTab(state.draggedId, item.dataset.codexTabId);
        });
        item.addEventListener("dragend", () => {
          state.draggedId = "";
          setTimeout(() => { state.suppressClick = false; }, 0);
        });
        item.querySelector(".codex-chrome-tab-close").addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          closeTab(item.dataset.codexTabId);
        });
      }
      item.className = `codex-chrome-tab${tab.id === state.currentId ? " active" : ""}${tab.attention ? " attention" : ""}${tab.running ? " running" : ""}`;
      item.title = `${tab.title}\n${tab.project}${tab.running ? "\n进行中" : tab.attention ? "\n待读" : ""}`;
      item.querySelector(".codex-chrome-tab-title").textContent = tab.title;
      item.querySelector(".codex-chrome-tab-project").textContent = tab.project;
      fragment.appendChild(item);
    }
    // Reordering existing nodes preserves focus, hover and compositing state.
    host.appendChild(fragment);
    for (const [id, item] of existing) if (!state.tabs.some((tab) => tab.id === id)) item.remove();
  }

  function mount() {
    let style = document.getElementById("codex-chrome-tabs-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "codex-chrome-tabs-style";
      style.textContent = css;
      document.head.appendChild(style);
    }
    const header = findHeader();
    if (!header) return false;
    let host = document.getElementById("codex-chrome-tabs");
    if (!host) {
      host = document.createElement("div");
      host.id = "codex-chrome-tabs";
      host.className = "no-drag";
      header.prepend(host);
      // A rebuilt header gets a fresh empty host; force its first paint.
      state.renderKey = "";
    }
    const original = [...header.children].find((child) => child !== host && child.classList.contains("text-md"));
    if (original) original.setAttribute("data-codex-tabs-original-title", "");
    return true;
  }

  function sync() {
    if (!mount()) return false;
    const active = activeConversation();
    if (!active) return render();
    const changedConversation = active.id !== state.currentId;
    state.currentId = active.id;
    const existing = state.tabs.find((tab) => tab.id === active.id);
    if (existing) {
      existing.title = active.title;
      existing.project = active.project;
    } else if (changedConversation || !state.tabs.length) {
      state.tabs.push(active);
    }
    for (const tab of state.tabs) {
      const row = [...document.querySelectorAll("[data-app-action-sidebar-thread-id]")]
        .find((item) => item.getAttribute("data-app-action-sidebar-thread-id") === tab.id);
      const handler = rowHandler(row);
      if (handler) state.handlers.set(tab.id, handler);
      tab.attention = !!row?.querySelector(".bg-info-solid");
      tab.running = !!row && [...row.querySelectorAll("*")].some((node) =>
        [...node.classList].some((name) => name === "animate-spin" || name.endsWith(":animate-spin"))
      );
    }
    save();
    render();
    return true;
  }

  function schedule() {
    clearTimeout(state.timer);
    state.timer = setTimeout(sync, 80);
  }

  function keepMounted() {
    if (document.getElementById("codex-chrome-tabs")) return;
    sync();
  }

  function destroy() {
    state.observer?.disconnect();
    clearTimeout(state.timer);
    clearInterval(state.mountTimer);
    document.getElementById("codex-chrome-tabs")?.remove();
    document.getElementById("codex-chrome-tabs-style")?.remove();
    document.querySelectorAll("[data-codex-tabs-original-title]").forEach((node) => node.removeAttribute("data-codex-tabs-original-title"));
  }

  state.tabs = load();
  window[KEY] = {
    destroy,
    sync,
    state,
    selfTest() {
      const before = state.tabs.map((tab) => tab.id);
      return new Set(before).size === before.length && state.tabs.every((tab) => tab.id && tab.title && tab.project);
    },
  };
  sync();
  state.mountTimer = setInterval(keepMounted, 300);
  state.observer = new MutationObserver((records) => {
    const host = document.getElementById("codex-chrome-tabs");
    if (host && records.every((record) => record.target === host || host.contains(record.target))) return;
    if (!host) keepMounted();
    schedule();
  });
  state.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-app-action-sidebar-thread-selected", "data-app-action-sidebar-thread-title"] });
})();
