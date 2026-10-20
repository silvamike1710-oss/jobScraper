const http = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const PAGE_SIZE = 20;
const MAX_OFFSET = 10_000;
const REQUEST_INTERVAL_MS = 1000;
const CACHE_TTLS = {
  gupy: 2 * 60 * 1000,
  remoteok: 10 * 60 * 1000,
  weworkremotely: 60 * 60 * 1000,
  arbeitnow: 10 * 60 * 1000,
  himalayas: 10 * 60 * 1000,
  jobicy: 10 * 60 * 1000,
  workingnomads: 10 * 60 * 1000,
  hackernews: 10 * 60 * 1000,
  eudev: 10 * 60 * 1000,
};
const PUBLIC_FILES = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
]);
const SOURCE_INFO = {
  gupy: { name: "Gupy", url: "https://portal.gupy.io/" },
  remoteok: { name: "Remote OK", url: "https://remoteok.com/" },
  weworkremotely: { name: "We Work Remotely", url: "https://weworkremotely.com/remote-jobs" },
  arbeitnow: { name: "Arbeitnow", url: "https://www.arbeitnow.com/" },
  himalayas: { name: "Himalayas", url: "https://himalayas.app/jobs" },
  jobicy: { name: "Jobicy", url: "https://jobicy.com/jobs-rss-feed" },
  workingnomads: { name: "Working Nomads", url: "https://www.workingnomads.com/jobs" },
  hackernews: { name: "Hacker News", url: "https://news.ycombinator.com/" },
  eudev: { name: "eu.dev.br", url: "https://eu.dev.br/vagas/" },
};

const cache = new Map();
const requestQueues = new Map();
const lastRequests = new Map();

function sendJson(response, status, data) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

function isGupyJobUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.endsWith(".gupy.io") &&
      url.pathname.startsWith("/job/")
    );
  } catch {
    return false;
  }
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[ßæœøłđðþ]/g, (character) => ({
      ß: "ss",
      æ: "ae",
      œ: "oe",
      ø: "o",
      ł: "l",
      đ: "d",
      ð: "d",
      þ: "th",
    })[character])
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const LOCATION_ALIASES = new Map();
const BRAZIL_STATES = {
  acre: "ac",
  alagoas: "al",
  amapá: "ap",
  amazonas: "am",
  bahia: "ba",
  ceará: "ce",
  "distrito federal": "df",
  "espírito santo": "es",
  goiás: "go",
  maranhão: "ma",
  "mato grosso": "mt",
  "mato grosso do sul": "ms",
  "minas gerais": "mg",
  pará: "pa",
  paraíba: "pb",
  paraná: "pr",
  pernambuco: "pe",
  piauí: "pi",
  "rio de janeiro": "rj",
  "rio grande do norte": "rn",
  "rio grande do sul": "rs",
  rondônia: "ro",
  roraima: "rr",
  "santa catarina": "sc",
  "são paulo": "sp",
  sergipe: "se",
  tocantins: "to",
};
const US_STATES = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca",
  colorado: "co", connecticut: "ct", delaware: "de", florida: "fl", georgia: "ga",
  hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia", kansas: "ks",
  kentucky: "ky", louisiana: "la", maine: "me", maryland: "md", massachusetts: "ma",
  michigan: "mi", minnesota: "mn", mississippi: "ms", missouri: "mo", montana: "mt",
  nebraska: "ne", nevada: "nv", "new hampshire": "nh", "new jersey": "nj",
  "new mexico": "nm", "new york": "ny", "north carolina": "nc", "north dakota": "nd",
  ohio: "oh", oklahoma: "ok", oregon: "or", pennsylvania: "pa", "rhode island": "ri",
  "south carolina": "sc", "south dakota": "sd", tennessee: "tn", texas: "tx",
  utah: "ut", vermont: "vt", virginia: "va", washington: "wa",
  "west virginia": "wv", wisconsin: "wi", wyoming: "wy",
};
const US_STATE_CODES = new Set(Object.values(US_STATES));

