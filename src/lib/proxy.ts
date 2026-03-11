import { serverOrigin } from "..";
import { DirectSource } from "./types";

export function proxifySource(source: DirectSource): DirectSource {
    const { type, url, headers } = source;
    const headerQuery = headers ? "&headers=" +encodeURIComponent(JSON.stringify(headers)) : "";

    const encodedUrl = encodeURIComponent(url);

    const finalUrl = type == "hls" ? `${serverOrigin}/m3u8-proxy?url=${encodedUrl}${headerQuery}` :
        `${serverOrigin}/mp4-proxy?url=${encodedUrl}${headerQuery}`

    return {
        proxiedUrl: finalUrl,
        ...source,
    };
} 