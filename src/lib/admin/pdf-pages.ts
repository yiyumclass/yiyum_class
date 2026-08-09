/**
 * PDF를 페이지 이미지로 바꾼다.
 *
 * 브라우저에서 처리한다. 서버에 PDF 렌더링을 넣으려면 네이티브 의존성이
 * 따라오는데, 자료 업로드는 어쩌다 한 번 하는 일이라 그 비용을 치를 이유가
 * 없다. 올리는 사람의 브라우저가 대신 그린다.
 */
export type RenderedPage = {
  pageNumber: number;
  blob: Blob;
  width: number;
  height: number;
};

/** 화면에서 읽을 수 있으면 된다. 원본 해상도를 그대로 쓰면 장당 수 MB가 된다. */
const TARGET_WIDTH = 1240;
const JPEG_QUALITY = 0.82;

export async function renderPdfPages(
  file: File,
  onProgress?: (done: number, total: number) => void
): Promise<RenderedPage[]> {
  const pdfjs = await import("pdfjs-dist");
  // 워커를 같은 번들에서 만든다. CDN 주소를 쓰면 CSP 에 걸려 로드되지 않는다.
  pdfjs.GlobalWorkerOptions.workerPort = new Worker(
    new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url),
    { type: "module" }
  );

  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: buffer });
  const document = await loadingTask.promise;
  const pages: RenderedPage[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: TARGET_WIDTH / base.width });

      const canvas = window.document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);

      const context = canvas.getContext("2d");
      if (!context) throw new Error("캔버스를 만들지 못했습니다.");

      // 투명 배경 PDF가 검게 깔리는 것을 막는다.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvas, canvasContext: context, viewport }).promise;

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
      );
      if (!blob) throw new Error("페이지 이미지를 만들지 못했습니다.");

      pages.push({
        pageNumber,
        blob,
        width: canvas.width,
        height: canvas.height,
      });

      page.cleanup();
      onProgress?.(pageNumber, document.numPages);
    }
  } finally {
    // 워커와 네트워크 요청까지 함께 정리한다.
    await loadingTask.destroy();
  }

  return pages;
}
