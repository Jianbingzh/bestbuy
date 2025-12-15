const { chromium } = require("playwright");
const fs = require("fs");

const NOTIFY_URL = process.env.WEBHOOK_URL; // 通过环境变量配置你的通知地址
const CONFIG_ITEMS = [
  {
    preClick: null,
    productURL:
      "https://www.bestbuy.com/product/apple-mac-mini-desktop-latest-model-m4-chip-built-for-apple-intelligence-16gb-memory-256gb-ssd-silver/JJGCQXH2S4",
    titleLocator: "h1.h4",
    priceLocator: 'div[data-testid="price-block-customer-price"]',
    saveLastPrice: "./mini_m4_last_price.json",
  },
  {
    preClick: { rootURL: "https://www.bestbuy.com/home", clickLocator: 'a.bottom-left-links:has-text("Deal of the Day")' },
    productURL: null,
    titleLocator: "h2.product-title",
    priceLocator: 'div[data-testid="customer-price"]',
    saveLastPrice: "./dealoftoday_last_price.json",
  },
];

async function monitor() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  for (const config of CONFIG_ITEMS) {
    try {
      console.log("正在访问页面...");
      let afterClickURL = null;
      if (config.preClick) {
        await page.goto(config.preClick.rootURL, { waitUntil: "domcontentloaded", timeout: 60000 });
        // 它会等待直到浏览器的 URL 匹配指定的模式或完成导航。
        const navigationPromise = page.waitForURL("**"); // '**' 表示等待任何 URL 变化
        await page.locator(config.priceLocator).click();
        // 等待点击引起的导航完成，并且新的 URL 可用
        await navigationPromise;
        afterClickURL = page.url();
      } else {
        await page.goto(config.productURL, { waitUntil: "domcontentloaded", timeout: 60000 });
      }

      // 提取商品名称
      const title = await page.locator(config.titleLocator).innerText();
      // 提取价格 (根据页面结构，提取 $ 符号后的数字)
      // <div data-testid="price-block-customer-price" data-lu-target="customer_price" style="flex-direction:row"><span class="font-sans text-default text-style-body-md-400 font-500 text-7 leading-7">$599.00</span></div>
      const priceText = await page.locator(config.priceLocator).innerText();
      const currentPrice = parseFloat(priceText.replace(/[^0-9.]/g, ""));

      console.log(`当前商品: ${title}`);
      console.log(`当前价格: ${currentPrice}`);

      // 读取历史价格
      let history = { price: 0 };
      if (fs.existsSync(config.saveLastPrice)) {
        history = JSON.parse(fs.readFileSync(config.saveLastPrice, "utf8"));
      }

      // 对比价格
      if (currentPrice !== history.price) {
        console.log("价格发生变化，发送通知...", NOTIFY_URL);
        try {
          const ntfyMessage = `${title}\nPrice Changed:$${history.price} => $${currentPrice}\n${config.preClick ? afterClickURL : config.productURL}`;
          await fetch(NOTIFY_URL, {
            method: "POST",
            body: ntfyMessage,
          });
        } catch (err) {
          console.error("Fetch error:", err, NOTIFY_URL);
        }

        // 保存新价格
        fs.writeFileSync(config.saveLastPrice, JSON.stringify({ price: currentPrice, name: title }));
      } else {
        console.log("价格未变，跳过通知。");
      }
    } catch (error) {
      console.error("运行出错:", error);
      process.exit(1);
    } finally {
      await browser.close();
    }
  }
}

monitor();
