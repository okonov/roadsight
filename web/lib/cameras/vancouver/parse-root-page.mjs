// See docs/add-trafficcams-vancouver.md §1: the root page lists every intersection twice
// (once under each street name), link text can wrap across lines, and some hrefs carry
// trailing whitespace inside the quotes (`href="/alma10.htm\n\t\t"`).

const LINK = /<a href="([^"]*\.htm[^"]*)">/gi;

/**
 * Every distinct intersection page linked from the root page, as lower-cased,
 * leading-slash page paths ('/boundary1.htm'). Deduped — the root page links each
 * intersection twice, once per street name in the pair.
 */
export function parseRootPage(html) {
  const paths = new Set();
  for (const match of html.matchAll(LINK)) {
    paths.add(match[1].trim().toLowerCase());
  }
  return [...paths];
}
