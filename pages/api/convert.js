import { createHash } from 'crypto';

const ALLOWED_ORIGINS = [
    'https://lumiwavestudio.com',
    'https://www.lumiwavestudio.com',
    'http://localhost:3000'
];

const ALLOWED_ORIGIN_PATTERNS = [
    /^https:\/\/[a-z0-9-]+\.myshopify\.com$/
];

function isAllowedOrigin(origin) {
    if (!origin) return false;
    if (ALLOWED_ORIGINS.includes(origin)) return true;
    return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

function firstQueryValue(value) {
    if (Array.isArray(value)) return value[0];
    return value;
}

function isTruthy(value) {
    const text = String(firstQueryValue(value) || '').trim().toLowerCase();
    return text === '1' || text === 'true' || text === 'yes' || text === 'on';
}

function normalizeMode(value) {
    const text = String(firstQueryValue(value) || '').trim().toLowerCase();
    if (text === 'links' || text === 'link' || text === 'lite' || text === 'minimal') return 'links';
    if (text === 'code' || text === 'spotifycode' || text === 'spotify_code') return 'code';
    return 'full';
}

function resolveIncludeYoutube({ query, mode }) {
    const raw = firstQueryValue(query && (query.include_youtube ?? query.youtube ?? query.yt));
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        // Default: full mode includes youtube; other modes prioritize speed.
        return mode === 'full';
    }
    const text = String(raw).trim().toLowerCase();
    if (text === '0' || text === 'false' || text === 'no' || text === 'off') return false;
    if (text === '1' || text === 'true' || text === 'yes' || text === 'on') return true;
    return mode === 'full';
}

const CACHE_WORKER_URL = process.env.CONVERT_CACHE_WORKER_URL || 'https://soundwave-music.sedfzazsd.workers.dev';
const CACHE_WORKER_AUTH = process.env.CACHE_AUTH_KEY || '';

function sha256Hex(input) {
    return createHash('sha256').update(String(input || ''), 'utf8').digest('hex');
}

function buildSpotifyCodeUrls(uri) {
    return {
        spotify_code_black: `https://scannables.scdn.co/uri/plain/png/FFFFFF/black/640/${uri}`,
        spotify_code_white: `https://scannables.scdn.co/uri/plain/png/000000/white/640/${uri}`,
        spotify_code_black_sm: `https://scannables.scdn.co/uri/plain/png/FFFFFF/black/320/${uri}`,
        spotify_code_white_sm: `https://scannables.scdn.co/uri/plain/png/000000/white/320/${uri}`,
        spotify_code_black_svg: `https://scannables.scdn.co/uri/plain/svg/FFFFFF/black/640/${uri}`,
        spotify_code_white_svg: `https://scannables.scdn.co/uri/plain/svg/000000/white/640/${uri}`,
        spotify_code_black_svg_sm: `https://scannables.scdn.co/uri/plain/svg/FFFFFF/black/320/${uri}`,
        spotify_code_white_svg_sm: `https://scannables.scdn.co/uri/plain/svg/000000/white/320/${uri}`
    };
}

function parseSpotifyUrlToUri(rawUrl) {
    if (!rawUrl) return null;
    let url;
    try {
        url = new URL(String(rawUrl));
    } catch (_) {
        return null;
    }

    if (url.hostname !== 'open.spotify.com') return null;

    const segments = url.pathname.split('/').filter(Boolean);
    if (!segments.length) return null;

    // Handle /intl-xx/... and /embed/... wrappers.
    let i = 0;
    if (segments[i] && segments[i].startsWith('intl-')) i++;
    if (segments[i] === 'embed') i++;

    // Handle legacy /user/{userId}/playlist/{playlistId}
    if (segments[i] === 'user' && segments[i + 2] && segments[i + 3]) {
        i += 2;
    }

    const type = segments[i];
    const id = segments[i + 1];
    if (!type || !id) return null;

    const allowedTypes = new Set(['track', 'album', 'artist', 'playlist', 'episode', 'show']);
    if (!allowedTypes.has(type)) return null;
    if (!/^[A-Za-z0-9]{22}$/.test(id)) return null;

    return {
        spotifyUrl: `https://open.spotify.com/${type}/${id}`,
        spotifyUri: `spotify:${type}:${id}`
    };
}