function addLocationAliases(entries) {
  for (const [name, abbreviation] of Object.entries(entries)) {
    const normalizedName = normalizeSearchText(name);
    const normalizedAbbreviation = normalizeSearchText(abbreviation);
    LOCATION_ALIASES.set(normalizedName, [
      ...new Set([...(LOCATION_ALIASES.get(normalizedName) || []), normalizedAbbreviation]),
    ]);
    LOCATION_ALIASES.set(normalizedAbbreviation, [
      ...new Set([...(LOCATION_ALIASES.get(normalizedAbbreviation) || []), normalizedName]),
    ]);
  }
}

addLocationAliases(BRAZIL_STATES);
addLocationAliases(US_STATES);
for (const [name, aliases] of Object.entries({
  brazil: ["brasil", "br"],
  brasil: ["brazil", "br"],
  "united states": ["usa", "us", "united states of america"],
  usa: ["us", "united states", "united states of america"],
  "united kingdom": ["uk", "great britain", "britain"],
  uk: ["united kingdom", "great britain", "britain"],
  "south korea": ["korea"],
  "new york city": ["nyc"],
})) {
  LOCATION_ALIASES.set(normalizeSearchText(name), aliases.map(normalizeSearchText));
  for (const alias of aliases) {
    const normalizedAlias = normalizeSearchText(alias);
    LOCATION_ALIASES.set(normalizedAlias, [
      ...(LOCATION_ALIASES.get(normalizedAlias) || []),
      normalizeSearchText(name),
    ]);
  }
}

function getLocationTerms(value) {
  const normalized = normalizeSearchText(value);
  return [normalized, ...(LOCATION_ALIASES.get(normalized) || [])];
}

function isBrazilCountry(location) {
  return getLocationTerms(location).some((term) =>
    ["br", "brazil", "brasil"].includes(normalizeSearchText(term)),
  );
}

function containsLocationTerm(location, term) {
  const normalizedLocation = normalizeSearchText(location);
  const locationWords = new Set(normalizedLocation.split(" "));
  const termWords = normalizeSearchText(term).split(" ").filter(Boolean);
  return (
    normalizedLocation === term ||
    normalizedLocation.startsWith(`${term} `) ||
    normalizedLocation.includes(` ${term} `) ||
    normalizedLocation.endsWith(` ${term}`) ||
    (termWords.length > 0 && termWords.every((word) => locationWords.has(word)))
  );
}

function isBrazilLocation(location) {
  const normalized = normalizeSearchText(location);
  return (
    ["br", "brazil", "brasil"].includes(normalized) ||
    Object.keys(BRAZIL_STATES).some((state) => normalizeSearchText(state) === normalized) ||
    (Object.values(BRAZIL_STATES).includes(normalized) && !US_STATE_CODES.has(normalized))
  );
}

function matchesLocation(value, location) {
  if (!location) return true;
  const valueTerms = normalizeSearchText(value);
  if (getLocationTerms(location).some((term) => containsLocationTerm(valueTerms, term))) return true;
  if (
    isBrazilLocation(location) &&
    /\b(brazil|brasil|latam|latin america|worldwide|global|anywhere)\b/.test(valueTerms)
  ) {
    return true;
  }
  return false;
}

function matchesSourceLocation(value, location, source) {
  if (isBrazilCountry(location) && ["gupy", "eudev"].includes(source)) return true;
  return matchesLocation(value, location);
}

function matchesText(values, term) {
  const needle = normalizeSearchText(term);
  return values.some((value) => normalizeSearchText(value).includes(needle));
}

function getTermVariants(term) {
  const normalized = normalizeSearchText(term);
  const variants = new Set([normalized]);
  const translations = {
    developer: ["desenvolvedor", "desenvolvedora", "programador", "programadora"],
    developers: ["desenvolvedor", "desenvolvedora", "programador", "programadora"],
    engineer: ["engenheiro", "engenheira"],
    engineering: ["engenharia"],
    designer: ["designer", "design"],
    analyst: ["analista"],
    analysta: ["analista"],
  };
  for (const [english, portuguese] of Object.entries(translations)) {
    if (normalized === english) {
      for (const variant of portuguese) variants.add(variant);
    }
  }
  return [...variants];
}

function getAttribute(attributes, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attributes.match(
    new RegExp(`\\b${escapedName}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+)))?`, "i"),
  );
  return match ? match[1] ?? match[2] ?? match[3] ?? "" : "";
}

