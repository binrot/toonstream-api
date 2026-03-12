import { cors } from "@elysiajs/cors";
import { Elysia, t } from "elysia";
import { Cache, redis } from "./lib/cache";
import { isTooLarge } from "./lib/helper";
import { Logger } from "./lib/logger";
import { ScrapeHomePage } from "./scrapers/home";
import { ScrapeMovieInfo, ScrapeMovies, ScrapeMovieSources } from "./scrapers/movie";
import { ScrapeSearch } from "./scrapers/search";
import { ScrapeEpisodeSources, ScrapeSeries, ScrapeSeriesInfo } from "./scrapers/series";

const HOME_CACHE_TTL = 43_200 // 12hr
const SEARCH_CACHE_TTL = 43_200 // 12hr

const MOVIES_PAGE_CACHE_TTL = 3600 * 24 * 30 // 30 days
const SERIES_PAGE_CACHE_TTL = 3600 * 24 * 30  // 30 days

const MOVIE_INFO_CACHE_TTL = 3600 * 24 * 14 // 14 days
const SERIES_INFO_CACHE_TTL = 3600 * 24 * 3 // 3 days





export const SERVER_ORIGIN = Bun.env.SERVER_ORIGIN || "";
export const PROXIFY = Boolean(Bun.env.PROXIFY) || false;

if (!SERVER_ORIGIN) throw new Error("set SERVER_ORIGIN at .env!");

console.log("auto source proxy is ", PROXIFY);

const envOrigins = Bun.env.ALLOWED_ORIGINS;

const ALLOWED_ORIGINS: string[] | "*" = envOrigins
  ? envOrigins.split(",").map((o: string) => o.trim().replace(/\/$/, ""))
  : "*";


// for proxy safety
const MAX_M3U8_SIZE = 5 * 1024 * 1024;       // 5 MB
const MAX_TS_SIZE = 50 * 1024 * 1024;        // 50 MB
const MAX_FETCH_SIZE = 50 * 1024 * 1024;     // 50 MB
const MAX_MP4_SIZE = 20 * 1024 * 1024 * 1024; // 20 GB