function normalizeAppleMusicUrl(rawUrl) {
    if (!rawUrl) return '';
    let url;
    try {
        url = new URL(String(rawUrl));
    } catch (_) {
        return String(rawUrl);
    }

    const host = url.hostname;
    const isAppleHost = host === 'music.apple.com'
        || host === 'geo.music.apple.com'
        || host === 'itunes.apple.com';
    if (!isAppleHost) return url.toString();

    const parts = url.pathname.split('/').filter(Boolean);
    const country = parts[0] && parts[0].length === 2 ? parts[0] : 'us';

    let trackId = url.searchParams.get('i');
    if (!trackId) {
        const last = parts[parts.length - 1];
        if (parts.includes('song') && /^\d+$/.test(last)) {
            trackId = last;
        }
    }

    if (!trackId || !/^\d+$/.test(trackId)) {
        return url.toString();
    }

    return `https://music.apple.com/${country}/song/_/${trackId}`;
}

function buildCacheKey({ inputUrl, inputUri }) {
    const raw = inputUri
        ? `uri:${String(inputUri).trim()}`
        : `url:${String(inputUrl || '').trim()}`;
    return sha256Hex(raw);
}

function isDebugEnabled(value) {
    if (Array.isArray(value)) value = value[0];
    const text = String(value || '').trim().toLowerCase();
    return text === '1' || text === 'true' || text === 'yes';
}

function sendJson(res, status, payload, debugInfo) {
    const body = debugInfo ? { ...payload, debug: debugInfo } : payload;
    return res.status(status).json(body);
}

function filterPayloadForMode(payload, mode) {
    if (!payload || typeof payload !== 'object') return payload;
    if (mode !== 'links') return payload;

    const out = {
        spotify_url: payload.spotify_url || null,
        spotify_uri: payload.spotify_uri || null,
        youtube_url: payload.youtube_url ?? null,
        cache_hit: !!payload.cache_hit
    };

    if (payload.input_url) out.input_url = payload.input_url;
    if (payload.input_uri) out.input_uri = payload.input_uri;
    return out;
}

function sanitizePayloadForRequest(payload, { mode, includeYoutube }) {
    const filtered = filterPayloadForMode(payload, mode);
    if (!filtered || typeof filtered !== 'object') return filtered;
    if (!includeYoutube) {
        // Respect yt/include_youtube opt-out even if cache contains a value.
        filtered.youtube_url = null;
    }
    return filtered;
}

async function readWorkerCache(cacheKey, debugInfo) {
    if (!CACHE_WORKER_URL || !cacheKey) {
        if (debugInfo) {
            debugInfo.cacheRead = {
                skipped: true,
                reason: !CACHE_WORKER_URL ? 'missing_worker_url' : 'missing_key'
            };
        }
        return null;
    }
    try {
        const url = `${CACHE_WORKER_URL}/odesli-cache?key=${encodeURIComponent(cacheKey)}`;
        const r = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'X-Custom-Auth': CACHE_WORKER_AUTH
            }
        });
        if (debugInfo) {
            debugInfo.cacheRead = {
                attempted: true,
                status: r.status,
                ok: r.ok,
                hit: false
            };
        }
        if (r.status === 404) return null;
        if (!r.ok) return null;
        const data = await r.json();
        if (debugInfo && debugInfo.cacheRead) {
            debugInfo.cacheRead.hit = true;
        }
        return data;
    } catch (_) {
        if (debugInfo) {
            debugInfo.cacheRead = { error: 'read_failed' };
        }
        return null;
    }
}

