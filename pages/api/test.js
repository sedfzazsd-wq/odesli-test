export default async function handler(req, res) {
    try {
        const appleUrl =
            "https://music.apple.com/us/album/shape-of-you/1193701079?i=1193701359";

        const api =
            "https://song.link/api/links?url=" + encodeURIComponent(appleUrl);

        const r = await fetch(api, {
            headers: {
                Accept: "application/json",
                "User-Agent": "Mozilla/5.0 (OdesliTest/1.0)"
            }
        });

        const text = await r.text();

        // 关键：用 res 返回（不要 return Response）
        res.status(r.status).send(text);
    } catch (e) {
        // 关键：任何错误都返回 500，而不是让模块挂掉
        res.status(500).json({ error: String(e) });
    }
}
