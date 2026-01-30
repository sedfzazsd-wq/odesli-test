export default async function handler(req, res) {
    const inputUrl = req.query.url;
    const inputUri = req.query.uri;
    if (!inputUrl && !inputUri) return res.status(400).json({ error: "missing url or uri" });

    // 建议加：Vercel CDN 缓存，减少 Odesli 请求次数，降低 429 概率
    res.setHeader(
        "Cache-Control",
        "public, s-maxage=86400, stale-while-revalidate=604800"
    );

    if (inputUri) {
        const parts = String(inputUri).split(':');
        if (parts.length !== 3 || parts[0] !== 'spotify') {
            return res.status(400).json({ error: "invalid uri format" });
        }
        const [, type, id] = parts;
        const spotifyUrl = `https://open.spotify.com/${type}/${id}`;
        const codeBlackOnWhite = `https://scannables.scdn.co/uri/plain/png/000000/white/640/${inputUri}`;
        const codeWhiteOnBlack = `https://scannables.scdn.co/uri/plain/png/FFFFFF/000000/640/${inputUri}`;

        return res.status(200).json({
            input_uri: inputUri,
            spotify_url: spotifyUrl,
            spotify_uri: inputUri,
            spotify_code_png: codeBlackOnWhite,
            spotify_code_png_invert: codeWhiteOnBlack
        });
    }

    const api = "https://song.link/api/links?url=" + encodeURIComponent(inputUrl);

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
            return res.status(429).json({ error: "odesli rate limited", retry_after: ra || null });
        }

        if (!r.ok) {
            return res.status(r.status).json({ error: `odesli ${r.status}`, body: await r.text() });
        }

        const data = await r.json();
        const spotifyUrl = data?.linksByPlatform?.spotify?.url || null;
        if (!spotifyUrl) return res.status(404).json({ error: "no spotify match" });

        // 解析 open.spotify.com/{type}/{id}
        const u = new URL(spotifyUrl);
        const [type, id] = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
        if (!type || !id) {
            return res.status(500).json({ error: "cannot parse spotify url", spotify_url: spotifyUrl });
        }

        const uri = `spotify:${type}:${id}`;

        // 真实 Spotify Code（PNG）
        const codeBlackOnWhite = `https://scannables.scdn.co/uri/plain/png/000000/white/640/${uri}`;
        const codeWhiteOnBlack = `https://scannables.scdn.co/uri/plain/png/FFFFFF/000000/640/${uri}`;

        return res.status(200).json({
            input_url: inputUrl,
            spotify_url: spotifyUrl,
            spotify_uri: uri,
            spotify_code_png: codeBlackOnWhite,
            spotify_code_png_invert: codeWhiteOnBlack
        });
    } catch (e) {
        return res.status(500).json({ error: "fetch failed", message: String(e) });
    }
}
