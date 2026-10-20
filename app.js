const STORAGE_KEY = "job-finder.jobs";
const LEGACY_STORAGE_KEY = "gupy-job-finder.jobs";
const SOURCE_NAMES = {
  gupy: "Gupy",
  remoteok: "Remote OK",
  weworkremotely: "We Work Remotely",
  arbeitnow: "Arbeitnow",
  himalayas: "Himalayas",
  jobicy: "Jobicy",
  workingnomads: "Working Nomads",
  hackernews: "Hacker News",
  eudev: "eu.dev.br",
};
const SOURCE_URLS = {
  gupy: "https://portal.gupy.io/",
  remoteok: "https://remoteok.com/",
  weworkremotely: "https://weworkremotely.com/remote-jobs",
  arbeitnow: "https://www.arbeitnow.com/",
  himalayas: "https://himalayas.app/jobs",
  jobicy: "https://jobicy.com/jobs-rss-feed",
  workingnomads: "https://www.workingnomads.com/jobs",
  hackernews: "https://news.ycombinator.com/",
  eudev: "https://eu.dev.br/vagas/",
};
const SOURCE_IDS = Object.keys(SOURCE_NAMES);
const LOCATION_SEARCH = window.JobFinderLocationSearch;
const STATIC_CATALOG_MODE =
  !["localhost", "127.0.0.1"].includes(location.hostname) ||
  new URLSearchParams(location.search).has("catalog");
const STATIC_PAGE_SIZE = 20;

const searchForm = document.querySelector("#search-form");
const searchButton = searchForm.querySelector('button[type="submit"]');
const jobForm = document.querySelector("#job-form");
const jobList = document.querySelector("#job-list");
const resultsList = document.querySelector("#results-list");
const emptyState = document.querySelector("#empty-state");
const resultsEmpty = document.querySelector("#results-empty");
const jobCount = document.querySelector("#job-count");
const resultsCount = document.querySelector("#results-count");
const resultsMessage = document.querySelector("#results-message");
const requirementsPanel = document.querySelector("#requirements-panel");
const selectedJobTitle = document.querySelector("#selected-job-title");
const selectedJobCompany = document.querySelector("#selected-job-company");
const requirementsList = document.querySelector("#requirements-list");
const requirementsEmpty = document.querySelector("#requirements-empty");
const originalJobLink = document.querySelector("#original-job-link");
const statusText = document.querySelector("#status-text");
const formMessage = document.querySelector("#form-message");
const loadMoreButton = document.querySelector("#load-more");
const clock = document.querySelector("#clock");

let jobs = loadJobs();
let search = { term: "", location: "" };
let searchResults = [];
let sourceOffsets = {};
let sourceHasMore = {};
let searchInProgress = false;
let jobCatalog;
let catalogLoadPromise;

function getSourceForUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (hostname.endsWith(".gupy.io")) return "gupy";
    if (hostname === "remoteok.com" || hostname.endsWith(".remoteok.com")) return "remoteok";
    if (hostname === "weworkremotely.com" || hostname.endsWith(".weworkremotely.com")) {
      return "weworkremotely";
    }
    if (hostname === "arbeitnow.com" || hostname.endsWith(".arbeitnow.com")) return "arbeitnow";
    if (hostname === "himalayas.app" || hostname.endsWith(".himalayas.app")) return "himalayas";
    if (hostname === "jobicy.com" || hostname.endsWith(".jobicy.com")) return "jobicy";
    if (hostname === "workingnomads.com" || hostname.endsWith(".workingnomads.com")) {
      return "workingnomads";
    }
    if (hostname === "news.ycombinator.com") return "hackernews";
    if (hostname === "eu.dev.br") return "eudev";
  } catch {
    return "";
  }
  return "";
}

