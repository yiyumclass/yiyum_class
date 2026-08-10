/**
 * 시청 시간·비율 표기. 브라우저 API에 기대지 않는 순수 계산만 둔다.
 * 여기에 두어야 테스트에서 그대로 불러 쓸 수 있다.
 */

export function formatVideoDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const rest = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

/**
 * 시청 비율. 0~100 밖으로 나가지 않게 자른다.
 * 재생기가 끝에서 길이보다 큰 위치를 보고하는 일이 있어 101% 같은 값이 나올 수 있다.
 */
export function calculateWatchPercent(
  watchedSeconds: number,
  durationSeconds: number
) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;

  const ratio = Math.max(0, watchedSeconds) / durationSeconds;
  return Math.min(100, Math.round(ratio * 100));
}

/**
 * 삭제된 차시의 시청량 표기.
 *
 * 차시를 지우고 나면 그 차시의 길이를 lessons 표에서 다시 읽을 수 없다. 그래서
 * 수강 기록에 함께 저장된 길이를 쓰는데, 옛 기록은 그 값이 0일 수 있다. 그때는
 * 비율을 지어내지 않고 시청 시간만 보여 준다.
 */
export function describeWatchProgress(
  watchedSeconds: number,
  durationSeconds: number
) {
  const watched = Math.max(0, Math.round(watchedSeconds));
  const label = formatVideoDuration(watched);

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return label;
  }

  return `${label} (${calculateWatchPercent(watched, durationSeconds)}%)`;
}
