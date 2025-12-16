import { chromium, expect } from "playwright/test"; // 导入 chromium 和 expect
import * as fs from "fs/promises"; // ⚡️ 修正 1: 导入 fs/promises 命名空间，以便使用 exists 方法
import { fileURLToPath } from "url";
import path from "path";

// 路径工具 (ESM 必须)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 辅助函数，用于构建相对路径，确保在 ESM 环境下正确解析
const resolvePath = (relativePath) => path.resolve(__dirname, relativePath);

const NOTIFY_URL = process.env.WEBHOOK_URL;
const CONFIG_ITEMS = [
  {
    preClick: null,
    productURL:
      "https://www.bestbuy.com/product/apple-mac-mini-desktop-latest-model-m4-chip-built-for-apple-intelligence-16gb-memory-256gb-ssd-silver/JJGCQXH2S4",
    titleLocator: "h1.h4",
    priceLocator: 'div[data-testid="price-block-customer-price"]',
    saveLastPrice: "mini_m4_last_price.json", // 路径将在 monitor 中解析
  },
  {
    preClick: { rootURL: "https://www.bestbuy.com/home", clickLocator: 'a.bottom-left-links:has-text("Deal of the Day")', haveURL: "/deal-of-the-day/" },
    productURL: null,
    titleLocator: "h2.product-title",
    priceLocator: 'div[data-testid="customer-price"]',
    saveLastPrice: "dealoftoday_last_price.json", // 路径将在 monitor 中解析
  },
];

/**
 * 重载 console.log 以添加时间戳
 */
function enableTimestampedLogging() {
  // 1. 备份原生的 console.log 方法
  const originalLog = console.log;

  // 2. 覆盖 console.log
  console.log = function (...args) {
    // 创建一个 Date 对象来获取当前时间
    const now = new Date();

    // 格式化时间戳
    // 使用 toLocaleString() 配合选项可以输出包含时区信息的格式化字符串
    const timestamp = now.toLocaleString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false, // 使用 24 小时制
      timeZoneName: "short", // 添加时区名称
    });

    // 格式化输出为 [YYYY/MM/DD, HH:MM:SS TZ]
    // 示例输出: [12/15/2025, 16:44:52 PST]
    const formattedTimestamp = `[${timestamp.replace(",", "")}]`;

    // 3. 调用原生的 log 方法，将时间戳作为第一个参数
    // 使用 Function.prototype.apply() 来确保日志能正确输出
    originalLog.apply(console, [formattedTimestamp, ...args]);
  };
}

// --- 使用方法 ---

// 1. 在代码的入口处调用函数来启用带时间戳的日志
enableTimestampedLogging();

async function monitor() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  for (const config of CONFIG_ITEMS) {
    let title = "未知商品"; // 初始化标题
    let priceText = ""; // 初始化价格文本
    let currentPrice = 0; // 初始化价格数值
    const resolvedSavePath = resolvePath(config.saveLastPrice); // ⚡️ 修正 2: 运行时解析路径

    try {
      console.log("正在访问页面...");
      let currentURL = null;

      if (config.preClick) {
        await page.goto(config.preClick.rootURL, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.locator(config.preClick.clickLocator).click();
      } else {
        await page.goto(config.productURL, { waitUntil: "domcontentloaded", timeout: 60000 });
      }

      // --- 数据提取和断言 ---
      const titleLocator = page.locator(config.titleLocator);
      // 确保元素存在并可见
      await expect(titleLocator).toBeVisible({ timeout: 60000 });
      title = await titleLocator.innerText();
      console.log(`当前商品: ${title.trim()}`);

      const priceLocator = page.locator(config.priceLocator);
      // 确保价格元素存在并可见
      await expect(priceLocator).toBeVisible({ timeout: 300000 });
      priceText = await priceLocator.innerText({ timeout: 60000 });
      console.log(`当前价格: ${priceText.trim()}`);

      // 验证价格文本至少包含一个数字或美元符号
      //await expect(priceLocator).toHaveText(/(\$|\d)/, { useInnerText: true });
      priceText = priceText.trim().split("\n")[0];

      currentPrice = parseFloat(priceText.replace(/[^0-9.]/g, ""));
      currentURL = page.url();

      // --- 价格对比和通知 ---
      let history = { price: 0 };
      try {
        const data = await fs.readFile(resolvedSavePath, "utf8");
        history = JSON.parse(data);
      } catch (e) {
        // 如果文件不存在或无法读取（首次运行），history 保持 { price: 0 }
        if (e.code === "ENOENT") {
          console.log("[信息] 历史价格文件不存在，将保存当前价格。");
        } else {
          console.error("[警告] 历史价格文件读取错误:", e.message);
        }
      }

      // 对比价格
      if (currentPrice !== history.price) {
        console.log(`价格发生变化: $${history.price} => $${currentPrice}`);
        if (NOTIFY_URL) {
          console.log("正在发送通知...");
          try {
            const ntfyMessage = `${title.trim()}\nPrice: $${history.price} => $${currentPrice}\nURL: ${currentURL}`;

            // ⚡️ 修正 4: 使用全局 fetch API 发送通知
            await fetch(NOTIFY_URL, {
              method: "POST",
              body: ntfyMessage,
              headers: {
                "Content-Type": "text/plain",
              },
            });
            console.log("通知发送成功。");
          } catch (err) {
            console.error("❌ Fetch error:", err.message);
          }
        } else {
          console.log("未设置 WEBHOOK_URL，跳过通知。");
        }

        // ⚡️ 修正 5: 使用 fs/promises.writeFile 异步保存新价格
        await fs.writeFile(resolvedSavePath, JSON.stringify({ price: currentPrice, name: title.trim(), timestamp: new Date().toISOString() }));
        console.log("新价格已保存。");
      } else {
        console.log("价格未变，跳过通知。");
      }
    } catch (error) {
      console.error("❌ 运行出错:", error.message);
      // 在出错时关闭浏览器并退出
      // await browser.close();
      // process.exit(1);
    }
  } //end for
  await browser.close();
  console.log("监控任务完成。");
}

monitor().catch((err) => {
  console.error("主监控函数未捕获的错误:", err);
  process.exit(1);
});
