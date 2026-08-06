/**
 * Mux 가 변환을 맡으므로 형식과 용량을 좁게 잡지 않는다.
 * mov, mkv, avi, ProRes 모두 그대로 올려도 된다.
 *
 * 다만 영상이 아닌 파일은 통째로 올린 뒤에야 실패하므로 여기서 먼저 걸러낸다.
 */
export function validateCourseVideoFile(file: File) {
  if (file.size <= 0) return "내용이 없는 파일은 업로드할 수 없습니다.";

  if (file.type) {
    if (!file.type.startsWith("video/")) {
      return "영상 파일이 아닙니다. 동영상 파일을 선택해 주세요.";
    }
    return null;
  }

  // 일부 브라우저는 mkv 같은 형식에 빈 type 을 준다. 그때만 확장자로 판단한다.
  if (!/\.(mp4|mov|m4v|mkv|avi|webm|mpg|mpeg|wmv|flv|ts)$/i.test(file.name)) {
    return "영상 파일인지 확인하지 못했습니다. 동영상 파일을 선택해 주세요.";
  }
  return null;
}

export async function readVideoFileDuration(file: File) {
  const previewUrl = URL.createObjectURL(file);
  try {
    return await readVideoDuration(previewUrl);
  } finally {
    URL.revokeObjectURL(previewUrl);
  }
}

export function readVideoDuration(previewUrl: string) {
  return new Promise<number>((resolve, reject) => {
    const video = document.createElement("video");
    const timeout = window.setTimeout(
      () => finish(new Error("metadata timeout")),
      15_000
    );

    const finish = (error?: Error, duration?: number) => {
      window.clearTimeout(timeout);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
      if (error) reject(error);
      else resolve(duration!);
    };

    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = video.duration;
      if (Number.isFinite(duration) && duration > 0) finish(undefined, duration);
      else finish(new Error("invalid duration"));
    };
    video.onerror = () => finish(new Error("invalid video"));
    video.src = previewUrl;
  });
}

export function formatVideoFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function formatVideoDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const rest = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}
