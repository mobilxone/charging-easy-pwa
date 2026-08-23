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

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
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
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders(allowedOrigin),
    });
  }

  try {
    const body = await request.json();
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    const language = clean(body.language || "zh-CN,zh,en").slice(0, 48);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return new Response(JSON.stringify({ error: "Invalid coordinates" }), {
        status: 400,
        headers: corsHeaders(allowedOrigin),
      });
    }

    const query = new URLSearchParams({
      format: "geocodejson",
      addressdetails: "1",
      layer: "address",
      zoom: "17",
      lat: String(latitude),
      lon: String(longitude),
      "accept-language": language,
    });
    const response = await fetch("https://nominatim.openstreetmap.org/reverse?" + query, {
      headers: {
        Accept: "application/geocode+json, application/json",
        "User-Agent": "ChargingEasy/1.3.9 (+https://chargingeasy.pages.dev/)",
      },
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) throw new Error("Nominatim request failed: " + response.status);

    const payload = await response.json();
    const geocoding = payload?.features?.[0]?.properties?.geocoding;
    const city = clean(geocoding?.city || geocoding?.county || geocoding?.state);
    const district = clean(geocoding?.district || geocoding?.locality);
    const road = clean(geocoding?.street || (geocoding?.type === "street" ? geocoding?.name : ""));
    const place = [...new Set([district, road].filter((part) => part && part !== city))].join(" ");
    if (!city || !place) {
      return new Response(JSON.stringify({ error: "No road-level address found" }), {
        status: 404,
        headers: corsHeaders(allowedOrigin),
      });
    }

    return new Response(JSON.stringify({
      city: city.slice(0, 30),
      place: place.slice(0, 80),
      attribution: "© OpenStreetMap contributors",
    }), {
      status: 200,
      headers: corsHeaders(allowedOrigin),
    });
  } catch (error) {
    console.error("reverse-geocode", error);
    return new Response(JSON.stringify({ error: "Address service unavailable" }), {
      status: 502,
      headers: corsHeaders(allowedOrigin),
    });
  }
});
