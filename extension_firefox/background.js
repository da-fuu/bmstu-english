function copyTextToPageContext(textToCopy) {
    const textArea = document.createElement("textarea");
    textArea.value = textToCopy;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "-9999px";
    document.body.appendChild(textArea);
    let success = false;
    try {
        textArea.select();
        textArea.focus();
        success = document.execCommand('copy');
    } catch (err) {
        console.error('PageContext: Error during execCommand("copy"):', err);
        success = false;
    } finally {
        if (document.body.contains(textArea)) {
            document.body.removeChild(textArea);
        }
    }
    return success;
}


browser.browserAction.onClicked.addListener(async (tab) => {
  if (!tab.id) {
      console.error("Background: Tab ID is missing.");
      return;
  }
  if (!tab.url) {
    console.log('Background: Tab URL is undefined.');
    browser.notifications.create("tabUrlError_mv2", {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Ошибка',
      message: 'Не удалось определить URL вкладки.'
    });
    return;
  }

  const allowedProtocols = ['http:', 'https:', 'file:'];
  let currentProtocol;
  try {
    currentProtocol = new URL(tab.url).protocol;
  } catch (e) {
    console.log(`Background: Invalid tab URL: ${tab.url}`, e);
    browser.notifications.create("invalidUrlError_mv2", { /* ... */ });
    return;
  }
  
  if (allowedProtocols.includes(currentProtocol)) {
    try {
      if (typeof parseAll !== 'function') {
        console.error("Background: parseAll function is not defined.");
        browser.notifications.create("parserLoadError_mv2", { /* ... */ });
        return;
      }

      const resultsHTML = await browser.tabs.executeScript(tab.id, {
        code: `document.documentElement.outerHTML;`
      });

      if (!resultsHTML || resultsHTML.length === 0 || !resultsHTML[0]) {
        console.error('Background: Could not get HTML from page.');
        browser.notifications.create("getHtmlError_mv2", { /* ... */ });
        return;
      }
      const htmlContent = resultsHTML[0];
      
      const parsedData = parseAll(htmlContent);

      if (!parsedData || parsedData.trim() === "") {
          console.warn("Background: Parsed data is empty. Nothing to copy.");
          browser.notifications.create("emptyParseResult_mv2", {
              type: 'basic',
              iconUrl: 'icons/icon48.png',
              title: 'Парсинг',
              message: 'После парсинга нет данных для копирования.'
          });
          return;
      }

      if (parsedData == 'Ошибка при парсинге!') {
          console.warn("Background: Parsed data is invalid.");
          browser.notifications.create("emptyParseResult_mv2", {
              type: 'basic',
              iconUrl: 'icons/icon48.png',
              title: 'Парсинг',
              message: 'Ошибка парсинга содержимого страницы. Вы уверены, что находитесь на странице с заданиями в e-learning?'
          });
          return;
      }

      const scriptToExecute = `(${copyTextToPageContext.toString()})(${JSON.stringify(parsedData)});`;
      
      const copyResults = await browser.tabs.executeScript(tab.id, {
        code: scriptToExecute
      });

      let copySuccessful = false;
      if (copyResults && copyResults.length > 0 && copyResults[0] === true) {
          copySuccessful = true;
      } else {
          console.warn("Background: executeScript for copy did not return true. Result:", copyResults);
      }

      if (copySuccessful) {
        console.log('Background: Data copied to clipboard.');
        browser.browserAction.setBadgeText({ text: "OK", tabId: tab.id });
        browser.browserAction.setBadgeBackgroundColor({ color: "#4CAF50", tabId: tab.id });

        setTimeout(() => {
            browser.browserAction.setBadgeText({ text: "", tabId: tab.id });
        }, 3000);
      } else {
        console.error('Background: Failed to copy data to clipboard.');
        browser.notifications.create("copyError_mv2", {
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Ошибка буфера обмена',
          message: 'Не удалось скопировать данные. Проверьте консоль страницы (Ctrl+Shift+J) для логов "PageContext".'
        });
      }

    } catch (error) {
      console.error('Background: General error:', error, error.stack);
      let notificationMessage = `Произошла ошибка: ${error.message}`;
      if (error.message && (error.message.toLowerCase().includes("missing host permission") || 
                             error.message.toLowerCase().includes("cannot access contents of url") ||
                             error.message.toLowerCase().includes("extension does not have permission to access the tab"))) {
         notificationMessage = 'Не удалось получить доступ к странице. Убедитесь, что расширение имеет необходимые разрешения и для локальных файлов включен доступ в about:addons.';
      }
      browser.notifications.create("generalError_mv2", {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Критическая ошибка',
        message: notificationMessage
      });
    }
  } else {
    console.log(`Background: Cannot execute script on this page protocol: ${currentProtocol}`);
    browser.notifications.create("protocolError_mv2", {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Ошибка',
      message: 'Вкладка имеет неподдерживаемый протокол'
    });
  }
});