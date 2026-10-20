(function attachLocationSearch(root) {
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

  const aliases = new Map();
  const brazilStates = {
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
  const usStates = {
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
  const usStateCodes = new Set(Object.values(usStates));

  function addAliases(entries) {
    for (const [name, abbreviation] of Object.entries(entries)) {
      const normalizedName = normalizeSearchText(name);
      const normalizedAbbreviation = normalizeSearchText(abbreviation);
      aliases.set(normalizedName, [
        ...new Set([...(aliases.get(normalizedName) || []), normalizedAbbreviation]),
      ]);
      aliases.set(normalizedAbbreviation, [
        ...new Set([...(aliases.get(normalizedAbbreviation) || []), normalizedName]),
      ]);
    }
  }

  addAliases(brazilStates);
  addAliases(usStates);
  for (const [name, values] of Object.entries({
    brazil: ["brasil", "br"],
    brasil: ["brazil", "br"],
    "united states": ["usa", "us", "united states of america"],
    usa: ["us", "united states", "united states of america"],
    "united kingdom": ["uk", "great britain", "britain"],
    uk: ["united kingdom", "great britain", "britain"],
    "south korea": ["korea"],
    "new york city": ["nyc"],
  })) {
    aliases.set(normalizeSearchText(name), values.map(normalizeSearchText));
    for (const value of values) {
      const normalizedValue = normalizeSearchText(value);
      aliases.set(normalizedValue, [
        ...(aliases.get(normalizedValue) || []),
        normalizeSearchText(name),
      ]);
    }
  }

  function getLocationTerms(value) {
    const normalized = normalizeSearchText(value);
    return [normalized, ...(aliases.get(normalized) || [])];
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
      Object.keys(brazilStates).some((state) => normalizeSearchText(state) === normalized) ||
      (Object.values(brazilStates).includes(normalized) && !usStateCodes.has(normalized))
    );
  }

  function isBrazilCountry(location) {
    return getLocationTerms(location).some((term) =>
      ["br", "brazil", "brasil"].includes(normalizeSearchText(term)),
    );
  }

  function matchesLocation(value, location) {
    if (!location) return true;
    const normalizedValue = normalizeSearchText(value);
    if (getLocationTerms(location).some((term) => containsLocationTerm(normalizedValue, term))) {
      return true;
    }
    return (
      isBrazilLocation(location) &&
      /\b(brazil|brasil|latam|latin america|worldwide|global|anywhere)\b/.test(normalizedValue)
    );
  }

  function matchesSourceLocation(value, location, source) {
    if (isBrazilCountry(location) && ["gupy", "eudev"].includes(source)) return true;
    return matchesLocation(value, location);
  }

  const api = {
    normalizeSearchText,
    isBrazilLocation,
    isBrazilCountry,
    matchesLocation,
    matchesSourceLocation,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.JobFinderLocationSearch = api;
})(typeof globalThis === "undefined" ? this : globalThis);