function isSupportedJobUrl(value) {
  try {
    return new URL(value).protocol === "https:" && Boolean(getSourceForUrl(value));
  } catch {
    return false;
  }
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function loadJobs() {
  try {
    const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "[]");
    const candidates = [
      ...(Array.isArray(current) ? current : []),
      ...(Array.isArray(legacy) ? legacy : []),
    ];
    const unique = new Map();
    for (const job of candidates) {
      if (
        !job ||
        typeof job.id !== "string" ||
        typeof job.title !== "string" ||
        typeof job.company !== "string" ||
        typeof job.location !== "string" ||
        typeof job.url !== "string" ||
        !isHttpsUrl(job.url) ||
        typeof job.addedAt !== "string" ||
        (job.requirementsSummary !== undefined && !Array.isArray(job.requirementsSummary))
      ) {
        continue;
      }
      const source =
        typeof job.source === "string" && SOURCE_NAMES[job.source]
          ? job.source
          : getSourceForUrl(job.url);
      if (!source) continue;
      unique.set(job.url, {
        ...job,
        source,
        sourceName: SOURCE_NAMES[source],
        sourceUrl: SOURCE_URLS[source],
      });
    }
    return [...unique.values()];
  } catch (error) {
    console.error("Could not load saved jobs from browser storage.", error);
    statusText.textContent = "Could not load saved jobs";
    return [];
  }
}

function saveJobs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
    return true;
  } catch (error) {
    console.error("Could not save jobs to browser storage.", error);
    statusText.textContent = "Could not save jobs";
    return false;
  }
}

function createJobLink(job) {
  const link = document.createElement("a");
  link.className = "position-link";
  link.href = job.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = job.title;
  return link;
}

function createSourceLink(job) {
  const link = document.createElement("a");
  link.href = job.sourceUrl || job.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = job.sourceName || SOURCE_NAMES[job.source] || "Job source";
  return link;
}

let requirementsRequestId = 0;

