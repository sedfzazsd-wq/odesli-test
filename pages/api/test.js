export default async function handler(req, res) {
    // 固定测试一首歌（Apple Music 链接）
    const appleUrl =
        "https://music.apple.com/us/album/shape-of-you/1193701079?i=1193701359";

    const api =
        "https://song.link/api/links?url=" + encodeURIComponent(appleUrl);

    // 请求 Odesli
    const r = await fetch(api, {
        headers: {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (VercelTest/1.0)"
        }
    });

    // 返回状态码
    res.status(r.status).send(await r.text());
}