function getCellText(row, className) {
  const escapedClass = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cell = row.match(
    new RegExp(`<td\\b[^>]*class=(?:"[^"]*\\b${escapedClass}\\b[^"]*"|'[^']*\\b${escapedClass}\\b[^']*'|[^\\s>]*\\b${escapedClass}\\b[^\\s>]*)[^>]*>([\\s\\S]*?)<\\/td>`, "i"),
  );
  if (!cell) return "";
  return decodeXml(
    cell[1]
      .replace(/<span\b[^>]*class=(?:"[^"]*\b(?:muted|mobile-meta)\b[^"]*"|'[^']*\b(?:muted|mobile-meta)\b[^']*')[^>]*>[\s\S]*?<\/span>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  );
}

function getFirstLink(row) {
  const match = row.match(/<a\b[^>]*href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/i);
  return match ? match[1] || match[2] || match[3] || "" : "";
}

function titleCaseSlug(value) {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word[0].toLocaleUpperCase() + word.slice(1))
    .join(" ");
}

function parseEuDevListings(html, term, location) {
  const searchTerms = getTermVariants(term);
  const jobs = [];
  for (const [, attributes, content] of html.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)) {
    if (!/\bdata-job-row\b/i.test(attributes)) continue;
    const slug = getAttribute(attributes, "data-slug");
    const relativeUrl = getFirstLink(content);
    if (!slug || !relativeUrl.startsWith("/vagas/")) continue;

    const title = getCellText(content, "title-cell").replace(/\s*\/\/\s*$/, "").trim();
    const company = getCellText(content, "company-cell").trim();
    const locations = getAttribute(attributes, "data-loc");
    const technologies = getAttribute(attributes, "data-tech");
    const area = getAttribute(attributes, "data-area");
    const languages = getAttribute(attributes, "data-lang");
    const terms = [title, company, technologies, area, languages];
    if (!searchTerms.some((searchTerm) => matchesText(terms, searchTerm))) continue;
    if (location && !matchesSourceLocation(locations, location, "eudev")) continue;

    const locationLabel = locations
      .split(/\s+/)
      .filter(Boolean)
      .map(titleCaseSlug)
      .join(", ");
    const job = normalizeJob(
      "eudev",
      slug,
      title,
      company,
      locationLabel,
      getAttribute(attributes, "data-mod"),
      "",
      new URL(relativeUrl, SOURCE_INFO.eudev.url).href,
    );
    if (job && job.title && job.company) jobs.push(job);
  }
  return jobs;
}

async function getEuDevJobs(term, location, offset) {
  const pageUrl = "https://eu.dev.br/vagas/";
  const html = await fetchText(pageUrl, "eudev:vagas", CACHE_TTLS.eudev);
  const allJobs = parseEuDevListings(html, term, location);
  const jobs = allJobs.slice(offset, offset + PAGE_SIZE);
  const nextOffset = offset + jobs.length;
  return { jobs, total: allJobs.length, nextOffset, hasMore: nextOffset < allJobs.length };
}

function extractEuDevRequirements(html) {
  const section = html.match(
    /<h[1-6]\b[^>]*>\s*requisitos\s*<\/h[1-6]>([\s\S]*?)(?=<h[1-6]\b|$)/i,
  );
  return section ? summarizeRequirements(section[1]) : [];
}

