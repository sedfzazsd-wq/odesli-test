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

const CACHE_WORKER_URL = process.env.CONVERT_CACHE_WORKER_URL || 'https://soundwave-music.sedfzazsd.workers.dev';
const CACHE_WORKER_AUTH = process.env.CONVERT_CACHE_AUTH_KEY || 'Soundwave2025ShopifyKey!';

function sha256Hex(input) {
    return createHash('sha256').update(String(input || ''), 'utf8').digest('hex');
}

function buildCacheKey({ inputUrl, inputUri }) {
    const raw = inputUri
        ? `uri:${String(inputUri).trim()}`
        : `url:${String(inputUrl || '').trim()}`;
    return sha256Hex(raw);
}

async function readWorkerCache(cacheKey) {
    if (!CACHE_WORKER_URL || !cacheKey) return null;
    try {
        const url = `${CACHE_WORKER_URL}/odesli-cache?key=${encodeURIComponent(cacheKey)}`;
        const r = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'X-Custom-Auth': CACHE_WORKER_AUTH
            }
        });
        if (r.status === 404) return null;
        if (!r.ok) return null;
        return await r.json();
    } catch (_) {
        return null;
    }
}

async function writeWorkerCache(cacheKey, payload) {
    if (!CACHE_WORKER_URL || !cacheKey || !payload) return false;
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
        return r.ok;
    } catch (_) {
        return false;
    }
}

