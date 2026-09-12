// Thousands of studio names, most with a single game, so these are NOT
// prerendered - the SPA fallback serves them and the client renders from the
// catalogue it already has. Prerendering them would add thousands of HTML files
// for pages nobody links to.
export const prerender = false;
