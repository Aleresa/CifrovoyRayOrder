const products = [
  {
    id: "mm0a3",
    name: "Оригинальный кабель Lightning to USB-C 1 м",
    sku: "MM0A3",
    price: 900,
    image: "/assets/apple-lightning-usbc-1m.jfif",
  },
  {
    id: "mqgh2",
    name: "Оригинальный кабель Lightning to USB-C 2 м",
    sku: "MQGH2",
    price: 1000,
    image: "/assets/apple-lightning-usbc-2m.jfif",
  },
  {
    id: "mqkj3",
    name: "Оригинальный кабель USB-C to USB-C 1 м",
    sku: "MQKJ3",
    price: 1100,
    image: "/assets/apple-usbc-usbc-1m.jfif",
  },
];

const quantities = new Map(products.map(({ id }) => [id, 0]));
const currency = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});
const integer = new Intl.NumberFormat("ru-RU");

const productList = document.querySelector("#product-list");
const template = document.querySelector("#product-template");
const totalQuantity = document.querySelector("#total-quantity");
const grandTotal = document.querySelector("#grand-total");
const summaryHint = document.querySelector("#summary-hint");
const orderForm = document.querySelector("#order-form");
const telegramInput = document.querySelector("#telegram");
const telegramWrap = telegramInput.closest(".input-wrap");
const telegramError = document.querySelector("#telegram-error");
const submitButton = document.querySelector("#submit-order");
const formStatus = document.querySelector("#form-status");
const successDialog = document.querySelector("#success-dialog");

const clampQuantity = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(1000, Math.max(0, parsed));
};

const getTotals = () =>
  products.reduce(
    (totals, product) => {
      const quantity = quantities.get(product.id) ?? 0;
      totals.quantity += quantity;
      totals.price += quantity * product.price;
      return totals;
    },
    { quantity: 0, price: 0 },
  );

const updateSummary = () => {
  const totals = getTotals();
  totalQuantity.textContent = `${integer.format(totals.quantity)} шт.`;
  grandTotal.textContent = currency.format(totals.price);
  summaryHint.textContent = totals.quantity
    ? `В заказе выбрано позиций: ${products.filter(({ id }) => quantities.get(id) > 0).length}. Проверьте количество перед отправкой.`
    : "Добавьте хотя бы один товар, чтобы оформить заказ.";
  submitButton.disabled = totals.quantity === 0 || submitButton.classList.contains("loading");
};

const setQuantity = (product, row, nextValue) => {
  const quantity = clampQuantity(nextValue);
  quantities.set(product.id, quantity);
  row.querySelector(".quantity-input").value = quantity;
  row.querySelector(".line-total strong").textContent = currency.format(quantity * product.price);
  row.classList.toggle("selected", quantity > 0);
  updateSummary();
};

products.forEach((product, index) => {
  const fragment = template.content.cloneNode(true);
  const row = fragment.querySelector(".product-row");
  const image = row.querySelector(".product-image");
  const quantityInput = row.querySelector(".quantity-input");

  row.dataset.productId = product.id;
  image.src = product.image;
  image.alt = product.name;
  row.querySelector(".product-index").textContent = `ТОВАР ${String(index + 1).padStart(2, "0")}`;
  row.querySelector(".product-name").textContent = product.name;
  row.querySelector(".product-sku").textContent = product.sku;
  row.querySelector(".product-price strong").textContent = currency.format(product.price);
  quantityInput.setAttribute("aria-label", `Количество: ${product.name}`);

  row.querySelector(".quantity-minus").addEventListener("click", () => {
    setQuantity(product, row, (quantities.get(product.id) ?? 0) - 1);
  });
  row.querySelector(".quantity-plus").addEventListener("click", () => {
    setQuantity(product, row, (quantities.get(product.id) ?? 0) + 1);
  });
  quantityInput.addEventListener("input", (event) => {
    setQuantity(product, row, event.currentTarget.value);
  });
  quantityInput.addEventListener("blur", () => {
    quantityInput.value = quantities.get(product.id) ?? 0;
  });

  productList.append(fragment);
});

const normalizeTelegram = (value) => value.trim().replace(/^@+/, "");
const isTelegramValid = (value) => /^[A-Za-z0-9_]{5,32}$/.test(normalizeTelegram(value));

const validateTelegram = () => {
  const value = telegramInput.value.trim();
  let message = "";
  if (!value) {
    message = "Укажите ник, чтобы мы могли подтвердить заказ.";
  } else if (!isTelegramValid(value)) {
    message = "Ник должен содержать 5–32 латинских символа, цифры или _.";
  }
  telegramError.textContent = message;
  telegramWrap.classList.toggle("invalid", Boolean(message));
  telegramInput.setAttribute("aria-invalid", String(Boolean(message)));
  return !message;
};

telegramInput.addEventListener("input", () => {
  if (telegramError.textContent) validateTelegram();
});
telegramInput.addEventListener("blur", validateTelegram);

const setSubmitting = (submitting) => {
  submitButton.classList.toggle("loading", submitting);
  submitButton.querySelector("span").textContent = submitting ? "Отправляем заказ" : "Оформить заказ";
  submitButton.disabled = submitting || getTotals().quantity === 0;
};

const resetOrder = () => {
  products.forEach((product) => {
    const row = productList.querySelector(`[data-product-id="${product.id}"]`);
    setQuantity(product, row, 0);
  });
  telegramInput.value = "";
  telegramError.textContent = "";
  telegramWrap.classList.remove("invalid");
};

orderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  formStatus.textContent = "";

  if (!validateTelegram()) {
    telegramInput.focus();
    return;
  }

  const items = products
    .map(({ id }) => ({ id, quantity: quantities.get(id) ?? 0 }))
    .filter(({ quantity }) => quantity > 0);

  if (!items.length) {
    formStatus.textContent = "Добавьте хотя бы один товар.";
    return;
  }

  setSubmitting(true);
  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        telegram: normalizeTelegram(telegramInput.value),
        items,
        website: orderForm.elements.website.value,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.message || "Не удалось отправить заказ. Попробуйте ещё раз.");
    }

    document.querySelector("#order-number").textContent = result.orderId;
    document.querySelector("#success-message").textContent = result.demo
      ? "Заказ сформирован в тестовом режиме. Подключите Telegram-бота для получения уведомлений."
      : "Ваш заказ отправлен. Мы свяжемся с вами в Telegram.";
    successDialog.showModal();
    resetOrder();
  } catch (error) {
    formStatus.textContent = error.message;
  } finally {
    setSubmitting(false);
  }
});

document.querySelector("#close-dialog").addEventListener("click", () => successDialog.close());
successDialog.addEventListener("click", (event) => {
  if (event.target === successDialog) successDialog.close();
});
document.querySelector("#year").textContent = new Date().getFullYear();
updateSummary();
