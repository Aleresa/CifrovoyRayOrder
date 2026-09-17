import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

export const PRODUCTS = Object.freeze({
  mm0a3: {
    name: "Оригинальный кабель Lightning to USB-C 1 м",
    sku: "MM0A3",
    price: 900,
  },
  mqgh2: {
    name: "Оригинальный кабель Lightning to USB-C 2 м",
    sku: "MQGH2",
    price: 1000,
  },
  mqkj3: {
    name: "Оригинальный кабель USB-C to USB-C 1 м",
    sku: "MQKJ3",
    price: 1100,
  },
});

const PUBLIC_DIR = resolve(fileURLToPath(new URL("./public/", import.meta.url)));
const MAX_BODY_BYTES = 16_384;
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jfif": "image/jpeg",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const sendJson = (response, status, payload) => {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
};

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const formatRubles = (value) => new Intl.NumberFormat("ru-RU").format(value) + " ₽";

export function validateOrder(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, message: "Некорректные данные заказа." };
  }

  if (payload.website) {
    return { ok: false, message: "Заказ отклонён." };
  }

  const telegram = String(payload.telegram ?? "").trim().replace(/^@+/, "");
  if (!/^[A-Za-z0-9_]{5,32}$/.test(telegram)) {
    return { ok: false, message: "Проверьте ник в Telegram." };
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return { ok: false, message: "Добавьте хотя бы один товар." };
  }

  const seen = new Set();
  const items = [];
  for (const requestedItem of payload.items) {
    const id = String(requestedItem?.id ?? "");
    const quantity = Number(requestedItem?.quantity);
    const product = PRODUCTS[id];
    if (!product || seen.has(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
      return { ok: false, message: "В заказе указано некорректное количество товара." };
    }
    seen.add(id);
    items.push({ id, quantity, ...product, total: quantity * product.price });
  }

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = items.reduce((sum, item) => sum + item.total, 0);
  return { ok: true, order: { telegram, items, totalQuantity, totalPrice } };
}

export function formatTelegramMessage(order, orderId, createdAt = new Date()) {
  const rows = order.items.map(
    (item, index) =>
      `<b>${index + 1}. ${escapeHtml(item.name)}</b>\n` +
      `Артикул: <code>${escapeHtml(item.sku)}</code>\n` +
      `${item.quantity} шт. × ${formatRubles(item.price)} = <b>${formatRubles(item.total)}</b>`,
  );
  const date = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(createdAt);

  return [
    `🛒 <b>Новый заказ ${escapeHtml(orderId)}</b>`,
    `👤 Покупатель: @${escapeHtml(order.telegram)}`,
    `🕒 ${escapeHtml(date)} (МСК)`,
    "",
    ...rows.flatMap((row) => [row, ""]),
    `📦 Всего: <b>${order.totalQuantity} шт.</b>`,
    `💳 Сумма: <b>${formatRubles(order.totalPrice)}</b>`,
  ].join("\n");
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("INVALID_JSON");
  }
}

async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { configured: false };

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const details = await response.text();
    console.error("Telegram API error:", response.status, details.slice(0, 300));
    throw new Error("TELEGRAM_ERROR");
  }
  return { configured: true };
}

async function handleCreateOrder(request, response) {
  try {
    const payload = await readJsonBody(request);
    const validation = validateOrder(payload);
    if (!validation.ok) return sendJson(response, 400, validation);

    const orderId = `CR-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;
    const message = formatTelegramMessage(validation.order, orderId);
    const telegram = await sendTelegramMessage(message);

    if (!telegram.configured && process.env.NODE_ENV === "production") {
      console.error("Telegram environment variables are not configured.");
      return sendJson(response, 503, {
        ok: false,
        message: "Приём заказов временно недоступен. Свяжитесь с продавцом напрямую.",
      });
    }

    if (!telegram.configured) console.info("Development order:\n" + message.replace(/<[^>]+>/g, ""));
    return sendJson(response, 201, { ok: true, orderId, demo: !telegram.configured });
  } catch (error) {
    if (error.message === "PAYLOAD_TOO_LARGE") {
      return sendJson(response, 413, { ok: false, message: "Слишком большой запрос." });
    }
    if (error.message === "INVALID_JSON") {
      return sendJson(response, 400, { ok: false, message: "Некорректные данные заказа." });
    }
    console.error("Order processing error:", error);
    return sendJson(response, 502, {
      ok: false,
      message: "Не удалось отправить заказ. Попробуйте ещё раз через минуту.",
    });
  }
}

async function serveStatic(request, response, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400);
    return response.end("Bad request");
  }

  const requestedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = resolve(PUBLIC_DIR, `.${requestedPath}`);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + sep)) {
    response.writeHead(403);
    return response.end("Forbidden");
  }

  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) throw new Error("NOT_FILE");
    const content = await readFile(filePath);
    const cacheControl = requestedPath.startsWith("/assets/") ? "public, max-age=604800" : "no-cache";
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": content.length,
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
    });
    if (request.method === "HEAD") return response.end();
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Страница не найдена");
  }
}

export const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "POST" && url.pathname === "/api/orders") {
    return handleCreateOrder(request, response);
  }
  if (request.method === "GET" && url.pathname === "/api/health") {
    return sendJson(response, 200, { ok: true });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD, POST" });
    return response.end("Method not allowed");
  }
  return serveStatic(request, response, url.pathname);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, "0.0.0.0", () => {
    console.log(`Цифровой Рай: http://localhost:${port}`);
  });
}
