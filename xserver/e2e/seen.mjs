// 確認用：一度だけ出る「更新のお知らせ」と閉院後の「ブロックの提案」の一覧をはじめから確認済みにする（ほかの確認の操作をふさがないため）
export function skipWhatsNew(browser) {
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (opts) => {
    const ctx = await newContext(opts);
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('natsume.seenChangeId', '99999');
        // 閉院後に予約表を開くと出る「ブロックの提案」の一覧も、今日は見たことにする（確認の時刻によって操作をふさがないため）
        const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
        for (let i = 1; i <= 9; i++) localStorage.setItem(`natsume.blockSuggest.S00${i}.${today}`, '1');
        // 自賠請求の提出のお知らせ（1 日 1 回）も、今日は見たことにする（e2e/jibaialert.mjs だけ消して確かめる）
        localStorage.setItem(`natsume.jibaiAlert.${today}`, '1');
      } catch { /* 保存できなくても続ける */ }
    });
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