async function writeWorkerCache(cacheKey, payload, debugInfo) {
    if (!CACHE_WORKER_URL || !cacheKey || !payload) {
        if (debugInfo) {
            debugInfo.cacheWrite = {
                skipped: true,
                reason: !CACHE_WORKER_URL ? 'missing_worker_url' : (!cacheKey ? 'missing_key' : 'missing_payload')
            };
        }
        return false;
    }
    try {
        const url = `${CACHE_WORKER_URL}/odesli-cache?key=${encodeURIComponent(cacheKey)}`;
        const r = await fetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Custom-Auth': CACHE_WORKER_AUTH
            },
            body: JSON.stringify(payload)
        });
        if (debugInfo) {
            debugInfo.cacheWrite = {
                attempted: true,
                status: r.status,
                ok: r.ok
            };
        }
        return r.ok;
    } catch (_) {
        if (debugInfo) {
            debugInfo.cacheWrite = { error: 'write_failed' };
        }
        return false;
    }
}

export default async function handler(req, res) {
    const debugEnabled = isDebugEnabled(req.query && req.query.debug);
    const debugInfo = debugEnabled ? {
        cacheWorkerUrl: CACHE_WORKER_URL,
        cacheAuthConfigured: !!CACHE_WORKER_AUTH
    } : null;

    const requestedModeRaw = firstQueryValue(req.query && req.query.mode);
    let mode = normalizeMode(requestedModeRaw);
    if (!requestedModeRaw && isTruthy(req.query && req.query.lite)) {
        mode = 'links';
    }
    const includeYoutube = resolveIncludeYoutube({ query: req.query, mode });
    if (debugInfo) {
        debugInfo.mode = mode;
        debugInfo.includeYoutube = includeYoutube;
    }

    const origin = req.headers.origin || '';
    const allowed = isAllowedOrigin(origin);
    if (!allowed) {
        return sendJson(res, 403, { error: 'Forbidden' }, debugInfo);
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader(
        "Access-Control-Allow-Headers",
        req.headers['access-control-request-headers'] || 'Content-Type'
    );
    if (req.method === 'OPTIONS') return res.status(200).end();

    const inputUrl = firstQueryValue(req.query && req.query.url);
    const inputUri = firstQueryValue(req.query && req.query.uri);
    if (debugInfo) {
        debugInfo.input = { url: inputUrl || null, uri: inputUri || null };
    }
    if (!inputUrl && !inputUri) return sendJson(res, 400, { error: "missing url or uri" }, debugInfo);

    // uri-mode is deterministic: avoid cache worker round-trip.
    if (inputUri) {
        const uri = String(inputUri).trim();
        const parts = uri.split(':');
        if (parts.length !== 3 || parts[0] !== 'spotify') {
            return sendJson(res, 400, { error: "invalid uri format" }, debugInfo);
        }
        const [, type, id] = parts;
        const spotifyUrl = `https://open.spotify.com/${type}/${id}`;
        const base = {
            input_uri: uri,
            spotify_url: spotifyUrl,
            spotify_uri: uri,
            youtube_url: null,
            cache_hit: false
        };
        const payload = mode === 'links' ? base : { ...base, ...buildSpotifyCodeUrls(uri) };

        // Vercel CDN cache (success only)
        res.setHeader(
            "Cache-Control",
            "public, s-maxage=86400, stale-while-revalidate=604800"
        );
        return sendJson(res, 200, sanitizePayloadForRequest(payload, { mode, includeYoutube }), debugInfo);
    }

    const normalizedUrl = inputUrl ? normalizeAppleMusicUrl(String(inputUrl)) : '';
    const effectiveUrl = normalizedUrl || inputUrl;

    // Fast-path: if caller doesn't need YouTube resolution, skip odesli for Spotify URLs.
    const spotifyParsed = parseSpotifyUrlToUri(effectiveUrl);
    if (spotifyParsed && !includeYoutube) {
        const base = {
            input_url: inputUrl,
            spotify_url: spotifyParsed.spotifyUrl,
            spotify_uri: spotifyParsed.spotifyUri,
            youtube_url: null,
            cache_hit: false
        };
        const payload = mode === 'links' ? base : { ...base, ...buildSpotifyCodeUrls(spotifyParsed.spotifyUri) };

        // Vercel CDN cache (success only)
        res.setHeader(
            "Cache-Control",
            "public, s-maxage=86400, stale-while-revalidate=604800"
        );
        return sendJson(res, 200, sanitizePayloadForRequest(payload, { mode, includeYoutube }), debugInfo);
    }

    const cacheKey = buildCacheKey({ inputUrl: effectiveUrl, inputUri });
    if (debugInfo) {
        debugInfo.normalizedUrl = normalizedUrl || null;
        debugInfo.effectiveUrl = effectiveUrl || null;
        debugInfo.cacheKey = cacheKey || null;
        debugInfo.cacheKeySource = inputUri ? 'uri' : 'url';
    }
    const cached = await readWorkerCache(cacheKey, debugInfo);
    if (cached && typeof cached === 'object') {
      res.setHeader(
        "Cache-Control",
        "public, s-maxage=86400, stale-while-revalidate=604800"
      );
         const payload = { ...cached, cache_hit: true };
         return sendJson(res, 200, sanitizePayloadForRequest(payload, { mode, includeYoutube }), debugInfo);
     }

    const api = "https://api.song.link/v1-alpha.1/links?url=" + encodeURIComponent(String(effectiveUrl));

    try {
        const r = await fetch(api, {
            headers: {
                Accept: "application/json",
                "User-Agent": "Mozilla/5.0 (OdesliConvert/1.0)"
            }
        });

        if (r.status === 429) {
            const ra = r.headers.get("retry-after");
            if (ra) res.setHeader("Retry-After", ra);
            res.setHeader('Cache-Control', 'no-store');
            return sendJson(res, 429, { error: "odesli rate limited", retry_after: ra || null }, debugInfo);
        }

        if (!r.ok) {
            res.setHeader('Cache-Control', 'no-store');
            return sendJson(res, r.status, { error: `odesli ${r.status}`, body: await r.text() }, debugInfo);
        }

        let data;
        const clone = r.clone();
        try {
            data = await r.json();
        } catch (err) {
            res.setHeader('Cache-Control', 'no-store');
            const body = await clone.text().catch(() => '');
            return sendJson(res, 502, {
                error: 'odesli invalid json',
                message: String(err),
                body: String(body).slice(0, 300)
            }, debugInfo);
        }

        const spotifyLink = data?.linksByPlatform?.spotify || null;
        const spotifyUrl = spotifyLink?.url || null;
        const youtubeLink = data?.linksByPlatform?.youtube || data?.linksByPlatform?.youtubeMusic || null;
        const youtubeUrl = youtubeLink?.url || null;
        let uri = spotifyLink?.nativeAppUriDesktop || spotifyLink?.nativeAppUriMobile || null;
        if (!spotifyUrl) {
            res.setHeader('Cache-Control', 'no-store');
            return sendJson(res, 404, { error: "no spotify match" }, debugInfo);
        }

        if (!uri) {
            // Fallback: parse open.spotify.com/{type}/{id}
            const u = new URL(spotifyUrl);
            const [type, id] = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
            if (!type || !id) {
                res.setHeader('Cache-Control', 'no-store');
                return sendJson(res, 500, { error: "cannot parse spotify url", spotify_url: spotifyUrl }, debugInfo);
            }
            uri = `spotify:${type}:${id}`;
        }

         // 真实 Spotify Code（PNG/SVG）
         const codeUrls = buildSpotifyCodeUrls(uri);

        // Vercel CDN cache (success only)
        res.setHeader(
            "Cache-Control",
            "public, s-maxage=86400, stale-while-revalidate=604800"
        );

         const payload = {
             input_url: inputUrl,
             spotify_url: spotifyUrl,
             spotify_uri: uri,
             ...codeUrls,
             youtube_url: youtubeUrl,
             cache_hit: false
         };

        // Cache write (best-effort)
        await writeWorkerCache(cacheKey, payload, debugInfo);

          return sendJson(res, 200, sanitizePayloadForRequest(payload, { mode, includeYoutube }), debugInfo);
    } catch (e) {
        res.setHeader('Cache-Control', 'no-store');
        return sendJson(res, 500, { error: "fetch failed", message: String(e) }, debugInfo);
    }
}
