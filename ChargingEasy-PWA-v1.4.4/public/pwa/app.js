(() => {
  "use strict";

  const DB_NAME = "charging-easy-db";
  const DB_VERSION = 1;
  const APP_VERSION = "1.4.4 PWA";
  const RECORD_STORE = "records";
  const THEME_KEY = "charging-easy-theme";
  const TOMBSTONE_KEY = "charging-easy-cloud-tombstones";
  const AUTO_SYNC_KEY = "charging-easy-auto-sync";
  const LAST_SYNC_KEY = "charging-easy-last-sync";
  const LAST_USER_KEY = "charging-easy-last-user";
  const DIRTY_KEY = "charging-easy-sync-dirty";
  const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const cloud = window.ChargingCloud;
  const page = document.getElementById("page");
  const pageTitle = document.getElementById("page-title");
  const pageEyebrow = document.getElementById("page-eyebrow");
  const headerCopy = document.querySelector(".topbar > div");
  const modalRoot = document.getElementById("modal-root");
  const toast = document.getElementById("toast");
  const accountButton = document.getElementById("account-button");
  const appShell = document.getElementById("app-shell");
  let navigationToken = 0;
  let routeAnimations = [];
  let modalCloseTimer = 0;
  const geocodeCache = new Map();

  const state = {
    route: "home",
    records: [],
    currency: localStorage.getItem("charging-easy-currency") || "¥",
    theme: ["light", "dark"].includes(localStorage.getItem(THEME_KEY)) ? localStorage.getItem(THEME_KEY) : "system",
    installPrompt: null,
    recordFilter: "all",
    recordSearch: "",
    statsPeriod: "month",
    statsReference: new Date(),
    statsCostPerKmMode: "all",
    statsTrendMetric: "total",
    session: cloud ? cloud.currentSession() : null,
    pendingEmail: "",
    pendingSession: null,
    autoSync: localStorage.getItem(AUTO_SYNC_KEY) !== "false",
    lastSync: localStorage.getItem(LAST_SYNC_KEY) || "",
    syncDirty: localStorage.getItem(DIRTY_KEY) === "true",
    syncStatus: "idle",
    syncing: false,
  };

  const icons = {
    bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 5 14h7l-1 8 8-12h-7l1-8Z"/></svg>',
    charger: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h8a2 2 0 0 1 2 2v15H5V5a2 2 0 0 1 2-2Z"/><path d="M8 7h6M11 11l-2 4h3l-1 4M17 8h2v6a2 2 0 0 0 2 2"/></svg>',
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10Z"/></svg>',
    toll: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3 5 21M16 3l3 18M12 4v3M12 11v3M12 18v2"/></svg>',
    parking: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M9 17V7h3.5a3.5 3.5 0 0 1 0 7H9M9 14h3.5"/></svg>',
    location: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.25"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .7-7.94A6 6 0 0 0 6.2 8.4 4.8 4.8 0 0 0 7 18Z"/><path d="m9 13 3-3 3 3M12 10v7"/></svg>',
    sync: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h13M14 5l3 3-3 3M20 16H7M10 13l-3 3 3 3"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M18.2 12A7 7 0 0 0 6.1 7.2L4 12M5.8 12a7 7 0 0 0 12.1 4.8L20 12"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>',
    chevronLeft: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
    chevronRight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
  };

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(RECORD_STORE)) {
          const store = db.createObjectStore(RECORD_STORE, { keyPath: "id" });
          store.createIndex("date", "date");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function recordKind(record) {
    return ["charge", "toll", "parking"].includes(record.kind) ? record.kind : "charge";
  }

  function normalizeRecord(record) {
    const kind = recordKind(record);
    const common = {
      ...record,
      id: typeof record.id === "string" && record.id ? record.id : crypto.randomUUID(),
      kind,
      date: new Date(record.date).toISOString(),
      cost: Math.max(0, Number(record.cost || 0)),
      note: String(record.note || "").slice(0, 300),
      createdAt: record.createdAt || new Date().toISOString(),
      updatedAt: record.updatedAt || record.createdAt || record.date || new Date().toISOString(),
    };

    if (kind === "charge") {
      const chargeType = ["home", "public", "other"].includes(record.chargeType)
        ? record.chargeType
        : (["home", "public", "other"].includes(record.type) ? record.type : "other");
      return {
        ...common,
        type: chargeType,
        chargeType,
        energy: Math.max(0, Number(record.energy || 0)),
        odometer: Math.max(0, Number(record.odometer || 0)),
        distance: Math.max(0, Number(record.distance || 0)),
        startSoc: record.startSoc == null || record.startSoc === "" ? null : Number(record.startSoc),
        endSoc: record.endSoc == null || record.endSoc === "" ? null : Number(record.endSoc),
        city: String(record.city || "").slice(0, 30),
        place: String(record.place || record.location || "").slice(0, 80),
        location: String(record.location || record.place || "").slice(0, 80),
        latitude: record.latitude == null ? null : Number(record.latitude),
        longitude: record.longitude == null ? null : Number(record.longitude),
      };
    }

    if (kind === "toll") {
      return {
        ...common,
        originCity: String(record.originCity || record.city || "").slice(0, 30),
        destinationCity: String(record.destinationCity || "").slice(0, 30),
        route: String(record.route || record.place || "").slice(0, 80),
      };
    }

    return {
      ...common,
      city: String(record.city || "").slice(0, 30),
      place: String(record.place || record.location || "").slice(0, 80),
    };
  }

  async function getAllRecords() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(RECORD_STORE, "readonly").objectStore(RECORD_STORE).getAll();
      request.onsuccess = () => {
        db.close();
        try {
          resolve(request.result.map(normalizeRecord).sort((a, b) => new Date(b.date) - new Date(a.date)));
        } catch (error) {
          reject(error);
        }
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  }

  async function saveRecord(record) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(RECORD_STORE, "readwrite").objectStore(RECORD_STORE).put(record);
      request.onsuccess = () => {
        db.close();
        resolve(record);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  }

  async function deleteRecord(id, trackDeletion) {
    if (trackDeletion !== false) addTombstone(id);
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(RECORD_STORE, "readwrite").objectStore(RECORD_STORE).delete(id);
      request.onsuccess = () => {
        db.close();
        resolve();
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  }

  async function clearRecords(trackDeletions) {
    if (trackDeletions !== false) state.records.forEach((record) => addTombstone(record.id));
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(RECORD_STORE, "readwrite").objectStore(RECORD_STORE).clear();
      request.onsuccess = () => {
        db.close();
        resolve();
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  }

  function recalculateDistances(records) {
    const normalized = records.map(normalizeRecord);
    const charges = normalized
      .filter((record) => record.kind === "charge")
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    charges.forEach((record, index) => {
      record.distance = index === 0
        ? 0
        : Math.max(0, Number(record.odometer) - Number(charges[index - 1].odometer));
    });

    return normalized;
  }

  async function recalculateAndSave(records, markAsChanged) {
    const normalized = recalculateDistances(records);

    await Promise.all(normalized.map(saveRecord));
    state.records = await getAllRecords();
    if (markAsChanged !== false) markSyncDirty();
  }

  async function replaceLocalRecords(records) {
    const normalized = recalculateDistances(records);
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(RECORD_STORE, "readwrite");
      const store = transaction.objectStore(RECORD_STORE);
      store.clear();
      normalized.forEach((record) => store.put(record));
      transaction.oncomplete = async () => {
        db.close();
        state.records = await getAllRecords();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    });
  }

  function hasOdometerConflict(records) {
    const charges = records
      .map(normalizeRecord)
      .filter((record) => record.kind === "charge")
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    return charges.some((record, index) => index > 0 && Number(record.odometer) < Number(charges[index - 1].odometer));
  }

  function escapeHTML(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function number(value, digits) {
    const precision = digits == null ? 1 : digits;
    return Number(value || 0).toLocaleString("zh-CN", {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
  }

  function money(value) {
    return state.currency + number(value, 2);
  }

  function sameMonth(date, reference) {
    const value = new Date(date);
    const target = reference || new Date();
    return value.getFullYear() === target.getFullYear() && value.getMonth() === target.getMonth();
  }

  function sameYear(date, reference) {
    return new Date(date).getFullYear() === (reference || new Date()).getFullYear();
  }

  function monthRecords(reference) {
    const target = reference || new Date();
    return state.records.filter((record) => sameMonth(record.date, target));
  }

  function summary(records) {
    const charges = records.filter((record) => record.kind === "charge");
    const measured = charges.filter((record) => Number(record.distance) > 0);
    const totalEnergy = charges.reduce((sum, record) => sum + Number(record.energy || 0), 0);
    const chargeCost = charges.reduce((sum, record) => sum + Number(record.cost || 0), 0);
    const tollCost = records.filter((record) => record.kind === "toll").reduce((sum, record) => sum + Number(record.cost || 0), 0);
    const parkingCost = records.filter((record) => record.kind === "parking").reduce((sum, record) => sum + Number(record.cost || 0), 0);
    const totalDistance = charges.reduce((sum, record) => sum + Number(record.distance || 0), 0);
    const measuredEnergy = measured.reduce((sum, record) => sum + Number(record.energy || 0), 0);
    const measuredCost = measured.reduce((sum, record) => sum + Number(record.cost || 0), 0);
    return {
      count: records.length,
      chargeCount: charges.length,
      totalEnergy,
      chargeCost,
      tollCost,
      parkingCost,
      totalCost: chargeCost + tollCost + parkingCost,
      totalDistance,
      unitPrice: totalEnergy > 0 ? chargeCost / totalEnergy : 0,
      costPerKm: totalDistance > 0 ? (chargeCost + tollCost + parkingCost) / totalDistance : null,
      chargeCostPerKm: totalDistance > 0 ? chargeCost / totalDistance : null,
      energyPer100: totalDistance > 0 ? (measuredEnergy / totalDistance) * 100 : null,
      costPer100: totalDistance > 0 ? (measuredCost / totalDistance) * 100 : null,
    };
  }

  function previousMonth(date) {
    const value = date || new Date();
    return new Date(value.getFullYear(), value.getMonth() - 1, 1);
  }

  function formatMonth(date) {
    return date.getFullYear() + "年" + (date.getMonth() + 1) + "月";
  }

  function formatYear(date) {
    return date.getFullYear() + "年";
  }

  function longDate(date) {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(date));
  }

  function shortDate(date) {
    return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(date));
  }

  function toDateTimeLocal(date) {
    const value = date || new Date();
    const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function chargeTypeLabel(type) {
    if (type === "home") return "家庭充电";
    if (type === "public") return "公共快充";
    return "其他充电";
  }

  function recordLabel(record) {
    if (record.kind === "toll") return "高速费用";
    if (record.kind === "parking") return "停车费用";
    return chargeTypeLabel(record.chargeType || record.type);
  }

  function recordIcon(record) {
    if (record.kind === "toll") return icons.toll;
    if (record.kind === "parking") return icons.parking;
    return record.chargeType === "home" || record.type === "home" ? icons.home : icons.bolt;
  }

  function locationLines(record) {
    if (record.kind === "toll") {
      const routeCities = [record.originCity, record.destinationCity].filter(Boolean).join(" → ");
      return {
        primary: routeCities || "未填写路线",
        secondary: record.route || "高速通行费",
      };
    }
    return {
      primary: record.city || "未填写城市",
      secondary: record.place || (record.kind === "parking" ? "未填写停车地点" : "未填写充电地点"),
    };
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("is-visible"), 2200);
  }

  function readTombstones() {
    try {
      const items = JSON.parse(localStorage.getItem(TOMBSTONE_KEY) || "[]");
      return Array.isArray(items) ? items.filter((item) => item && item.id && item.updatedAt) : [];
    } catch {
      return [];
    }
  }

  function writeTombstones(items) {
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(items));
  }

  function addTombstone(id) {
    const items = readTombstones().filter((item) => item.id !== id);
    items.push({ id, updatedAt: new Date().toISOString() });
    writeTombstones(items);
    markSyncDirty();
  }

  function markSyncDirty() {
    state.syncDirty = true;
    localStorage.setItem(DIRTY_KEY, "true");
    updateAccountButton();
    scheduleAutoSync();
  }

  function clearSyncDirty() {
    state.syncDirty = false;
    localStorage.removeItem(DIRTY_KEY);
  }

  function currentUser() {
    return state.session && state.session.user ? state.session.user : null;
  }

  function accountAgeDays(user) {
    const registeredAt = user && (user.created_at || user.email_confirmed_at || user.confirmed_at);
    const registeredTime = registeredAt ? new Date(registeredAt).getTime() : NaN;
    if (!Number.isFinite(registeredTime)) return null;
    return Math.max(1, Math.floor((Date.now() - registeredTime) / 86400000) + 1);
  }

  function lifetimeChargeCount() {
    return state.records.filter((record) => recordKind(record) === "charge").length;
  }

  function syncTimeLabel() {
    if (!state.lastSync) return "尚未同步";
    const date = new Date(state.lastSync);
    if (Number.isNaN(date.getTime())) return "尚未同步";
    const now = new Date();
    if (now.toDateString() === date.toDateString()) {
      return "今天 " + date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    }
    return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) + " " + date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function syncStatusLabel() {
    if (!currentUser()) return "未登录";
    if (state.syncing) return "正在同步";
    if (!navigator.onLine) return "离线，稍后同步";
    if (state.syncStatus === "setup") return "等待初始化云端数据库";
    if (state.syncStatus === "error") return "同步失败，点击重试";
    if (state.syncDirty) return "有数据等待同步";
    return state.lastSync ? "已同步" : "等待首次同步";
  }

  function updateAccountButton() {
    if (!accountButton) return;
    accountButton.classList.toggle("is-authenticated", Boolean(currentUser()));
    accountButton.classList.toggle("is-syncing", state.syncing);
    accountButton.classList.toggle("has-sync-error", state.syncStatus === "error" || state.syncStatus === "setup");
    accountButton.setAttribute("aria-label", currentUser() ? "账户，" + syncStatusLabel() : "登录并开启云端同步");
  }

  function scheduleAutoSync(delay) {
    clearTimeout(scheduleAutoSync.timer);
    if (!state.autoSync || !currentUser() || !navigator.onLine || state.syncing) return;
    scheduleAutoSync.timer = setTimeout(() => syncNow(true), delay == null ? 1000 : delay);
  }

  function isCloudSetupError(error) {
    const message = String(error && error.message || "").toLowerCase();
    return message.includes("charging_records") || message.includes("schema cache") || message.includes("relation");
  }

  async function syncNow(silent) {
    if (!currentUser()) {
      if (!silent) openAccountPopover("login");
      return false;
    }
    if (!navigator.onLine) {
      state.syncStatus = "offline";
      updateAccountButton();
      if (!silent) showToast("当前离线，恢复网络后会自动同步");
      if (state.route === "settings") renderSettings();
      return false;
    }
    if (state.syncing) return false;

    state.syncing = true;
    state.syncStatus = "syncing";
    updateAccountButton();
    if (state.route === "settings") renderSettings();
    try {
      const validSession = await cloud.ensureSession();
      if (!validSession) throw new Error("登录状态已失效，请重新登录");
      state.session = validSession;
      const result = await cloud.sync(state.records, readTombstones());
      await replaceLocalRecords(result.records);
      writeTombstones(result.tombstones);
      state.lastSync = new Date().toISOString();
      localStorage.setItem(LAST_SYNC_KEY, state.lastSync);
      if (currentUser()) localStorage.setItem(LAST_USER_KEY, currentUser().id);
      clearSyncDirty();
      state.syncStatus = "success";
      if (!silent) showToast("云端同步完成");
      return true;
    } catch (error) {
      console.error("Cloud sync:", error);
      if (error && error.status === 401) {
        state.session = null;
        state.syncStatus = "error";
        showToast("登录状态已失效，请重新登录");
      } else if (isCloudSetupError(error)) {
        state.syncStatus = "setup";
        if (!silent) showToast("请先初始化 Supabase 数据表");
      } else {
        state.syncStatus = "error";
        if (!silent) showToast("同步失败，本机数据不受影响");
      }
      return false;
    } finally {
      state.syncing = false;
      updateAccountButton();
      if (state.route === "settings") renderSettings();
      if (modalRoot.querySelector(".account-layer") && currentUser()) openAccountPopover("account");
    }
  }

  function resolvedTheme() {
    return state.theme === "system" ? (systemThemeQuery.matches ? "dark" : "light") : state.theme;
  }

  function applyTheme(theme, persist) {
    state.theme = ["light", "dark"].includes(theme) ? theme : "system";
    document.documentElement.dataset.theme = state.theme;
    document.querySelector('meta[name="theme-color"]').setAttribute("content", resolvedTheme() === "dark" ? "#000000" : "#F7F7F8");
    if (persist) localStorage.setItem(THEME_KEY, state.theme);
  }

  function setHeader(title, eyebrow) {
    pageTitle.textContent = title;
    pageEyebrow.textContent = eyebrow;
  }

  function navRoute(route) {
    if (route === "about") return "settings";
    return route.startsWith("add-") ? "add" : route;
  }

  function updateTabs(route) {
    const activeRoute = navRoute(route || state.route);
    document.querySelectorAll(".tab").forEach((tab) => {
      const active = tab.dataset.route === activeRoute;
      tab.classList.toggle("is-active", active);
      if (active) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
  }

  function cancelRouteAnimations() {
    routeAnimations.forEach((animation) => animation.cancel());
    routeAnimations = [];
  }

  function commitRoute(route) {
    state.route = route;
    updateTabs(route);
    window.scrollTo({ top: 0, behavior: "auto" });
    render();
  }

  function animateRoute(route) {
    const token = ++navigationToken;

    cancelRouteAnimations();
    if (reducedMotionQuery.matches || !page.animate) {
      commitRoute(route);
      return;
    }

    const outgoing = page.animate([
      { opacity: 1 },
      { opacity: 0 },
    ], {
      duration: 105,
      easing: "cubic-bezier(0.4, 0, 1, 1)",
      fill: "forwards",
    });
    const headerOutgoing = headerCopy.animate([
      { opacity: 1 },
      { opacity: 0 },
    ], {
      duration: 95,
      easing: "cubic-bezier(0.4, 0, 1, 1)",
      fill: "forwards",
    });
    routeAnimations = [outgoing, headerOutgoing];

    Promise.allSettled(routeAnimations.map((animation) => animation.finished)).then(() => {
      if (token !== navigationToken) return;
      cancelRouteAnimations();
      commitRoute(route);

      const incoming = page.animate([
        { opacity: 0 },
        { opacity: 1 },
      ], {
        duration: 280,
        easing: "cubic-bezier(0.2, 0.75, 0.2, 1)",
      });
      const headerIncoming = headerCopy.animate([
        { opacity: 0 },
        { opacity: 1 },
      ], {
        duration: 250,
        easing: "cubic-bezier(0.2, 0.75, 0.2, 1)",
      });
      routeAnimations = [incoming, headerIncoming];
      Promise.allSettled(routeAnimations.map((animation) => animation.finished)).then(() => {
        if (token === navigationToken) routeAnimations = [];
      });
    });
  }

  function setRoute(route) {
    if (route === "add") {
      if (modalRoot.querySelector(".add-chooser:not(.is-closing)")) {
        closeModal();
        return;
      }
      openAddChooser();
      return;
    }
    if (modalRoot.querySelector(".add-chooser:not(.is-closing), .account-layer:not(.is-closing)")) closeModal();
    if (route === state.route) return;
    animateRoute(route);
  }

  function closeModal() {
    const layer = modalRoot.firstElementChild;
    if (!layer) {
      document.body.classList.remove("modal-open");
      document.body.style.overflow = "";
      updateTabs();
      return;
    }

    window.clearTimeout(modalCloseTimer);
    if (reducedMotionQuery.matches || layer.classList.contains("is-closing")) {
      modalRoot.innerHTML = "";
      document.body.classList.remove("modal-open");
      document.body.style.overflow = "";
      updateTabs();
      return;
    }

    layer.classList.add("is-closing");
    layer.setAttribute("aria-hidden", "true");
    modalCloseTimer = window.setTimeout(() => {
      if (modalRoot.firstElementChild !== layer) return;
      modalRoot.innerHTML = "";
      document.body.classList.remove("modal-open");
      document.body.style.overflow = "";
    }, 230);
    updateTabs();
  }

  function openModal(content, options) {
    const isRecordDetail = Boolean(options && options.recordDetail);
    const dimmer = isRecordDetail ? '<div class="record-detail-dimmer" aria-hidden="true"></div>' : "";
    modalRoot.innerHTML = '<div class="modal-backdrop' + (isRecordDetail ? " record-detail-layer" : "") + '" role="presentation">' + dimmer + '<section class="modal-sheet' + (isRecordDetail ? " record-detail-sheet" : "") + '" role="dialog" aria-modal="true">' + content + "</section></div>";
    document.body.classList.add("modal-open");
    document.body.style.overflow = "hidden";
    modalRoot.querySelector(".modal-backdrop").addEventListener("click", (event) => {
      if (event.target.classList.contains("modal-backdrop")) closeModal();
    });
    modalRoot.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", closeModal));
    if (isRecordDetail) bindRecordDetailGestures();
  }

  function bindRecordDetailGestures() {
    const layer = modalRoot.querySelector(".record-detail-layer");
    const dimmer = modalRoot.querySelector(".record-detail-dimmer");
    const sheet = modalRoot.querySelector(".record-detail-sheet");
    const handle = sheet && sheet.querySelector(".modal-handle");
    const edgeZone = sheet && sheet.querySelector(".detail-edge-swipe-zone");
    if (!layer || !dimmer || !sheet || !handle || !edgeZone) return;

    let gesture = null;
    let motionFrame = 0;
    let dismissing = false;
    let settling = false;
    let touchListenersBound = false;
    let mouseListenersBound = false;

    function cancelMotion() {
      if (!motionFrame) return;
      window.cancelAnimationFrame(motionFrame);
      motionFrame = 0;
    }

    function unbindTouchListeners() {
      if (!touchListenersBound) return;
      touchListenersBound = false;
      document.removeEventListener("touchmove", onTouchMove, true);
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("touchcancel", onTouchCancel, true);
    }

    function unbindMouseListeners() {
      if (!mouseListenersBound) return;
      mouseListenersBound = false;
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("mouseup", onMouseUp, true);
    }

    function removeDetailLayer() {
      cancelMotion();
      unbindTouchListeners();
      unbindMouseListeners();
      if (modalRoot.firstElementChild !== layer) return;
      modalRoot.innerHTML = "";
      document.body.classList.remove("modal-open");
      document.body.style.overflow = "";
      updateTabs();
    }

    function prepareInteractiveMotion() {
      sheet.classList.add("is-gesture-active");
      sheet.style.animation = "none";
      sheet.style.transition = "none";
      dimmer.style.animation = "none";
      dimmer.style.transition = "none";
    }

    function applyPosition(axis, distance) {
      const size = Math.max(1, axis === "x" ? sheet.clientWidth : sheet.clientHeight);
      const progress = Math.min(1, Math.max(0, distance / size));
      sheet.style.transform = axis === "x"
        ? "translate3d(" + distance + "px, 0, 0)"
        : "translate3d(0, " + distance + "px, 0)";
      sheet.style.opacity = String(1 - progress * 0.06);
      dimmer.style.opacity = String(1 - progress);
    }

    function clearInteractiveMotion() {
      if (!modalRoot.contains(sheet)) return;
      sheet.classList.remove("is-gesture-active");
      sheet.style.transform = "";
      sheet.style.opacity = "";
      sheet.style.transition = "";
      dimmer.style.opacity = "";
      dimmer.style.transition = "";
      settling = false;
    }

    function springTo(snapshot, destination, shouldRemove) {
      cancelMotion();
      prepareInteractiveMotion();
      dismissing = shouldRemove;
      settling = !shouldRemove;

      if (reducedMotionQuery.matches) {
        applyPosition(snapshot.axis, destination);
        if (shouldRemove) removeDetailLayer();
        else clearInteractiveMotion();
        return;
      }

      const stiffness = shouldRemove ? 96 : 176;
      const damping = shouldRemove ? 19.8 : 26.4;
      const maximumDuration = shouldRemove ? 820 : 620;
      let position = snapshot.distance;
      let speed = snapshot.velocity * 1000;
      let previousTime = performance.now();
      const startedAt = previousTime;

      function step(now) {
        const deltaTime = Math.min(0.032, Math.max(0.001, (now - previousTime) / 1000));
        previousTime = now;
        const acceleration = stiffness * (destination - position) - damping * speed;
        speed += acceleration * deltaTime;
        position += speed * deltaTime;

        if (!shouldRemove && position < 0) {
          position = 0;
          speed = 0;
        }

        applyPosition(snapshot.axis, position);
        const isAtRest = Math.abs(destination - position) < 0.7 && Math.abs(speed) < 8;
        if (isAtRest || now - startedAt >= maximumDuration) {
          applyPosition(snapshot.axis, destination);
          motionFrame = 0;
          if (shouldRemove) removeDetailLayer();
          else clearInteractiveMotion();
          return;
        }
        motionFrame = window.requestAnimationFrame(step);
      }

      motionFrame = window.requestAnimationFrame(step);
    }

    function startGesture(axis, id, clientX, clientY, input) {
      if (dismissing || settling || gesture) return false;
      const startedAt = performance.now();
      gesture = {
        axis,
        id,
        input,
        startX: clientX,
        startY: clientY,
        lastAt: startedAt,
        lastDistance: 0,
        velocity: 0,
        distance: 0,
        active: false,
      };
      return true;
    }

    function updateGesture(clientX, clientY) {
      if (!gesture) return false;
      const dx = clientX - gesture.startX;
      const dy = clientY - gesture.startY;
      const primary = gesture.axis === "y" ? dy : dx;
      const cross = gesture.axis === "y" ? dx : dy;

      if (!gesture.active) {
        if (primary <= 2) return false;
        if (Math.abs(cross) > Math.abs(primary) * 1.35) return false;
        gesture.active = true;
        prepareInteractiveMotion();
      }

      const distance = Math.max(0, primary);
      const now = performance.now();
      const elapsed = Math.max(8, now - gesture.lastAt);
      const instantVelocity = (distance - gesture.lastDistance) / elapsed;
      gesture.velocity = gesture.velocity * 0.25 + instantVelocity * 0.75;
      gesture.lastAt = now;
      gesture.lastDistance = distance;
      gesture.distance = distance;
      applyPosition(gesture.axis, distance);
      return true;
    }

    function finishGesture(cancelled) {
      if (!gesture) return;
      const snapshot = { ...gesture };
      const velocity = performance.now() - gesture.lastAt > 80 ? 0 : gesture.velocity;
      snapshot.velocity = velocity;
      gesture = null;

      if (!snapshot.active) {
        return;
      }

      const size = snapshot.axis === "x" ? sheet.clientWidth : sheet.clientHeight;
      const threshold = snapshot.axis === "x" ? Math.min(88, size * 0.2) : Math.min(84, size * 0.14);
      const shouldDismiss = !cancelled && (
        (snapshot.distance >= threshold && snapshot.velocity > -0.55)
        || (snapshot.distance >= 20 && snapshot.velocity >= 0.42)
      );

      if (shouldDismiss) springTo(snapshot, Math.max(size + 56, snapshot.distance + 36), true);
      else springTo(snapshot, 0, false);
    }

    function findTouch(touchList, identifier) {
      for (let index = 0; index < touchList.length; index += 1) {
        if (touchList[index].identifier === identifier) return touchList[index];
      }
      return null;
    }

    function bindTouchListeners() {
      if (touchListenersBound) return;
      touchListenersBound = true;
      document.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
      document.addEventListener("touchend", onTouchEnd, { passive: false, capture: true });
      document.addEventListener("touchcancel", onTouchCancel, { passive: false, capture: true });
    }

    function startTouchGesture(axis, event) {
      if (event.touches.length !== 1) return;
      const touch = event.changedTouches[0];
      if (!touch || !startGesture(axis, touch.identifier, touch.clientX, touch.clientY, "touch")) return;
      if (event.cancelable) event.preventDefault();
      bindTouchListeners();
    }

    function onTouchMove(event) {
      if (!gesture || gesture.input !== "touch") return;
      const touch = findTouch(event.touches, gesture.id);
      if (!touch) return;
      if (event.cancelable) event.preventDefault();
      updateGesture(touch.clientX, touch.clientY);
    }

    function onTouchEnd(event) {
      if (!gesture || gesture.input !== "touch") return;
      const touch = findTouch(event.changedTouches, gesture.id);
      if (!touch && event.touches.length) return;
      if (event.cancelable) event.preventDefault();
      if (touch) updateGesture(touch.clientX, touch.clientY);
      unbindTouchListeners();
      finishGesture(false);
    }

    function onTouchCancel(event) {
      if (!gesture || gesture.input !== "touch") return;
      const touch = findTouch(event.changedTouches, gesture.id);
      if (!touch && event.touches.length) return;
      unbindTouchListeners();
      finishGesture(true);
    }

    function bindMouseListeners() {
      if (mouseListenersBound) return;
      mouseListenersBound = true;
      document.addEventListener("mousemove", onMouseMove, true);
      document.addEventListener("mouseup", onMouseUp, true);
    }

    function startMouseGesture(axis, event) {
      if (event.button !== 0 || !startGesture(axis, "mouse", event.clientX, event.clientY, "mouse")) return;
      event.preventDefault();
      bindMouseListeners();
    }

    function onMouseMove(event) {
      if (!gesture || gesture.input !== "mouse") return;
      event.preventDefault();
      updateGesture(event.clientX, event.clientY);
    }

    function onMouseUp(event) {
      if (!gesture || gesture.input !== "mouse") return;
      updateGesture(event.clientX, event.clientY);
      unbindMouseListeners();
      finishGesture(false);
    }

    handle.addEventListener("touchstart", (event) => startTouchGesture("y", event), { passive: false });
    edgeZone.addEventListener("touchstart", (event) => startTouchGesture("x", event), { passive: false });
    handle.addEventListener("mousedown", (event) => startMouseGesture("y", event));
    edgeZone.addEventListener("mousedown", (event) => startMouseGesture("x", event));
  }

  function accountAvatar(email) {
    return [
      '<div class="account-avatar-large">', icons.user, "</div>",
      email ? '<strong class="account-email">' + escapeHTML(email) + "</strong>" : "",
    ].join("");
  }

  function accountPopoverShell(content) {
    return [
      '<div class="account-layer" role="presentation"><section class="account-popover" role="dialog" aria-modal="true" aria-label="账户与云端同步">',
      '<button class="account-popover-close" type="button" data-close-modal aria-label="关闭">', icons.close, "</button>",
      content,
      "</section></div>",
    ].join("");
  }

  async function finishLogin(session) {
    state.session = session;
    state.pendingSession = null;
    state.syncStatus = "idle";
    markSyncDirty();
    closeModal();
    updateAccountButton();
    if (state.route === "settings") renderSettings();
    showToast("登录成功，正在同步本机数据");
    await syncNow(true);
  }

  function openAccountPopover(mode) {
    const user = currentUser();
    const view = mode || (user ? "account" : "login");
    let content = "";

    if (view === "otp") {
      content = [
        '<div class="account-popover-copy">', accountAvatar(""), '<h2>输入验证码</h2><div class="otp-delivery-note"><span>验证码已发送至</span><strong>', escapeHTML(state.pendingEmail), '</strong><small>请输入邮件中的 6 位数字</small></div></div>',
        '<form class="account-form" id="otp-form"><input class="account-field otp-field" id="account-otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="6 位验证码" aria-label="邮箱验证码" required>',
        '<button class="primary-button compact-button" id="verify-otp" type="submit">登录并同步</button></form>',
        '<div class="account-inline-actions"><button type="button" id="change-email">更换邮箱</button><button type="button" id="resend-otp">重新发送</button></div>',
      ].join("");
    } else if (view === "signout-confirm") {
      content = [
        '<div class="account-popover-copy">', accountAvatar(user && user.email), '<h2>退出当前账户？</h2><p>退出后本机记录仍会保留，但将停止云端同步。</p></div>',
        '<div class="account-confirm-actions"><button class="danger-button compact-button" id="confirm-signout" type="button">确认退出</button><button class="secondary-button compact-button" id="cancel-signout" type="button">取消</button></div>',
      ].join("");
    } else if (view === "merge-confirm") {
      const pendingUser = state.pendingSession && state.pendingSession.user;
      content = [
        '<div class="account-popover-copy">', accountAvatar(pendingUser && pendingUser.email), '<h2>合并本机记录？</h2><p>这台设备已有 ', state.records.length, " 条记录。继续后会合并到这个云端账户。</p></div>",
        '<div class="account-confirm-actions"><button class="primary-button compact-button" id="confirm-merge" type="button">合并并同步</button><button class="secondary-button compact-button" id="cancel-merge" type="button">取消登录</button></div>',
      ].join("");
    } else if (user) {
      const registeredDays = accountAgeDays(user);
      content = [
        '<div class="account-popover-copy">', accountAvatar(user.email), '<div class="cloud-connected"><i></i><span>', escapeHTML(syncStatusLabel()), "</span></div></div>",
        '<div class="account-summary"><div><span>注册天数</span><strong>', registeredDays == null ? "—" : registeredDays + " 天", '</strong></div><div><span>充电次数</span><strong>', lifetimeChargeCount(), ' 次</strong></div><div><span>云端同步</span><strong>', state.autoSync ? "自动" : "手动", '</strong></div><div><span>同步时间</span><strong>', escapeHTML(syncTimeLabel()), "</strong></div></div>",
        '<button class="secondary-button compact-button sync-button" id="popover-sync" type="button">', icons.sync, '<span>', state.syncing ? "正在同步" : "立即同步", "</span></button>",
        '<button class="account-signout" id="account-signout" type="button">退出登录</button>',
      ].join("");
    } else {
      content = [
        '<div class="account-popover-copy">', accountAvatar(""), '<h2>登录充電易</h2><p>使用邮箱验证码登录，开启安全的云端同步。</p></div>',
        '<form class="account-form" id="email-form"><input class="account-field" id="account-email" type="email" inputmode="email" autocomplete="email" placeholder="邮箱地址" aria-label="邮箱地址" required>',
        '<button class="primary-button compact-button" id="send-otp" type="submit">获取验证码</button></form>',
        '<p class="account-privacy">登录不会影响当前设备中的本地记录</p>',
      ].join("");
    }

    modalRoot.innerHTML = accountPopoverShell(content);
    modalRoot.querySelector(".account-layer").addEventListener("click", (event) => {
      if (event.target.classList.contains("account-layer")) closeModal();
    });
    modalRoot.querySelector("[data-close-modal]").addEventListener("click", closeModal);

    if (view === "otp") {
      const otpInput = document.getElementById("account-otp");
      otpInput.focus();
      document.getElementById("otp-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const token = otpInput.value.replace(/\D/g, "");
        if (token.length !== 6) {
          showToast("请输入 6 位验证码");
          return;
        }
        const button = document.getElementById("verify-otp");
        button.disabled = true;
        button.textContent = "正在验证…";
        try {
          const session = await cloud.verifyOtp(state.pendingEmail, token);
          state.session = session;
          const previousUser = localStorage.getItem(LAST_USER_KEY);
          if (previousUser && session.user && previousUser !== session.user.id && state.records.length) {
            state.pendingSession = session;
            openAccountPopover("merge-confirm");
          } else {
            await finishLogin(session);
          }
        } catch (error) {
          console.error("OTP verify:", error);
          button.disabled = false;
          button.textContent = "登录并同步";
          showToast("验证码无效或已过期");
        }
      });
      document.getElementById("change-email").addEventListener("click", () => openAccountPopover("login"));
      document.getElementById("resend-otp").addEventListener("click", async (event) => {
        event.currentTarget.disabled = true;
        try {
          await cloud.requestOtp(state.pendingEmail);
          showToast("验证码已重新发送");
        } catch {
          showToast("发送过于频繁，请稍后再试");
        } finally {
          event.currentTarget.disabled = false;
        }
      });
    } else if (view === "signout-confirm") {
      document.getElementById("cancel-signout").addEventListener("click", () => openAccountPopover("account"));
      document.getElementById("confirm-signout").addEventListener("click", async () => {
        await cloud.signOut();
        state.session = null;
        state.syncStatus = "idle";
        closeModal();
        updateAccountButton();
        if (state.route === "settings") renderSettings();
        showToast("已退出登录，本机数据已保留");
      });
    } else if (view === "merge-confirm") {
      document.getElementById("confirm-merge").addEventListener("click", () => finishLogin(state.pendingSession));
      document.getElementById("cancel-merge").addEventListener("click", async () => {
        await cloud.signOut();
        state.session = null;
        state.pendingSession = null;
        openAccountPopover("login");
      });
    } else if (user) {
      document.getElementById("popover-sync").addEventListener("click", () => syncNow(false));
      document.getElementById("account-signout").addEventListener("click", () => openAccountPopover("signout-confirm"));
    } else {
      const emailInput = document.getElementById("account-email");
      document.getElementById("email-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const email = emailInput.value.trim().toLowerCase();
        if (!email || !emailInput.checkValidity()) {
          showToast("请输入有效的邮箱地址");
          return;
        }
        const button = document.getElementById("send-otp");
        button.disabled = true;
        button.textContent = "正在发送…";
        try {
          await cloud.requestOtp(email);
          state.pendingEmail = email;
          openAccountPopover("otp");
          showToast("验证码已发送");
        } catch (error) {
          console.error("OTP request:", error);
          button.disabled = false;
          button.textContent = "获取验证码";
          showToast("暂时无法发送验证码，请稍后重试");
        }
      });
    }
  }

  function openAddChooser() {
    updateTabs("add");
    modalRoot.innerHTML = [
      '<div class="modal-backdrop add-chooser" role="presentation">',
      '<section class="action-panel" role="dialog" aria-modal="true" aria-labelledby="add-title">',
      '<header class="action-header"><h2 id="add-title">新增记录</h2><p>选择要记录的费用类型</p></header>',
      '<button class="action-row is-primary" data-kind="charge"><span class="action-icon">', icons.bolt, '</span><span><strong>充电记录</strong><small>记录电量、费用、里程与能耗</small></span><b>›</b></button>',
      '<button class="action-row" data-kind="toll"><span class="action-icon">', icons.toll, '</span><span><strong>高速费用</strong><small>记录通行费与行驶路线</small></span><b>›</b></button>',
      '<button class="action-row" data-kind="parking"><span class="action-icon">', icons.parking, '</span><span><strong>停车费用</strong><small>记录停车金额与具体地点</small></span><b>›</b></button>',
      '<button class="action-cancel" data-close-modal>取消</button>',
      "</section></div>",
    ].join("");
    document.body.classList.add("modal-open");
    document.body.style.overflow = "hidden";
    modalRoot.querySelector(".add-chooser").addEventListener("click", (event) => {
      if (event.target.classList.contains("add-chooser")) closeModal();
    });
    modalRoot.querySelector("[data-close-modal]").addEventListener("click", closeModal);
    modalRoot.querySelectorAll("[data-kind]").forEach((button) => {
      button.addEventListener("click", () => {
        const kind = button.dataset.kind;
        closeModal();
        setRoute(kind === "charge" ? "add-charge" : "add-" + kind);
      });
    });
  }

  function costBreakdown(totals) {
    return [
      '<div class="cost-breakdown">',
      '<div><span><i class="dot charge"></i>充电</span><strong>', money(totals.chargeCost), "</strong></div>",
      '<div><span><i class="dot toll"></i>高速</span><strong>', money(totals.tollCost), "</strong></div>",
      '<div><span><i class="dot parking"></i>停车</span><strong>', money(totals.parkingCost), "</strong></div>",
      "</div>",
    ].join("");
  }

  function recordRow(record) {
    const location = locationLines(record);
    const primaryValue = record.kind === "charge" ? number(record.energy) + " kWh" : money(record.cost);
    const secondaryValue = record.kind === "charge" ? money(record.cost) : "";
    return [
      '<button type="button" class="record-row record-button" data-record-id="', escapeHTML(record.id), '">',
      '<span class="record-icon kind-', record.kind, '">', recordIcon(record), "</span>",
      '<div class="record-copy"><strong>', shortDate(record.date), "</strong><span>", escapeHTML(recordLabel(record)), "</span></div>",
      '<div class="record-location"><strong>', escapeHTML(location.primary), "</strong><span>", escapeHTML(location.secondary), "</span></div>",
      '<div class="record-values"><strong>', primaryValue, "</strong><span>", secondaryValue, "</span></div>",
      "</button>",
    ].join("");
  }

  function wireRecordButtons(container) {
    container.querySelectorAll("[data-record-id]").forEach((button) => {
      button.addEventListener("click", () => openRecordDetail(button.dataset.recordId));
    });
    container.querySelectorAll("[data-go]").forEach((button) => {
      button.addEventListener("click", () => setRoute(button.dataset.go));
    });
  }

  function renderHome() {
    const current = monthRecords();
    const totals = summary(current);
    const previous = summary(monthRecords(previousMonth()));
    const difference = totals.totalCost - previous.totalCost;
    const comparison = previous.count
      ? "较上月" + (difference >= 0 ? "增加 " : "减少 ") + money(Math.abs(difference))
      : (totals.count ? "本月共记录 " + totals.count + " 笔费用" : "从第一笔用车费用开始记录");

    setHeader("充電易", formatMonth(new Date()));
    page.innerHTML = [
      '<div class="stack">',
      '<section class="card hero-card simple-hero"><div class="hero-main"><p class="hero-label">本月用车支出</p><p class="hero-value">', money(totals.totalCost), '</p><p class="comparison">', comparison, "</p></div>",
      costBreakdown(totals), "</section>",
      '<section class="quick-metrics">',
      '<div class="card quick-metric"><span class="flat-metric-icon">', icons.toll, '</span><div><span>本月行驶</span><strong>', number(totals.totalDistance, 0), " km</strong></div></div>",
      '<div class="card quick-metric"><span class="flat-metric-icon">', icons.bolt, '</span><div><span>平均能耗</span><strong>', totals.energyPer100 == null ? "—" : number(totals.energyPer100) + " kWh/100km", "</strong></div></div>",
      "</section>",
      state.records.length
        ? [
            '<section><div class="section-heading"><h2>最近记录</h2><button class="text-button" data-go="records">查看全部 ›</button></div>',
            '<div class="card list-card">', state.records.slice(0, 3).map(recordRow).join(""), "</div></section>",
          ].join("")
        : [
            '<section class="card empty-state"><span class="empty-icon">', icons.bolt, '</span><h2>开始记录第一笔费用</h2>',
            '<p>充电、高速和停车费用，都可以在这里统一管理。</p><button class="primary-button" data-go="add">新增记录</button></section>',
          ].join(""),
      "</div>",
    ].join("");
    wireRecordButtons(page);
  }

  function renderRecords() {
    setHeader("充电记录", "搜索、筛选和管理历史数据");
    const query = state.recordSearch.trim().toLowerCase();
    const filtered = state.records.filter((record) => {
      const filterMatch = state.recordFilter === "all" || record.kind === state.recordFilter;
      const location = locationLines(record);
      const searchable = [
        recordLabel(record),
        location.primary,
        location.secondary,
        record.note,
      ].join(" ").toLowerCase();
      return filterMatch && (!query || searchable.includes(query));
    });
    const current = summary(monthRecords());
    const groups = new Map();
    filtered.forEach((record) => {
      const date = new Date(record.date);
      const key = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    });

    const groupMarkup = filtered.length
      ? [...groups.entries()].map((entry) => {
          const parts = entry[0].split("-");
          return '<h2 class="month-heading">' + parts[0] + "年" + Number(parts[1]) + '月</h2><section class="card list-card">' + entry[1].map(recordRow).join("") + "</section>";
        }).join("")
      : [
          '<section class="card empty-state"><span class="empty-icon">', icons.bolt, '</span><h2>没有匹配的记录</h2>',
          '<p>试试更换筛选条件，或添加一笔新的费用。</p><button class="primary-button" data-go="add">新增记录</button></section>',
        ].join("");

    page.innerHTML = [
      '<div class="stack">',
      '<section class="toolbar-stack"><label class="search-shell"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/></svg><input id="record-search" type="search" value="', escapeHTML(state.recordSearch), '" placeholder="搜索记录" aria-label="搜索记录"></label>',
      '<div class="segmented four" id="record-filter">',
      '<button class="', state.recordFilter === "all" ? "is-active" : "", '" data-filter="all">全部</button>',
      '<button class="', state.recordFilter === "charge" ? "is-active" : "", '" data-filter="charge">充电</button>',
      '<button class="', state.recordFilter === "toll" ? "is-active" : "", '" data-filter="toll">高速</button>',
      '<button class="', state.recordFilter === "parking" ? "is-active" : "", '" data-filter="parking">停车</button>',
      "</div></section>",
      '<section class="card"><div class="metric-grid">',
      '<div class="metric"><strong>', current.chargeCount, ' 次</strong><span>本月充电</span></div>',
      '<div class="metric"><strong>', number(current.totalEnergy), ' kWh</strong><span>本月电量</span></div>',
      '<div class="metric"><strong>', money(current.chargeCost), '</strong><span>本月充电费</span></div>',
      "</div></section>",
      '<p class="result-count">共 ', filtered.length, " 条记录</p>",
      groupMarkup,
      "</div>",
    ].join("");

    document.getElementById("record-filter").querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        state.recordFilter = button.dataset.filter;
        renderRecords();
      });
    });

    const search = document.getElementById("record-search");
    let composing = false;
    search.addEventListener("compositionstart", () => { composing = true; });
    search.addEventListener("compositionend", () => {
      composing = false;
      state.recordSearch = search.value;
      renderRecords();
      document.getElementById("record-search").focus();
    });
    search.addEventListener("input", () => {
      if (composing) return;
      state.recordSearch = search.value;
      const position = search.selectionStart;
      renderRecords();
      const next = document.getElementById("record-search");
      next.focus();
      next.setSelectionRange(position, position);
    });
    wireRecordButtons(page);
  }

  function previousChargeBefore(date, excludedId) {
    return state.records.find((record) => (
      record.kind === "charge" &&
      record.id !== excludedId &&
      new Date(record.date) < date
    ));
  }

  function preferredGeocodeLanguage() {
    const language = String(navigator.language || "zh-CN");
    if (/^zh-(TW|HK|MO)|^zh-Hant/i.test(language)) return "zh-TW,zh,en";
    if (/^zh/i.test(language)) return "zh-CN,zh,en";
    return language + ",zh,en";
  }

  function cleanAddressPart(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeGeocodeResult(payload) {
    if (payload && payload.city && payload.place) {
      return {
        city: cleanAddressPart(payload.city).slice(0, 30),
        place: cleanAddressPart(payload.place).slice(0, 80),
      };
    }

    const geocoding = payload && payload.features && payload.features[0]
      && payload.features[0].properties && payload.features[0].properties.geocoding;
    if (!geocoding) return null;

    const city = cleanAddressPart(
      geocoding.city || geocoding.county || geocoding.state
    );
    const district = cleanAddressPart(geocoding.district || geocoding.locality);
    const road = cleanAddressPart(
      geocoding.street || (geocoding.type === "street" ? geocoding.name : "")
    );
    const place = [...new Set([district, road].filter((part) => part && part !== city))].join(" ");
    if (!city || !place) return null;
    return { city: city.slice(0, 30), place: place.slice(0, 80) };
  }

  function geocodeCacheKey(latitude, longitude) {
    return Number(latitude).toFixed(4) + "," + Number(longitude).toFixed(4);
  }

  function isMainlandCoordinate(latitude, longitude) {
    const inChinaBounds = latitude >= 18 && latitude <= 53.6
      && longitude >= 73.5 && longitude <= 134.8;
    const inTaiwan = latitude >= 21.5 && latitude <= 25.6
      && longitude >= 119.2 && longitude <= 122.2;
    return inChinaBounds && !inTaiwan;
  }

  async function fetchWithTimeout(url, options, timeout) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
    }
  }

  function saveGeocodeCache(key, value) {
    geocodeCache.delete(key);
    geocodeCache.set(key, { ...value, cachedAt: Date.now() });
    while (geocodeCache.size > 24) geocodeCache.delete(geocodeCache.keys().next().value);
  }

  async function reverseGeocode(latitude, longitude) {
    const cacheKey = geocodeCacheKey(latitude, longitude);
    const cached = geocodeCache.get(cacheKey);
    if (cached && Date.now() - Number(cached.cachedAt || 0) < 60 * 60 * 1000) {
      return { city: cached.city, place: cached.place };
    }

    const language = preferredGeocodeLanguage();
    const isMainland = isMainlandCoordinate(latitude, longitude);
    let result = null;
    let proxyError = null;
    if (cloud && cloud.reverseGeocode) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 9000);
      try {
        result = normalizeGeocodeResult(await cloud.reverseGeocode(
          latitude,
          longitude,
          language,
          controller.signal
        ));
      } catch (error) {
        proxyError = error;
        console.warn("Reverse geocoding proxy:", error);
      } finally {
        window.clearTimeout(timer);
      }
    }

    if (!result && isMainland) {
      const errorCode = proxyError && proxyError.payload && proxyError.payload.code;
      if (errorCode === "AMAP_NOT_CONFIGURED") {
        throw new Error("大陆地址服务尚未配置，请先设置高德地图 Key");
      }
      if (errorCode === "ADDRESS_TIMEOUT" || (proxyError && proxyError.name === "AbortError")) {
        throw new Error("地址识别超时，请重试或手动填写");
      }
      throw new Error("大陆地址服务暂时不可用，请手动填写");
    }

    if (!result) {
      const query = new URLSearchParams({
        format: "geocodejson",
        addressdetails: "1",
        layer: "address",
        zoom: "17",
        lat: String(latitude),
        lon: String(longitude),
        "accept-language": language,
      });
      let response;
      try {
        response = await fetchWithTimeout("https://nominatim.openstreetmap.org/reverse?" + query, {
          headers: { Accept: "application/geocode+json, application/json" },
          referrerPolicy: "strict-origin-when-cross-origin",
        }, 8000);
      } catch (error) {
        if (error && error.name === "AbortError") {
          throw new Error("地址识别超时，请重试或手动填写");
        }
        throw error;
      }
      if (!response.ok) throw new Error("地址服务暂时不可用");
      result = normalizeGeocodeResult(await response.json());
    }

    if (!result) throw new Error("当前位置附近没有可识别的道路");
    saveGeocodeCache(cacheKey, result);
    return result;
  }

  function renderChargeForm() {
    setHeader("记录充电", "记录电量、费用、里程与位置");
    page.innerHTML = [
      '<form id="charge-form" class="stack" novalidate>',
      '<div class="segmented" id="charge-type"><button type="button" class="is-active" data-type="home">家充</button><button type="button" data-type="public">公共快充</button><button type="button" data-type="other">其他</button></div>',
      '<section class="card form-card">',
      '<label class="form-row form-row-inline"><span class="form-label">充电量</span><span class="inline-value"><input id="energy" type="number" min="0" step="0.1" inputmode="decimal" placeholder="0.0" required><em>kWh</em></span></label>',
      '<label class="form-row form-row-inline"><span class="form-label">充电费用</span><span class="inline-value"><em>', state.currency, '</em><input id="cost" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" required></span></label>',
      '<label class="form-row form-row-inline"><span class="form-label">当前里程</span><span class="inline-value"><input id="odometer" type="number" min="0" step="1" inputmode="decimal" placeholder="0" required><em>km</em></span></label>',
      '<label class="form-row form-row-inline"><span class="form-label">充电日期</span><input class="inline-input date-input" id="date" type="datetime-local" value="', toDateTimeLocal(), '" required></label>',
      "</section>",
      '<section class="card form-card"><h2 class="form-section-title">充电位置</h2>',
      '<label class="form-row form-row-inline"><span class="form-label">城市</span><input class="inline-input" id="city" maxlength="30" placeholder="例如：台北市" required></label>',
      '<label class="form-row form-row-inline"><span class="form-label">具体地址</span><input class="inline-input" id="place" maxlength="80" placeholder="例如：信义区市府路" required></label>',
      '<button class="location-button" type="button" id="use-location"><span class="location-button-icon">', icons.location, '</span><span class="location-button-label">使用当前位置</span></button></section>',
      '<section class="calculation-strip"><div><span>电价</span><strong id="unit-price">—</strong></div><div><span>距上次</span><strong id="distance">首次记录</strong></div><div><span>平均能耗</span><strong id="consumption">—</strong></div></section>',
      '<details class="card optional-card"><summary>更多信息</summary><div class="optional-content"><div class="two-columns"><label><span class="form-label">充电前 %</span><input class="field" id="start-soc" type="number" min="0" max="100" inputmode="numeric"></label><label><span class="form-label">充电后 %</span><input class="field" id="end-soc" type="number" min="0" max="100" inputmode="numeric"></label></div><label><span class="form-label">备注（可选）</span><textarea class="field" id="note" maxlength="300"></textarea></label></div></details>',
      '<button class="primary-button" type="submit">保存充电记录</button>',
      "</form>",
    ].join("");
    wireChargeForm();
  }

  function wireChargeForm() {
    const form = document.getElementById("charge-form");
    let selectedType = "home";
    document.querySelectorAll("#charge-type button").forEach((button) => {
      button.addEventListener("click", () => {
        selectedType = button.dataset.type;
        document.querySelectorAll("#charge-type button").forEach((item) => item.classList.toggle("is-active", item === button));
      });
    });

    const calculate = () => {
      const energy = Number(document.getElementById("energy").value);
      const cost = Number(document.getElementById("cost").value);
      const odometer = Number(document.getElementById("odometer").value);
      const date = new Date(document.getElementById("date").value);
      const previous = previousChargeBefore(date);
      const distance = previous && odometer >= Number(previous.odometer) ? odometer - Number(previous.odometer) : null;
      document.getElementById("unit-price").textContent = energy > 0 ? money(cost / energy) + "/kWh" : "—";
      document.getElementById("distance").textContent = distance == null ? "首次记录" : number(distance, 0) + " km";
      document.getElementById("consumption").textContent = distance > 0 && energy > 0 ? number((energy / distance) * 100) + " kWh/100km" : "—";
    };
    ["energy", "cost", "odometer", "date"].forEach((id) => document.getElementById(id).addEventListener("input", calculate));

    document.getElementById("use-location").addEventListener("click", () => {
      const locationButton = document.getElementById("use-location");
      if (!navigator.geolocation) {
        showToast("当前设备不支持定位");
        return;
      }
      if (!navigator.onLine) {
        showToast("需要联网识别地址，请手动填写");
        return;
      }

      locationButton.disabled = true;
      locationButton.classList.add("is-locating");
      locationButton.innerHTML = '<span class="location-button-icon">' + icons.refresh + '</span><span class="location-button-label">正在识别地址…</span>';

      const finishLocating = () => {
        if (!document.body.contains(locationButton)) return;
        locationButton.disabled = false;
        locationButton.classList.remove("is-locating");
        locationButton.innerHTML = '<span class="location-button-icon">' + icons.location + '</span><span class="location-button-label">使用当前位置</span>';
      };

      navigator.geolocation.getCurrentPosition(async (position) => {
        try {
          const address = await reverseGeocode(position.coords.latitude, position.coords.longitude);
          document.getElementById("city").value = address.city;
          document.getElementById("place").value = address.place;
          showToast("已填写城市和道路，可继续修改");
        } catch (error) {
          console.error("Reverse geocoding:", error);
          showToast(error && error.message ? error.message : "无法识别地址，请手动填写");
        } finally {
          finishLocating();
        }
      }, (error) => {
        finishLocating();
        if (error && error.code === 1) showToast("请在 iPhone 设置中允许位置权限");
        else if (error && error.code === 3) showToast("定位超时，请重试或手动填写");
        else showToast("无法获取位置，请手动填写");
      }, {
        enableHighAccuracy: true,
        maximumAge: 30000,
        timeout: 12000,
      });
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const energy = Number(document.getElementById("energy").value);
      const cost = Number(document.getElementById("cost").value);
      const odometer = Number(document.getElementById("odometer").value);
      const date = new Date(document.getElementById("date").value);
      const city = document.getElementById("city").value.trim();
      const place = document.getElementById("place").value.trim();
      const previous = previousChargeBefore(date);
      if (!(energy > 0) || cost < 0 || !(odometer >= 0) || Number.isNaN(date.getTime())) {
        showToast("请检查充电量、费用和里程");
        return;
      }
      if (!city || !place) {
        showToast("请填写城市和具体地点");
        return;
      }
      if (previous && odometer < Number(previous.odometer)) {
        showToast("当前里程不能小于 " + number(previous.odometer, 0) + " km");
        return;
      }
      const startSoc = document.getElementById("start-soc").value;
      const endSoc = document.getElementById("end-soc").value;
      if ((startSoc && (Number(startSoc) < 0 || Number(startSoc) > 100)) || (endSoc && (Number(endSoc) < 0 || Number(endSoc) > 100))) {
        showToast("电量百分比应为 0–100");
        return;
      }
      const record = normalizeRecord({
        id: crypto.randomUUID(),
        kind: "charge",
        date: date.toISOString(),
        chargeType: selectedType,
        type: selectedType,
        energy,
        cost,
        odometer,
        distance: previous ? Math.max(0, odometer - Number(previous.odometer)) : 0,
        city,
        place,
        location: place,
        startSoc: startSoc ? Number(startSoc) : null,
        endSoc: endSoc ? Number(endSoc) : null,
        note: document.getElementById("note").value.trim(),
        createdAt: new Date().toISOString(),
      });
      try {
        const nextRecords = [...state.records, record];
        if (hasOdometerConflict(nextRecords)) {
          showToast("这条记录会导致里程顺序错误，请检查日期或里程");
          return;
        }
        await recalculateAndSave(nextRecords);
        showToast("本次充电记录已保存");
        setRoute("home");
      } catch (error) {
        console.error(error);
        showToast("保存失败，请稍后重试");
      }
    });
  }

  function renderExpenseForm(kind) {
    const isToll = kind === "toll";
    setHeader("记录其他费用", isToll ? "记录高速通行费与路线" : "记录停车金额与地点");
    const fields = isToll
      ? [
          '<label class="form-row form-row-inline"><span class="form-label">出发城市</span><input class="inline-input" id="origin-city" maxlength="30" placeholder="例如：台北市" required></label>',
          '<label class="form-row form-row-inline"><span class="form-label">到达城市</span><input class="inline-input" id="destination-city" maxlength="30" placeholder="例如：台中市" required></label>',
          '<label class="form-row form-row-inline"><span class="form-label">具体路线</span><input class="inline-input" id="route" maxlength="80" placeholder="例如：国道1号" required></label>',
        ].join("")
      : [
          '<label class="form-row form-row-inline"><span class="form-label">城市</span><input class="inline-input" id="city" maxlength="30" placeholder="例如：台北市" required></label>',
          '<label class="form-row form-row-inline"><span class="form-label">具体地点</span><input class="inline-input" id="place" maxlength="80" placeholder="例如：松山机场停车场" required></label>',
        ].join("");

    page.innerHTML = [
      '<form id="expense-form" class="stack" novalidate>',
      '<div class="segmented expense-segments" id="expense-type"><button type="button" class="', isToll ? "is-active" : "", '" data-kind="toll"><span class="segment-icon">', icons.toll, "</span>高速费用</button>",
      '<button type="button" class="', !isToll ? "is-active" : "", '" data-kind="parking"><span class="segment-icon">', icons.parking, "</span>停车费用</button></div>",
      '<p class="helper-text">', isToll ? "记录出发城市、到达城市与具体路线" : "记录城市与具体停车地点", "</p>",
      '<section class="card form-card">',
      '<label class="form-row form-row-inline"><span class="form-label">费用金额</span><span class="inline-value"><em>', state.currency, '</em><input id="cost" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" required></span></label>',
      '<label class="form-row form-row-inline"><span class="form-label">日期</span><input class="inline-input date-input" id="date" type="datetime-local" value="', toDateTimeLocal(), '" required></label>',
      fields,
      '<label class="form-row form-row-inline"><span class="form-label">备注（可选）</span><input class="inline-input" id="note" maxlength="300" placeholder="添加备注"></label>',
      "</section>",
      '<button class="primary-button" type="submit">保存', isToll ? "高速费用" : "停车费用", "</button>",
      "</form>",
    ].join("");

    document.getElementById("expense-type").querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => setRoute("add-" + button.dataset.kind));
    });
    document.getElementById("expense-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const cost = Number(document.getElementById("cost").value);
      const date = new Date(document.getElementById("date").value);
      if (cost < 0 || Number.isNaN(date.getTime())) {
        showToast("请检查费用金额和日期");
        return;
      }
      const base = {
        id: crypto.randomUUID(),
        kind,
        cost,
        date: date.toISOString(),
        note: document.getElementById("note").value.trim(),
        createdAt: new Date().toISOString(),
      };
      if (isToll) {
        base.originCity = document.getElementById("origin-city").value.trim();
        base.destinationCity = document.getElementById("destination-city").value.trim();
        base.route = document.getElementById("route").value.trim();
        if (!base.originCity || !base.destinationCity || !base.route) {
          showToast("请填写出发城市、到达城市和具体路线");
          return;
        }
      } else {
        base.city = document.getElementById("city").value.trim();
        base.place = document.getElementById("place").value.trim();
        if (!base.city || !base.place) {
          showToast("请填写城市和具体地点");
          return;
        }
      }
      try {
        await saveRecord(normalizeRecord(base));
        state.records = await getAllRecords();
        markSyncDirty();
        showToast((isToll ? "高速费用" : "停车费用") + "已保存");
        setRoute("home");
      } catch (error) {
        console.error(error);
        showToast("保存失败，请稍后重试");
      }
    });
  }

  function detailRows(record) {
    const location = locationLines(record);
    if (record.kind === "charge") {
      const energyPer100 = record.distance > 0 ? (record.energy / record.distance) * 100 : null;
      const costPer100 = record.distance > 0 ? (record.cost / record.distance) * 100 : null;
      return [
        '<div class="value-row"><span>充电量</span><strong>', number(record.energy), " kWh</strong></div>",
        '<div class="value-row"><span>每度电价格</span><strong>', money(record.cost / record.energy), "/kWh</strong></div>",
        '<div class="value-row"><span>当前里程</span><strong>', number(record.odometer, 0), " km</strong></div>",
        '<div class="value-row"><span>行驶里程</span><strong>', record.distance > 0 ? number(record.distance, 0) + " km" : "首次记录", "</strong></div>",
        '<div class="value-row"><span>平均能耗</span><strong>', energyPer100 == null ? "—" : number(energyPer100) + " kWh/100km", "</strong></div>",
        '<div class="value-row"><span>百公里费用</span><strong>', costPer100 == null ? "—" : money(costPer100), "</strong></div>",
        '<div class="value-row"><span>城市</span><strong>', escapeHTML(location.primary), "</strong></div>",
        '<div class="value-row"><span>具体地点</span><strong>', escapeHTML(location.secondary), "</strong></div>",
        record.startSoc != null ? '<div class="value-row"><span>充电前电量</span><strong>' + record.startSoc + "%</strong></div>" : "",
        record.endSoc != null ? '<div class="value-row"><span>充电后电量</span><strong>' + record.endSoc + "%</strong></div>" : "",
        record.note ? '<div class="value-row"><span>备注</span><strong>' + escapeHTML(record.note) + "</strong></div>" : "",
      ].join("");
    }
    if (record.kind === "toll") {
      return [
        '<div class="value-row"><span>出发城市</span><strong>', escapeHTML(record.originCity), "</strong></div>",
        '<div class="value-row"><span>到达城市</span><strong>', escapeHTML(record.destinationCity), "</strong></div>",
        '<div class="value-row"><span>具体路线</span><strong>', escapeHTML(record.route), "</strong></div>",
        record.note ? '<div class="value-row"><span>备注</span><strong>' + escapeHTML(record.note) + "</strong></div>" : "",
      ].join("");
    }
    return [
      '<div class="value-row"><span>城市</span><strong>', escapeHTML(record.city), "</strong></div>",
      '<div class="value-row"><span>具体地点</span><strong>', escapeHTML(record.place), "</strong></div>",
      record.note ? '<div class="value-row"><span>备注</span><strong>' + escapeHTML(record.note) + "</strong></div>" : "",
    ].join("");
  }

  function openRecordDetail(id) {
    const record = state.records.find((item) => item.id === id);
    if (!record) return;
    openModal([
      '<div class="detail-edge-swipe-zone" aria-hidden="true"></div><div class="modal-handle detail-drag-handle" aria-hidden="true"></div><div class="record-detail-scroll"><header class="modal-header detail-modal-header"><h2>记录详情</h2></header>',
      '<section class="card detail-hero"><p class="hero-label">', escapeHTML(recordLabel(record)), '</p><p class="hero-value">', money(record.cost), '</p><p class="comparison">', longDate(record.date), "</p></section>",
      '<section class="card"><div class="calculation-list">', detailRows(record), "</div></section>",
      '<div class="button-stack detail-actions"><button class="primary-button" id="edit-record">编辑记录</button><button class="danger-button" id="delete-record">删除这条记录</button></div></div>',
    ].join(""), { recordDetail: true });
    document.getElementById("edit-record").addEventListener("click", () => openEditRecord(record));
    document.getElementById("delete-record").addEventListener("click", async () => {
      if (!window.confirm("确定删除这条记录吗？")) return;
      await deleteRecord(record.id);
      await recalculateAndSave(state.records.filter((item) => item.id !== record.id));
      closeModal();
      showToast("记录已删除");
      render();
    });
  }

  function editFields(record) {
    if (record.kind === "charge") {
      return [
        '<label class="form-row"><span class="form-label">充电类型</span><select class="field" id="edit-charge-type"><option value="home" ', record.chargeType === "home" ? "selected" : "", '>家充</option><option value="public" ', record.chargeType === "public" ? "selected" : "", '>公共快充</option><option value="other" ', record.chargeType === "other" ? "selected" : "", ">其他</option></select></label>",
        '<label class="form-row"><span class="form-label">充电量（kWh）</span><input class="field" id="edit-energy" type="number" min="0" step="0.1" value="', record.energy, '" required></label>',
        '<label class="form-row"><span class="form-label">当前里程（km）</span><input class="field" id="edit-odometer" type="number" min="0" step="1" value="', record.odometer, '" required></label>',
        '<label class="form-row"><span class="form-label">城市</span><input class="field" id="edit-city" value="', escapeHTML(record.city), '" required></label>',
        '<label class="form-row"><span class="form-label">具体地点</span><input class="field" id="edit-place" value="', escapeHTML(record.place), '" required></label>',
        '<div class="two-columns form-row"><label><span class="form-label">充电前 %</span><input class="field" id="edit-start-soc" type="number" min="0" max="100" value="', record.startSoc == null ? "" : record.startSoc, '"></label><label><span class="form-label">充电后 %</span><input class="field" id="edit-end-soc" type="number" min="0" max="100" value="', record.endSoc == null ? "" : record.endSoc, '"></label></div>',
      ].join("");
    }
    if (record.kind === "toll") {
      return [
        '<label class="form-row"><span class="form-label">出发城市</span><input class="field" id="edit-origin-city" value="', escapeHTML(record.originCity), '" required></label>',
        '<label class="form-row"><span class="form-label">到达城市</span><input class="field" id="edit-destination-city" value="', escapeHTML(record.destinationCity), '" required></label>',
        '<label class="form-row"><span class="form-label">具体路线</span><input class="field" id="edit-route" value="', escapeHTML(record.route), '" required></label>',
      ].join("");
    }
    return [
      '<label class="form-row"><span class="form-label">城市</span><input class="field" id="edit-city" value="', escapeHTML(record.city), '" required></label>',
      '<label class="form-row"><span class="form-label">具体地点</span><input class="field" id="edit-place" value="', escapeHTML(record.place), '" required></label>',
    ].join("");
  }

  function openEditRecord(record) {
    openModal([
      '<div class="modal-handle"></div><header class="modal-header"><h2>编辑记录</h2><button class="modal-close" data-close-modal aria-label="关闭">×</button></header>',
      '<form id="edit-form" class="stack"><section class="card form-card">',
      '<label class="form-row"><span class="form-label">日期</span><input class="field" id="edit-date" type="datetime-local" value="', toDateTimeLocal(new Date(record.date)), '" required></label>',
      '<label class="form-row"><span class="form-label">费用</span><input class="field" id="edit-cost" type="number" min="0" step="0.01" value="', record.cost, '" required></label>',
      editFields(record),
      '<label class="form-row"><span class="form-label">备注</span><textarea class="field" id="edit-note">', escapeHTML(record.note), "</textarea></label>",
      '</section><button class="primary-button" type="submit">保存修改</button></form>',
    ].join(""));

    document.getElementById("edit-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const date = new Date(document.getElementById("edit-date").value);
      const cost = Number(document.getElementById("edit-cost").value);
      if (Number.isNaN(date.getTime()) || cost < 0) {
        showToast("请检查日期和费用");
        return;
      }
      const updated = {
        ...record,
        date: date.toISOString(),
        cost,
        note: document.getElementById("edit-note").value.trim(),
        updatedAt: new Date().toISOString(),
      };
      if (record.kind === "charge") {
        updated.chargeType = document.getElementById("edit-charge-type").value;
        updated.type = updated.chargeType;
        updated.energy = Number(document.getElementById("edit-energy").value);
        updated.odometer = Number(document.getElementById("edit-odometer").value);
        updated.city = document.getElementById("edit-city").value.trim();
        updated.place = document.getElementById("edit-place").value.trim();
        updated.location = updated.place;
        updated.startSoc = document.getElementById("edit-start-soc").value ? Number(document.getElementById("edit-start-soc").value) : null;
        updated.endSoc = document.getElementById("edit-end-soc").value ? Number(document.getElementById("edit-end-soc").value) : null;
        if (!(updated.energy > 0) || updated.odometer < 0 || !updated.city || !updated.place) {
          showToast("请检查充电数据和位置信息");
          return;
        }
        if ((updated.startSoc != null && (updated.startSoc < 0 || updated.startSoc > 100)) || (updated.endSoc != null && (updated.endSoc < 0 || updated.endSoc > 100))) {
          showToast("电量百分比应为 0–100");
          return;
        }
      } else if (record.kind === "toll") {
        updated.originCity = document.getElementById("edit-origin-city").value.trim();
        updated.destinationCity = document.getElementById("edit-destination-city").value.trim();
        updated.route = document.getElementById("edit-route").value.trim();
        if (!updated.originCity || !updated.destinationCity || !updated.route) {
          showToast("请填写完整路线信息");
          return;
        }
      } else {
        updated.city = document.getElementById("edit-city").value.trim();
        updated.place = document.getElementById("edit-place").value.trim();
        if (!updated.city || !updated.place) {
          showToast("请填写城市和具体地点");
          return;
        }
      }
      const nextRecords = state.records.map((item) => item.id === updated.id ? normalizeRecord(updated) : item);
      if (hasOdometerConflict(nextRecords)) {
        showToast("修改后会导致里程顺序错误，请检查日期或里程");
        return;
      }
      await recalculateAndSave(nextRecords);
      closeModal();
      showToast("记录已更新");
      render();
    });
  }

  function periodRecords(reference, period) {
    return state.records.filter((record) => period === "month" ? sameMonth(record.date, reference) : sameYear(record.date, reference));
  }

  function chartData(reference, period) {
    const buckets = period === "month"
      ? Array.from({ length: 5 }, (_, index) => ({ label: "第" + (index + 1) + "周", charge: 0, toll: 0, parking: 0 }))
      : Array.from({ length: 12 }, (_, index) => ({ label: (index + 1) + "月", charge: 0, toll: 0, parking: 0 }));
    periodRecords(reference, period).forEach((record) => {
      const index = period === "month"
        ? Math.min(4, Math.floor((new Date(record.date).getDate() - 1) / 7))
        : new Date(record.date).getMonth();
      buckets[index][record.kind] += Number(record.cost || 0);
    });
    return buckets;
  }

  function renderStackedChart(points) {
    const max = Math.max(...points.map((point) => point.charge + point.toll + point.parking), 1);
    return [
      '<div class="chart-legend"><span><i class="dot charge"></i>充电</span><span><i class="dot toll"></i>高速</span><span><i class="dot parking"></i>停车</span></div>',
      '<div class="stacked-chart" style="grid-template-columns:repeat(', points.length, ',minmax(0,1fr))">',
      points.map((point) => {
        const total = point.charge + point.toll + point.parking;
        return [
          '<div class="stacked-column" title="', escapeHTML(point.label), " ", money(total), '">',
          '<div class="stack-total">', total ? money(total) : "", "</div>",
          '<div class="stack-bar"><i class="stack-charge" style="height:', Math.max(0, point.charge / max * 142), 'px"></i><i class="stack-toll" style="height:', Math.max(0, point.toll / max * 142), 'px"></i><i class="stack-parking" style="height:', Math.max(0, point.parking / max * 142), 'px"></i></div>',
          "<span>", escapeHTML(point.label), "</span></div>",
        ].join("");
      }).join(""),
      "</div>",
    ].join("");
  }

  function trendMetricLabel(metric) {
    if (metric === "charge") return "电费";
    if (metric === "toll") return "高速费";
    if (metric === "parking") return "停车费";
    return "总费用";
  }

  function trendValue(totals, metric) {
    if (metric === "charge") return totals.chargeCost;
    if (metric === "toll") return totals.tollCost;
    if (metric === "parking") return totals.parkingCost;
    if (metric === "distance") return totals.totalDistance;
    return totals.totalCost;
  }

  function recordContributesToTrend(record, metric) {
    if (metric === "distance") return recordKind(record) === "charge" && Number(record.distance || 0) > 0;
    if (metric === "charge") return recordKind(record) === "charge" && Number(record.cost || 0) > 0;
    if (metric === "toll") return recordKind(record) === "toll" && Number(record.cost || 0) > 0;
    if (metric === "parking") return recordKind(record) === "parking" && Number(record.cost || 0) > 0;
    return Number(record.cost || 0) > 0;
  }

  function recentMonthPages(reference, metric) {
    const end = new Date(reference.getFullYear(), reference.getMonth(), 1);
    const eligibleDates = state.records
      .filter((record) => recordContributesToTrend(record, metric))
      .map((record) => new Date(record.date))
      .filter((date) => !Number.isNaN(date.getTime()) && date <= new Date(end.getFullYear(), end.getMonth() + 1, 0, 23, 59, 59));
    const earliest = eligibleDates.length
      ? new Date(Math.min(...eligibleDates.map((date) => date.getTime())))
      : null;
    const monthSpan = earliest
      ? (end.getFullYear() - earliest.getFullYear()) * 12 + end.getMonth() - earliest.getMonth() + 1
      : 1;
    const pageCount = Math.max(2, Math.ceil(Math.max(1, monthSpan) / 6));

    return Array.from({ length: pageCount }, (_, pageIndex) => {
      const pageEnd = new Date(end.getFullYear(), end.getMonth() - pageIndex * 6, 1);
      const points = Array.from({ length: 6 }, (_item, index) => {
        const date = new Date(pageEnd.getFullYear(), pageEnd.getMonth() - 5 + index, 1);
        return {
          date,
          label: (date.getMonth() + 1) + "月",
          fullLabel: formatMonth(date),
          value: trendValue(summary(monthRecords(date)), metric),
        };
      });
      return {
        label: formatMonth(points[0].date) + " – " + formatMonth(points[5].date),
        points,
      };
    });
  }

  function recentYearPages(reference, metric) {
    const endYear = reference.getFullYear();
    const pages = [];
    for (let pageIndex = 0; pageIndex < 40; pageIndex += 1) {
      const pageEndYear = endYear - pageIndex * 3;
      const points = Array.from({ length: 3 }, (_item, index) => {
        const date = new Date(pageEndYear - 2 + index, 0, 1);
        return {
          date,
          label: String(date.getFullYear()),
          fullLabel: formatYear(date),
          value: trendValue(summary(periodRecords(date, "year")), metric),
        };
      });
      if (pageIndex > 0 && !points.some((point) => point.value > 0)) break;
      pages.push({
        label: points[0].fullLabel + " – " + points[2].fullLabel,
        points,
      });
    }
    return pages;
  }

  function renderLineChart(points, ariaLabel, options) {
    const settings = options || {};
    const width = 320;
    const height = 150;
    const left = settings.showValues ? 22 : 12;
    const right = settings.showValues ? 22 : 12;
    const top = settings.showValues ? 32 : 14;
    const bottom = 24;
    const max = Math.max(...points.map((point) => point.value), 1);
    const coords = points.map((point, index) => ({
      ...point,
      x: left + (index / Math.max(1, points.length - 1)) * (width - left - right),
      y: top + (1 - point.value / max) * (height - top - bottom),
    }));
    const path = coords.map((point, index) => (index ? "L" : "M") + point.x.toFixed(1) + "," + point.y.toFixed(1)).join(" ");
    const tooltipFormatter = settings.tooltipFormatter || money;
    const valueLabelFormatter = settings.valueLabelFormatter || ((value) => number(value, 0));
    return [
      '<svg class="line-chart" viewBox="0 0 ', width, " ", height, '" role="img" aria-label="', escapeHTML(ariaLabel), '">',
      '<line class="grid" x1="0" y1="45" x2="320" y2="45"/><line class="grid" x1="0" y1="85" x2="320" y2="85"/>',
      '<path class="trend-line" d="', path, '"/>',
      coords.map((point, index) => {
        const labelAnchor = index === 0 ? "start" : (index === coords.length - 1 ? "end" : "middle");
        const valueLabel = settings.showValues
          ? '<text class="value-label" x="' + point.x + '" y="' + Math.max(12, point.y - 10) + '" text-anchor="' + labelAnchor + '">' + escapeHTML(valueLabelFormatter(point.value)) + "</text>"
          : "";
        return '<g><title>' + escapeHTML((point.fullLabel || point.label) + " " + tooltipFormatter(point.value)) + '</title>' + valueLabel + '<circle class="point" cx="' + point.x + '" cy="' + point.y + '" r="4"/><text class="axis-label" x="' + point.x + '" y="145" text-anchor="middle">' + point.label + "</text></g>";
      }).join(""),
      "</svg>",
    ].join("");
  }

  function renderTrendCard(reference) {
    const metric = state.statsTrendMetric;
    const annual = state.statsPeriod === "year";
    const pages = annual ? recentYearPages(reference, metric) : recentMonthPages(reference, metric);
    const metrics = [
      { value: "total", label: "总费用" },
      { value: "charge", label: "电费" },
      { value: "toll", label: "高速费" },
      { value: "parking", label: "停车费" },
    ];
    return [
      '<section class="card trend-card"><div class="trend-heading"><div><h2>', annual ? "近3年费用" : "近6个月费用", '</h2><span>', pages.length > 1 ? (annual ? "左滑查看更早年份" : "左滑查看更早月份") : (annual ? "暂无更早年份数据" : "最近六个月"), '</span></div></div>',
      '<div class="trend-metric-toggle" id="trend-metric" role="group" aria-label="费用趋势类型">',
      metrics.map((item) => '<button type="button" data-trend-metric="' + item.value + '" class="' + (metric === item.value ? "is-active" : "") + '" aria-pressed="' + (metric === item.value) + '">' + item.label + "</button>").join(""),
      '</div><div class="trend-pager" aria-label="', annual ? "历史年度费用" : "历史月份费用，可横向滑动", '">',
      pages.map((pageData) => '<div class="trend-page"><span class="trend-range">' + escapeHTML(pageData.label) + '</span>' + renderLineChart(pageData.points, pageData.label + " " + trendMetricLabel(metric) + "趋势") + "</div>").join(""),
      "</div></section>",
    ].join("");
  }

  function renderDistanceTrendCard(reference) {
    const annual = state.statsPeriod === "year";
    const pages = annual ? recentYearPages(reference, "distance") : recentMonthPages(reference, "distance");
    const title = annual ? "近3年行驶里程" : "近6个月行驶里程";
    const hint = pages.length > 1
      ? (annual ? "左滑查看更早年份" : "左滑查看更早月份")
      : (annual ? "暂无更早年份数据" : "最近六个月");
    return [
      '<section class="card trend-card distance-trend-card"><div class="trend-heading"><div><h2>', title, '</h2><span>', hint, '</span></div></div>',
      '<div class="trend-pager" aria-label="', annual ? "历史年度行驶里程" : "历史月份行驶里程，可横向滑动", '">',
      pages.map((pageData) => {
        const total = pageData.points.reduce((sum, point) => sum + point.value, 0);
        return '<div class="trend-page"><div class="trend-page-meta"><span class="trend-range">' + escapeHTML(pageData.label) + '</span><strong>合计 ' + escapeHTML(number(total, 0)) + ' km</strong></div>' + renderLineChart(pageData.points, pageData.label + "行驶里程趋势", {
          showValues: true,
          tooltipFormatter: (value) => number(value, 0) + " km",
          valueLabelFormatter: (value) => number(value, 0),
        }) + "</div>";
      }).join(""),
      "</div></section>",
    ].join("");
  }

  function isCurrentStatsPeriod() {
    const now = new Date();
    if (state.statsPeriod === "month") {
      return state.statsReference.getFullYear() === now.getFullYear() && state.statsReference.getMonth() === now.getMonth();
    }
    return state.statsReference.getFullYear() >= now.getFullYear();
  }

  function renderStatistics() {
    setHeader("数据统计", "充电、高速与停车费用汇总");
    const currentRecords = periodRecords(state.statsReference, state.statsPeriod);
    const totals = summary(currentRecords);
    const priorReference = state.statsPeriod === "month"
      ? new Date(state.statsReference.getFullYear(), state.statsReference.getMonth() - 1, 1)
      : new Date(state.statsReference.getFullYear() - 1, 0, 1);
    const previous = summary(periodRecords(priorReference, state.statsPeriod));
    const difference = totals.totalCost - previous.totalCost;
    const comparison = previous.count
      ? "较" + (state.statsPeriod === "month" ? "上月" : "去年") + (difference >= 0 ? "增加 " : "减少 ") + money(Math.abs(difference))
      : "共记录 " + totals.count + " 笔费用";
    const points = chartData(state.statsReference, state.statsPeriod);
    const perKmValue = state.statsCostPerKmMode === "charge" ? totals.chargeCostPerKm : totals.costPerKm;
    const perKmLabel = state.statsCostPerKmMode === "charge" ? "充电费用" : "全部费用";

    page.innerHTML = [
      '<div class="stack">',
      '<div class="segmented" id="stats-period"><button class="', state.statsPeriod === "month" ? "is-active" : "", '" data-period="month">月度</button><button class="', state.statsPeriod === "year" ? "is-active" : "", '" data-period="year">年度</button></div>',
      '<div class="period-nav glass-control"><button id="previous-period" aria-label="上一个周期">‹</button><strong>', state.statsPeriod === "month" ? formatMonth(state.statsReference) : formatYear(state.statsReference), '</strong><button id="next-period" aria-label="下一个周期" ', isCurrentStatsPeriod() ? "disabled" : "", ">›</button></div>",
      '<section class="card stats-hero"><p class="hero-label">', state.statsPeriod === "month" ? "本月用车支出" : "本年用车支出", '</p><p class="hero-value">', money(totals.totalCost), '</p><p class="comparison">', comparison, "</p>", costBreakdown(totals), "</section>",
      '<section class="card chart-card"><div class="section-heading"><h2>', state.statsPeriod === "month" ? "每周费用" : "每月费用", "</h2></div>", renderStackedChart(points), "</section>",
      '<section class="card"><div class="stats-grid four-metrics">',
      '<div class="metric"><strong>', number(totals.totalEnergy), ' kWh</strong><span>充电量</span></div>',
      '<div class="metric"><strong>', number(totals.totalDistance, 0), ' km</strong><span>行驶里程</span></div>',
      '<div class="metric"><strong>', totals.energyPer100 == null ? "—" : number(totals.energyPer100) + " kWh/100km", '</strong><span>平均能耗</span></div>',
      '<div class="metric"><strong>', totals.chargeCount, ' 次</strong><span>充电次数</span></div>',
      "</div></section>",
      '<section class="card efficiency-card"><div class="efficiency-heading"><h2>费用效率</h2><span>', state.statsPeriod === "month" ? "本月" : "本年", '</span></div><div class="efficiency-grid">',
      '<div><span>平均电价</span><strong>', totals.totalEnergy > 0 ? money(totals.unitPrice) + "/kWh" : "—", '</strong><small>充电费 ÷ 充电量</small></div>',
      '<div class="per-km-metric"><span>每公里费用</span><strong>', perKmValue == null ? "—" : money(perKmValue) + "/km", '</strong><div class="per-km-toggle" id="cost-per-km-mode" role="group" aria-label="每公里费用类型"><button type="button" data-cost-mode="all" class="', state.statsCostPerKmMode === "all" ? "is-active" : "", '" aria-pressed="', state.statsCostPerKmMode === "all", '">全部费用</button><button type="button" data-cost-mode="charge" class="', state.statsCostPerKmMode === "charge" ? "is-active" : "", '" aria-pressed="', state.statsCostPerKmMode === "charge", '">充电费用</button></div><small>', perKmLabel, ' ÷ 行驶里程</small></div>',
      "</div></section>",
      renderTrendCard(state.statsReference),
      renderDistanceTrendCard(state.statsReference),
      '<p class="settings-note">平均电价只计算充电费用；每公里费用可切换全部支出或仅充电支出。电量与能耗数据仅包含充电记录。</p>',
      "</div>",
    ].join("");

    document.getElementById("stats-period").querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        state.statsPeriod = button.dataset.period;
        state.statsReference = new Date();
        renderStatistics();
      });
    });
    document.getElementById("cost-per-km-mode").querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        state.statsCostPerKmMode = button.dataset.costMode;
        renderStatistics();
      });
    });
    document.getElementById("trend-metric").querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        state.statsTrendMetric = button.dataset.trendMetric;
        renderStatistics();
      });
    });
    document.getElementById("previous-period").addEventListener("click", () => {
      state.statsReference = state.statsPeriod === "month"
        ? new Date(state.statsReference.getFullYear(), state.statsReference.getMonth() - 1, 1)
        : new Date(state.statsReference.getFullYear() - 1, 0, 1);
      renderStatistics();
    });
    document.getElementById("next-period").addEventListener("click", () => {
      if (isCurrentStatsPeriod()) return;
      state.statsReference = state.statsPeriod === "month"
        ? new Date(state.statsReference.getFullYear(), state.statsReference.getMonth() + 1, 1)
        : new Date(state.statsReference.getFullYear() + 1, 0, 1);
      renderStatistics();
    });
  }

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || Boolean(window.navigator.standalone);
  }

  function downloadFile(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportJSON() {
    const content = JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), records: state.records }, null, 2);
    downloadFile("充電易备份-" + new Date().toISOString().slice(0, 10) + ".json", content, "application/json");
  }

  function exportCSV() {
    const header = ["日期", "记录类型", "充电类型", "充电量(kWh)", "费用", "当前里程(km)", "行驶里程(km)", "城市", "具体地点", "出发城市", "到达城市", "路线", "备注"];
    const rows = state.records.map((record) => {
      const values = [
        longDate(record.date),
        record.kind === "charge" ? "充电" : (record.kind === "toll" ? "高速" : "停车"),
        record.kind === "charge" ? chargeTypeLabel(record.chargeType) : "",
        record.energy || "",
        record.cost,
        record.odometer == null ? "" : record.odometer,
        record.distance || "",
        record.city || "",
        record.place || "",
        record.originCity || "",
        record.destinationCity || "",
        record.route || "",
        record.note || "",
      ];
      return values.map((value) => '"' + String(value).replaceAll('"', '""') + '"').join(",");
    });
    downloadFile("充電易记录-" + new Date().toISOString().slice(0, 10) + ".csv", "\uFEFF" + [header.join(","), ...rows].join("\n"), "text/csv;charset=utf-8");
  }

  function openInstallInstructions() {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    openModal([
      '<div class="modal-handle"></div><header class="modal-header"><h2>添加到主屏幕</h2><button class="modal-close" data-close-modal aria-label="关闭">×</button></header>',
      '<section class="card"><p class="settings-note">安装后从桌面打开，会隐藏浏览器地址栏，以独立 App 窗口运行。</p><ol class="install-steps">',
      ios
        ? "<li>使用 Safari 打开此页面。</li><li>点击底部工具栏的“分享”按钮。</li><li>选择“添加到主屏幕”。</li><li>点击右上角“添加”，再从桌面打开。</li>"
        : "<li>使用 Chrome 或 Edge 打开此页面。</li><li>打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。</li><li>确认安装，再从桌面图标打开。</li>",
      "</ol></section>",
    ].join(""));
  }

  async function requestInstall() {
    if (state.installPrompt) {
      state.installPrompt.prompt();
      await state.installPrompt.userChoice;
      state.installPrompt = null;
      renderSettings();
      return;
    }
    openInstallInstructions();
  }

  function normalizeImportedRecords(input) {
    if (!Array.isArray(input)) throw new Error("备份中没有记录数组");
    return input.map((record) => {
      const date = new Date(record.date);
      const cost = Number(record.cost);
      if (Number.isNaN(date.getTime()) || cost < 0) throw new Error("备份中包含无效记录");
      const normalized = normalizeRecord(record);
      if (normalized.kind === "charge" && (!(normalized.energy > 0) || normalized.odometer < 0)) {
        throw new Error("备份中包含无效充电记录");
      }
      return normalized;
    });
  }

  async function importBackup(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const imported = normalizeImportedRecords(Array.isArray(parsed) ? parsed : parsed.records);
      if (!window.confirm("将导入 " + imported.length + " 条记录，并替换当前数据。是否继续？")) return;
      await clearRecords();
      await recalculateAndSave(imported);
      showToast("备份已导入");
      renderSettings();
    } catch (error) {
      console.error(error);
      showToast("无法导入这个备份文件");
    }
  }

  function accountSettingsCard() {
    const user = currentUser();
    if (!user) {
      return [
        '<section class="card sync-settings-card"><div class="sync-card-heading"><span class="sync-card-icon">', icons.cloud, '</span><div><strong>账户与云端同步</strong><span>登录后可跨设备恢复数据</span></div></div>',
        '<button class="secondary-button settings-action" id="settings-account-login" type="button">邮箱验证码登录</button>',
        '<p class="sync-card-note">登录不会改变本机数据，首次同步会安全合并现有记录。</p></section>',
      ].join("");
    }
    return [
      '<section class="card sync-settings-card"><button class="sync-card-heading sync-account-button" id="settings-account-info" type="button"><span class="sync-card-icon is-connected">', icons.user, '</span><div><strong>', escapeHTML(user.email || "充電易账户"), '</strong><span><i class="sync-inline-dot"></i>', escapeHTML(syncStatusLabel()), '</span></div><b>›</b></button>',
      '<div class="sync-settings-list"><label class="sync-setting-row"><span><strong>自动同步</strong><small>打开 App 与记录变更后自动同步</small></span><span class="ios-switch"><input id="auto-sync-toggle" type="checkbox" ', state.autoSync ? "checked" : "", ' aria-label="自动同步"><i></i></span></label>',
      '<div class="sync-setting-row"><span><strong>同步时间</strong><small>最近一次成功同步</small></span><b>', escapeHTML(syncTimeLabel()), '</b></div>',
      '<button class="sync-setting-row manual-sync-row" id="manual-sync" type="button"><span><strong>', state.syncing ? "正在同步" : "立即同步", '</strong><small>', state.syncStatus === "setup" ? "需要先初始化 Supabase 数据表" : "点按后同步本机与云端记录", '</small></span><span class="manual-sync-icon ', state.syncing ? "is-spinning" : "", '">', icons.sync, "</span></button></div>",
      '<p class="sync-card-note">IndexedDB 保持本地优先，断网记录会在恢复网络后补传。</p></section>',
    ].join("");
  }

  function renderAbout() {
    page.innerHTML = [
      '<div class="about-page">',
      '<button class="about-back" id="about-back" type="button" aria-label="返回设置">', icons.chevronLeft, '<span>设置</span></button>',
      '<section class="about-app-brand" aria-label="充電易应用信息"><img class="about-app-icon" src="./icons/icon-512.png" alt="充電易 App 图标"><h2>充電易</h2><p>版本 ', escapeHTML(APP_VERSION), "</p></section>",
      '<div class="about-legal"><p class="about-map-credit">地址服务：高德地图 / <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></p><footer class="about-footer"><div class="about-signature-logo"><img src="./personal-logo.png" alt="LIU JUNJIE 个人标志"></div><p>All Rights Reserved © 2026 LIU JUNJIE</p></footer></div>',
      "</div>",
    ].join("");
    document.getElementById("about-back").addEventListener("click", () => setRoute("settings"));
  }

  function renderSettings() {
    setHeader("设置", "账户、外观与本地数据");
    const installed = isStandalone();
    const themeOptions = [
      { value: "system", label: "跟随系统" },
      { value: "light", label: "浅色" },
      { value: "dark", label: "深色" },
    ];
    page.innerHTML = [
      '<div class="stack">',
      '<section class="card"><h2>', installed ? "已从主屏幕运行" : "安装充電易", '</h2><p class="settings-note">', installed ? "当前已是独立窗口模式，浏览器地址栏已隐藏。" : "添加到手机主屏幕后，会像原生 App 一样独立启动并隐藏地址栏。", "</p>",
      installed ? "" : '<button class="primary-button settings-action" id="install-app">添加到主屏幕</button>', "</section>",
      accountSettingsCard(),
      '<section class="card appearance-card"><div class="settings-copy"><strong>外观</strong><span>默认跟随 iOS 系统</span></div><div class="appearance-control" role="group" aria-label="外观模式">', themeOptions.map((option) => '<button type="button" data-theme-option="' + option.value + '" class="' + (state.theme === option.value ? "is-active" : "") + '" aria-pressed="' + (state.theme === option.value) + '">' + option.label + "</button>").join(""), "</div></section>",
      '<section class="card settings-group"><div class="settings-row"><strong>货币符号</strong><select id="currency-select">', ["¥", "HK$", "NT$", "$", "€"].map((symbol) => '<option ' + (state.currency === symbol ? "selected" : "") + ">" + symbol + "</option>").join(""), '</select></div><div class="settings-row"><strong>电量单位</strong><span>kWh</span></div><div class="settings-row"><strong>里程单位</strong><span>km</span></div><div class="settings-row"><strong>能耗单位</strong><span>kWh/100km</span></div></section>',
      '<section class="card"><h2>数据备份</h2><p class="settings-note">本机优先与云端同步不替代独立备份。建议定期导出 JSON；CSV 可用于 Excel 或 Numbers。</p><div class="button-stack settings-action"><button class="secondary-button" id="export-json">导出 JSON 备份</button><button class="secondary-button" id="export-csv">导出 CSV 表格</button><button class="secondary-button" id="import-json">导入 JSON 备份</button><input id="import-file" type="file" accept="application/json,.json" hidden></div></section>',
      '<section class="card settings-group"><div class="settings-row"><strong>存储方式</strong><span>', currentUser() ? "IndexedDB + Supabase" : "设备本地 IndexedDB", '</span></div><div class="settings-row"><strong>离线使用</strong><span>已启用</span></div><div class="settings-row"><strong>隐私与追踪</strong><span>无广告追踪</span></div><div class="settings-row"><strong>版本</strong><span>', APP_VERSION, '</span></div><button class="settings-row about-settings-button" id="open-about" type="button"><strong>关于</strong><span class="about-row-chevron">', icons.chevronRight, "</span></button></section>",
      '<button class="danger-button" id="clear-records" ', state.records.length ? "" : "disabled", ">清空全部记录</button>",
      "</div>",
    ].join("");

    const loginButton = document.getElementById("settings-account-login");
    if (loginButton) loginButton.addEventListener("click", () => openAccountPopover("login"));
    const accountInfoButton = document.getElementById("settings-account-info");
    if (accountInfoButton) accountInfoButton.addEventListener("click", () => openAccountPopover("account"));
    const autoSyncToggle = document.getElementById("auto-sync-toggle");
    if (autoSyncToggle) {
      autoSyncToggle.addEventListener("change", (event) => {
        state.autoSync = event.target.checked;
        localStorage.setItem(AUTO_SYNC_KEY, String(state.autoSync));
        showToast(state.autoSync ? "已开启自动同步" : "已关闭自动同步");
        if (state.autoSync) scheduleAutoSync(100);
      });
    }
    const manualSyncButton = document.getElementById("manual-sync");
    if (manualSyncButton) manualSyncButton.addEventListener("click", () => syncNow(false));
    document.getElementById("open-about").addEventListener("click", () => setRoute("about"));

    document.querySelectorAll("[data-theme-option]").forEach((button) => {
      button.addEventListener("click", () => {
        applyTheme(button.dataset.themeOption, true);
        document.querySelectorAll("[data-theme-option]").forEach((item) => {
          const active = item.dataset.themeOption === state.theme;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-pressed", String(active));
        });
        showToast(state.theme === "system" ? "已跟随 iOS 系统" : state.theme === "dark" ? "已切换深色模式" : "已切换浅色模式");
      });
    });

    document.getElementById("currency-select").addEventListener("change", (event) => {
      state.currency = event.target.value;
      localStorage.setItem("charging-easy-currency", state.currency);
      showToast("货币符号已更新");
      renderSettings();
    });
    document.getElementById("export-json").addEventListener("click", exportJSON);
    document.getElementById("export-csv").addEventListener("click", exportCSV);
    document.getElementById("import-json").addEventListener("click", () => document.getElementById("import-file").click());
    document.getElementById("import-file").addEventListener("change", (event) => {
      if (event.target.files[0]) importBackup(event.target.files[0]);
    });
    if (!installed) document.getElementById("install-app").addEventListener("click", requestInstall);
    document.getElementById("clear-records").addEventListener("click", async () => {
      if (!state.records.length || !window.confirm("确定清空全部记录吗？此操作无法撤销。")) return;
      await clearRecords();
      state.records = [];
      showToast("全部记录已清空");
      renderSettings();
    });
  }

  function render() {
    appShell.classList.toggle("is-about-route", state.route === "about");
    if (state.route === "home") renderHome();
    else if (state.route === "records") renderRecords();
    else if (state.route === "statistics") renderStatistics();
    else if (state.route === "settings") renderSettings();
    else if (state.route === "about") renderAbout();
    else if (state.route === "add-charge") renderChargeForm();
    else if (state.route === "add-toll") renderExpenseForm("toll");
    else if (state.route === "add-parking") renderExpenseForm("parking");
    else renderHome();
  }

  function dismissLaunchScreen() {
    const launchScreen = document.getElementById("app-launch-screen");
    if (!launchScreen) return;
    const paintedAt = Number(window.__chargingEasyLaunchPaintedAt || 0);
    if (!paintedAt) {
      window.requestAnimationFrame(dismissLaunchScreen);
      return;
    }
    const delay = Math.max(0, 720 - (performance.now() - paintedAt));
    window.setTimeout(() => {
      window.requestAnimationFrame(() => launchScreen.classList.add("is-hiding"));
      window.setTimeout(() => launchScreen.remove(), 340);
    }, delay);
  }

  async function init() {
    applyTheme(state.theme, false);
    try {
      state.records = await getAllRecords();
    } catch (error) {
      console.error(error);
      showToast("无法读取本地数据");
    }

    if (cloud && state.session) {
      try {
        state.session = await cloud.ensureSession() || state.session;
      } catch (error) {
        if (navigator.onLine) {
          console.error("Cloud session:", error);
          state.session = cloud.currentSession();
        }
      }
    }

    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => setRoute(tab.dataset.route));
    });
    accountButton.addEventListener("click", () => openAccountPopover(currentUser() ? "account" : "login"));
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      state.installPrompt = event;
      if (state.route === "settings") renderSettings();
    });
    if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) {
      document.documentElement.classList.add("is-standalone");
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js?v=1.4.4").catch((error) => console.error("Service worker:", error));
    }
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
    const handleSystemThemeChange = () => {
      if (state.theme === "system") applyTheme("system", false);
    };
    if (systemThemeQuery.addEventListener) systemThemeQuery.addEventListener("change", handleSystemThemeChange);
    else if (systemThemeQuery.addListener) systemThemeQuery.addListener(handleSystemThemeChange);
    window.addEventListener("online", () => {
      updateAccountButton();
      scheduleAutoSync(250);
      if (state.route === "settings") renderSettings();
    });
    window.addEventListener("offline", () => {
      updateAccountButton();
      if (state.route === "settings") renderSettings();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") scheduleAutoSync(250);
    });
    setInterval(() => scheduleAutoSync(0), 15 * 60 * 1000);
    updateTabs();
    updateAccountButton();
    render();
    dismissLaunchScreen();
    if (currentUser() && state.autoSync) scheduleAutoSync(500);
  }

  init();
})();