// const PLAYLIST_REGEX = /\.m3u|playlist|\.txt/i
const PLAYLIST_REGEX = /\.m3u|playlist|\.txt|^(?!.*\.(?:js|css|gif|jpg|png|svg|woff|woff2|ttf|ts|mp4|m4s|aac|key|vtt)(?:[?#].*)?$).*$/i;



const app = new Elysia()
  .use(cors({
    origin: "*"
  }))
  .get("/", () => {
    return {
      name: "toonstream-api",
      version: "0.1",
      endpoints: [
        "/home",
        "/search/{query}/{page}",
        "----------------------",
        "/movies/{page}",
        "/movie/info/{slug}",
        "/movie/sources/{url}",
        "----------------------",
        "/series/{page}",
        "/series/info/{slug}",
        "/episode/sources/{slug}",
        "----------------------",
        "/m3u8-proxy?url={url}&headers={encodedHeaders}",
        "/ts-segment?url={url}&headers={encodedHeaders}",
        "/fetch?url={url}&headers={encodedHeaders}",
        "/mp4-proxy?url={url}&headers=",
      ],
    };
  })
  .get("/home", async () => {
    const then = performance.now();
    // serve cache if has
    const cachedHomeData = await Cache.get("home", true);
    if (cachedHomeData)
      return {
        success: true,
        served_cache: true,
        took_ms: (performance.now() - then).toFixed(2),
        data: cachedHomeData
      };

    const data = await ScrapeHomePage();

    if (data?.lastEpisodes || data?.main || data?.sidebar) {
      Cache.set("home", true, data, HOME_CACHE_TTL); // dont await
    }

    if (data)
      return {
        success: true,
        took_ms: (performance.now() - then).toFixed(2),
        data: data,
        served_cache: false,
      };
    else
      return {
        success: false,
        took_ms: (performance.now() - then).toFixed(2),
        msg: "No Data Scraped!",
      };
  })

  .get("/search/:query/:page?",
    async ({ params: { query, page } }) => {
      const then = performance.now();

      const key = `search:${query}:${page || 1}`;
      const cachedSearchData = await Cache.get(key, true);
      if (cachedSearchData)
        return {
          success: true,
          served_cache: true,
          took_ms: (performance.now() - then).toFixed(2),
          data: cachedSearchData
        };

      const data = await ScrapeSearch(query, page);

      if (data?.data) {
        Cache.set(key, true, data, SEARCH_CACHE_TTL); // dont await
      }

      if (data)
        return {
          success: true,
          served_cache: false,
          took_ms: (performance.now() - then).toFixed(2),
          data: data,
        };
      else
        return {
          success: false,
          took_ms: (performance.now() - then).toFixed(2),
          msg: "No Data Scraped!",
        };
    },
    {
      params: t.Object({
        query: t.String(),
        page: t.Optional(t.Number()),
      }),
    }
  )

  .get("/movies/:page?",
    async ({ params: { page } }) => {
      const then = performance.now();
      const key = `movies:${page || 1}`;
      const cachedMoviesData = await Cache.get(key, true);


      if (cachedMoviesData)
        return {
          success: true,
          served_cache: true,
          page: page || 1,
          took_ms: (performance.now() - then).toFixed(2),
          data: cachedMoviesData
        };

      const data = await ScrapeMovies(page);

      if (data?.data) {
        Cache.set(key, true, data, MOVIES_PAGE_CACHE_TTL); // dont await
      }

      if (data) {
        return {
          success: true,
          served_cache: false,
          took_ms: (performance.now() - then).toFixed(2),
          page: page || 1,
          data: data,
        };
      }
      else
        return {
          success: false,
          took_ms: (performance.now() - then).toFixed(2),
          page: page || 1,
          msg: "No Data Scraped!",
        };
    },
    {
      params: t.Object({
        page: t.Optional(t.Number()),
      }),
    }
  )
  .get("/movie/info/:slug", async ({ params: { slug } }) => {

    const then = performance.now();
    const key = `movie:info:${slug}`;
    const cachedMovieData = await Cache.get(key, true);

    if (cachedMovieData)
      return {
        success: true,
        served_cache: true,
        took_ms: (performance.now() - then).toFixed(2),
        data: cachedMovieData
      };

    const data = await ScrapeMovieInfo(slug);

    if (data) {
      Cache.set(key, true, data, MOVIE_INFO_CACHE_TTL); // dont await

      return {
        success: true,
        served_cache: false,
        took_ms: (performance.now() - then).toFixed(2),
        data: data,
      };
    }

    else
      return {
        success: false,
        took_ms: (performance.now() - then).toFixed(2),
        msg: "No Data Scraped!",
      };
  })
  .get("/movie/sources/:slug/", async ({ params: { slug } }) => {
    const then = performance.now();

    const data = await ScrapeMovieSources(slug);

    if (data)
      return {
        success: true,
        took_ms: (performance.now() - then).toFixed(2),
        data: data,
      };
    else
      return {
        success: false,
        took_ms: (performance.now() - then).toFixed(2),
        msg: "No Data Scraped!",
      };
  })

  .get("/series/:page?",
    async ({ params: { page } }) => {
      const then = performance.now();
      const key = `series:${page}`;

      const cachedData = await Cache.get(key, true);

      if (cachedData)
        return {
          success: true,
          served_cache: true,
          page: page || 1,
          took_ms: (performance.now() - then).toFixed(2),
          data: cachedData
        };

      const data = await ScrapeSeries(page);

      if (data?.data) {
        Cache.set(key, true, data, SERIES_PAGE_CACHE_TTL); // dont await
      }

      if (data) {
        return {
          success: true,
          served_cache: false,
          took_ms: (performance.now() - then).toFixed(2),
          page: page || 1,
          data: data,
        };
      }
      else
        return {
          success: false,
          took_ms: (performance.now() - then).toFixed(2),
          page: page || 1,
          msg: "No Data Scraped!",
        };
    },
    {
      params: t.Object({
        page: t.Optional(t.Number()),
      }),
    }
  )
  .get("/series/info/:slug", async ({ params: { slug } }) => {
    const then = performance.now();
    const key = `series:info:${slug}`;

    const cachedData = await Cache.get(key, true);

    if (cachedData)
      return {
        success: true,
        served_cache: true,
        took_ms: (performance.now() - then).toFixed(2),
        data: cachedData
      };

    const data = await ScrapeSeriesInfo(slug);

    if (data) {
      Cache.set(key, true, data, SERIES_INFO_CACHE_TTL); // dont await

      return {
        success: true,
        served_cache: false,
        took_ms: (performance.now() - then).toFixed(2),
        data: data,
      };
    }
    else
      return {
        success: false,
        took_ms: (performance.now() - then).toFixed(2),
        msg: "No Data Scraped!",
      };
  })
  .get("/episode/sources/:slug", async ({ params: { slug } }) => {
    const data = await ScrapeEpisodeSources(slug);
    if (data)
      return {
        success: true,
        data: data,
      };
    else
      return {
        success: false,
        msg: "No Data Scraped!",
      };
  })



  .get("/m3u8-proxy", async ({ request, query: { url, headers } }) => {
    let corsHeaders: Record<string, string> = {};

    if (headers) {
      try {
        corsHeaders = JSON.parse(decodeURIComponent(headers));
      } catch {
        return new Response("Invalid headers format", { status: 400 });
      }
    }

    corsHeaders["Connection"] = "keep-alive";

    try {
      const res = await fetch(url, {
        headers: corsHeaders,
        signal: request.signal // Abort if client disconnects
      });

      if (!res.ok) {
        console.log("Fetch failed with status:", res.status, "Url:", url)
        return new Response(res.body, { status: res.status });
      }

      // Size limit check
      if (isTooLarge(res.headers.get("content-length"), MAX_M3U8_SIZE)) {
        return new Response("File too large", { status: 413 });
      }

      const text = await res.text();
      const encodedHeaders = encodeURIComponent(headers || "");

      const proxifiedM3u8 = text.split("\n").map(line => {
        const tl = line.trim();
        if (!tl) return line;

        if (tl.startsWith("#EXT")) {
          return tl.replace(/URI="([^"]+)"/g, (_, uri) => {
            const absoluteUrl = new URL(uri, url).href;
            let proxiedUrl;
            const encodedUrl = encodeURIComponent(absoluteUrl);

            if (PLAYLIST_REGEX.test(absoluteUrl)) {
              proxiedUrl = `${SERVER_ORIGIN}/m3u8-proxy?url=${encodedUrl}${headers ? `&headers=${encodedHeaders}` : ""}`;
            } else {
              proxiedUrl = `${SERVER_ORIGIN}/fetch?url=${encodedUrl}${headers ? `&headers=${encodedHeaders}` : ""}`;
            }

            return `URI="${proxiedUrl}"`;
          })
        }

        const absoluteUrl = new URL(tl, url).href;
        const encodedUrl = encodeURIComponent(absoluteUrl);

        if (PLAYLIST_REGEX.test(absoluteUrl)) {
          return `${SERVER_ORIGIN}/m3u8-proxy?url=${encodedUrl}${headers ? `&headers=${encodedHeaders}` : ""}`;
        } else {
          return `${SERVER_ORIGIN}/ts-segment?url=${encodedUrl}${headers ? `&headers=${encodedHeaders}` : ""}`;
        }
      }).join("\n");

      return new Response(proxifiedM3u8, {
        headers: {
          "Content-Type": res.headers.get("Content-Type") || "application/vnd.apple.mpegurl",
        }
      });

    } catch (err: any) {
      if (err.name === 'AbortError') return new Response("Client disconnected", { status: 499 });
      Logger.error(err);
      return new Response("Internal Server Error", { status: 500 });
    }
  }, {
    query: t.Object({
      url: t.String(),
      headers: t.Optional(t.String())
    }),
    detail: {
      tags: ['proxy'],
      summary: 'M3U8 Playlist Proxy'
    }
  })

  .get("/ts-segment", async ({ request, query: { url, headers } }) => {
    let corsHeaders: Record<string, string> = {};

    if (headers) {
      try {
        corsHeaders = JSON.parse(decodeURIComponent(headers));
      } catch {
        return new Response("Invalid headers format", { status: 400 });
      }
    }

    // Force keep-alive for the upstream connection
    corsHeaders["Connection"] = "keep-alive";

    try {
      const res = await fetch(url, {
        headers: corsHeaders,
        signal: request.signal // Abort if client disconnects
      });

      if (!res.ok) {
        console.error("TS segment Fetch failed:", res.status, url);
        return new Response(res.body, { status: res.status });
      }

      // Size limit check
      if (isTooLarge(res.headers.get("content-length"), MAX_TS_SIZE)) {
        return new Response("Segment too large", { status: 413 });
      }

      return new Response(res.body, {
        headers: {
          "Content-Type": res.headers.get("Content-Type") || "video/MP2T",
          "Cache-Control": "public, max-age=86400"
        }
      });

    } catch (err: any) {
      if (err.name === 'AbortError') return new Response("Client disconnected", { status: 499 });
      Logger.error(err);
      return new Response("Internal Server Error", { status: 500 });
    }
  }, {
    query: t.Object({
      url: t.String(),
      headers: t.Optional(t.String())
    }),
    detail: {
      tags: ['proxy'],
      summary: 'TS Segment Proxy'
    }
  })

  .get("/mp4-proxy", async ({ request, query: { url, headers } }) => {
    let corsHeaders: Record<string, string> = {};

    if (headers) {
      try {
        corsHeaders = JSON.parse(decodeURIComponent(headers));
      } catch {
        return new Response("Invalid headers format", { status: 400 });
      }
    }

    const clientRange = request.headers.get("range");

    if (clientRange) {
      corsHeaders["Range"] = clientRange;
    }

    corsHeaders["Connection"] = "keep-alive";

    try {
      const res = await fetch(url, {
        headers: corsHeaders,
        signal: request.signal // Abort if client disconnects
      });

      if (!res.ok) {
        console.error("[MP4] Fetch failed:", res.status, url);
        return new Response(await res.text(), { status: res.status });
      }

      // Size limit check
      if (isTooLarge(res.headers.get("content-length"), MAX_MP4_SIZE)) {
        return new Response("Video too large", { status: 413 });
      }

      return new Response(res.body, {
        status: res.status,
        headers: {
          "content-type": res.headers.get('content-type') || "video/mp4",
          "content-range": res.headers.get("content-range") || "",
          "content-length": res.headers.get('content-length') || "",
          "accept-ranges": "bytes",
        }
      })

    } catch (err: any) {
      if (err.name === 'AbortError') return new Response("Client disconnected", { status: 499 });
      console.error("[MP4] Proxy Error:", err);
      return new Response("Internal Server Error", { status: 500 });
    }
  }, {
    query: t.Object({
      url: t.String(),
      headers: t.Optional(t.String()),
    }),
    detail: {
      tags: ['proxy'],
      summary: 'MP4 Video Proxy'
    }
  })

  .get("/fetch", async ({ request, query: { url, headers } }) => {
    let customHeaders: Record<string, string> = {};
    if (headers) {
      try {
        customHeaders = JSON.parse(decodeURIComponent(headers));
      } catch (_e) {
        console.error("Fetch header parse failed");
      }
    }

    customHeaders["Connection"] = "keep-alive";

    try {
      const res = await fetch(url, {
        headers: customHeaders,
        signal: request.signal // Abort if client disconnects
      });

      // Size limit check
      if (isTooLarge(res.headers.get("content-length"), MAX_FETCH_SIZE)) {
        return new Response("Payload too large", { status: 413 });
      }

      return new Response(res.body, {
        status: res.status,
        headers: {
          "content-type": res.headers.get("content-type") || "application/octet-stream",
        }
      });
    } catch (err: any) {
      if (err.name === 'AbortError') return new Response("Client disconnected", { status: 499 });
      return new Response("Fetch Error", { status: 500 });
    }
  }, {
    query: t.Object({
      url: t.String(),
      headers: t.Optional(t.String())
    }),
    detail: {
      tags: ['proxy'],
      summary: 'General Media Fetch Proxy'
    }
  })




const port = Bun.env.PORT || 3000;
app.listen(port);

console.log(
  `Elysia is running at ${app.server?.protocol}://${app.server?.hostname}:${app.server?.port}`
);


function gracefulShutdown(signal: string) {
  console.log(`${signal} received. Closing Redis connection...`);
  redis.close();
  console.log("Redis connection closed. Exiting.");
  process.exit(0);
}

// Handle Ctrl+C (Manual stop)
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle Docker stop / PM2 restart / systemctl stop
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

export default app