export default async function handler(req, res) {
    const origin = req.headers.origin || '';
    const allowed = isAllowedOrigin(origin);
    if (!allowed) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader(
        "Access-Control-Allow-Headers",
        req.headers['access-control-request-headers'] || 'Content-Type'
    );
    if (req.method === 'OPTIONS') return res.status(200).end();

    const inputUrl = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;
    const inputUri = Array.isArray(req.query.uri) ? req.query.uri[0] : req.query.uri;
    if (!inputUrl && !inputUri) return res.status(400).json({ error: "missing url or uri" });

    const cacheKey = buildCacheKey({ inputUrl, inputUri });
    const cached = await readWorkerCache(cacheKey);
    if (cached && typeof cached === 'object') {
        res.setHeader(
            "Cache-Control",
            "public, s-maxage=86400, stale-while-revalidate=604800"
        );
        return res.status(200).json(cached);
    }

    if (inputUri) {
        const uri = String(inputUri).trim();
        const parts = uri.split(':');
        if (parts.length !== 3 || parts[0] !== 'spotify') {
            return res.status(400).json({ error: "invalid uri format" });
        }
        const [, type, id] = parts;
        const spotifyUrl = `https://open.spotify.com/${type}/${id}`;
        const codeBlackBar = `https://scannables.scdn.co/uri/plain/png/FFFFFF/black/640/${uri}`;
        const codeWhiteBar = `https://scannables.scdn.co/uri/plain/png/000000/white/640/${uri}`;
        const codeBlackBarSm = `https://scannables.scdn.co/uri/plain/png/FFFFFF/black/320/${uri}`;
        const codeWhiteBarSm = `https://scannables.scdn.co/uri/plain/png/000000/white/320/${uri}`;
        const codeBlackBarSvg = `https://scannables.scdn.co/uri/plain/svg/FFFFFF/black/640/${uri}`;
        const codeWhiteBarSvg = `https://scannables.scdn.co/uri/plain/svg/000000/white/640/${uri}`;
        const codeBlackBarSvgSm = `https://scannables.scdn.co/uri/plain/svg/FFFFFF/black/320/${uri}`;
        const codeWhiteBarSvgSm = `https://scannables.scdn.co/uri/plain/svg/000000/white/320/${uri}`;

        // Vercel CDN cache (success only)
        res.setHeader(
            "Cache-Control",
            "public, s-maxage=86400, stale-while-revalidate=604800"
        );

        return res.status(200).json({
            input_uri: uri,
            spotify_url: spotifyUrl,
            spotify_uri: uri,
            spotify_code_black: codeBlackBar,
            spotify_code_white: codeWhiteBar,
            spotify_code_black_sm: codeBlackBarSm,
            spotify_code_white_sm: codeWhiteBarSm,
            spotify_code_black_svg: codeBlackBarSvg,
            spotify_code_white_svg: codeWhiteBarSvg,
            spotify_code_black_svg_sm: codeBlackBarSvgSm,
            spotify_code_white_svg_sm: codeWhiteBarSvgSm,
            youtube_url: null
        });
    }

    const api = "https://api.song.link/v1-alpha.1/links?url=" + encodeURIComponent(String(inputUrl));

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
            return res.status(429).json({ error: "odesli rate limited", retry_after: ra || null });
        }

        if (!r.ok) {
            res.setHeader('Cache-Control', 'no-store');
            return res.status(r.status).json({ error: `odesli ${r.status}`, body: await r.text() });
        }

        let data;
        const clone = r.clone();
        try {
            data = await r.json();
        } catch (err) {
            res.setHeader('Cache-Control', 'no-store');
            const body = await clone.text().catch(() => '');
            return res.status(502).json({
                error: 'odesli invalid json',
                message: String(err),
                body: String(body).slice(0, 300)
            });
        }

        const spotifyLink = data?.linksByPlatform?.spotify || null;
        const spotifyUrl = spotifyLink?.url || null;
        const youtubeLink = data?.linksByPlatform?.youtube || data?.linksByPlatform?.youtubeMusic || null;
        const youtubeUrl = youtubeLink?.url || null;
        let uri = spotifyLink?.nativeAppUriDesktop || spotifyLink?.nativeAppUriMobile || null;
        if (!spotifyUrl) {
            res.setHeader('Cache-Control', 'no-store');
            return res.status(404).json({ error: "no spotify match" });
        }

        if (!uri) {
            // Fallback: parse open.spotify.com/{type}/{id}
            const u = new URL(spotifyUrl);
            const [type, id] = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
            if (!type || !id) {
                res.setHeader('Cache-Control', 'no-store');
                return res.status(500).json({ error: "cannot parse spotify url", spotify_url: spotifyUrl });
            }
            uri = `spotify:${type}:${id}`;
        }

        // 真实 Spotify Code（PNG/SVG）
        const codeBlackBar = `https://scannables.scdn.co/uri/plain/png/FFFFFF/black/640/${uri}`;
        const codeWhiteBar = `https://scannables.scdn.co/uri/plain/png/000000/white/640/${uri}`;
        const codeBlackBarSm = `https://scannables.scdn.co/uri/plain/png/FFFFFF/black/320/${uri}`;
        const codeWhiteBarSm = `https://scannables.scdn.co/uri/plain/png/000000/white/320/${uri}`;
        const codeBlackBarSvg = `https://scannables.scdn.co/uri/plain/svg/FFFFFF/black/640/${uri}`;
        const codeWhiteBarSvg = `https://scannables.scdn.co/uri/plain/svg/000000/white/640/${uri}`;
        const codeBlackBarSvgSm = `https://scannables.scdn.co/uri/plain/svg/FFFFFF/black/320/${uri}`;
        const codeWhiteBarSvgSm = `https://scannables.scdn.co/uri/plain/svg/000000/white/320/${uri}`;

        // Vercel CDN cache (success only)
        res.setHeader(
            "Cache-Control",
            "public, s-maxage=86400, stale-while-revalidate=604800"
        );

        const payload = {
            input_url: inputUrl,
            spotify_url: spotifyUrl,
            spotify_uri: uri,
            spotify_code_black: codeBlackBar,
            spotify_code_white: codeWhiteBar,
            spotify_code_black_sm: codeBlackBarSm,
            spotify_code_white_sm: codeWhiteBarSm,
            spotify_code_black_svg: codeBlackBarSvg,
            spotify_code_white_svg: codeWhiteBarSvg,
            spotify_code_black_svg_sm: codeBlackBarSvgSm,
            spotify_code_white_svg_sm: codeWhiteBarSvgSm,
            youtube_url: youtubeUrl
        };

        // Cache write (best-effort)
        await writeWorkerCache(cacheKey, payload);

        return res.status(200).json(payload);
    } catch (e) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(500).json({ error: "fetch failed", message: String(e) });
    }
}
