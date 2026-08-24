const allowedOrigins = new Set([
  "https://charging-easy-pwa.qd5pbx6jbr.chatgpt.site",
  "https://chargingeasy.pages.dev",
]);

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}

function json(origin: string, status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), { status, headers: corsHeaders(origin) });
}

function clean(value: unknown) {
  if (Array.isArray(value)) return value.length ? clean(value[0]) : "";
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isMainlandCoordinate(latitude: number, longitude: number) {
  const inChinaBounds = latitude >= 18 && latitude <= 53.6
    && longitude >= 73.5 && longitude <= 134.8;
  const inTaiwan = latitude >= 21.5 && latitude <= 25.6
    && longitude >= 119.2 && longitude <= 122.2;
  return inChinaBounds && !inTaiwan;
}

async function fetchJson(url: string, init: RequestInit = {}, timeout = 6500) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Address request failed: ${response.status}`);
  return payload;
}

async function reverseWithAmap(latitude: number, longitude: number, key: string) {
  const convertQuery = new URLSearchParams({
    key,
    locations: `${longitude},${latitude}`,
    coordsys: "gps",
    output: "JSON",
  });
  const converted = await fetchJson(
    `https://restapi.amap.com/v3/assistant/coordinate/convert?${convertQuery}`
  );
  if (String(converted?.status) !== "1" || !clean(converted?.locations)) {
    throw new Error(`AMap coordinate conversion failed: ${clean(converted?.info) || "unknown"}`);
  }

  const regeoQuery = new URLSearchParams({
    key,
    location: clean(converted.locations),
    extensions: "base",
    output: "JSON",
  });
  const payload = await fetchJson(
    `https://restapi.amap.com/v3/geocode/regeo?${regeoQuery}`
  );
  if (String(payload?.status) !== "1") {
    throw new Error(`AMap reverse geocoding failed: ${clean(payload?.info) || "unknown"}`);
  }

  const component = payload?.regeocode?.addressComponent;
  const province = clean(component?.province);
  const city = clean(component?.city) || province;
  const district = clean(component?.district);
  const road = clean(component?.streetNumber?.street);
  const place = [...new Set([district, road].filter((part) => part && part !== city))].join(" ");
  if (!city || !place) return null;
  return {
    city: city.slice(0, 30),
    place: place.slice(0, 80),
    source: "amap",
  };
}

async function reverseWithOsm(latitude: number, longitude: number, language: string) {
  const query = new URLSearchParams({
    format: "geocodejson",
    addressdetails: "1",
    layer: "address",
    zoom: "17",
    lat: String(latitude),
    lon: String(longitude),
    "accept-language": language,
  });
  const payload = await fetchJson(`https://nominatim.openstreetmap.org/reverse?${query}`, {
    headers: {
      Accept: "application/geocode+json, application/json",
      "User-Agent": "ChargingEasy/1.4.0 (+https://chargingeasy.pages.dev/)",
    },
  }, 8000);
  const geocoding = payload?.features?.[0]?.properties?.geocoding;
  const city = clean(geocoding?.city || geocoding?.county || geocoding?.state);
  const district = clean(geocoding?.district || geocoding?.locality);
  const road = clean(geocoding?.street || (geocoding?.type === "street" ? geocoding?.name : ""));
  const place = [...new Set([district, road].filter((part) => part && part !== city))].join(" ");
  if (!city || !place) return null;
  return {
    city: city.slice(0, 30),
    place: place.slice(0, 80),
    source: "openstreetmap",
  };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") || "";
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const allowedOrigin = allowedOrigins.has(origin) || isLocal ? origin : "";

  if (!allowedOrigin) {
    return new Response(JSON.stringify({ error: "Origin not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) });
  }
  if (request.method !== "POST") return json(allowedOrigin, 405, { error: "Method not allowed" });

  try {
    const body = await request.json();
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    const language = clean(body.language || "zh-CN,zh,en").slice(0, 48);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return json(allowedOrigin, 400, { error: "Invalid coordinates" });
    }

    if (isMainlandCoordinate(latitude, longitude)) {
      const key = Deno.env.get("AMAP_WEB_SERVICE_KEY") || "";
      if (!key) {
        return json(allowedOrigin, 503, {
          error: "Mainland address service is not configured",
          code: "AMAP_NOT_CONFIGURED",
        });
      }
      const result = await reverseWithAmap(latitude, longitude, key);
      if (!result) return json(allowedOrigin, 404, { error: "No road-level address found" });
      return json(allowedOrigin, 200, result);
    }

    const result = await reverseWithOsm(latitude, longitude, language);
    if (!result) return json(allowedOrigin, 404, { error: "No road-level address found" });
    return json(allowedOrigin, 200, result);
  } catch (error) {
    console.error("reverse-geocode", error);
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return json(allowedOrigin, timedOut ? 504 : 502, {
      error: timedOut ? "Address service timed out" : "Address service unavailable",
      code: timedOut ? "ADDRESS_TIMEOUT" : "ADDRESS_UNAVAILABLE",
    });
  }
});
