export const MAX_COURSE_VIDEO_BYTES = 50 * 1024 * 1024;

export function validateCourseVideoFile(file: File) {
  const extensionValid = file.name.toLowerCase().endsWith(".mp4");
  const typeValid = file.type === "video/mp4" || file.type === "";

  if (!extensionValid || !typeValid) {
    return "현재는 MP4 영상만 업로드할 수 있습니다.";
  }
  if (file.size <= 0) return "내용이 없는 파일은 업로드할 수 없습니다.";
  if (file.size > MAX_COURSE_VIDEO_BYTES) {
    return `파일 용량이 ${formatVideoFileSize(file.size)}입니다. 현재는 50MB 이하 영상만 업로드할 수 있습니다.`;
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
