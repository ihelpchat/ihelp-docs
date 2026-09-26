export async function createSitePage(browser, siteUrl, basePath) {
  const page = await browser.newPage();
  if (basePath) await page.route(`${siteUrl}${basePath}/**`, async (route) => {
    const url = new URL(route.request().url());
    url.pathname = url.pathname.slice(basePath.length);
    await route.fulfill({ response: await route.fetch({ url: url.href }) });
  });
  return page;
}
