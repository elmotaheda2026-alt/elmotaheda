export interface PrintHtmlOptions {
  title?: string;
  width?: number;
  height?: number;
  delayMs?: number;
}

interface ElectronPrintAPI {
  printPreviewHtml?: (payload: { html: string; title?: string }) => Promise<{ success: boolean; error?: string }>;
  printPreviewCurrent?: (payload?: { title?: string }) => Promise<{ success: boolean; error?: string }>;
}

/**
 * Prints an HTML document cleanly.
 * Inside Electron, renders to PDF and opens Chromium's interactive PDF print preview
 * instead of triggering Windows 11's unsupported native print preview dialog.
 */
export async function printHtmlDocument(
  html: string,
  options: PrintHtmlOptions = {}
): Promise<boolean> {
  const electronApi = (window as unknown as { electronAPI?: ElectronPrintAPI }).electronAPI;

  if (electronApi?.printPreviewHtml) {
    const res = await electronApi.printPreviewHtml({
      html,
      title: options.title || 'معاينة الطباعة - شركة المتحدة',
    });
    return Boolean(res?.success);
  }

  const features =
    options.width && options.height
      ? `width=${options.width},height=${options.height}`
      : '';
  const printWindow = window.open('', '_blank', features);
  if (!printWindow) {
    return false;
  }

  let hasPrinted = false;
  const triggerPrint = () => {
    if (hasPrinted || printWindow.closed) return;
    hasPrinted = true;
    try {
      printWindow.print();
    } catch {
      // Ignore user-cancelled print dialog
    }
  };

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();

  if (options.delayMs && options.delayMs > 0) {
    setTimeout(triggerPrint, options.delayMs);
  } else {
    printWindow.onload = triggerPrint;
    setTimeout(() => {
      if (!hasPrinted && !printWindow.closed && printWindow.document.readyState === 'complete') {
        triggerPrint();
      }
    }, 350);
  }

  return true;
}