async function getEuDevJobDetails(pathname) {
  if (!/^\/vagas\/[a-z0-9-]{8,200}\/$/i.test(pathname)) {
    throw new Error("Invalid eu.dev.br listing identifier.");
  }
  const url = new URL(pathname, SOURCE_INFO.eudev.url).href;
  const html = await fetchText(url, `eudev:detail:${pathname}`, CACHE_TTLS.eudev);
  return { requirementsSummary: extractEuDevRequirements(html) };
}

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeRequirements(description) {
  if (typeof description !== "string" || !description.trim()) return [];

  const text = description
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<li\b[^>]*>/gi, "\n")
    .replace(/<\/(?:p|div|section|h[1-6]|ul|ol|li|br)\s*>/gi, "\n")
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(
      /(?=(?:requirements?|qualifications?|what you(?:'ll| will) need|what you bring|who you are|must[- ]haves?|skills?|requisitos?|qualifica(?:ções|coes)|o que esperamos|o que você precisa|experiência|conhecimentos|formação|habilidades|desejáveis?))/gi,
      "\n",
    )
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/^[\s•*–-]+/, "").trim())
    .filter(Boolean);
  const sectionHeading =
    /\b(requirements?|qualifications?|what you(?:'ll| will) need|what you bring|who you are|must[- ]haves?|skills?|requisitos?|qualifica(?:ções|coes)|o que esperamos|o que você precisa|experiência|conhecimentos|formação|habilidades|desejáveis?)\b/i;
  const nextSection =
    /^(?:responsibilities|what you(?:'ll| will) do|about (?:the role|you|us)|benefits|nice to have|about us|responsabilidades|benefícios|sobre nós)\b/i;
  let inRequirements = false;
  const relevantLines = [];

  for (const line of lines) {
    if (nextSection.test(line)) inRequirements = false;
    if (sectionHeading.test(line)) inRequirements = true;
    if (inRequirements && !sectionHeading.test(line)) relevantLines.push(line);
  }

  const candidates = (relevantLines.length ? relevantLines : lines)
    .flatMap((line) => line.split(/;\s*|(?<=[.!?])\s+(?=[A-ZÀ-Ý0-9])/))
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length >= 20)
    .filter((sentence) => !/\b(compensation|salary|benefits?|pay range|remuneration)\b/i.test(sentence))
    .filter((sentence) =>
      /\b(experience|years?|degree|bachelor|master|phd|proficien|knowledge|skill|ability|familiar|expert|must|require|qualification|preferred|background|fluent|english|portuguese|requisitos?|experiência|anos|graduação|formação|conhecimento|habilidade|domínio|desejável|necessário|necessária|inglês|português|certifica(?:tion|ção))\b/i.test(
        sentence,
      ),
    );
  const unique = [...new Set(candidates)];
  return unique.slice(0, 3).map((sentence) => {
    if (sentence.length <= 180) return sentence;
    const clipped = sentence.slice(0, 177);
    const lastSpace = clipped.lastIndexOf(" ");
    return `${clipped.slice(0, lastSpace > 160 ? lastSpace : 217).trimEnd()}…`;
  });
}

function xmlTag(item, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = item.match(new RegExp(`<${escapedName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedName}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

async function waitForRequestSlot(origin) {
  const previous = requestQueues.get(origin) || Promise.resolve();
  const next = previous.then(async () => {
    const lastRequestAt = lastRequests.get(origin) || 0;
    const waitMs = REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastRequests.set(origin, Date.now());
  });
  requestQueues.set(origin, next.catch(() => {}));
  await next;
}

async function fetchText(url, cacheKey, ttl) {
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const origin = new URL(url).origin;
  await waitForRequestSlot(origin);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json, application/rss+xml, application/xml, text/xml",
        "user-agent": "RetroJobFinder/1.0 (public job search; local use)",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Upstream returned HTTP ${response.status}.`);
    const value = await response.text();
    cache.set(cacheKey, { value, expiresAt: Date.now() + ttl });
    return value;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, cacheKey, ttl) {
  const text = await fetchText(url, cacheKey, ttl);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Upstream returned invalid JSON.");
  }
}

function normalizeJob(source, id, title, company, location, workplaceType, publishedAt, url, description = "") {
  if (
    typeof title !== "string" ||
    typeof company !== "string" ||
    typeof url !== "string" ||
    !url.startsWith("https://")
  ) {
    return null;
  }
  return {
    id: `${source}:${id || url}`,
    source,
    sourceName: SOURCE_INFO[source].name,
    sourceUrl: SOURCE_INFO[source].url,
    title: title.trim(),
    company: company.trim(),
    location: String(location || "").trim(),
    workplaceType: workplaceType || "",
    publishedAt: publishedAt || "",
    url,
    requirementsSummary: summarizeRequirements(description),
  };
}

function parseWeWorkRemotely(xml, term, location) {
  const jobs = [];
  for (const [, item] of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const rawTitle = xmlTag(item, "title");
    const colon = rawTitle.indexOf(":");
    const company = colon > 0 ? rawTitle.slice(0, colon).trim() : "We Work Remotely listing";
    const title = colon > 0 ? rawTitle.slice(colon + 1).trim() : rawTitle;
    const description = xmlTag(item, "description");
    const region = xmlTag(item, "region");
    const country = xmlTag(item, "country");
    const jobLocation = [region, country].filter(Boolean).join(", ");
    const url = xmlTag(item, "link");
    if (
      !matchesText([title, company, description], term) ||
      !matchesLocation(jobLocation, location)
    ) {
      continue;
    }
    const job = normalizeJob(
      "weworkremotely",
      url,
      title,
      company,
      jobLocation,
      "remote",
      xmlTag(item, "pubDate"),
      url,
      description,
    );
    if (job) jobs.push(job);
  }
  return jobs;
}

async function getGupyJobs(term, location, offset) {
  const locationSearch = Boolean(location) && !isBrazilCountry(location);
  const payloads = [];
  const pageCount = locationSearch
    ? Math.min(10, Math.max(5, Math.ceil((offset + PAGE_SIZE) / PAGE_SIZE) + 2))
    : 1;

  for (let page = 0; page < pageCount; page += 1) {
    const pageOffset = locationSearch ? page * PAGE_SIZE : offset;
    const url = new URL("https://portal.gupy.io/api/job-search/jobs");
    url.searchParams.set("jobName", term);
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("offset", String(pageOffset));
    url.searchParams.set("sortBy", "publishedDate");
    url.searchParams.set("sortOrder", "desc");
    const payload = await fetchJson(url, `gupy:${url}`, CACHE_TTLS.gupy);
    if (!Array.isArray(payload.data) || !Number.isInteger(payload.pagination?.total)) {
      throw new Error("Gupy returned an unexpected jobs response.");
    }
    payloads.push({ payload, offset: pageOffset });
    if (
      !locationSearch ||
      payload.data.length < PAGE_SIZE ||
      pageOffset + payload.data.length >= payload.pagination.total
    ) {
      break;
    }
  }

  const apiJobs = payloads.flatMap(({ payload }) => payload.data);
  const matchingJobs = [...new Map(apiJobs.map((job) => [job.id, job])).values()]
    .filter((job) => job && typeof job.id === "number" && isGupyJobUrl(job.jobUrl))
    .map((job) =>
      normalizeJob(
        "gupy",
        String(job.id),
        job.name,
        job.careerPageName,
        [job.city, job.state].filter(Boolean).join(", "),
        job.workplaceType,
        job.publishedDate,
        job.jobUrl,
        job.description,
      ),
    )
    .filter((job) => job && job.title && job.company && matchesSourceLocation(job.location, location, "gupy"));
  const jobs = locationSearch ? matchingJobs.slice(offset, offset + PAGE_SIZE) : matchingJobs;
  const nextOffset = offset + jobs.length;
  const lastPage = payloads.at(-1);
  const hasUnfetchedJobs = Boolean(
    locationSearch &&
      lastPage &&
      lastPage.offset + lastPage.payload.data.length < lastPage.payload.pagination.total &&
      payloads.length === pageCount,
  );
  const hasMore = locationSearch
    ? matchingJobs.length > nextOffset || hasUnfetchedJobs
    : nextOffset < (lastPage?.payload.pagination.total || 0);
  const total = locationSearch
    ? Math.max(matchingJobs.length, hasMore ? nextOffset + 1 : 0)
    : lastPage?.payload.pagination.total || 0;
  return {
    jobs,
    total,
    nextOffset,
    hasMore: Boolean(hasMore),
  };
}

async function getRemoteOkJobs(term, location, offset) {
  const url = new URL("https://remoteok.com/api");
  const words = term.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const tagAliases = { developer: "dev", developers: "dev", programming: "dev", programmer: "dev" };
  const tag = tagAliases[words[0]] || words[0];
  url.searchParams.set("tag", tag);
  const payload = await fetchJson(url, `remoteok:${url}`, CACHE_TTLS.remoteok);
  if (!Array.isArray(payload)) throw new Error("Remote OK returned an unexpected jobs response.");
  const allJobs = payload
    .filter((job) => job && job.id && (job.position || job.title))
    .filter((job) =>
      matchesText([job.position, job.title, job.company, job.description, ...(job.tags || [])], term) ||
      (job.tags || []).some((jobTag) => words.some((word) => jobTag.toLocaleLowerCase().includes(word)) || jobTag === tag),
    )
    .map((job) =>
      normalizeJob(
        "remoteok",
        String(job.id),
        job.position || job.title,
        job.company,
        job.location || "Remote",
        "remote",
        job.date,
        job.url || `https://remoteok.com/remote-jobs/${job.slug || job.id}`,
        job.description,
      ),
    )
    .filter(
      (job) =>
        job &&
        matchesLocation(job.location, location),
    );
  const jobs = allJobs.slice(offset, offset + PAGE_SIZE);
  const nextOffset = offset + jobs.length;
  return { jobs, total: allJobs.length, nextOffset, hasMore: nextOffset < allJobs.length };
}

async function getWeWorkRemotelyJobs(term, location, offset) {
  const url = "https://weworkremotely.com/remote-jobs.rss";
  const xml = await fetchText(url, "weworkremotely:all", CACHE_TTLS.weworkremotely);
  const allJobs = parseWeWorkRemotely(xml, term, location);
  const jobs = allJobs.slice(offset, offset + PAGE_SIZE);
  const nextOffset = offset + jobs.length;
  return { jobs, total: allJobs.length, nextOffset, hasMore: nextOffset < allJobs.length };
}

async function getArbeitnowJobs(term, location, offset) {
  const page = Math.floor(offset / 300) + 1;
  const url = new URL("https://www.arbeitnow.com/api/job-board-api");
  url.searchParams.set("search", term);
  url.searchParams.set("page", String(page));
  const payload = await fetchJson(url, `arbeitnow:${url}`, CACHE_TTLS.arbeitnow);
  if (!Array.isArray(payload.data)) throw new Error("Arbeitnow returned an unexpected jobs response.");
  const allJobs = payload.data
    .map((job) =>
      normalizeJob(
        "arbeitnow",
        job.slug,
        job.title,
        job.company_name,
        job.location,
        job.remote ? "remote" : "",
        job.created_at,
        job.url,
        job.description,
      ),
    )
    .filter(
      (job) =>
        job &&
        matchesText([job.title, job.company], term) &&
        matchesLocation(job.location, location),
    );
  const pageHasMore = Boolean(payload.links?.next);
  const pageOffset = offset % 300;
  const jobs = allJobs.slice(pageOffset, pageOffset + PAGE_SIZE);
  const nextOffset = pageHasMore ? page * 300 : offset + jobs.length;
  return {
    jobs,
    total: offset + jobs.length + Number(pageHasMore),
    nextOffset,
    hasMore: pageHasMore || nextOffset < offset + allJobs.length,
  };
}

async function getHimalayasJobs(term, location, offset) {
  const url = new URL("https://himalayas.app/jobs/api/search");
  url.searchParams.set("q", term);
  url.searchParams.set("page", String(Math.floor(offset / PAGE_SIZE) + 1));
  if (isBrazilLocation(location)) url.searchParams.set("country", "Brazil");
  const payload = await fetchJson(url, `himalayas:${url}`, CACHE_TTLS.himalayas);
  if (!Array.isArray(payload.jobs)) throw new Error("Himalayas returned an unexpected jobs response.");
  const jobs = payload.jobs
    .map((job) =>
      normalizeJob(
        "himalayas",
        job.guid || `${job.companySlug}:${job.title}`,
        job.title,
        job.companyName,
        [
          ...(Array.isArray(job.locationRestrictions) ? job.locationRestrictions : []),
          ...(Array.isArray(job.timezoneRestrictions)
            ? job.timezoneRestrictions.map((timezone) => `UTC${timezone >= 0 ? "+" : ""}${timezone}`)
            : []),
        ].join(", ") ||
          (isBrazilLocation(location) ? "Worldwide (Brazil eligible)" : "Worldwide"),
        job.employmentType,
        job.pubDate,
        job.applicationLink || SOURCE_INFO.himalayas.url,
        job.description || job.excerpt,
      ),
    )
    .filter(
      (job) =>
        job &&
        job.title &&
        job.company &&
        (matchesLocation(job.location, location) ||
          (isBrazilLocation(location) && !job.location)),
    );
  const total = Number.isInteger(payload.totalCount) ? payload.totalCount : offset + jobs.length;
  const nextOffset = offset + payload.jobs.length;
  return {
    jobs,
    total,
    nextOffset,
    hasMore: nextOffset < total && payload.jobs.length === PAGE_SIZE,
  };
}

async function getJobicyJobs(term, location, offset) {
  const url = new URL("https://jobicy.com/api/jobs");
  url.searchParams.set("count", "200");
  url.searchParams.set("tag", term);
  if (isBrazilLocation(location)) url.searchParams.set("geo", "brazil");
  const payload = await fetchJson(url, `jobicy:${url}`, CACHE_TTLS.jobicy);
  if (!Array.isArray(payload.jobs)) throw new Error("Jobicy returned an unexpected jobs response.");
  const allJobs = payload.jobs
    .filter((job) => matchesText([job.jobTitle, job.companyName, job.jobExcerpt, job.jobDescription], term))
    .map((job) =>
      normalizeJob(
        "jobicy",
        String(job.id),
        job.jobTitle,
        job.companyName,
        job.jobGeo,
        job.jobType?.join(", "),
        job.pubDate,
        job.url,
        job.jobDescription || job.jobExcerpt,
      ),
    )
    .filter(
      (job) =>
        job &&
        matchesLocation(job.location, location),
    );
  const jobs = allJobs.slice(offset, offset + PAGE_SIZE);
  const nextOffset = offset + jobs.length;
  return { jobs, total: allJobs.length, nextOffset, hasMore: nextOffset < allJobs.length };
}

async function getWorkingNomadsJobs(term, location, offset) {
  const url = "https://www.workingnomads.com/api/exposed_jobs/";
  const payload = await fetchJson(url, "workingnomads:all", CACHE_TTLS.workingnomads);
  if (!Array.isArray(payload)) {
    throw new Error("Working Nomads returned an unexpected jobs response.");
  }
  const allJobs = payload
    .filter((job) =>
      matchesText([job.title, job.company_name, job.category_name, job.description, ...(job.tags || [])], term),
    )
    .map((job) =>
      normalizeJob(
        "workingnomads",
        job.url,
        job.title,
        job.company_name,
        job.location,
        job.category_name,
        job.pub_date,
        job.url,
        job.description,
      ),
    )
    .filter((job) => job && matchesLocation(job.location, location));
  const jobs = allJobs.slice(offset, offset + PAGE_SIZE);
  const nextOffset = offset + jobs.length;
  return { jobs, total: allJobs.length, nextOffset, hasMore: nextOffset < allJobs.length };
}

async function getHackerNewsJobs(term, location, offset) {
  const storySearch = new URL("https://hn.algolia.com/api/v1/search_by_date");
  storySearch.searchParams.set("query", "Who is hiring");
  storySearch.searchParams.set("tags", "story");
  storySearch.searchParams.set("hitsPerPage", "100");
  const stories = await fetchJson(storySearch, `hackernews-stories:${storySearch}`, CACHE_TTLS.hackernews);
  const currentThread = stories.hits?.find((story) =>
    /^Ask HN:\s*Who is hiring/i.test(story.title || ""),
  );
  if (!currentThread) {
    return { jobs: [], total: 0, nextOffset: 0, hasMore: false };
  }

  const commentsUrl = new URL("https://hn.algolia.com/api/v1/search");
  commentsUrl.searchParams.set("query", [term, location].filter(Boolean).join(" "));
  commentsUrl.searchParams.set("tags", `comment,story_${currentThread.objectID}`);
  commentsUrl.searchParams.set("hitsPerPage", String(PAGE_SIZE));
  commentsUrl.searchParams.set("page", String(Math.floor(offset / PAGE_SIZE)));
  const payload = await fetchJson(commentsUrl, `hackernews:${commentsUrl}`, CACHE_TTLS.hackernews);
  if (!Array.isArray(payload.hits) || !Number.isInteger(payload.nbHits)) {
    throw new Error("Hacker News search returned an unexpected response.");
  }

  const jobs = payload.hits
    .map((hit) => {
      const rawFirstLine = String(hit.comment_text || "").split(/<p\b|<br\s*\/?>/i, 1)[0];
      const firstLine = decodeXml(rawFirstLine);
      const segments = firstLine.split("|").map((segment) => segment.trim()).filter(Boolean);
      const company = (segments[0] || "").replace(/\s*\(?https?:\/\/\S+\)?/gi, "").trim();
      if (!company || /^(seeking work|freelancer seeking|available for hire)\b/i.test(company)) {
        return null;
      }
      const rolePattern =
        /\b(engineer|developer|designer|manager|analyst|scientist|architect|recruiter|product|sales|support|marketing|director|intern|consultant|administrator|operations|writer|researcher)\b/i;
      const details = segments.slice(1).filter((segment) => !/^https?:\/\//i.test(segment));
      const title =
        details.find((segment) => matchesText([segment], term) && !/^(remote|hybrid|on.?site|full.?time|part.?time|contract|intern(ship)?)\b/i.test(segment)) ||
        details.find((segment) => rolePattern.test(segment)) ||
        `Hiring post at ${company}`;
      const location =
        details.find(
          (segment) =>
            segment !== title &&
            /remote|hybrid|on.?site|,\s*[A-Z]{2}\b|\b(US|USA|UK|Canada|Europe|Worldwide)\b/i.test(segment),
        ) ||
        "";
      return normalizeJob(
        "hackernews",
        String(hit.objectID),
        title,
        company,
        location,
        "",
        hit.created_at,
        `https://news.ycombinator.com/item?id=${encodeURIComponent(hit.objectID)}`,
        hit.comment_text,
      );
    })
    .filter((job) => job && matchesLocation(job.location, location));
  const nextOffset = offset + payload.hits.length;
  return {
    jobs,
    total: payload.nbHits,
    nextOffset,
    hasMore: nextOffset < payload.nbHits,
  };
}

const SOURCE_ADAPTERS = {
  gupy: getGupyJobs,
  remoteok: getRemoteOkJobs,
  weworkremotely: getWeWorkRemotelyJobs,
  arbeitnow: getArbeitnowJobs,
  himalayas: getHimalayasJobs,
  jobicy: getJobicyJobs,
  workingnomads: getWorkingNomadsJobs,
  hackernews: getHackerNewsJobs,
  eudev: getEuDevJobs,
};

async function searchSource(requestUrl, response) {
  const source = requestUrl.searchParams.get("source") || "";
  const term = (requestUrl.searchParams.get("term") || "").trim();
  const location = (requestUrl.searchParams.get("location") || "").trim();
  const offset = Number(requestUrl.searchParams.get("offset") || "0");

  if (!SOURCE_ADAPTERS[source]) {
    sendJson(response, 400, { error: "Choose a supported job source." });
    return;
  }
  if (!term || term.length > 100) {
    sendJson(response, 400, { error: "Search term is required and must be 100 characters or fewer." });
    return;
  }
  if (location.length > 100) {
    sendJson(response, 400, { error: "Location must be 100 characters or fewer." });
    return;
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
    sendJson(response, 400, { error: "Search offset is invalid." });
    return;
  }

  try {
    const result = await SOURCE_ADAPTERS[source](term, location, offset);
    sendJson(response, 200, result);
  } catch (error) {
    console.error(`${SOURCE_INFO[source].name} job search failed.`, error);
    const timedOut = error.name === "AbortError";
    sendJson(response, timedOut ? 504 : 502, {
      error: timedOut
        ? `${SOURCE_INFO[source].name} search timed out.`
        : `${SOURCE_INFO[source].name} search failed: ${error.message}`,
    });
  }
}

async function serveStaticFile(urlPath, response) {
  const entry = PUBLIC_FILES.get(urlPath);
  if (!entry) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  try {
    const content = await readFile(path.join(__dirname, entry.file));
    response.writeHead(200, {
      "content-type": entry.type,
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    });
    response.end(content);
  } catch (error) {
    console.error(`Could not serve ${entry.file}.`, error);
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Could not load application file.");
  }
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
  if (requestUrl.pathname === "/api/job-details") {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }
    try {
      const details = await getEuDevJobDetails(requestUrl.searchParams.get("path") || "");
      sendJson(response, 200, details);
    } catch (error) {
      console.error("Could not retrieve eu.dev.br job requirements.", error);
      const timedOut = error.name === "AbortError";
      sendJson(response, timedOut ? 504 : 502, {
        error: timedOut
          ? "eu.dev.br job details timed out."
          : `Could not retrieve eu.dev.br job details: ${error.message}`,
      });
    }
    return;
  }
  if (requestUrl.pathname === "/api/jobs") {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }
    await searchSource(requestUrl, response);
    return;
  }

  if (request.method !== "GET") {
    response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    response.end("Method not allowed");
    return;
  }
  await serveStaticFile(requestUrl.pathname, response);
});

server.listen(PORT, HOST, () => {
  console.log(`Job Finder running at http://${HOST}:${PORT}`);
});
