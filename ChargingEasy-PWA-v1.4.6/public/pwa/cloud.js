(() => {
  "use strict";

  const SUPABASE_URL = "https://sovqcyobgiqptnksvqfu.supabase.co";
  const SUPABASE_KEY = "sb_publishable_IubRGx64oZkxOt05E8BowQ_WoEvY0R9";
  const SESSION_KEY = "charging-easy-cloud-session";
  let session = readSession();

  function readSession() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      return value && value.access_token && value.refresh_token ? value : null;
    } catch {
      return null;
    }
  }

  function saveSession(value) {
    session = value && value.access_token ? value : null;
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
    return session;
  }

  function messageFrom(payload, fallback) {
    if (!payload) return fallback;
    return payload.msg || payload.message || payload.error_description || payload.error || fallback;
  }

  async function request(path, options) {
    const response = await fetch(SUPABASE_URL + path, {
      ...options,
      headers: {
        apikey: SUPABASE_KEY,
        "Content-Type": "application/json",
        ...(options && options.headers ? options.headers : {}),
      },
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
    if (!response.ok) {
      const error = new Error(messageFrom(payload, "云端服务暂时不可用"));
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async function requestOtp(email) {
    await request("/auth/v1/otp", {
      method: "POST",
      body: JSON.stringify({ email, create_user: true }),
    });
  }

  async function verifyOtp(email, token) {
    const value = await request("/auth/v1/verify", {
      method: "POST",
      body: JSON.stringify({ email, token, type: "email" }),
    });
    return saveSession(value);
  }

  function sessionExpiresSoon() {
    if (!session || !session.expires_at) return true;
    return Number(session.expires_at) * 1000 < Date.now() + 60000;
  }

  async function refreshSession() {
    if (!session || !session.refresh_token) return saveSession(null);
    try {
      const value = await request("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      return saveSession(value);
    } catch (error) {
      if (error && (error.status === 400 || error.status === 401 || error.status === 403)) saveSession(null);
      throw error;
    }
  }

  async function ensureSession() {
    if (!session) return null;
    if (sessionExpiresSoon()) return refreshSession();
    return session;
  }

  async function signOut() {
    const current = session;
    saveSession(null);
    if (!current || !navigator.onLine) return;
    try {
      await request("/auth/v1/logout", {
        method: "POST",
        headers: { Authorization: "Bearer " + current.access_token },
      });
    } catch {
      // The local session is already cleared; a failed remote logout must not trap the user.
    }
  }

  async function reverseGeocode(latitude, longitude, language, signal) {
    const current = await ensureSession().catch(() => session);
    return request("/functions/v1/reverse-geocode", {
      method: "POST",
      signal,
      headers: current && current.access_token
        ? { Authorization: "Bearer " + current.access_token }
        : {},
      body: JSON.stringify({ latitude, longitude, language }),
    });
  }

  async function restRequest(path, options, allowRefresh) {
    const current = await ensureSession();
    if (!current) {
      const error = new Error("登录状态已失效，请重新登录");
      error.status = 401;
      throw error;
    }
    try {
      return await request("/rest/v1/" + path, {
        ...options,
        headers: {
          Authorization: "Bearer " + current.access_token,
          ...(options && options.headers ? options.headers : {}),
        },
      });
    } catch (error) {
      if (error.status === 401 && allowRefresh !== false) {
        await refreshSession();
        return restRequest(path, options, false);
      }
      throw error;
    }
  }

  async function fetchCloudRows() {
    const rows = await restRequest(
      "charging_records?select=id,record,updated_at,deleted&order=updated_at.asc",
      { method: "GET" }
    );
    return Array.isArray(rows) ? rows : [];
  }

  async function upsertCloudRows(rows) {
    if (!rows.length) return [];
    const result = await restRequest("charging_records?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(rows),
    });
    return Array.isArray(result) ? result : [];
  }

  function timestamp(value) {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  async function sync(localRecords, localTombstones) {
    const cloudRows = await fetchCloudRows();
    const records = new Map((localRecords || []).map((record) => [record.id, record]));
    const tombstones = new Map((localTombstones || []).map((item) => [item.id, item]));
    const cloud = new Map(cloudRows.map((row) => [row.id, row]));
    const ids = new Set([...records.keys(), ...tombstones.keys(), ...cloud.keys()]);
    const uploads = [];
    let downloaded = 0;

    ids.forEach((id) => {
      const localRecord = records.get(id);
      const localTombstone = tombstones.get(id);
      const cloudRow = cloud.get(id);
      const recordTime = timestamp(localRecord && localRecord.updatedAt);
      const tombstoneTime = timestamp(localTombstone && localTombstone.updatedAt);
      const localDeleted = Boolean(localTombstone && tombstoneTime >= recordTime);
      const localValue = localDeleted ? localTombstone : localRecord;
      const localTime = Math.max(recordTime, tombstoneTime);
      const cloudTime = timestamp(cloudRow && cloudRow.updated_at);

      if (!cloudRow && localValue) {
        uploads.push(localDeleted
          ? { id, record: null, updated_at: localValue.updatedAt, deleted: true }
          : { id, record: localRecord, updated_at: localRecord.updatedAt, deleted: false });
        return;
      }

      if (!localValue && cloudRow) {
        if (!cloudRow.deleted && cloudRow.record) records.set(id, { ...cloudRow.record, updatedAt: cloudRow.updated_at });
        downloaded += 1;
        return;
      }

      if (!cloudRow || !localValue) return;

      if (localTime > cloudTime) {
        uploads.push(localDeleted
          ? { id, record: null, updated_at: localValue.updatedAt, deleted: true }
          : { id, record: localRecord, updated_at: localRecord.updatedAt, deleted: false });
        return;
      }

      tombstones.delete(id);
      if (cloudRow.deleted || !cloudRow.record) records.delete(id);
      else records.set(id, { ...cloudRow.record, updatedAt: cloudRow.updated_at });
      downloaded += 1;
    });

    await upsertCloudRows(uploads);
    uploads.forEach((row) => {
      if (row.deleted) tombstones.delete(row.id);
    });

    return {
      records: Array.from(records.values()),
      tombstones: Array.from(tombstones.values()),
      uploaded: uploads.length,
      downloaded,
    };
  }

  window.ChargingCloud = {
    configured: Boolean(SUPABASE_URL && SUPABASE_KEY),
    currentSession: () => session,
    ensureSession,
    requestOtp,
    verifyOtp,
    signOut,
    sync,
    reverseGeocode,
  };
})();
