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

  function cleanDisplayText(value) {
    const entities = {
      aacute: "á", acirc: "â", agrave: "à", auml: "ä", atilde: "ã",
      amp: "&", apos: "'", bull: "•", ccedil: "ç", copy: "©", eacute: "é",
      ecirc: "ê", egrave: "è", euro: "€", hellip: "…", iacute: "í",
      icirc: "î", igrave: "ì", laquo: "«", ldquo: "“", lsquo: "‘", mdash: "—",
      nbsp: " ", ndash: "–", ntilde: "ñ", oacute: "ó", ocirc: "ô", ograve: "ò",
      ouml: "ö", otilde: "õ", pound: "£", quot: '"', raquo: "»", rdquo: "”",
      reg: "®", rsquo: "’", uacute: "ú", ucirc: "û", ugrave: "ù", uuml: "ü",
      yacute: "ý", trade: "™",
    };
    let text = String(value || "")
      .replace(/â€™/g, "’")
      .replace(/â€œ/g, "“")
      .replace(/â€/g, "”")
      .replace(/â€“/g, "–")
      .replace(/â€”/g, "—")
      .replace(/â€¦/g, "…")
      .replace(/â€¢/g, "•")
      .replace(/ï¸/g, "")
      .replace(/ï¿½/g, " ")
      .replace(/Â(?=\s|[.,;:!?])/g, "")
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, name) => {
        if (name[0] === "#") {
          const codePoint = name[1].toLowerCase() === "x"
            ? Number.parseInt(name.slice(2), 16)
            : Number.parseInt(name.slice(1), 10);
          return codePoint > 0 && codePoint <= 0x10ffff
            ? String.fromCodePoint(codePoint)
            : " ";
        }
        return entities[name.toLowerCase()] || " ";
      });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      text = text.replace(
        /(?:Ã[\u0080-\u00bf]|Â[\u0080-\u00bf]|â[\u0080-\u00bf]{1,2}|ð[\u0080-\u00bf]{1,3})/g,
        (sequence) => {
          const bytes = Uint8Array.from([...sequence], (character) => character.charCodeAt(0) & 0xff);
          const decoded = new TextDecoder().decode(bytes);
          return decoded.includes("\ufffd") ? sequence : decoded;
        },
      );
    }
    return text
      .replace(/ï¸/g, "")
      .replace(/ï¿½/g, " ")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\ufeff\ufffd]/g, " ")
      .replace(/\p{Extended_Pictographic}(?:\uFE0F|\u200D|\p{Extended_Pictographic})*/gu, " ")
      .replace(/\s+/g, " ")
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

  const jobSearchAliases = new Map();
  for (const terms of [
    ["developer", "developers", "desenvolvedor", "desenvolvedora", "programador", "programadora"],
    ["engineer", "engineering", "engenheiro", "engenheira", "engenharia"],
    ["analyst", "analysta", "analista"],
    ["designer", "design"],
  ]) {
    const normalizedTerms = terms.map(normalizeSearchText);
    for (const term of normalizedTerms) jobSearchAliases.set(term, normalizedTerms);
  }

  function matchesJobSearch(values, query) {
    const searchableText = normalizeSearchText(values.join(" "));
    const normalizedQuery = normalizeSearchText(query);
    const variants = jobSearchAliases.get(normalizedQuery) || [normalizedQuery];
    return variants.some((variant) =>
      variant.split(" ").filter(Boolean).every((word) => searchableText.includes(word)),
    );
  }

  const api = {
    normalizeSearchText,
    cleanDisplayText,
    isBrazilLocation,
    isBrazilCountry,
    matchesLocation,
    matchesSourceLocation,
    matchesJobSearch,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.JobFinderLocationSearch = api;
})(typeof globalThis === "undefined" ? this : globalThis);
