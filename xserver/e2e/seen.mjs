// 確認用：一度だけ出る「更新のお知らせ」をはじめから確認済みにする（ほかの確認の操作をふさがないため）
export function skipWhatsNew(browser) {
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (opts) => {
    const ctx = await newContext(opts);
    await ctx.addInitScript(() => { try { localStorage.setItem('natsume.seenChangeId', '99999'); } catch { /* 保存できなくても続ける */ } });
    return ctx;
  };
  browser.newPage = async (opts) => {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('close', () => { ctx.close().catch(() => {}); });
    return page;
  };
  return browser;
}
