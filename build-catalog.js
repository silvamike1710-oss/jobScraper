const { writeFile } = require("node:fs/promises");
const path = require("node:path");
const { SOURCE_INFO, SOURCE_ADAPTERS, getEuDevJobDetails } = require("./server.js");

const SEARCH_TERMS = [
  "developer",
  "engineer",
  "designer",
  "analyst",
  "product",
  "marketing",
  "sales",
  "support",
  "data",
  "devops",
  "desenvolvedor",
  "programador",
  "programadora",
  "engenheiro",
  "analista",
  "dados",
  "suporte",
];
const MAX_PAGES_PER_TERM = 3;
const MAX_EUDEV_REQUIREMENT_DETAILS = 60;
const jobsByUrl = new Map();
const sourceFailures = Object.fromEntries(
  Object.keys(SOURCE_ADAPTERS).map((source) => [source, []]),
);

async function collectSourcePage(source, term, offset) {
  return SOURCE_ADAPTERS[source](term, "", offset);
}

async function main() {
  for (const term of SEARCH_TERMS) {
    const sourceResults = await Promise.allSettled(
      Object.keys(SOURCE_ADAPTERS).map(async (source) => {
        let offset = 0;
        for (let page = 0; page < MAX_PAGES_PER_TERM; page += 1) {
          const result = await collectSourcePage(source, term, offset);
          for (const job of result.jobs) {
            if (!job || !job.url) continue;
            const current = jobsByUrl.get(job.url) || {
              ...job,
              searchKeywords: [],
            };
            if (!current.searchKeywords.includes(term)) current.searchKeywords.push(term);
            if (!current.requirementsSummary?.length && job.requirementsSummary?.length) {
              current.requirementsSummary = job.requirementsSummary;
            }
            jobsByUrl.set(job.url, current);
          }
          if (!result.hasMore || result.nextOffset <= offset) break;
          offset = result.nextOffset;
        }
      }),
    );

    sourceResults.forEach((result, index) => {
      if (result.status === "rejected") {
        const source = Object.keys(SOURCE_ADAPTERS)[index];
        sourceFailures[source].push(`${term}: ${result.reason.message || "request failed"}`);
        console.error(`${SOURCE_INFO[source].name} catalog search failed for "${term}".`, result.reason);
      }
    });
    console.log(`Collected catalog keyword "${term}".`);
  }

  if (jobsByUrl.size === 0) {
    throw new Error("No jobs were collected from any source; refusing to publish an empty catalog.");
  }

  const euDevJobs = [...jobsByUrl.values()]
    .filter((job) => job.source === "eudev" && !job.requirementsSummary?.length)
    .slice(0, MAX_EUDEV_REQUIREMENT_DETAILS);
  for (const job of euDevJobs) {
    try {
      const { requirementsSummary } = await getEuDevJobDetails(new URL(job.url).pathname);
      job.requirementsSummary = requirementsSummary;
    } catch (error) {
      sourceFailures.eudev.push(`Requirements for ${job.title}: ${error.message}`);
      console.error(`Could not precompute eu.dev.br requirements for "${job.title}".`, error);
    }
  }

  const jobs = [...jobsByUrl.values()].sort((left, right) => {
    const leftDate = Date.parse(left.publishedAt) || 0;
    const rightDate = Date.parse(right.publishedAt) || 0;
    return rightDate - leftDate;
  });
  const output = {
    generatedAt: new Date().toISOString(),
    searchTerms: SEARCH_TERMS,
    sourceFailures: Object.fromEntries(
      Object.entries(sourceFailures).filter(([, failures]) => failures.length > 0),
    ),
    jobs,
  };
  const outputPath = path.join(__dirname, "jobs.json");
  await writeFile(outputPath, `${JSON.stringify(output)}\n`, "utf8");
  console.log(`Wrote ${jobs.length} jobs to ${outputPath}.`);
}

main().catch((error) => {
  console.error("Could not build the static job catalog.", error);
  process.exitCode = 1;
});
