# MingleTV SEO implementation

This repository ships a static, crawlable SEO layer around the live random-chat application.

## Target search intents

English: `random video chat`, `chat with strangers`, `online chat`, `video chat without registration`, `Omegle alternative`, `random chat`.

French: `chat vidéo aléatoire`, `chat en ligne`, `chat avec des inconnus`, `chat sans inscription`, `alternative à Omegle`, `chat rencontre`.

Common misspellings are intentionally **not** repeated globally and are never hidden. A few plausible variants (`omgle`, `omegl`, `chat en lgne`, `cht online`) appear once in visible explanatory copy on the most relevant pages. Do not create one page per typo and do not add a `meta keywords` tag.

## Indexable URLs

- `/`
- `/en/random-video-chat`
- `/en/omegle-alternative`
- `/en/chat-with-strangers`
- `/en/video-chat-without-registration`
- `/fr/chat-video-aleatoire`
- `/fr/alternative-omegle`
- `/fr/chat-en-ligne`
- `/fr/chat-sans-inscription`
- `/terms`
- `/privacy`
- `/rules`

Every SEO landing page has a unique title, description, self-referencing canonical, visible H1/content, internal links, Open Graph metadata and reciprocal `hreflang` where there is a real translated equivalent. Landing pages also include `BreadcrumbList` JSON-LD. The homepage includes `WebSite` and `WebApplication` JSON-LD.

## After deployment

1. Verify that `https://mingletv.app` permanently redirects to the canonical `https://www.mingletv.app/` host.
2. Open `https://www.mingletv.app/robots.txt` and `https://www.mingletv.app/sitemap.xml` and confirm HTTP 200 responses.
3. Add the domain property to Google Search Console and submit `https://www.mingletv.app/sitemap.xml`.
4. Inspect `/`, the two Omegle-alternative pages and the two random-video-chat pages in URL Inspection and request indexing.
5. Validate structured data with Google's Rich Results Test / Schema Markup Validator.
6. Watch Search Console queries and impressions. Expand content only when a genuine search intent is visible; avoid mass-generated near-duplicate pages.
7. Earn legitimate links and mentions to the canonical URLs. Do not buy large packages of keyword-rich links.

## Content rule

Any future SEO page should answer a distinct user question and contain substantial, visible, useful content. Do not generate location/keyword/typo doorway pages whose only purpose is to funnel the visitor back to `/`.
