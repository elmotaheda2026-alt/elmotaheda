export type PrintPaperSize = 'a4' | 'a4-landscape' | 'thermal-80mm' | 'thermal-58mm';

export interface PrintHtmlOptions {
  title?: string;
  width?: number;
  height?: number;
  delayMs?: number;
  paperSize?: PrintPaperSize;
}

interface ElectronPrintAPI {
  printPreviewHtml?: (payload: {
    html: string;
    title?: string;
    paperSize?: PrintPaperSize;
  }) => Promise<{ success: boolean; error?: string }>;
  printPreviewCurrent?: (payload?: {
    title?: string;
    paperSize?: PrintPaperSize;
  }) => Promise<{ success: boolean; error?: string }>;
}

function prepareBrowserThermalHtml(html: string, widthMm: number): string {
  const cleanCss = `<style id="__thermal_page_override">
    @page {
      size: ${widthMm}mm 297mm;
      margin: 0;
      @top-left { content: none; }
      @top-center { content: none; }
      @top-right { content: none; }
      @bottom-left { content: none; }
      @bottom-center { content: none; }
      @bottom-right { content: none; }
    }
    html, body {
      width: ${widthMm}mm;
      max-width: ${widthMm}mm;
      height: auto !important;
      min-height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
    }
  </style>`;
  const cleanedHtml = html.replace(/@page\s*\{[^}]*\}/gi, '');
  if (/<\/head>/i.test(cleanedHtml)) {
    return cleanedHtml.replace(/<\/head>/i, `${cleanCss}</head>`);
  }
  return `${cleanCss}${cleanedHtml}`;
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
      paperSize: options.paperSize,
    });
    return Boolean(res?.success);
  }

  let preparedHtml = html;
  if (options.paperSize === 'thermal-80mm' || options.paperSize === 'thermal-58mm') {
    const widthMm = options.paperSize === 'thermal-58mm' ? 58 : 80;
    preparedHtml = prepareBrowserThermalHtml(html, widthMm);
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
  printWindow.document.write(preparedHtml);
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