async function showRequirements(job) {
  const requestId = ++requirementsRequestId;
  selectedJobTitle.textContent = job.title;
  selectedJobCompany.textContent = `${job.company} · ${job.sourceName || SOURCE_NAMES[job.source] || "Job source"}`;
  requirementsList.replaceChildren();
  let summary = Array.isArray(job.requirementsSummary)
    ? job.requirementsSummary.filter((item) => typeof item === "string" && item.trim())
    : [];
  requirementsPanel.hidden = false;
  requirementsEmpty.hidden = true;
  requirementsEmpty.textContent = "Loading requirements from the original listing…";
  requirementsEmpty.hidden = false;
  if (!summary.length && job.source === "eudev" && !STATIC_CATALOG_MODE) {
    try {
      const path = new URL(job.url).pathname;
      const response = await fetch(`/api/job-details?path=${encodeURIComponent(path)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not retrieve job requirements.");
      if (!Array.isArray(result.requirementsSummary)) {
        throw new Error("eu.dev.br returned an unexpected requirements response.");
      }
      summary = result.requirementsSummary;
      job.requirementsSummary = summary;
      const savedJob = jobs.find((saved) => saved.url === job.url);
      if (savedJob) {
        savedJob.requirementsSummary = summary;
        saveJobs();
      }
    } catch (error) {
      console.error("Could not load eu.dev.br requirements.", error);
      if (requestId !== requirementsRequestId) return;
      requirementsEmpty.textContent = "Could not retrieve requirements. Open the original listing to review the details.";
    }
  }
  if (requestId !== requirementsRequestId) return;
  for (const requirement of summary) {
    const item = document.createElement("li");
    item.textContent = requirement;
    requirementsList.append(item);
  }
  requirementsList.hidden = summary.length === 0;
  if (summary.length > 0) {
    requirementsEmpty.hidden = true;
  } else if (job.source === "eudev" && requirementsEmpty.textContent.startsWith("Loading")) {
    requirementsEmpty.textContent =
      "No clear requirements were found in the listing. Open the original post for full details.";
  } else if (requirementsEmpty.textContent.startsWith("Loading")) {
    requirementsEmpty.textContent =
      "No clear requirements were included in the retrieved listing. Open the original post for full details.";
  }
  originalJobLink.href = job.url;
  requirementsPanel.hidden = false;
  requirementsPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function updateSavedJobs() {
  jobList.replaceChildren();
  emptyState.hidden = jobs.length > 0;
  jobCount.textContent = `${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}`;

  for (const job of jobs) {
    const row = document.createElement("tr");
    const titleCell = document.createElement("td");
    titleCell.append(createJobLink(job));
    const companyCell = document.createElement("td");
    companyCell.textContent = job.company;
    const locationCell = document.createElement("td");
    locationCell.textContent = job.location || "—";
    const sourceCell = document.createElement("td");
    sourceCell.append(createSourceLink(job));
    const addedCell = document.createElement("td");
    addedCell.textContent = new Date(job.addedAt).toLocaleDateString();
    const actionCell = document.createElement("td");
    const removeButton = document.createElement("button");
    removeButton.className = "button remove-button";
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.setAttribute("aria-label", `Remove ${job.title} at ${job.company}`);
    removeButton.addEventListener("click", () => removeJob(job.id));
    const summaryButton = document.createElement("button");
    summaryButton.className = "button remove-button";
    summaryButton.type = "button";
    summaryButton.textContent = "Requirements";
    summaryButton.setAttribute("aria-label", `Show requirements for ${job.title} at ${job.company}`);
    summaryButton.addEventListener("click", () => showRequirements(job));
    actionCell.append(summaryButton, removeButton);
    row.append(titleCell, companyCell, locationCell, sourceCell, addedCell, actionCell);
    jobList.append(row);
  }
  updateSearchResults();
}

function updateSearchResults() {
  for (const row of resultsList.rows) {
    const job = searchResults.find((result) => result.id === row.dataset.jobId);
    const button = row.querySelector('button[aria-label^="Save "]');
    if (job && button) {
      const saved = jobs.some((savedJob) => savedJob.url === job.url);
      button.textContent = saved ? "Saved" : "Save";
      button.disabled = saved;
    }
  }
}

function formatWorkplace(value) {
  const labels = {
    remote: "Remote",
    hybrid: "Hybrid",
    "on-site": "On-site",
    onsite: "On-site",
    in_person: "On-site",
  };
  return labels[String(value || "").toLowerCase()] || value || "—";
}

function renderSearchResults() {
  resultsList.replaceChildren();
  for (const job of searchResults) {
    const row = document.createElement("tr");
    row.dataset.jobId = job.id;
    const titleCell = document.createElement("td");
    titleCell.append(createJobLink(job));
    const companyCell = document.createElement("td");
    companyCell.textContent = job.company || "—";
    const locationCell = document.createElement("td");
    locationCell.textContent = job.location || "—";
    const workplaceCell = document.createElement("td");
    workplaceCell.textContent = formatWorkplace(job.workplaceType);
    const sourceCell = document.createElement("td");
    sourceCell.append(createSourceLink(job));
    const actionCell = document.createElement("td");
    const summaryButton = document.createElement("button");
    summaryButton.className = "button remove-button";
    summaryButton.type = "button";
    summaryButton.textContent = "Requirements";
    summaryButton.setAttribute("aria-label", `Show requirements for ${job.title} at ${job.company}`);
    summaryButton.addEventListener("click", () => showRequirements(job));
    const saveButton = document.createElement("button");
    saveButton.className = "button remove-button";
    saveButton.type = "button";
    saveButton.textContent = "Save";
    saveButton.setAttribute("aria-label", `Save ${job.title} at ${job.company}`);
    saveButton.addEventListener("click", () => saveJob(job));
    actionCell.append(summaryButton, saveButton);
    row.append(titleCell, companyCell, locationCell, workplaceCell, sourceCell, actionCell);
    resultsList.append(row);
  }

  resultsEmpty.hidden = searchResults.length > 0;
  resultsCount.textContent = searchResults.length ? `${searchResults.length} jobs found` : "No jobs found";
  loadMoreButton.hidden =
    !searchResults.length ||
    !Object.values(sourceHasMore).some(Boolean);
  updateSearchResults();
}

function addResults(newJobs) {
  const existing = new Set(searchResults.map((job) => job.url));
  for (const job of newJobs) {
    if (!existing.has(job.url)) {
      searchResults.push(job);
      existing.add(job.url);
    }
  }
}

async function fetchSource(source, offset) {
  if (STATIC_CATALOG_MODE) {
    const catalog = await loadJobCatalog();
    const matchingJobs = catalog.jobs.filter((job) => {
      if (job.source !== source) return false;
      return (
        LOCATION_SEARCH.matchesJobSearch([
        job.title,
        job.company,
        job.location,
        job.workplaceType,
        ...(Array.isArray(job.searchKeywords) ? job.searchKeywords : []),
        ...(Array.isArray(job.requirementsSummary) ? job.requirementsSummary : []),
        ], search.term) &&
        LOCATION_SEARCH.matchesSourceLocation(job.location, search.location, source)
      );
    });
    const jobs = matchingJobs.slice(offset, offset + STATIC_PAGE_SIZE);
    const nextOffset = offset + jobs.length;
    return {
      jobs,
      total: matchingJobs.length,
      nextOffset,
      hasMore: nextOffset < matchingJobs.length,
    };
  }

  const params = new URLSearchParams({
    source,
    term: search.term,
    location: search.location,
    offset: String(offset),
  });
  const response = await fetch(`/api/jobs?${params.toString()}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `${SOURCE_NAMES[source]} search failed.`);
  if (
    !Array.isArray(result.jobs) ||
    result.jobs.some(
      (job) =>
        !job ||
        typeof job.id !== "string" ||
        typeof job.title !== "string" ||
        typeof job.company !== "string" ||
        typeof job.url !== "string" ||
        !Array.isArray(job.requirementsSummary),
    ) ||
    !Number.isInteger(result.total) ||
    !Number.isInteger(result.nextOffset) ||
    typeof result.hasMore !== "boolean"
  ) {
    throw new Error(`${SOURCE_NAMES[source]} returned an unexpected response.`);
  }
  return result;
}

async function loadJobCatalog() {
  if (!catalogLoadPromise) {
    catalogLoadPromise = fetch(new URL("./jobs.json", document.baseURI), { cache: "no-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load published job catalog (HTTP ${response.status}).`);
        const catalog = await response.json();
        if (
          !catalog ||
          !Array.isArray(catalog.jobs) ||
          catalog.jobs.some(
            (job) =>
              !job ||
              typeof job.id !== "string" ||
              typeof job.source !== "string" ||
              typeof job.title !== "string" ||
              typeof job.company !== "string" ||
              typeof job.location !== "string" ||
              typeof job.url !== "string" ||
              !Array.isArray(job.requirementsSummary)
          )
        ) {
          throw new Error("Published job catalog has an unexpected format.");
        }
        jobCatalog = catalog;
        if (catalog.generatedAt) {
          statusText.textContent = `Catalog refreshed ${new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(catalog.generatedAt))}`;
        }
        return catalog;
      })
      .catch((error) => {
        catalogLoadPromise = undefined;
        throw error;
      });
  }
  return catalogLoadPromise;
}

async function searchSources(append = false) {
  if (searchInProgress) return;
  const selectedSources = [...searchForm.querySelectorAll('input[name="source"]:checked')]
    .map((input) => input.value)
    .filter((source) => SOURCE_IDS.includes(source));
  if (!selectedSources.length) {
    resultsMessage.textContent = "Select at least one job source.";
    return;
  }

  searchInProgress = true;
  searchButton.disabled = true;
  loadMoreButton.disabled = true;
  resultsMessage.textContent = "";
  if (!append) {
    searchResults = [];
    sourceOffsets = Object.fromEntries(selectedSources.map((source) => [source, 0]));
    sourceHasMore = Object.fromEntries(selectedSources.map((source) => [source, false]));
    resultsList.replaceChildren();
    resultsEmpty.hidden = false;
    resultsCount.textContent = "Searching…";
  }

  const sourcesToQuery = selectedSources.filter(
    (source) => !append || sourceHasMore[source],
  );
  statusText.textContent = `Searching ${sourcesToQuery.length} source${sourcesToQuery.length === 1 ? "" : "s"}…`;

  try {
    const settled = await Promise.allSettled(
      sourcesToQuery.map(async (source) => ({
        source,
        result: await fetchSource(source, sourceOffsets[source] || 0),
      })),
    );
    const failures = [];
    for (const entry of settled) {
      if (entry.status === "rejected") {
        failures.push(entry.reason.message || "A source search failed.");
        continue;
      }
      const { source, result } = entry.value;
      sourceOffsets[source] = result.nextOffset;
      sourceHasMore[source] = result.hasMore;
      addResults(result.jobs);
    }
    renderSearchResults();
    const catalogWarnings = STATIC_CATALOG_MODE
      ? selectedSources
          .flatMap((source) => jobCatalog?.sourceFailures?.[source] || [])
          .length
      : 0;
    if (failures.length) {
      resultsMessage.textContent = `Some sources could not be searched: ${failures.join(" ")}`;
      statusText.textContent = "Search completed with source errors";
    } else if (catalogWarnings) {
      resultsMessage.textContent =
        `Some sources reported ${catalogWarnings} collection issue${catalogWarnings === 1 ? "" : "s"} during the last catalog refresh; results may be incomplete.`;
      statusText.textContent = `${searchResults.length} jobs found · catalog warnings`;
    } else {
      statusText.textContent = STATIC_CATALOG_MODE && jobCatalog?.generatedAt
        ? `${searchResults.length} jobs found · refreshed ${new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(jobCatalog.generatedAt))}`
        : `${searchResults.length} jobs found`;
    }
    if (STATIC_CATALOG_MODE && !jobCatalog?.generatedAt) {
      resultsMessage.textContent =
        "The published catalog has not been generated yet. Run the “Refresh job catalog and deploy Pages” workflow in GitHub Actions.";
    }
  } finally {
    searchInProgress = false;
    searchButton.disabled = false;
    loadMoreButton.disabled = false;
  }
}

function saveJob(job) {
  if (jobs.some((savedJob) => savedJob.id === job.id || savedJob.url === job.url)) {
    return false;
  }
  const savedJob = {
    id: job.id,
    source: job.source || getSourceForUrl(job.url),
    sourceName: job.sourceName || SOURCE_NAMES[job.source || getSourceForUrl(job.url)],
    sourceUrl: job.sourceUrl || job.url,
    title: job.title,
    company: job.company,
    location: job.location || "",
    requirementsSummary: Array.isArray(job.requirementsSummary) ? job.requirementsSummary : [],
    url: job.url,
    addedAt: new Date().toISOString(),
  };
  jobs = [savedJob, ...jobs];
  if (!saveJobs()) {
    jobs = jobs.filter((saved) => saved.id !== savedJob.id);
    return false;
  }
  updateSavedJobs();
  statusText.textContent = `${savedJob.sourceName} job saved`;
  return true;
}

function removeJob(id) {
  const previousJobs = jobs;
  jobs = jobs.filter((job) => job.id !== id);
  if (!saveJobs()) {
    jobs = previousJobs;
    return;
  }
  updateSavedJobs();
  statusText.textContent = "Job removed";
}

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(searchForm);
  search = {
    term: String(formData.get("keywords") || "").trim(),
    location: String(formData.get("location") || "").trim(),
    requirementsSummary: [],
  };
  sourceOffsets = {};
  sourceTotals = {};
  searchSources();
});

