import { loadCourseVideoManifest } from "@/lib/learning/video";
import { isMuxPlaybackConfigured } from "@/lib/mux/client";
import {
  createSignedPlaybackToken,
  createSignedPlaybackUrl,
} from "@/lib/mux/playback";
import { getVerifiedIdentity } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ courseSlug: string; lessonKey: string }> }
) {
  const { courseSlug, lessonKey } = await params;
  if (!isContentKey(courseSlug) || !isContentKey(lessonKey)) {
    return json({ error: "강의 영상을 찾지 못했습니다." }, 404);
  }

  const supabase = await createClient();
  const identity = await getVerifiedIdentity(supabase);

  if (!identity) return json({ error: "로그인이 필요합니다." }, 401);

  const manifest = await loadCourseVideoManifest(supabase, courseSlug);
  if (!manifest.available) {
    return json({ error: "영상 저장 기능을 준비하고 있습니다." }, 503);
  }

  const video = manifest.videos.find((item) => item.lesson_key === lessonKey);
  if (!video) return json({ error: "재생 가능한 영상이 없습니다." }, 404);

  // 영상 전달은 Mux 로 일원화했다. 수강권은 위 매니페스트에서 이미 확인했다.
  if (!video.mux_playback_id) {
    return json({ error: "재생 가능한 영상이 없습니다." }, 404);
  }
  if (!isMuxPlaybackConfigured()) {
    return json({ error: "영상 재생 설정을 준비하고 있습니다." }, 503);
  }

  try {
    // Mux Player 는 리다이렉트된 m3u8 대신 playbackId + token 을 받아야
    // 화질 전환과 재생 통계가 제대로 붙는다.
    const wantsJson =
      new URL(request.url).searchParams.get("format") === "json";

    if (wantsJson) {
      const { token, expiresInSeconds } = await createSignedPlaybackToken(
        video.mux_playback_id,
        video.duration_seconds
      );
      return json(
        {
          provider: "mux",
          playbackId: video.mux_playback_id,
          token,
          expiresInSeconds,
        },
        200
      );
    }

    const playback = await createSignedPlaybackUrl(
      video.mux_playback_id,
      video.duration_seconds
    );
    return redirectTo(playback.url);
  } catch (error) {
    console.error(
      "Failed to sign Mux playback:",
      error instanceof Error ? error.message : "unknown error"
    );
    return json({ error: "영상 재생 권한을 확인하지 못했습니다." }, 403);
  }
}

function isContentKey(value: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function redirectTo(location: string) {
  return new Response(null, {
    status: 307,
    headers: {
      Location: location,
      "Cache-Control": "private, no-store",
    },
  });
}

function json(body: object, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
