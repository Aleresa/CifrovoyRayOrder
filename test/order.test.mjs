import test from "node:test";
import assert from "node:assert/strict";
import { formatTelegramMessage, validateOrder } from "../server.mjs";

test("validates and recalculates a correct order on the server", () => {
  const result = validateOrder({
    telegram: "@buyer_name",
    items: [
      { id: "mm0a3", quantity: 2, price: 1 },
      { id: "mqkj3", quantity: 3, price: 1 },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.order.telegram, "buyer_name");
  assert.equal(result.order.totalQuantity, 5);
  assert.equal(result.order.totalPrice, 5100);
});

test("rejects invalid Telegram username", () => {
  const result = validateOrder({ telegram: "bad name", items: [{ id: "mm0a3", quantity: 1 }] });
  assert.equal(result.ok, false);
});

test("rejects unknown products and quantities outside 1–1000", () => {
  assert.equal(validateOrder({ telegram: "buyer1", items: [{ id: "unknown", quantity: 1 }] }).ok, false);
  assert.equal(validateOrder({ telegram: "buyer1", items: [{ id: "mm0a3", quantity: 1001 }] }).ok, false);
  assert.equal(validateOrder({ telegram: "buyer1", items: [{ id: "mm0a3", quantity: 0 }] }).ok, false);
});

test("rejects duplicate products", () => {
  const result = validateOrder({
    telegram: "buyer1",
    items: [
      { id: "mm0a3", quantity: 1 },
      { id: "mm0a3", quantity: 2 },
    ],
  });
  assert.equal(result.ok, false);
});

test("formats a readable Telegram message and escapes user content", () => {
  const validation = validateOrder({ telegram: "buyer_name", items: [{ id: "mqgh2", quantity: 2 }] });
  const message = formatTelegramMessage(validation.order, "CR-TEST", new Date("2026-09-17T10:00:00Z"));

  assert.match(message, /Новый заказ CR-TEST/);
  assert.match(message, /@buyer_name/);
  assert.match(message, /MQGH2/);
  assert.match(message, /2\s000 ₽/);
});