loadMoreButton.addEventListener("click", () => searchSources(true));

document.querySelector("#show-form").addEventListener("click", () => {
  jobForm.hidden = false;
  formMessage.textContent = "";
  jobForm.elements.title.focus();
});

document.querySelector("#cancel-form").addEventListener("click", () => {
  jobForm.reset();
  jobForm.hidden = true;
  formMessage.textContent = "";
});

jobForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(jobForm);
  const url = String(formData.get("url") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const company = String(formData.get("company") || "").trim();
  if (!isSupportedJobUrl(url)) {
    formMessage.textContent = "Enter an HTTPS job URL from one of the supported sources.";
    return;
  }
  if (!title || !company) {
    formMessage.textContent = "Enter both a job title and company.";
    return;
  }
  if (jobs.some((job) => job.url === url)) {
    formMessage.textContent = "This job is already in your tracker.";
    return;
  }

  const source = getSourceForUrl(url);
  const saved = saveJob({
    id: url,
    source,
    sourceName: SOURCE_NAMES[source],
    sourceUrl: url,
    title,
    company,
    location: String(formData.get("location") || "").trim(),
    url,
  });
  if (!saved) {
    formMessage.textContent = "Could not save this job. Check browser storage and try again.";
    return;
  }
  jobForm.reset();
  jobForm.hidden = true;
  formMessage.textContent = "";
});

document.querySelector("#open-gupy").addEventListener("click", () => {
  document.querySelector("#keywords").focus();
});
document.querySelector("#open-tracker").addEventListener("click", () => {
  document.querySelector("#tracker").scrollIntoView({ behavior: "smooth" });
});
document.querySelector("#taskbar-app").addEventListener("click", () => {
  document.querySelector(".window").scrollIntoView({ behavior: "smooth" });
});

function updateClock() {
  clock.textContent = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
}

updateSavedJobs();
updateClock();
setInterval(updateClock, 30_000);
