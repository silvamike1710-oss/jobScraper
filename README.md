# Multi-Source Job Finder

A Windows 95-inspired job search and tracker with selectable public job APIs and feeds.

## Run it

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

eu.dev.br listing rows do not include full requirements text. Selecting **Requirements** loads the public listing details on demand and extracts the requirements section.

The local server serves the app and calls the selected public APIs/feeds to avoid browser cross-origin restrictions. Requests are cached per source and spaced at least one second apart per upstream host. Saved jobs are stored in this browser's `localStorage`; they are not uploaded. The app does not sign in or bypass access controls.

Remote OK requires a visible link and source attribution; Himalayas and Jobicy listings also retain source links and attribution in the results.

## Sources not included

- Adzuna and USAJobs require API credentials; Jooble access is by request.
- Remotive's current `robots.txt` disallows its `/api/` path, so the app does not call that endpoint.
- The Muse's public jobs endpoint does not currently provide a usable free-text search parameter, so it cannot reliably power this keyword-search interface.

Verify upstream terms and endpoint behavior before deploying this as a public service; these public APIs and feeds can change.
