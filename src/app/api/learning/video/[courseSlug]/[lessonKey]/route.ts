import { loadCourseVideoManifest } from "@/lib/learning/video";
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return json({ error: "로그인이 필요합니다." }, 401);

  const manifest = await loadCourseVideoManifest(supabase, courseSlug);
  if (!manifest.available) {
    return json({ error: "영상 저장 기능을 준비하고 있습니다." }, 503);
  }

  const video = manifest.videos.find((item) => item.lesson_key === lessonKey);
  if (!video) return json({ error: "재생 가능한 영상이 없습니다." }, 404);

  if (video.video_provider === "local") {
    if (!video.video_path.startsWith("/videos/")) {
      return json({ error: "영상 경로가 올바르지 않습니다." }, 500);
    }
    return redirectTo(new URL(video.video_path, request.url).toString());
  }

  const { data, error } = await supabase.storage
    .from("course-videos")
    .createSignedUrl(video.video_path, 2 * 60 * 60);

  if (error || !data?.signedUrl) {
    if (error) console.error("Failed to sign lesson video:", error.message);
    return json({ error: "영상 재생 권한을 확인하지 못했습니다." }, 403);
  }

  return redirectTo(data.signedUrl);
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
