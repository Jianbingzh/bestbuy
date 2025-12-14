const { chromium } = require("playwright");
const fs = require("fs");

const URL = "https://www.bestbuy.com/product/apple-mac-mini-desktop-latest-model-m4-chip-built-for-apple-intelligence-16gb-memory-256gb-ssd-silver/JJGCQXH2S4";
const NOTIFY_URL = process.env.WEBHOOK_URL; // 通过环境变量配置你的通知地址
const DATA_FILE = "./last_price.json";

async function monitor() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    console.log("正在访问页面...");
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });

    // 提取商品名称
    const title = await page.locator("h1.h4").innerText();
    // 提取价格 (根据页面结构，提取 $ 符号后的数字)
    // <div data-testid="price-block-customer-price" data-lu-target="customer_price" style="flex-direction:row"><span class="font-sans text-default text-style-body-md-400 font-500 text-7 leading-7">$599.00</span></div>
    const priceText = await page.locator('div[data-testid="price-block-customer-price"]').innerText();
    const currentPrice = parseFloat(priceText.replace(/[^0-9.]/g, ""));

    console.log(`当前商品: ${title}`);
    console.log(`当前价格: ${currentPrice}`);

    // 读取历史价格
    let history = { price: 0 };
    if (fs.existsSync(DATA_FILE)) {
      history = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }

    // 对比价格
    if (currentPrice !== history.price) {
      console.log("价格发生变化，发送通知...", NOTIFY_URL);
      try {
        const ntfyMessage = `${title}\nPrice Changed:$${history.price} => $${currentPrice}\n${URL}`;
        await fetch(NOTIFY_URL, {
          method: "POST",
          body: ntfyMessage,
        });
      } catch (err) {
        console.error("Fetch error:", err, NOTIFY_URL);
      }

      // 保存新价格
      fs.writeFileSync(DATA_FILE, JSON.stringify({ price: currentPrice, name: title }));
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

monitor();
