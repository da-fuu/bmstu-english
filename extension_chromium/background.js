function getPageHTML() {
  return document.documentElement.outerHTML;
}

function copyTextToClipboardOnPage(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text)
      .then(() => {
        console.log('ContentScript: Text copied to clipboard using navigator.clipboard.writeText');
        return true;
      })
      .catch(err => {
        console.error('ContentScript: Failed to copy text using navigator.clipboard.writeText: ', err);
        return fallbackCopyTextToClipboard(text);
      });
  } else {
    return fallbackCopyTextToClipboard(text);
  }
}

function fallbackCopyTextToClipboard(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    const successful = document.execCommand('copy');
    if (successful) {
        console.log('ContentScript: Text copied to clipboard using fallback execCommand');
        document.body.removeChild(textArea);
        return true;
    } else {
        console.error('ContentScript: Fallback execCommand("copy") was unsuccessful');
        document.body.removeChild(textArea);
        return false;
    }
  } catch (err) {
    console.error('ContentScript: Error in fallback execCommand("copy"): ', err);
    document.body.removeChild(textArea);
    return false;
  }
}


const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
let creatingOffscreenPromise = null;

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
  });

  if (existingContexts.length > 0) {
    console.log("Background: Offscreen document already exists.");
    return;
  }

  if (creatingOffscreenPromise) {
    console.log("Background: Offscreen document creation is already in progress. Waiting...");
    await creatingOffscreenPromise;
    return;
  }
  
  console.log("Background: Creating offscreen document...");
  creatingOffscreenPromise = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason.DOM_PARSER],
    justification: 'Needed for parsing HTML string using DOMParser',
  });

  try {
      await creatingOffscreenPromise;
      console.log("Background: Offscreen document created successfully.");
  } catch (error) {
      console.error("Background: Error creating offscreen document:", error);
      const finalContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
      });
      if (finalContexts.length === 0) {
        throw error;
      } else {
        console.log("Background: Offscreen document was likely created by another process or just finished, proceeding.");
      }
  } finally {
      creatingOffscreenPromise = null;
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url) {
    console.log('Background: Tab URL is undefined, cannot execute script.');
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Ошибка',
      message: 'Не удалось определить URL вкладки.',
      priority: 2
    });
    return;
  }

  const allowedProtocols = ['http:', 'https:', 'file:'];
  let currentProtocol;
  try {
    currentProtocol = new URL(tab.url).protocol;
  } catch (e) {
    console.log(`Background: Invalid tab URL: ${tab.url}`, e);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Ошибка',
      message: `Некорректный URL вкладки: ${tab.url}`,
      priority: 2
    });
    return;
  }
  

  if (allowedProtocols.includes(currentProtocol)) {
    if (currentProtocol === 'file:') {
      let hasFileAccess = false;
      try {
        hasFileAccess = await chrome.extension.isAllowedFileSchemeAccess();
      } catch (e) {
        console.warn("Background: Error checking file scheme access (chrome.extension.isAllowedFileSchemeAccess may not be available in all contexts for service workers, trying chrome.runtime alternative):", e);
        try {
            hasFileAccess = await new Promise(resolve => chrome.runtime.isAllowedFileSchemeAccess(resolve));
        } catch (e2) {
            console.error("Background: Failed to check file scheme access with both methods.", e2);
            chrome.notifications.create({
              type: 'basic',
              iconUrl: 'icons/icon48.png',
              title: 'Ошибка проверки доступа',
              message: 'Не удалось проверить разрешение на доступ к файлам. Пожалуйста, убедитесь, что оно включено.',
              priority: 1
            });
            return;
        }
      }

      if (!hasFileAccess) {
        console.log('Background: Extension does not have access to file URLs. Please enable it in chrome://extensions.');
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Требуется разрешение',
          message: 'Для работы с локальными файлами разрешите "Доступ к URL-адресам файлов" на странице расширений (chrome://extensions).',
          priority: 1
        });
        return;
      }
    }

    try {
      const injectionResultsPageHTML = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: getPageHTML,
      });

      if (injectionResultsPageHTML && injectionResultsPageHTML.length > 0 && injectionResultsPageHTML[0].result) {
        const htmlContent = injectionResultsPageHTML[0].result;
        
        await ensureOffscreenDocument();

        console.log("Background: Sending HTML to offscreen document for parsing...");
        const offscreenResponse = await chrome.runtime.sendMessage({
          action: 'parseHTMLViaOffscreen',
          htmlContent: htmlContent,
        });

        if (offscreenResponse && offscreenResponse.success) {
          const parsedData = offscreenResponse.data;
          console.log("Background: Parsed data received from offscreen. Attempting to copy to clipboard via content script...");


          if (parsedData == 'Ошибка при парсинге!') {
            console.warn("Background: Parsed data is invalid.");
            chrome.notifications.create("parseError", {
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: 'Парсинг',
                message: 'Ошибка парсинга содержимого страницы. Вы уверены, что находитесь на странице с заданиями в e-learning?'
            });
          } else {
            console.log("Background: Attempting to copy to clipboard via content script...");
            const copyResults = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: copyTextToClipboardOnPage,
              args: [parsedData],
              world: "MAIN"
            });

            if (copyResults && copyResults.length > 0 && copyResults[0].result === true) {
              console.log('Background: Data successfully copied to clipboard by content script.');
              chrome.action.setBadgeText({ text: "OK", tabId: tab.id });
              chrome.action.setBadgeBackgroundColor({ color: "#4CAF50", tabId: tab.id });

              setTimeout(() => {
                  chrome.action.setBadgeText({ text: "", tabId: tab.id });
              }, 3000);
            } else {
              console.error('Background: Failed to copy data to clipboard via content script.', copyResults);
              let errorDetail = "Неизвестная ошибка.";
              if(copyResults && copyResults.length > 0 && copyResults[0].result === false) {
                  errorDetail = "Функция копирования вернула ошибку. Проверьте консоль активной вкладки.";
              } else if (copyResults && copyResults.length > 0 && copyResults[0].error) {
                  errorDetail = copyResults[0].error.message || "Ошибка при выполнении скрипта копирования.";
              } else if (!copyResults || copyResults.length === 0) {
                  errorDetail = "Скрипт копирования не вернул результат.";
              }

              chrome.notifications.create("copyError", {
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: 'Ошибка буфера обмена',
                message: `Не удалось скопировать данные. ${errorDetail}`,
                priority: 2
              });
            }
          }
        } else {
          const errorMessage = offscreenResponse ? (offscreenResponse.error || "Unknown error") : "No response from offscreen document";
          const errorStack = offscreenResponse ? offscreenResponse.stack : "No stack trace available";
          console.error("Background: Error parsing HTML in offscreen document:", errorMessage, "\nStack:", errorStack);
          chrome.notifications.create("parseError", {
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: 'Ошибка парсинга',
            message: `Ошибка при обработке HTML: ${errorMessage}`,
            priority: 2
          });
        }
      } else {
        console.error('Background: Could not get HTML from page.', injectionResultsPageHTML);
        chrome.notifications.create("getHtmlError", {
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: 'Ошибка',
            message: 'Не удалось получить HTML код страницы.',
            priority: 2
          });
      }
    } catch (error) {
      console.error('Background: General error in onClicked handler:', error, error.stack);
      let notificationMessage = `Произошла ошибка: ${error.message}`;
      if (error.message && error.message.includes("Cannot access contents of url \"file:///\"")) {
         notificationMessage = 'Не удалось получить доступ к локальному файлу. Убедитесь, что разрешен "Доступ к URL-адресам файлов" в настройках расширения.';
      } else if (error.message && error.message.includes("No offscreen document is active")) {
         notificationMessage = "Offscreen документ не активен или не был создан. Попробуйте еще раз.";
      } else if (error.message && error.message.includes("Could not establish connection") && error.message.includes("Receiving end does not exist")) {
         notificationMessage = "Не удалось связаться с offscreen документом. Возможно, он был закрыт или не создан. Попробуйте еще раз.";
      }
      chrome.notifications.create("generalError", {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Критическая ошибка',
        message: notificationMessage,
        priority: 2
      });
    }

  } else {
    console.log(`Background: Cannot execute script on this page protocol: ${currentProtocol}`);
    chrome.notifications.create("protocolError", {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Недоступно',
        message: `Невозможно выполнить на этой странице (протокол ${currentProtocol}). Поддерживаются http, https, file.`,
        priority: 1
      });
  }
});