# Multi-Source Job Finder

A Windows 95-inspired job search and tracker with selectable public job APIs and feeds.

## Run it locally

Requires Node.js 18 or newer (for the built-in `fetch` API). From this folder, run:

```sh
npm start
```

Then open <http://127.0.0.1:3000>.

Select one or more sources and search by keyword and optional location. The app currently supports:

- Gupy public job-search API
- Remote OK API
- We Work Remotely RSS feed
- Arbeitnow public API
- Himalayas public API
- Jobicy public API
- Working Nomads public JSON feed
- Current Hacker News "Who is hiring?" thread via Algolia's public search API
- eu.dev.br public listings

Results are normalized to the same job fields, linked to their original listing, and show the source attribution. Hacker News entries link to the original comment; their title and company are inferred from the comment's first line and may be approximate. A failed source does not prevent results from other selected sources from loading. Use **Save** on a result or **Add job** to add a listing manually. **Load more jobs** fetches additional pages where the source supports them.

Location searches are case- and accent-insensitive, ignore punctuation differences, and support common Brazilian and U.S. state abbreviations and country aliases. Search by city, state/region, or country; for example, "Sao Paulo" and "São Paulo" match the same location. Gupy location searches filter a bounded set of its public results locally so its accent-sensitive city filter does not change results based on spelling. For Brazilian city or state searches, country-eligible Brazil and LATAM remote listings may also appear. Some sources only provide a finite feed, so results are filtered against the locations those feeds actually publish.

Select **Requirements** on a result or saved job to see a short summary extracted from requirement-related text in the listing. Summaries are extractive rather than generated, so they only repeat details present in the retrieved description; if no clear requirements are available, the app says so and links to the original listing.

eu.dev.br listing rows do not include full requirements text. Locally, selecting **Requirements** loads the public listing details on demand. On Pages, requirement summaries are precomputed for up to 60 eu.dev.br listings during catalog refresh.

When run locally, the Node.js server calls the selected public APIs and feeds directly. Requests are cached and spaced at least one second apart per upstream host. Saved jobs are stored in this browser's `localStorage`; they are not uploaded. The app does not sign in or bypass access controls.

## Publish on GitHub Pages

The GitHub Pages version searches a static `jobs.json` catalog, so it does not need an always-on backend or browser access to the sources. A GitHub Actions workflow refreshes the catalog and deploys the site every six hours. You can also refresh it on demand.

1. Push this project to a public GitHub repository on its default branch (GitHub Free includes Pages for public repositories).
2. In **Settings → Pages**, set the build and deployment source to **GitHub Actions**.
3. Open **Actions → Refresh job catalog and deploy Pages → Run workflow** to create and publish the first catalog.
4. Open the Pages URL shown in the workflow's deployment result.

The workflow needs the repository's standard Pages deployment permissions; it does not require API secrets. The published catalog is public. Searches on Pages are limited to jobs fetched by the workflow's curated role keywords and page limits, rather than arbitrary live upstream searches. Catalog freshness is shown in the status bar. Requirements are precomputed during catalog generation; eu.dev.br detail extraction is capped at 60 listings per refresh. Some sources may fail or change their public endpoints; those collection errors are reported in the site and the other sources can still contribute results.

To refresh the catalog locally, run `npm run refresh-catalog`; this overwrites `jobs.json` with the latest generated catalog.

Remote OK requires a visible link and source attribution; Himalayas and Jobicy listings also retain source links and attribution in the results.

## Sources not included

- Adzuna and USAJobs require API credentials; Jooble access is by request.
- Remotive's current `robots.txt` disallows its `/api/` path, so the app does not call that endpoint.
- The Muse's public jobs endpoint does not currently provide a usable free-text search parameter, so it cannot reliably power this keyword-search interface.

Verify upstream terms and endpoint behavior before deploying this as a public service; these public APIs and feeds can change.
