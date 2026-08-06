"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import {
  getMuxClient,
  isMuxPlaybackConfigured,
  isMuxUploadConfigured,
} from "@/lib/mux/client";
import { createSignedPlaybackToken } from "@/lib/mux/playback";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation/safe-input";

export type MuxUploadTicket =
  | { ok: true; uploadUrl: string; uploadId: string }
  | { ok: false; message: string };

export type MuxSyncResult =
  | { ok: true; status: "preparing"; message: string }
  | { ok: true; status: "ready"; message: string; durationSeconds: number }
  | { ok: false; message: string };

export type MuxPreviewResult =
  | { ok: true; playbackId: string; token: string }
  | { ok: false; message: string };

function revalidateCourses() {
  revalidatePath("/admin/courses");
}

/**
 * 브라우저가 Mux 로 직접 올릴 수 있는 업로드 URL을 만든다.
 * 파일은 이 서버를 거치지 않으므로 업로드 크기 제한이 없다.
 */
export async function createLessonMuxUploadAction(
  lessonId: string
): Promise<MuxUploadTicket> {
  await requireAdmin();

  if (!isUuid(lessonId)) {
    return { ok: false, message: "영상을 연결할 차시를 확인해 주세요." };
  }
  if (!isMuxUploadConfigured()) {
    return { ok: false, message: "영상 업로드 설정이 아직 적용되지 않았습니다." };
  }

  const supabase = await createClient();
  const { data: lesson, error: lessonError } = await supabase
    .from("lessons")
    .select("id")
    .eq("id", lessonId)
    .maybeSingle<{ id: string }>();

  if (lessonError || !lesson) {
    return { ok: false, message: "영상을 연결할 차시를 찾지 못했습니다." };
  }

  try {
    const mux = getMuxClient();
    const upload = await mux.video.uploads.create({
      cors_origin: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
      new_asset_settings: {
        // 수강권 없는 사람이 재생 ID만으로 볼 수 없도록 서명 정책을 쓴다.
        playback_policies: ["signed"],
        passthrough: lessonId,
      },
    });

    if (!upload.url || !upload.id) {
      return { ok: false, message: "업로드 주소를 만들지 못했습니다." };
    }

    const { error: updateError } = await supabase
      .from("lessons")
      .update({ mux_upload_id: upload.id, mux_status: "waiting" })
      .eq("id", lessonId);

    if (updateError) {
      console.error("Failed to store Mux upload id:", updateError.code);
      return { ok: false, message: "업로드 정보를 저장하지 못했습니다." };
    }

    return { ok: true, uploadUrl: upload.url, uploadId: upload.id };
  } catch (error) {
    console.error(
      "Failed to create Mux upload:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { ok: false, message: "업로드를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

/**
 * 관리자가 업로드 직후 재생을 확인하기 위한 서명 토큰.
 * 수강생 재생 경로(/api/learning/video/...)와는 별개이며 관리자만 쓸 수 있다.
 */
export async function getLessonMuxPreviewAction(
  lessonId: string
): Promise<MuxPreviewResult> {
  await requireAdmin();

  if (!isUuid(lessonId)) {
    return { ok: false, message: "확인할 차시를 찾지 못했습니다." };
  }
  if (!isMuxPlaybackConfigured()) {
    return { ok: false, message: "영상 재생 설정이 아직 적용되지 않았습니다." };
  }

  const supabase = await createClient();
  const { data: lesson, error } = await supabase
    .from("lessons")
    .select("mux_playback_id, mux_status, duration_seconds")
    .eq("id", lessonId)
    .maybeSingle<{
      mux_playback_id: string | null;
      mux_status: string | null;
      duration_seconds: number | null;
    }>();

  if (error || !lesson) {
    return { ok: false, message: "확인할 차시를 찾지 못했습니다." };
  }
  if (lesson.mux_status !== "ready" || !lesson.mux_playback_id) {
    return { ok: false, message: "아직 재생할 수 있는 상태가 아닙니다." };
  }

  try {
    const { token } = await createSignedPlaybackToken(
      lesson.mux_playback_id,
      lesson.duration_seconds ?? 0
    );
    return { ok: true, playbackId: lesson.mux_playback_id, token };
  } catch (err) {
    console.error(
      "Failed to sign Mux preview:",
      err instanceof Error ? err.message : "unknown error"
    );
    return { ok: false, message: "재생 토큰을 만들지 못했습니다." };
  }
}

/**
 * 업로드가 끝난 뒤 Mux 인코딩 상태를 확인해 차시에 반영한다.
 * 웹훅은 localhost 로 들어오지 못해서, 지금은 화면에서 이 액션을 반복 호출한다.
 */
export async function syncLessonMuxVideoAction(
  lessonId: string
): Promise<MuxSyncResult> {
  await requireAdmin();

  if (!isUuid(lessonId)) {
    return { ok: false, message: "확인할 차시를 찾지 못했습니다." };
  }
  if (!isMuxUploadConfigured()) {
    return { ok: false, message: "영상 업로드 설정이 아직 적용되지 않았습니다." };
  }

  const supabase = await createClient();
  const { data: lesson, error: lessonError } = await supabase
    .from("lessons")
    .select("mux_upload_id, mux_asset_id")
    .eq("id", lessonId)
    .maybeSingle<{ mux_upload_id: string | null; mux_asset_id: string | null }>();

  if (lessonError || !lesson) {
    return { ok: false, message: "확인할 차시를 찾지 못했습니다." };
  }
  if (!lesson.mux_upload_id && !lesson.mux_asset_id) {
    return { ok: false, message: "업로드된 영상이 없습니다." };
  }

  try {
    const mux = getMuxClient();

    let assetId = lesson.mux_asset_id;
    if (!assetId && lesson.mux_upload_id) {
      const upload = await mux.video.uploads.retrieve(lesson.mux_upload_id);
      if (!upload.asset_id) {
        return { ok: true, status: "preparing", message: "영상을 받는 중입니다." };
      }
      assetId = upload.asset_id;
    }

    if (!assetId) {
      return { ok: true, status: "preparing", message: "영상을 받는 중입니다." };
    }

    const asset = await mux.video.assets.retrieve(assetId);

    if (asset.status === "errored") {
      await supabase
        .from("lessons")
        .update({ mux_asset_id: assetId, mux_status: "errored" })
        .eq("id", lessonId);
      revalidateCourses();
      return { ok: false, message: "Mux 가 영상을 처리하지 못했습니다. 파일을 확인해 주세요." };
    }

    const playbackId = asset.playback_ids?.[0]?.id;
    if (asset.status !== "ready" || !playbackId) {
      await supabase
        .from("lessons")
        .update({ mux_asset_id: assetId, mux_status: "preparing" })
        .eq("id", lessonId);
      return { ok: true, status: "preparing", message: "영상을 변환하는 중입니다." };
    }

    const durationSeconds = Math.max(1, Math.round(asset.duration ?? 0));
    const { error: updateError } = await supabase
      .from("lessons")
      .update({
        mux_asset_id: assetId,
        mux_playback_id: playbackId,
        mux_status: "ready",
        duration_seconds: durationSeconds,
      })
      .eq("id", lessonId);

    if (updateError) {
      console.error("Failed to store Mux asset:", updateError.code);
      return { ok: false, message: "영상 정보를 저장하지 못했습니다." };
    }

    revalidateCourses();
    return {
      ok: true,
      status: "ready",
      message: "영상 준비가 끝났습니다.",
      durationSeconds,
    };
  } catch (error) {
    console.error(
      "Failed to sync Mux asset:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { ok: false, message: "영상 상태를 확인하지 못했습니다." };
  }
}
