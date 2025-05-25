chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'parseHTMLViaOffscreen') {
    if (typeof parseAll !== 'function') {
      const errorMsg = "Offscreen: функция parseAll не определена. Проверьте, что parser.js загружен корректно.";
      console.error(errorMsg);
      sendResponse({ success: false, type: 'setupError', error: errorMsg });
      return;
    }

    try {
      console.log("Offscreen: Получен HTML, начинаю парсинг...");
      const parsedData = parseAll(message.htmlContent);
      console.log("Offscreen: Парсинг завершен. Отправляю данные обратно в Service Worker.");
      sendResponse({ success: true, data: parsedData });
    } catch (parseError) {
      console.error("Offscreen: Ошибка во время парсинга:", parseError, parseError.stack);
      sendResponse({ success: false, type: 'parseError', error: parseError.message, stack: parseError.stack });
    }
    return true;
  }
});